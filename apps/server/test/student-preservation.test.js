import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import express from 'express';
import importRoutes from '../src/routes/import.js';
import { requireStudentSyncAuth } from '../src/lib/auth.js';
import { ensureCurriculumHistory } from '../src/lib/curriculum.js';

// students.js also imports the application DB path. Keep its bootstrap away from real data.
const bootstrapDir = mkdtempSync(path.join(tmpdir(), 'student-preservation-'));
process.env.DB_PATH = path.join(bootstrapDir, 'bootstrap.sqlite');
const { default: studentRoutes } = await import('../src/routes/students.js');
const { db: bootstrapDb } = await import('../src/lib/db.js');
after(() => {
  bootstrapDb.close();
  for (const name of readdirSync(bootstrapDir)) unlinkSync(path.join(bootstrapDir, name));
  rmdirSync(bootstrapDir);
});

async function fixture(t) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../src/lib/schema.sql', import.meta.url), 'utf8'));
  // Production permits NULL actors for the synchronization service.
  db.exec('DROP TABLE audit_logs; CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, details_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  ensureCurriculumHistory(db);
  db.exec(`INSERT INTO users (id,username,password_hash,role) VALUES (1,'admin','unused','director');
    INSERT INTO students (id,external_id,name) VALUES (1,'keep','Existing'),(2,'incoming','Incoming'),(3,'empty','Empty');
    INSERT INTO weeks (id,label) VALUES (1,'38');
    INSERT INTO mentoring_subjects (id,student_id,name) VALUES (1,1,'Math');
    INSERT INTO subject_records (id,student_id,week_id,subject_id,a_curriculum,a_this_hw)
      VALUES (1,1,1,1,'original curriculum','keep homework');
    INSERT INTO week_records (student_id,week_id,c_director_commentary) VALUES (1,1,'keep weekly feedback');`);
  const app = express(); app.use(express.json());
  app.use('/sync/students', requireStudentSyncAuth(db), studentRoutes(db));
  app.use((req, res, next) => { req.user = { id: 1, role: 'director', username: 'admin' }; next(); });
  app.use('/students', studentRoutes(db)); app.use('/import', importRoutes(db));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = () => ['students','mentoring_subjects','subject_records','week_records','curriculum_history','audit_logs']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  return { db, base, snapshot };
}

test('sync-key and director deletion preserve identity, curricula, homework, feedback and history', async t => {
  const f = await fixture(t);
  const previousKey = process.env.STUDENT_SYNC_API_KEY;
  process.env.STUDENT_SYNC_API_KEY = 'test-student-sync-key';
  t.after(() => { if (previousKey === undefined) delete process.env.STUDENT_SYNC_API_KEY; else process.env.STUDENT_SYNC_API_KEY = previousKey; });
  for (const route of ['/sync/students/1', '/students/1']) {
    const before = f.snapshot();
    const response = await fetch(f.base + route, { method: 'DELETE', headers: { 'X-Student-Sync-Key': 'test-student-sync-key' } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'STUDENT_HAS_LEARNING_RECORDS');
    assert.deepEqual(f.snapshot(), before);
  }
  // A later roster upsert must find and retain the same internal identity.
  const response = await fetch(f.base + '/import/students', {
    method: 'POST', body: roster([{ external_id: 'keep', name: 'Existing' }])
  });
  assert.equal(response.status, 200);
  assert.equal(f.db.prepare("SELECT id FROM students WHERE external_id='keep'").get().id, 1);
  assert.equal(f.db.prepare('SELECT a_curriculum FROM subject_records WHERE id=1').get().a_curriculum, 'original curriculum');
});

function roster(students) {
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify({ students })], { type: 'application/json' }), 'roster.json');
  return form;
}

test('deleteMissing import preserves learning records but still deletes a genuinely empty student', async t => {
  const f = await fixture(t);
  const before = f.snapshot();
  const response = await fetch(f.base + '/import/students?deleteMissing=true', {
    method: 'POST', body: roster([{ external_id: 'incoming', name: 'Incoming' }])
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.deleted, 1); assert.equal(result.protectedMissing, 1); assert.equal(result.preservedMissing, 1);
  assert.ok(f.db.prepare('SELECT id FROM students WHERE id=1').get());
  assert.equal(f.db.prepare('SELECT id FROM students WHERE id=3').get(), undefined);
  assert.deepEqual(f.snapshot().slice(1, 5), before.slice(1, 5));
});

test('weekly feedback alone and surviving curriculum history each prevent deletion', async t => {
  const f = await fixture(t);
  f.db.prepare('DELETE FROM subject_records WHERE student_id=1').run();
  const response = await fetch(f.base + '/students/1', { method: 'DELETE' });
  assert.equal(response.status, 409);
  f.db.prepare('DELETE FROM week_records WHERE student_id=1').run();
  const before = f.snapshot();
  const historical = await fetch(f.base + '/students/1', { method: 'DELETE' });
  assert.equal(historical.status, 409); assert.deepEqual(f.snapshot(), before);
  f.db.prepare('INSERT INTO week_records (student_id,week_id,c_director_commentary) VALUES (3,1,?)').run('weekly only');
  assert.equal((await fetch(f.base + '/students/3', { method: 'DELETE' })).status, 409);
});

test('empty student deletion remains available and rolls back if its audit cannot be stored', async t => {
  const f = await fixture(t);
  f.db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.equal((await fetch(f.base + '/students/3', { method: 'DELETE' })).status, 500);
  assert.ok(f.db.prepare('SELECT id FROM students WHERE id=3').get());
  f.db.exec('DROP TRIGGER audit_failure');
  assert.equal((await fetch(f.base + '/students/3', { method: 'DELETE' })).status, 200);
  assert.equal(f.db.prepare('SELECT id FROM students WHERE id=3').get(), undefined);
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_logs WHERE entity='student' AND action='delete' AND entity_id=3").get().n, 1);
});
