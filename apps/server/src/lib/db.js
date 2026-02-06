// apps/server/src/lib/db.js
// SQLite DB helper (better-sqlite3)

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function resolveDbFile() {
  if (process.env.NODE_ENV === 'test') return ':memory:';

  const p = process.env.DB_PATH;
  if (p) return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);

  const dataDir = path.resolve(process.cwd(), 'data');
  ensureDir(dataDir);

  const dbSqlite = path.join(dataDir, 'db.sqlite');
  const appDb = path.join(dataDir, 'app.db');
  if (!fs.existsSync(dbSqlite) && fs.existsSync(appDb)) return appDb;

  return dbSqlite;
}

const dbFile = resolveDbFile();
const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function columnMap(table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  const m = new Map();
  for (const r of rows) m.set(r.name, r);
  return m;
}

function ensureUsersTableAndColumns() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'mentor',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const cols = columnMap('users');

  if (!cols.has('username')) db.exec(`ALTER TABLE users ADD COLUMN username TEXT;`);
  if (!cols.has('email')) db.exec(`ALTER TABLE users ADD COLUMN email TEXT;`);
  if (!cols.has('password_hash')) db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT;`);
  if (!cols.has('role')) db.exec(`ALTER TABLE users ADD COLUMN role TEXT;`);
  if (!cols.has('created_at')) db.exec(`ALTER TABLE users ADD COLUMN created_at TEXT;`);
  if (!cols.has('updated_at')) db.exec(`ALTER TABLE users ADD COLUMN updated_at TEXT;`);

  // 추가: 화면에서 쓰는 컬럼들
  if (!cols.has('display_name')) db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT;`);
  if (!cols.has('is_active')) db.exec(`ALTER TABLE users ADD COLUMN is_active INTEGER;`);

  // 백필
  db.exec(`
    UPDATE users SET role = COALESCE(NULLIF(role,''), 'mentor')
    WHERE role IS NULL OR role = '';
  `);

  db.exec(`
    UPDATE users SET created_at = COALESCE(NULLIF(created_at,''), datetime('now'))
    WHERE created_at IS NULL OR created_at = '';
  `);

  db.exec(`
    UPDATE users SET updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
    WHERE updated_at IS NULL OR updated_at = '';
  `);

  db.exec(`
    UPDATE users SET is_active = COALESCE(is_active, 1)
    WHERE is_active IS NULL;
  `);

  db.exec(`
    UPDATE users
    SET display_name = COALESCE(NULLIF(display_name,''), username)
    WHERE display_name IS NULL OR display_name = '';
  `);

  // username/email 최대한 채움(레거시)
  db.exec(`
    UPDATE users
    SET username = COALESCE(NULLIF(username,''), CASE
      WHEN email IS NOT NULL AND instr(email, '@') > 1 THEN substr(email, 1, instr(email,'@')-1)
      ELSE username
    END)
    WHERE username IS NULL OR username = '';
  `);

  db.exec(`
    UPDATE users
    SET email = COALESCE(NULLIF(email,''), CASE
      WHEN username IS NOT NULL AND username != '' THEN username || '@demo.local'
      ELSE email
    END)
    WHERE email IS NULL OR email = '';
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_uq ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_uq ON users(email);
  `);
}

function ensureStudentsColumns() {
  // students 테이블은 bootstrap에서 생성되므로 여기서는 컬럼만 보강
  const cols = columnMap('students');

  // 학생 성적/목표대학 등 저장용
  if (!cols.has('profile_json')) db.exec(`ALTER TABLE students ADD COLUMN profile_json TEXT;`);

  // 혹시 레거시 DB에 updated_at 없으면 보강 (안전장치)
  if (!cols.has('updated_at')) db.exec(`ALTER TABLE students ADD COLUMN updated_at TEXT;`);

  db.exec(`
    UPDATE students
    SET updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
    WHERE updated_at IS NULL OR updated_at = '';
  `);
}

function ensureWeekRecordsColumns() {
  const cols = columnMap('week_records');

  if (!cols.has('b_daily_tasks')) db.exec(`ALTER TABLE week_records ADD COLUMN b_daily_tasks TEXT;`);
  if (!cols.has('b_lead_daily_feedback')) db.exec(`ALTER TABLE week_records ADD COLUMN b_lead_daily_feedback TEXT;`);
  if (!cols.has('c_lead_weekly_feedback')) db.exec(`ALTER TABLE week_records ADD COLUMN c_lead_weekly_feedback TEXT;`);
  if (!cols.has('c_director_commentary')) db.exec(`ALTER TABLE week_records ADD COLUMN c_director_commentary TEXT;`);
  if (!cols.has('scores_json')) db.exec(`ALTER TABLE week_records ADD COLUMN scores_json TEXT;`);
  if (!cols.has('shared_with_parent')) db.exec(`ALTER TABLE week_records ADD COLUMN shared_with_parent INTEGER NOT NULL DEFAULT 0;`);
  if (!cols.has('shared_at')) db.exec(`ALTER TABLE week_records ADD COLUMN shared_at TEXT;`);
  if (!cols.has('updated_at')) db.exec(`ALTER TABLE week_records ADD COLUMN updated_at TEXT;`);
  if (!cols.has('updated_by')) db.exec(`ALTER TABLE week_records ADD COLUMN updated_by INTEGER;`);

  db.exec(`
    UPDATE week_records
    SET shared_with_parent = COALESCE(shared_with_parent, 0)
    WHERE shared_with_parent IS NULL;
  `);

  db.exec(`
    UPDATE week_records
    SET updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
    WHERE updated_at IS NULL OR updated_at = '';
  `);

  db.exec(`
    UPDATE week_records
    SET shared_at = COALESCE(NULLIF(shared_at,''), updated_at)
    WHERE shared_with_parent = 1 AND (shared_at IS NULL OR shared_at = '');
  `);
}

function ensureParentLegacyImagesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_legacy_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_parent_legacy_images_student_id
      ON parent_legacy_images(student_id);
  `);
}

function bootstrap() {
  ensureUsersTableAndColumns();

  db.exec(`
    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE,
      name TEXT NOT NULL,
      grade TEXT,
      student_phone TEXT,
      parent_phone TEXT,
      schedule_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mentoring_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      week_id INTEGER NOT NULL,
      content_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE,
      UNIQUE(student_id, week_id)
    );

    CREATE TABLE IF NOT EXISTS penalties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      week_id INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
    CREATE INDEX IF NOT EXISTS idx_students_external_id ON students(external_id);
    CREATE INDEX IF NOT EXISTS idx_records_week ON mentoring_records(week_id);
    CREATE INDEX IF NOT EXISTS idx_penalties_week ON penalties(week_id);
  `);

  // students 컬럼 보강(profile_json 등)
  ensureStudentsColumns();
  ensureWeekRecordsColumns();
  ensureParentLegacyImagesTable();

  // 추가: 학생(=학부모) 로그인 발급용 평문 비밀번호 저장 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_credentials (
      student_id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password_plain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_credentials_user_id ON parent_credentials(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_credentials_username ON parent_credentials(username);
  `);
}

function seedDemoUsers() {
  const demo = [
    { username: 'admin', role: 'admin', password: 'admin1234', display_name: '원장' },
    { username: 'lead1', role: 'lead', password: 'pass1234', display_name: '총괄멘토' },
    { username: 'mentor1', role: 'mentor', password: 'pass1234', display_name: '학습멘토' },
    { username: 'staff1', role: 'admin', password: 'pass1234', display_name: '관리자' },
    { username: 'parent1', role: 'parent', password: 'pass1234', display_name: '학부모' }
  ];

  const getUser = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const ins = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, display_name, is_active, created_at, updated_at)
    VALUES (@username, @email, @password_hash, @role, @display_name, 1, datetime('now'), datetime('now'))
  `);

  for (const u of demo) {
    const exists = getUser.get(u.username);
    if (exists) continue;

    const password_hash = bcrypt.hashSync(u.password, 10);
    ins.run({
      username: u.username,
      email: `${u.username}@demo.local`,
      password_hash,
      role: u.role,
      display_name: u.display_name
    });
  }
}

export function initDb() {
  bootstrap();
  seedDemoUsers();
}

function prep(sql) {
  return db.prepare(sql);
}

export function tx(fn) {
  const wrapped = db.transaction(fn);
  return wrapped();
}

export function get(sql, params) {
  return prep(sql).get(params);
}

export function all(sql, params) {
  return prep(sql).all(params);
}

export function run(sql, params) {
  return prep(sql).run(params);
}

export function upsertStudentByExternalId(input) {
  const {
    external_id,
    name,
    grade = null,
    student_phone = null,
    parent_phone = null,
    schedule_json = null
  } = input || {};

  if (!name?.trim()) throw new Error('student.name is required');

  if (!external_id) {
    const r = run(
      `
      INSERT INTO students (external_id, name, grade, student_phone, parent_phone, schedule_json, updated_at)
      VALUES (NULL, @name, @grade, @student_phone, @parent_phone, @schedule_json, datetime('now'))
      `,
      { name: name.trim(), grade, student_phone, parent_phone, schedule_json }
    );
    return get(`SELECT * FROM students WHERE id = ?`, r.lastInsertRowid);
  }

  run(
    `
    INSERT INTO students (external_id, name, grade, student_phone, parent_phone, schedule_json, updated_at)
    VALUES (@external_id, @name, @grade, @student_phone, @parent_phone, @schedule_json, datetime('now'))
    ON CONFLICT(external_id) DO UPDATE SET
      name = excluded.name,
      grade = excluded.grade,
      student_phone = excluded.student_phone,
      parent_phone = excluded.parent_phone,
      schedule_json = excluded.schedule_json,
      updated_at = datetime('now')
    `,
    {
      external_id: String(external_id).trim(),
      name: name.trim(),
      grade,
      student_phone,
      parent_phone,
      schedule_json
    }
  );

  return get(`SELECT * FROM students WHERE external_id = ?`, String(external_id).trim());
}

export function upsertWeek({ label, start_date = null, end_date = null }) {
  if (!label?.trim()) throw new Error('week.label is required');

  const existing = get(`SELECT * FROM weeks WHERE label = ?`, label.trim());
  if (existing) {
    run(
      `UPDATE weeks SET start_date = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?`,
      [start_date, end_date, existing.id]
    );
    return get(`SELECT * FROM weeks WHERE id = ?`, existing.id);
  }

  const r = run(
    `INSERT INTO weeks (label, start_date, end_date, updated_at) VALUES (?, ?, ?, datetime('now'))`,
    [label.trim(), start_date, end_date]
  );
  return get(`SELECT * FROM weeks WHERE id = ?`, r.lastInsertRowid);
}

export { db };
export default db;
