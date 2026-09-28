import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import express from 'express';
import mentoringRoutes from '../src/routes/mentoring.js';
import weekRoutes from '../src/routes/weeks.js';
import { ensureCurriculumHistory, fillMissingCurricula, hasCurriculum } from '../src/lib/curriculum.js';
import { reconcileSubjectDrafts, createSubjectSaveQueue } from '../../web/src/utils/subjectDrafts.js';
import { planCurriculumRecovery, applyCurriculumRecovery } from '../src/lib/curriculumRecovery.js';

function fixture(t) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../src/lib/schema.sql', import.meta.url), 'utf8'));
  ensureCurriculumHistory(db);
  db.exec(`INSERT INTO users (id, username, password_hash, role) VALUES (1,'test','unused','director');
    INSERT INTO students (id,name) VALUES (1,'A'),(2,'B');
    INSERT INTO weeks (id,label) VALUES (1,'31회차'),(2,'32회차'),(3,'33회차'),(4,'34회차');
    INSERT INTO mentoring_subjects (id,student_id,name) VALUES (1,1,'국어'),(2,1,'수학'),(3,2,'영어');
    INSERT INTO field_permissions (field_key, label, roles_view_json, roles_edit_json)
      VALUES ('a_curriculum','curriculum','["director"]','["director"]'),
        ('a_comment','comment','["director"]','["director"]');`);
  t.after(() => db.close());
  const insert = (student, week, subject, curriculum) => Number(db.prepare(`INSERT INTO subject_records
    (student_id,week_id,subject_id,a_curriculum,a_comment) VALUES (?,?,?,?,'keep comment')`)
    .run(student, week, subject, curriculum).lastInsertRowid);
  const get = (id) => db.prepare('SELECT * FROM subject_records WHERE id=?').get(id);
  return { db, insert, get };
}

test('inherit each subject across missing weeks, preserving all existing fields and other students', (t) => {
  const { db, insert, get } = fixture(t);
  insert(1, 1, 1, 'original Korean');
  insert(1, 2, 2, 'latest math');
  insert(1, 4, 1, 'future must not leak');
  const target = insert(1, 3, 1, null);
  const populated = insert(1, 3, 2, 'current math');
  const other = insert(2, 3, 3, 'other student');
  const before = get(target), beforePopulated = get(populated), beforeOther = get(other);
  assert.equal(fillMissingCurricula(db, 1, 3, 2), 1);
  assert.deepEqual(get(target), { ...before, a_curriculum: 'original Korean' });
  assert.deepEqual(get(populated), beforePopulated);
  assert.deepEqual(get(other), beforeOther);
  assert.equal(fillMissingCurricula(db, 1, 3, 2), 0);
});

test('empty legacy JSON and unvisited weeks do not interrupt carry-forward', (t) => {
  const { db, insert } = fixture(t);
  insert(1, 1, 1, 'original');
  insert(1, 2, 1, '{"director":""}');
  assert.equal(fillMissingCurricula(db, 1, 4), 1);
  assert.equal(db.prepare('SELECT a_curriculum FROM subject_records WHERE week_id=4').get().a_curriculum, 'original');
  assert.equal(db.prepare('SELECT count(*) n FROM subject_records WHERE week_id=3').get().n, 0);
});

test('pinned source stays bounded and archived subjects are not resurrected', (t) => {
  const { db, insert } = fixture(t);
  insert(1, 1, 1, 'pinned'); insert(1, 2, 1, 'newer'); insert(1, 1, 2, 'archived');
  db.prepare('UPDATE mentoring_subjects SET deleted_from_week_id=3 WHERE id=2').run();
  assert.equal(fillMissingCurricula(db, 1, 4, 1), 1);
  assert.equal(db.prepare('SELECT a_curriculum FROM subject_records WHERE week_id=4').get().a_curriculum, 'pinned');
});

test('history keeps both versions and survives row deletion; initialization is idempotent', (t) => {
  const { db, insert } = fixture(t);
  const id = insert(1, 1, 1, 'v1');
  ensureCurriculumHistory(db);
  db.prepare('UPDATE subject_records SET a_curriculum=? WHERE id=?').run('v2', id);
  db.prepare('DELETE FROM subject_records WHERE id=?').run(id);
  assert.deepEqual(db.prepare('SELECT before_value,after_value,operation FROM curriculum_history ORDER BY id').all(), [
    { before_value: null, after_value: 'v1', operation: 'insert' },
    { before_value: 'v1', after_value: 'v2', operation: 'update' },
    { before_value: 'v2', after_value: null, operation: 'delete' }
  ]);
});

