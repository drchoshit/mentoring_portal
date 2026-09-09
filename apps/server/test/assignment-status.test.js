import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import mentoringRoutes from '../src/routes/mentoring.js';
import mentorBriefingsRoutes from '../src/routes/mentorBriefings.js';
import { signToken } from '../src/lib/auth.js';

async function fixture(t, { latestStart = '2026-09-14', latestEnd = '2026-09-20' } = {}) {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../src/lib/schema.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES (1, 'test', 'unused', 'director')").run();
  db.prepare("INSERT INTO students (id, name) VALUES (1, '테스트 학생')").run();
  db.prepare('INSERT INTO weeks (id, label, start_date, end_date) VALUES (?, ?, ?, ?)')
    .run(1, '이전 회차', '2026-09-07', '2026-09-13');
  db.prepare('INSERT INTO weeks (id, label, start_date, end_date) VALUES (?, ?, ?, ?)')
    .run(2, '최신 회차', latestStart, latestEnd);
  const assignment = {
    mentor_id: 'original-mentor', mentor_name: '기존멘토M', mentor_role: 'mentor',
    session_day_label: '화', session_month: '9', session_day: '8',
    session_start_time: '18:30', session_duration_minutes: 15,
    assigned_at: '2026-09-07T12:00:00.000Z', assigned_by: '원장'
  };
  const problem = {
    subject: '수학', problem_name: '22', note: '전달사항 보존',
    images: [{ id: 'image-1', url: '/test-image.jpg', filename: '문제.jpg' }],
    assignment, completion_status: 'done', completion_feedback: '이전 멘토의 피드백'
  };
  db.prepare('INSERT INTO week_records (id, student_id, week_id, e_wrong_answer_distribution) VALUES (1, 1, 1, ?)')
    .run(JSON.stringify({ assignment, problems: [problem, { ...problem, problem_name: '23' }] }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, role: req.headers['x-test-role'] || 'director', display_name: '원장' };
    next();
  });
  app.use('/api/mentoring', mentoringRoutes(db));
  app.use('/api/mentor-briefings', mentorBriefingsRoutes(db));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/mentoring/assignment-status`;
  const read = () => JSON.parse(db.prepare('SELECT e_wrong_answer_distribution FROM week_records WHERE id=1').get().e_wrong_answer_distribution);
  return {
    db, read,
    briefing: async () => {
      const briefingBase = `http://127.0.0.1:${server.address().port}/api/mentor-briefings`;
      const issued = await fetch(`${briefingBase}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({ id: 1, role: 'director' })}` },
        body: JSON.stringify({ week_id: 2, mentor_name: '새멘토M' })
      });
      assert.equal(issued.status, 200);
      const credentials = await issued.json();
      const opened = await fetch(`${briefingBase}/open`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: credentials.token, pin_code: credentials.pin_code })
      });
      assert.equal(opened.status, 200);
      return opened.json();
    },
    update: (body, role = 'director') => fetch(`${base}/1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-role': role },
      body: JSON.stringify({ problem_index: 0, mentor_name: '새멘토M', session_day_label: '화', ...body })
    }),
    list: async (week) => {
      const response = await fetch(`${base}?weekId=${week}`);
      assert.equal(response.status, 200);
      return (await response.json()).assignments;
    }
  };
}

test('changing mentor shows only that question in the latest round with its images and a pending status', async (t) => {
  const f = await fixture(t);
  const original = f.read();
  const originalRows = await f.list(1);
  const response = await f.update({ session_month: '9', session_day: '8' });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.target_week.id, 2);
  assert.equal(saved.assignment.mentor_id, '새멘토M');
  assert.equal(saved.assignment.session_day, '15');
  const latest = await f.list(2);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].mentor_name, '새멘토M');
  assert.equal(latest[0].completion_status, 'pending');
  assert.equal(latest[0].completion_feedback, '');
  assert.equal(latest[0].problem_items[0].images[0].url, '/test-image.jpg');
  assert.equal(latest[0].problem_items[0].note, original.problems[0].note);
  const previous = await f.list(1);
  assert.equal(previous.length, 1);
  assert.equal(previous[0].problem_index, 1);
  assert.deepEqual(previous[0], originalRows.find((row) => row.problem_index === 1));
  const audit = JSON.parse(f.db.prepare('SELECT details_json FROM audit_logs ORDER BY id DESC LIMIT 1').get().details_json);
  assert.equal(audit.previous_completion_feedback, '이전 멘토의 피드백');
});

test('saving the same mentor preserves the round and completion record', async (t) => {
  const f = await fixture(t);
  const response = await f.update({ mentor_name: '기존멘토M' });
  assert.equal(response.status, 200);
  assert.equal((await f.list(2)).length, 0);
  const previous = await f.list(1);
  assert.equal(previous.length, 2);
  assert.equal(previous[0].completion_status, 'done');
  assert.equal(previous[0].completion_feedback, '이전 멘토의 피드백');
  assert.equal(previous[0].assigned_at, '2026-09-07T12:00:00.000Z');
});

test('reassignment works for a non-first question even if the latest round has no dates', async (t) => {
  const f = await fixture(t, { latestStart: null, latestEnd: null });
  assert.equal((await f.update({ problem_index: 1 })).status, 200);
  const latest = await f.list(2);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].problem_index, 1);
  assert.equal(latest[0].session_month, '');
  assert.equal(latest[0].session_day, '');
  assert.equal((await f.list(1))[0].problem_index, 0);
});

test('an explicit round prevents a question from falling into a previous year or a newly created round', async (t) => {
  const f = await fixture(t, { latestStart: '2027-09-06', latestEnd: '2027-09-12' });
  assert.equal((await f.update({})).status, 200);
  assert.equal((await f.list(2)).length, 1);
  f.db.prepare("INSERT INTO weeks (id, label, start_date, end_date) VALUES (3, '다음 회차', '2027-09-13', '2027-09-19')").run();
  assert.equal((await f.update({ mentor_name: '새멘토M' })).status, 200);
  assert.equal((await f.list(2)).length, 1);
  assert.equal((await f.list(3)).length, 0);
});

test('missing work day keeps the question in the latest round without inventing a scheduled date', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.update({ session_day_label: '' })).status, 200);
  const latest = await f.list(2);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].session_month, '');
  assert.equal(latest[0].session_day, '');
});

test('clinic mentors cannot reassign questions', async (t) => {
  const f = await fixture(t);
  const original = f.read();
  assert.equal((await f.update({}, 'mentor')).status, 403);
  assert.deepEqual(f.read(), original);
});

test('the selected mentor briefing includes the reassigned question in the latest round', async (t) => {
  const f = await fixture(t, { latestStart: null, latestEnd: null });
  assert.equal((await f.update({})).status, 200);
  const briefing = await f.briefing();
  assert.equal(briefing.week.id, 2);
  assert.equal(briefing.item_count, 1);
  assert.equal(briefing.items[0].mentor_name, '새멘토M');
});
