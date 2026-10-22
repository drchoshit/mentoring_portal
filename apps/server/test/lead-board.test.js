import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import Database from 'better-sqlite3';
import routes from '../src/routes/mentorAssignments.js';
import { requireAuth, signToken } from '../src/lib/auth.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('board includes reassignments; admin mentor changes persist independently of source sync', async (t) => {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../src/lib/schema.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'unused', 'admin')").run();
  db.prepare("INSERT INTO students (id, name) VALUES (1, '학생')").run();
  db.prepare("INSERT INTO weeks (id, label, start_date, end_date) VALUES (1, '회차', '2026-10-19', '2026-10-25')").run();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: 1, role: req.headers['x-role'] || 'admin' }; next(); });
  app.use('/api', routes(db));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT)');
  const putSetting = (key, data) => db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)').run(key, JSON.stringify(data));
  const source = { periodId: '2026-10-19~2026-10-25', assignments: [{ student_id: 1, name: '학생', lead_mentor: '기존M', scheduledDays: ['목'] }] };
  putSetting('mentor_assignments', source);
  putSetting('mentor_info', { mentors: [{ name: '기존M', role: 'lead' }, { name: '변경M', role: 'lead' }] });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const get = async (path) => { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json(); };
  const update = (role, mentor_name = '변경M') => fetch(base + '/lead-board/mentor', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-role': role }, body: JSON.stringify({ week_id: 1, student_id: 1, mentor_name }) });
  await get('/lead-week-status?weekId=1');
  db.prepare(`INSERT INTO lead_mentoring_reassignments (week_id, student_id, source_assignment_date, source_mentor_name, target_assignment_date, target_mentor_name) VALUES (1, 1, '2026-10-20', '기존M', '2026-10-22', '변경M')`).run();
  const board = await get('/lead-board?weekId=1');
  assert.equal(board.reassignments[0].target_day_label, '목');
  assert.equal(board.reassignments[0].student_name, '학생');
  assert.equal((await update('lead')).status, 403);
  assert.equal((await update('admin', '미등록M')).status, 400);
  assert.equal((await update('admin')).status, 200);
  putSetting('mentor_assignments', source);
  assert.equal((await get('/lead-board?weekId=1')).assignments[0].lead_mentor, '변경M');
  const status = await get('/lead-week-status?weekId=1');
  const thursday = status.days.find((day) => day.date === '2026-10-22');
  assert.equal(thursday.assignments.length, 1);
  assert.equal(thursday.assignments[0].mentor_name, '변경M');
  assert.equal(thursday.assignments[0].reassigned, true);
});

for (const account of [{ username: 'staff1', role: 'admin' }, { username: 'admin', role: 'director' }]) {
  test(`${account.username}: authenticated save, reopen database, status, reassignment and week isolation`, async (t) => {
    const folder = mkdtempSync(path.join(tmpdir(), 'lead-board-'));
    const filename = path.join(folder, 'test.sqlite');
    let db = new Database(filename);
    db.exec(readFileSync(new URL('../src/lib/schema.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (1, ?, ?, ?)').run(account.username, 'unused', account.role);
    db.prepare("INSERT INTO students (id, name) VALUES (1, '학생')").run();
    for (const id of [1, 2]) db.prepare('INSERT INTO weeks (id, label, start_date, end_date) VALUES (?, ?, ?, ?)')
      .run(id, `회차${id}`, id === 1 ? '2026-10-19' : '2026-10-26', id === 1 ? '2026-10-25' : '2026-11-01');
    db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT)');
    const row = { student_id: 1, name: '학생', lead_mentor: '기존M', scheduledDays: ['목'] };
    const source = { assignments_by_period: { '2026-10-19~2026-10-25': [row], '2026-10-26~2026-11-01': [row] } };
    const setting = (key, value) => db.prepare('INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?, ?)').run(key, JSON.stringify(value));
    setting('mentor_assignments', source);
    setting('mentor_info', { mentors: ['기존M', '변경M'].map((name) => ({ name, role: 'lead' })) });
    const token = signToken({ id: 1, ...account });
    const app = express();
    app.use(express.json());
    // Proxy keeps the real authentication and routes using the reopened database.
    const proxy = new Proxy({}, { get: (_, key) => typeof db[key] === 'function' ? db[key].bind(db) : db[key] });
    app.use('/api', requireAuth(proxy), routes(proxy));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(folder, { recursive: true, force: true });
    });
    const request = async (url, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    await request('/lead-board/mentor', 'PUT', { week_id: 1, student_id: 1, mentor_name: '변경M' });
    db.close();
    db = new Database(filename);
    // A fresh source import must not erase the administrator's saved override.
    setting('mentor_assignments', source);
    assert.equal((await request('/lead-board?weekId=1')).assignments[0].lead_mentor, '변경M');
    assert.equal((await request('/lead-board?weekId=2')).assignments[0].lead_mentor, '기존M');
    const weekly = await request('/lead-week-status?weekId=1');
    assert.equal(weekly.assignments[0].mentor_name, '변경M');
    assert.equal((await request('/lead-today?weekId=1')).assignments[0].mentor_name, '변경M');
    await request('/lead-today/status', 'PUT', { week_id: 1, student_id: 1, mentor_name: '변경M', assignment_date: '2026-10-22', status: 'missed', reason: '일정 변경' });
    await request('/lead-today/reassign', 'POST', { week_id: 1, student_id: 1, source_mentor_name: '변경M', source_assignment_date: '2026-10-22', target_mentor_name: '기존M', target_assignment_date: '2026-10-23' });
    const board = await request('/lead-board?weekId=1');
    assert.equal(board.reassignments.length, 1);
    assert.equal(board.reassignments[0].target_day_label, '금');
    assert.equal(board.reassignments[0].target_mentor_name, '기존M');
    const updated = await request('/lead-week-status?weekId=1');
    const friday = updated.days.find((day) => day.date === '2026-10-23').assignments;
    assert.equal(friday.length, 1);
    assert.equal(friday[0].mentor_name, board.reassignments[0].target_mentor_name);
    assert.equal(friday[0].reassigned, true);
    await request('/lead-today/status', 'PUT', { week_id: 1, student_id: 1, mentor_name: '기존M', assignment_date: '2026-10-23', status: 'completed' });
    const completed = await request('/lead-week-status?weekId=1');
    assert.equal(completed.days.find((day) => day.date === '2026-10-23').assignments[0].status.status, 'completed');
    assert.equal(completed.days.find((day) => day.date === '2026-10-22').assignments[0].status.status, 'missed');
  });
}