async function apiFixture(t) {
  const f = fixture(t);
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, role: req.headers['x-role'] || 'director' }; next(); });
  app.use('/api/mentoring', mentoringRoutes(f.db));
  app.use('/api/weeks', weekRoutes(f.db));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/mentoring`;
  return { ...f, createWeek: () => fetch(`http://127.0.0.1:${server.address().port}/api/weeks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: '35회차' })
  }), snapshot: (role = 'director') => fetch(`${base}/curriculum-snapshot?studentIds=1`, { headers: { 'x-role': role } }), update: (id, body, role = 'director') => fetch(`${base}/subject-record/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-role': role }, body: JSON.stringify(body)
  }), read: (week) => fetch(`${base}/record?studentId=1&weekId=${week}`),
  source: (source) => fetch(`${base}/curriculum-source`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: 1, week_id: 4, source_week_id: source })
  }) };
}

test('API rejects blank erasure, stale/legacy saves, wrong scope and unauthorized writes', async (t) => {
  const f = await apiFixture(t); const id = f.insert(1, 3, 1, 'saved'); const before = f.get(id);
  for (const blank of ['', ' \n ', null, '{}', '[]', '{"director":""}']) {
    const response = await f.update(id, { a_curriculum: blank, expected_curriculum: 'saved', a_comment: 'must roll back' });
    assert.equal(response.status, 409); assert.deepEqual(f.get(id), before);
  }
  for (const body of [
    { a_curriculum: 'stale', expected_curriculum: 'old' },
    { a_curriculum: 'legacy' },
    { a_curriculum: 'wrong', expected_curriculum: 'saved', student_id: 2 },
    { a_curriculum: 'wrong', expected_curriculum: 'saved', week_id: 2 }
  ]) { assert.equal((await f.update(id, body)).status, 409); assert.deepEqual(f.get(id), before); }
  assert.equal((await f.update(id, { a_curriculum: 'unauthorized', expected_curriculum: 'saved' }, 'parent')).status, 403);
  assert.equal((await f.update(id, { a_comment: 'comment only' })).status, 200);
  assert.equal(f.get(id).a_curriculum, 'saved');
});

test('API supports initial save, edits, retry and atomic audit; stale client cannot overwrite latest', async (t) => {
  const f = await apiFixture(t); const id = f.insert(1, 3, 1, null);
  const save = (value, expected) => f.update(id, { a_curriculum: value, expected_curriculum: expected });
  assert.equal((await save('v1', '')).status, 200);
  assert.equal((await save('v2', 'v1')).status, 200);
  assert.equal((await save('v2', 'v1')).status, 200);
  assert.equal((await save('stale', 'v1')).status, 409);
  assert.equal(f.get(id).a_curriculum, 'v2');
  const audit = JSON.parse(f.db.prepare('SELECT details_json FROM audit_logs ORDER BY id LIMIT 1').get().details_json);
  assert.equal(audit.before.a_curriculum, null); assert.equal(audit.after.a_curriculum, 'v1');
  f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.equal((await save('v3', 'v2')).status, 500);
  assert.equal(f.get(id).a_curriculum, 'v2');
  assert.equal(f.db.prepare('SELECT count(*) n FROM curriculum_history WHERE after_value=?').get('v3').n, 0);
});

test('record API and automatic source load both recover across a gap', async (t) => {
  const f = await apiFixture(t); f.insert(1, 1, 1, 'week one');
  const response = await f.read(3); assert.equal(response.status, 200);
  const record = await response.json();
  assert.equal(record.subject_records.find((row) => row.subject_id === 1).a_curriculum, 'week one');
  assert.equal((await f.source(null)).status, 200);
  assert.equal(f.db.prepare('SELECT a_curriculum FROM subject_records WHERE week_id=4 AND subject_id=1').get().a_curriculum, 'week one');
});

test('administrative snapshot is read-only and restricted to directors/admins', async (t) => {
  const f = await apiFixture(t); f.insert(1, 1, 1, 'original');
  const before = f.db.serialize();
  const response = await f.snapshot(); assert.equal(response.status, 200);
  const snapshot = await response.json(); assert.equal(snapshot.subject_records.length, 1);
  assert.deepEqual(f.db.serialize(), before);
  for (const role of ['lead', 'mentor', 'parent']) assert.equal((await f.snapshot(role)).status, 403);
});

test('new week materializes curricula without visiting intermediate weeks or changing old records', async (t) => {
  const f = await apiFixture(t); f.insert(1, 1, 1, 'saved weeks ago'); f.insert(2, 2, 3, 'other saved plan');
  const before = f.db.prepare('SELECT * FROM subject_records ORDER BY id').all();
  const response = await f.createWeek(); assert.equal(response.status, 200);
  const { id } = await response.json();
  assert.equal(f.db.prepare('SELECT a_curriculum FROM subject_records WHERE week_id=? AND subject_id=1').get(id).a_curriculum, 'saved weeks ago');
  assert.deepEqual(f.db.prepare('SELECT * FROM subject_records WHERE week_id<? ORDER BY id').all(id), before);
});

test('refresh displays recovered values while retaining dirty edits and conflict bases', () => {
  const keys = ['a_curriculum', 'a_comment'];
  const result = reconcileSubjectDrafts([{ id: 1, a_curriculum: 'recovered', a_comment: 'server edit' }],
    { 1: { a_curriculum: '', a_comment: 'unsaved' } }, { 1: { a_curriculum: '', a_comment: 'original' } }, keys);
  assert.equal(result.drafts[1].a_curriculum, 'recovered');
  assert.equal(result.drafts[1].a_comment, 'unsaved');
  assert.equal(result.baselines[1].a_comment, 'original');
});

test('blur and save button serialize requests; failure does not poison the queue', async () => {
  const queue = createSubjectSaveQueue(), events = []; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queue('1', async () => { events.push('first-start'); await gate; events.push('first-end'); });
  const second = queue('1', async () => { events.push('second'); });
  await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(events, ['first-start']);
  release(); await Promise.all([first, second]); assert.deepEqual(events, ['first-start', 'first-end', 'second']);
  await assert.rejects(queue('1', async () => { throw Error('network'); }));
  assert.equal(await queue('1', async () => 'retry'), 'retry');
});

test('meaningful curriculum handles historical editor encodings', () => {
  for (const value of [null, '', ' ', '{}', '[]', 'null', '{"director":""}']) assert.equal(hasCurriculum(value), false);
  for (const value of ['plan', '123', '{"director":"plan"}']) assert.equal(hasCurriculum(value), true);
});

test('recovery chooses surviving same-week history, fills only blanks and proves unrelated data unchanged', (t) => {
  const { db, insert, get } = fixture(t);
  insert(1, 1, 1, 'old plan'); const target = insert(1, 3, 1, 'latest plan');
  db.prepare('UPDATE subject_records SET a_curriculum=NULL WHERE id=?').run(target);
  const existing = insert(1, 3, 2, 'leave intact'); const other = insert(2, 3, 3, 'other student');
  const originals = [get(target), get(existing), get(other)];
  const plan = planCurriculumRecovery(db, { studentNames: ['A'], weekId: 3 });
  assert.equal(plan.changes.length, 1); assert.equal(plan.changes[0].after, 'latest plan');
  const result = applyCurriculumRecovery(db, plan);
  assert.equal(result.restored, 1); assert.equal(result.protected_digest_before, result.protected_digest_after);
  assert.deepEqual(get(target), { ...originals[0], a_curriculum: 'latest plan' });
  assert.deepEqual(get(existing), originals[1]); assert.deepEqual(get(other), originals[2]);
  assert.throws(() => applyCurriculumRecovery(db, plan), /not empty/);
});

test('recovery aborts every change when any target was edited after planning', (t) => {
  const { db, insert, get } = fixture(t);
  insert(1, 1, 1, 'Korean'); insert(1, 1, 2, 'math');
  const a = insert(1, 3, 1, null), b = insert(1, 3, 2, null);
  const plan = planCurriculumRecovery(db, { studentNames: ['A'], weekId: 3 });
  db.prepare('UPDATE subject_records SET a_curriculum=? WHERE id=?').run('concurrent edit', b);
  assert.throws(() => applyCurriculumRecovery(db, plan), /not empty/);
  assert.equal(get(a).a_curriculum, null); assert.equal(get(b).a_curriculum, 'concurrent edit');
});

test('recovery uses backup evidence, rejects wrong identity and leaves conflicting versions unresolved', (t) => {
  const current = fixture(t), backup = fixture(t), conflict = fixture(t);
  const id = current.insert(1, 3, 1, null);
  backup.insert(1, 3, 1, 'backup plan'); conflict.insert(1, 3, 1, 'conflicting plan');
  const options = { studentNames: ['A'], weekId: 3, sources: [{ name: 'backup', db: backup.db }] };
  assert.equal(planCurriculumRecovery(current.db, options).changes[0].after, 'backup plan');
  options.sources.push({ name: 'conflict', db: conflict.db });
  assert.equal(planCurriculumRecovery(current.db, options).changes.length, 0);
  for (const source of options.sources) source.db.exec("UPDATE students SET name='wrong identity' WHERE id=1");
  assert.equal(planCurriculumRecovery(current.db, options).changes.length, 0);
  assert.equal(current.get(id).a_curriculum, null);
});

test('recovery rolls back unexpected trigger side effects on unrelated records', (t) => {
  const { db, insert, get } = fixture(t);
  insert(1, 1, 1, 'saved'); const target = insert(1, 3, 1, null);
  const plan = planCurriculumRecovery(db, { studentNames: ['A'], weekId: 3 });
  db.exec(`CREATE TRIGGER unexpected_side_effect AFTER UPDATE OF a_curriculum ON subject_records
    BEGIN UPDATE students SET name='unexpected' WHERE id=2; END;`);
  assert.throws(() => applyCurriculumRecovery(db, plan), /Unrelated data changed/);
  assert.equal(get(target).a_curriculum, null); assert.equal(db.prepare('SELECT name FROM students WHERE id=2').get().name, 'B');
});
