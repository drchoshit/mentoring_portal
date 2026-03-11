// apps/server/src/lib/db.js
// SQLite DB helper (better-sqlite3)

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

function isSqliteIoError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code.startsWith('SQLITE_IOERR') || /disk i\/o error/i.test(msg);
}

function isRecoverableDbOpenError(err) {
  if (!err) return false;
  if (isSqliteIoError(err)) return true;
  const code = String(err.code || '').toUpperCase();
  if (code === 'SQLITE_FULL') return true;
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOSPC' || code === 'ENOENT' || code === 'EIO') {
    return true;
  }
  const msg = String(err.message || '');
  return /database or disk is full/i.test(msg);
}

function isRenderRuntime() {
  return Boolean(
    process.env.RENDER ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_INSTANCE_ID
  );
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDbParentDir(filePath) {
  const target = String(filePath || '').trim();
  if (!target || target === ':memory:' || /^file:/i.test(target)) return;
  ensureDir(path.dirname(target));
}

function isTruthyEnv(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function resolvePersistentDataDir() {
  const explicitDir = process.env.RENDER_DISK_PATH || process.env.PERSISTENT_DATA_DIR;
  if (explicitDir) {
    const dir = path.isAbsolute(explicitDir) ? explicitDir : path.resolve(process.cwd(), explicitDir);
    ensureDir(dir);
    return dir;
  }

  // Render persistent disk default mount path.
  if (isRenderRuntime()) {
    const renderDiskDir = '/var/data';
    ensureDir(renderDiskDir);
    return renderDiskDir;
  }

  return null;
}

function resolveDbFile() {
  if (process.env.NODE_ENV === 'test') return ':memory:';

  const p = String(process.env.DB_PATH || '').trim();
  if (p) {
    if (p === ':memory:') return ':memory:';
    const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    // If DB_PATH points to db.sqlite but legacy app.db exists, prefer app.db to avoid data loss.
    if (resolved.endsWith(`${path.sep}db.sqlite`)) {
      const legacy = path.join(path.dirname(resolved), 'app.db');
      if (fs.existsSync(legacy)) {
        const legacySize = fs.statSync(legacy).size;
        const resolvedSize = fs.existsSync(resolved) ? fs.statSync(resolved).size : 0;
        if (resolvedSize < legacySize) return legacy;
      }
    }
    return resolved;
  }

  const persistentDir = resolvePersistentDataDir();
  if (persistentDir) {
    const dbSqlite = path.join(persistentDir, 'db.sqlite');
    const appDb = path.join(persistentDir, 'app.db');
    if (fs.existsSync(appDb)) {
      const appSize = fs.statSync(appDb).size;
      const dbSize = fs.existsSync(dbSqlite) ? fs.statSync(dbSqlite).size : 0;
      if (dbSize < appSize) return appDb;
    }
    return dbSqlite;
  }

  const dataDir = path.resolve(process.cwd(), 'data');
  ensureDir(dataDir);

  const dbSqlite = path.join(dataDir, 'db.sqlite');
  const appDb = path.join(dataDir, 'app.db');
  if (!fs.existsSync(dbSqlite) && fs.existsSync(appDb)) return appDb;

  return dbSqlite;
}

function resolveBackupDir(baseDbFilePath = '') {
  const explicit = String(process.env.BACKUP_DIR || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  }
  const base = String(baseDbFilePath || '').trim();
  if (!base || base === ':memory:' || /^file:/i.test(base)) return '';
  return path.join(path.dirname(base), 'backups');
}

function resolveLegacySiblingDbFiles(primaryDbFile) {
  const normalized = String(primaryDbFile || '').trim();
  if (!normalized || normalized === ':memory:' || /^file:/i.test(normalized)) return [];
  const dir = path.dirname(normalized);
  const base = path.basename(normalized).toLowerCase();
  const out = [];
  if (base === 'db.sqlite') out.push(path.join(dir, 'app.db'));
  if (base === 'app.db') out.push(path.join(dir, 'db.sqlite'));
  return out;
}

function resolveBackupDbCandidates(primaryDbFile) {
  const backupDir = resolveBackupDir(primaryDbFile);
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  try {
    return fs.readdirSync(backupDir)
      .filter((f) => f.endsWith('.sqlite'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 30)
      .map((name) => path.join(backupDir, name));
  } catch {
    return [];
  }
}

function shouldAllowEphemeralFallback() {
  // Production defaults to strict mode (no silent empty-db boot).
  // Set ALLOW_EPHEMERAL_DB_FALLBACK=1 to explicitly opt in.
  if (isTruthyEnv(process.env.ALLOW_EPHEMERAL_DB_FALLBACK)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

function resolveFallbackDbFiles(primaryDbFile) {
  if (process.env.NODE_ENV === 'test') return [];

  const fallbackCandidates = [];
  fallbackCandidates.push(...resolveLegacySiblingDbFiles(primaryDbFile));
  fallbackCandidates.push(...resolveBackupDbCandidates(primaryDbFile));

  const explicitFallback = String(process.env.DB_FALLBACK_PATH || '').trim();
  if (explicitFallback) {
    fallbackCandidates.push(
      explicitFallback === ':memory:'
        ? ':memory:'
        : (path.isAbsolute(explicitFallback)
          ? explicitFallback
          : path.resolve(process.cwd(), explicitFallback))
    );
  }

  if (shouldAllowEphemeralFallback()) {
    if (isRenderRuntime()) {
      const tmpRoot = String(process.env.TMPDIR || '/tmp').trim() || '/tmp';
      fallbackCandidates.push(path.join(tmpRoot, 'mentoring-portal', 'db.sqlite'));
    }
    // Last-resort fallback so the service can still boot when filesystem writes are broken.
    fallbackCandidates.push(':memory:');
  }

  const seen = new Set([String(primaryDbFile || '').trim()]);
  const uniqueFallbacks = [];
  for (const candidate of fallbackCandidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueFallbacks.push(normalized);
  }
  return uniqueFallbacks;
}

function shouldRetryWithSidecarCleanup(filePath, err) {
  const target = String(filePath || '').trim();
  if (!target || target === ':memory:' || /^file:/i.test(target)) return false;
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  return code.includes('SHMSIZE') || msg.includes('shm');
}

function cleanupSqliteSidecars(filePath) {
  const target = String(filePath || '').trim();
  if (!target || target === ':memory:' || /^file:/i.test(target)) return [];
  const files = [`${target}-wal`, `${target}-shm`];
  const removed = [];
  for (const f of files) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        removed.push(f);
      }
    } catch {}
  }
  return removed;
}

function runPragmaBestEffort(dbInstance, source, fileLabel = 'unknown') {
  try {
    return dbInstance.pragma(source);
  } catch (e) {
    if (isSqliteIoError(e)) {
      console.warn(
        `[db bootstrap] Skipped PRAGMA "${source}" on "${fileLabel}" due to ${String(e.code || e.message || e)}`
      );
      return null;
    }
    throw e;
  }
}

function applyDbPragmas(dbInstance, fileLabel = 'unknown') {
  const requestedMode = String(process.env.SQLITE_JOURNAL_MODE || '').trim().toUpperCase();
  const defaultMode = isRenderRuntime() ? 'DELETE' : 'WAL';
  const desiredMode = requestedMode || defaultMode;

  const setJournalMode = (mode) => runPragmaBestEffort(dbInstance, `journal_mode = ${mode}`, fileLabel);

  try {
    const result = setJournalMode(desiredMode);
    if (!result) {
      console.warn(`[db bootstrap] journal_mode=${desiredMode} not applied for "${fileLabel}"; continuing with defaults.`);
    }
  } catch (e) {
    const canFallbackToDelete = desiredMode !== 'DELETE' && isSqliteIoError(e);
    if (!canFallbackToDelete) throw e;
    console.warn(
      `[db bootstrap] journal_mode=${desiredMode} failed for "${fileLabel}" (${String(e.code || e.message || e)}). Falling back to DELETE.`
    );
    const fallbackResult = setJournalMode('DELETE');
    if (!fallbackResult) {
      console.warn(`[db bootstrap] journal_mode=DELETE not applied for "${fileLabel}"; continuing with defaults.`);
    }
  }

  runPragmaBestEffort(dbInstance, 'foreign_keys = ON', fileLabel);
  runPragmaBestEffort(dbInstance, 'busy_timeout = 5000', fileLabel);
}

function assertWritableDb(dbInstance) {
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS __db_startup_probe__ (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      touched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO __db_startup_probe__ (id, touched_at)
    VALUES (1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET touched_at = excluded.touched_at;
  `);
}

function openDatabaseAt(filePath) {
  const target = String(filePath || '').trim();
  const tryOpen = () => {
    ensureDbParentDir(target);
    const instance = new Database(target);
    try {
      applyDbPragmas(instance, target);
      assertWritableDb(instance);
      return instance;
    } catch (e) {
      try { instance.close(); } catch {}
      throw e;
    }
  };

  try {
    return tryOpen();
  } catch (e) {
    if (!shouldRetryWithSidecarCleanup(target, e)) throw e;
    const removed = cleanupSqliteSidecars(target);
    if (removed.length) {
      console.warn(
        `[db bootstrap] Retrying "${target}" after removing sidecar files: ${removed.join(', ')}`
      );
    }
    return tryOpen();
  }
}

function createDatabaseWithFallback() {
  const primaryDbFile = resolveDbFile();
  const candidates = [primaryDbFile, ...resolveFallbackDbFiles(primaryDbFile)];
  let lastRecoverableError = null;

  for (const candidate of candidates) {
    try {
      const instance = openDatabaseAt(candidate);
      if (candidate !== primaryDbFile) {
        console.warn(`[db bootstrap] Switched DB to fallback path "${candidate}" (primary "${primaryDbFile}" failed).`);
      }
      return { instance, filePath: candidate };
    } catch (e) {
      if (!isRecoverableDbOpenError(e)) throw e;
      lastRecoverableError = e;
      console.warn(
        `[db bootstrap] DB open failure on "${candidate}" (${String(e.code || e.message || e)}). Trying next fallback.`
      );
    }
  }

  if (lastRecoverableError) throw lastRecoverableError;
  throw new Error('Failed to initialize SQLite database.');
}

const { instance: db, filePath: dbFile } = createDatabaseWithFallback();

function isSqliteFullError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === 'SQLITE_FULL' || /database or disk is full/i.test(msg);
}

function runBestEffort(fn, label) {
  try {
    return fn();
  } catch (e) {
    if (isSqliteFullError(e)) {
      console.error(`[db bootstrap] Skipped "${label}" due to SQLITE_FULL`);
      return null;
    }
    throw e;
  }
}

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      week_id INTEGER NOT NULL,
      b_daily_tasks TEXT,
      b_daily_tasks_this_week TEXT,
      b_lead_daily_feedback TEXT,
      c_lead_weekly_feedback TEXT,
      c_director_commentary TEXT,
      d_clinic_records TEXT,
      e_wrong_answer_distribution TEXT,
      scores_json TEXT,
      shared_with_parent INTEGER NOT NULL DEFAULT 0,
      shared_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE,
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(student_id, week_id)
    );

    CREATE INDEX IF NOT EXISTS idx_week_records_student_week
      ON week_records(student_id, week_id);
  `);

  const cols = columnMap('week_records');

  if (!cols.has('b_daily_tasks')) db.exec(`ALTER TABLE week_records ADD COLUMN b_daily_tasks TEXT;`);
  if (!cols.has('b_daily_tasks_this_week')) db.exec(`ALTER TABLE week_records ADD COLUMN b_daily_tasks_this_week TEXT;`);
  if (!cols.has('b_lead_daily_feedback')) db.exec(`ALTER TABLE week_records ADD COLUMN b_lead_daily_feedback TEXT;`);
  if (!cols.has('c_lead_weekly_feedback')) db.exec(`ALTER TABLE week_records ADD COLUMN c_lead_weekly_feedback TEXT;`);
  if (!cols.has('c_director_commentary')) db.exec(`ALTER TABLE week_records ADD COLUMN c_director_commentary TEXT;`);
  if (!cols.has('d_clinic_records')) db.exec(`ALTER TABLE week_records ADD COLUMN d_clinic_records TEXT;`);
  if (!cols.has('e_wrong_answer_distribution')) db.exec(`ALTER TABLE week_records ADD COLUMN e_wrong_answer_distribution TEXT;`);
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
    SET d_clinic_records = COALESCE(NULLIF(d_clinic_records, ''), '[]')
    WHERE d_clinic_records IS NULL OR TRIM(d_clinic_records) = '';
  `);

  db.exec(`
    UPDATE week_records
    SET e_wrong_answer_distribution = COALESCE(NULLIF(e_wrong_answer_distribution, ''), '{}')
    WHERE e_wrong_answer_distribution IS NULL OR TRIM(e_wrong_answer_distribution) = '';
  `);

  // Migration safety: apply only to round 4+ so legacy rounds (1~3) remain unchanged.
  const round4WeekId = findWeekIdByRound(4);
  if (round4WeekId) {
    db.prepare(`
      UPDATE week_records
      SET
        b_daily_tasks_this_week = b_daily_tasks,
        updated_at = datetime('now')
      WHERE
        week_id >= @round4WeekId
        AND (b_daily_tasks_this_week IS NULL OR TRIM(b_daily_tasks_this_week) = '' OR TRIM(b_daily_tasks_this_week) = '{}')
        AND b_daily_tasks IS NOT NULL
        AND TRIM(b_daily_tasks) != ''
        AND TRIM(b_daily_tasks) != '{}'
    `).run({ round4WeekId });
  }

  db.exec(`
    UPDATE week_records
    SET shared_at = COALESCE(NULLIF(shared_at,''), updated_at)
    WHERE shared_with_parent = 1 AND (shared_at IS NULL OR shared_at = '');
  `);
}

function ensureMentoringTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mentoring_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      deleted_from_week_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(deleted_from_week_id) REFERENCES weeks(id) ON DELETE SET NULL,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mentoring_subjects_student_name
      ON mentoring_subjects(student_id, name);

    CREATE TABLE IF NOT EXISTS subject_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      week_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      a_curriculum TEXT,
      a_last_hw TEXT,
      a_hw_exec TEXT,
      a_progress TEXT,
      a_this_hw TEXT,
      a_comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE,
      FOREIGN KEY(subject_id) REFERENCES mentoring_subjects(id) ON DELETE CASCADE,
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(student_id, week_id, subject_id)
    );

    CREATE INDEX IF NOT EXISTS idx_subject_records_student_week
      ON subject_records(student_id, week_id);
  `);

  const subjectCols = new Set(db.prepare(`PRAGMA table_info(mentoring_subjects)`).all().map((r) => r.name));
  if (!subjectCols.has('deleted_from_week_id')) {
    db.exec(`ALTER TABLE mentoring_subjects ADD COLUMN deleted_from_week_id INTEGER;`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mentoring_subjects_student_deleted_from_week
      ON mentoring_subjects(student_id, deleted_from_week_id);
  `);
}

function ensureMessagingTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      student_id INTEGER,
      target_field TEXT,
      title TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY(from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(to_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feeds_student_id ON feeds(student_id);
    CREATE INDEX IF NOT EXISTS idx_feeds_to_user_id ON feeds(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_feeds_from_user_id ON feeds(from_user_id);

    CREATE TABLE IF NOT EXISTS feed_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_id INTEGER NOT NULL,
      from_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
      FOREIGN KEY(from_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_feed_comments_feed_id ON feed_comments(feed_id);
  `);
}

function ensurePermissionAndConfigTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS field_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      roles_view_json TEXT NOT NULL DEFAULT '[]',
      roles_edit_json TEXT NOT NULL DEFAULT '[]',
      parent_visible INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS print_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_key TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Legacy DB compatibility: older tables may miss audit timestamp columns.
  {
    const fpCols = new Set(db.prepare(`PRAGMA table_info(field_permissions)`).all().map((r) => r.name));
    if (!fpCols.has('created_at')) runBestEffort(() => db.exec(`ALTER TABLE field_permissions ADD COLUMN created_at TEXT;`), 'field_permissions add created_at');
    if (!fpCols.has('updated_at')) runBestEffort(() => db.exec(`ALTER TABLE field_permissions ADD COLUMN updated_at TEXT;`), 'field_permissions add updated_at');
    runBestEffort(() => db.exec(`
      UPDATE field_permissions
      SET created_at = COALESCE(NULLIF(created_at,''), datetime('now')),
          updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
      WHERE created_at IS NULL OR created_at='' OR updated_at IS NULL OR updated_at='';
    `), 'field_permissions timestamp backfill');
  }
  {
    const pcCols = new Set(db.prepare(`PRAGMA table_info(print_config)`).all().map((r) => r.name));
    if (!pcCols.has('created_at')) runBestEffort(() => db.exec(`ALTER TABLE print_config ADD COLUMN created_at TEXT;`), 'print_config add created_at');
    if (!pcCols.has('updated_at')) runBestEffort(() => db.exec(`ALTER TABLE print_config ADD COLUMN updated_at TEXT;`), 'print_config add updated_at');
    runBestEffort(() => db.exec(`
      UPDATE print_config
      SET created_at = COALESCE(NULLIF(created_at,''), datetime('now')),
          updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
      WHERE created_at IS NULL OR created_at='' OR updated_at IS NULL OR updated_at='';
    `), 'print_config timestamp backfill');
  }

  const defaults = [
    { key: 'a_curriculum', label: '학습 커리큘럼', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'a_last_hw', label: '지난주 과제', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'a_hw_exec', label: '과제 이행도', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'a_progress', label: '진행상황 피드백', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'a_this_hw', label: '이번주 과제', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'a_comment', label: '과목 별 코멘트', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'b_daily_tasks', label: '일일 학습 과제', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'b_daily_tasks_this_week', label: '일일 학습 과제(이번주)', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'b_lead_daily_feedback', label: '요일 별 총괄멘토 피드백', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'admin'], parent: 1 },
    { key: 'c_lead_weekly_feedback', label: '주간 총괄멘토 피드백', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'admin'], parent: 1 },
    { key: 'c_director_commentary', label: '원장 코멘터리', view: ['director', 'lead', 'admin'], edit: ['director'], parent: 0 },
    { key: 'd_clinic_records', label: '클리닉 섹션', view: ['director', 'lead', 'mentor', 'admin', 'parent'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 1 },
    { key: 'e_wrong_answer_distribution', label: '오답 배분하기', view: ['director', 'lead', 'admin', 'parent'], edit: ['director', 'lead', 'admin'], parent: 1 },
    { key: 'scores_json', label: '점수/성적', view: ['director', 'lead', 'mentor', 'admin'], edit: ['director', 'lead', 'mentor', 'admin'], parent: 0 }
  ];

  const upsert = db.prepare(`
    INSERT OR IGNORE INTO field_permissions
      (field_key, label, roles_view_json, roles_edit_json, parent_visible)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of defaults) {
    runBestEffort(
      () => upsert.run(row.key, row.label, JSON.stringify(row.view), JSON.stringify(row.edit), row.parent ? 1 : 0),
      `field_permissions seed ${row.key}`
    );
  }

  // Keep clinic permission consistent for already-initialized databases.
  runBestEffort(
    () => db.prepare(`
      UPDATE field_permissions
      SET
        label = ?,
        roles_view_json = ?,
        roles_edit_json = ?,
        parent_visible = ?,
        updated_at = datetime('now')
      WHERE field_key = ?
    `).run(
      '클리닉 섹션',
      JSON.stringify(['director', 'lead', 'mentor', 'admin', 'parent']),
      JSON.stringify(['director', 'lead', 'mentor', 'admin']),
      1,
      'd_clinic_records'
    ),
    'field_permissions sync d_clinic_records'
  );

  runBestEffort(
    () => db.prepare(`
      UPDATE field_permissions
      SET
        label = ?,
        roles_view_json = ?,
        roles_edit_json = ?,
        parent_visible = ?,
        updated_at = datetime('now')
      WHERE field_key = ?
    `).run(
      '오답 배분하기',
      JSON.stringify(['director', 'lead', 'admin', 'parent']),
      JSON.stringify(['director', 'lead', 'admin']),
      1,
      'e_wrong_answer_distribution'
    ),
    'field_permissions sync e_wrong_answer_distribution'
  );
}

function ensureSystemTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parent_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_user_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(parent_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(parent_user_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

  const cols = columnMap('parent_legacy_images');
  if (!cols.has('created_at')) runBestEffort(() => db.exec(`ALTER TABLE parent_legacy_images ADD COLUMN created_at TEXT;`), 'parent_legacy_images add created_at');
  if (!cols.has('updated_at')) runBestEffort(() => db.exec(`ALTER TABLE parent_legacy_images ADD COLUMN updated_at TEXT;`), 'parent_legacy_images add updated_at');

  runBestEffort(() => db.exec(`
    UPDATE parent_legacy_images
    SET created_at = COALESCE(NULLIF(created_at,''), datetime('now'))
    WHERE created_at IS NULL OR created_at = '';
  `), 'parent_legacy_images created_at backfill');

  runBestEffort(() => db.exec(`
    UPDATE parent_legacy_images
    SET updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
    WHERE updated_at IS NULL OR updated_at = '';
  `), 'parent_legacy_images updated_at backfill');
}

function ensureCurriculumSourceTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_curriculum_sources (
      student_id INTEGER PRIMARY KEY,
      source_week_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(source_week_id) REFERENCES weeks(id) ON DELETE SET NULL,
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  const cols = columnMap('student_curriculum_sources');
  if (!cols.has('updated_at')) db.exec(`ALTER TABLE student_curriculum_sources ADD COLUMN updated_at TEXT;`);
  if (!cols.has('updated_by')) db.exec(`ALTER TABLE student_curriculum_sources ADD COLUMN updated_by INTEGER;`);

  db.exec(`
    UPDATE student_curriculum_sources
    SET updated_at = COALESCE(NULLIF(updated_at,''), datetime('now'))
    WHERE updated_at IS NULL OR updated_at = '';
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
  ensureMentoringTables();
  ensureMessagingTables();
  ensurePermissionAndConfigTables();
  ensureSystemTables();
  ensureStudentsColumns();
  ensureWeekRecordsColumns();
  ensureParentLegacyImagesTable();
  ensureCurriculumSourceTable();

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
    { username: 'admin', role: 'director', password: 'admin1234', display_name: '원장' },
    { username: 'lead1', role: 'lead', password: 'pass1234', display_name: '총괄멘토' },
    { username: 'mentor1', role: 'mentor', password: 'pass1234', display_name: '클리닉 멘토' },
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

function parseRoundNumber(label) {
  const raw = String(label || '').trim();
  if (!raw) return null;
  const m = raw.match(/(\d+)\s*(?:회차|주차)?/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

function findWeekIdByRound(round) {
  const rows = db.prepare('SELECT id, label FROM weeks ORDER BY id').all();
  if (!rows.length) return null;

  for (const r of rows) {
    if (parseRoundNumber(r.label) === round) return Number(r.id);
  }

  // Fallback for legacy labels: use sequential order.
  if (rows.length >= round) return Number(rows[round - 1].id);
  return null;
}

function backfillRound4LastWeekTasksFromRound3ThisWeek() {
  const prevWeekId = findWeekIdByRound(3);
  const currWeekId = findWeekIdByRound(4);
  if (!prevWeekId || !currWeekId) return 0;

  const info = db.prepare(`
    UPDATE week_records AS cur
    SET
      b_daily_tasks = (
        SELECT prev.b_daily_tasks_this_week
        FROM week_records AS prev
        WHERE prev.student_id = cur.student_id
          AND prev.week_id = @prevWeekId
        LIMIT 1
      ),
      updated_at = datetime('now')
    WHERE cur.week_id = @currWeekId
      AND EXISTS (
        SELECT 1
        FROM week_records AS prev
        WHERE prev.student_id = cur.student_id
          AND prev.week_id = @prevWeekId
          AND prev.b_daily_tasks_this_week IS NOT NULL
          AND TRIM(prev.b_daily_tasks_this_week) != ''
          AND TRIM(prev.b_daily_tasks_this_week) != '{}'
      )
      AND (
        cur.b_daily_tasks IS NULL
        OR TRIM(cur.b_daily_tasks) = ''
        OR TRIM(cur.b_daily_tasks) = '{}'
        OR TRIM(cur.b_daily_tasks) = TRIM(COALESCE(cur.b_daily_tasks_this_week, ''))
      )
  `).run({ prevWeekId, currWeekId });

  return Number(info?.changes || 0);
}

function migrateLegacyAdminRole() {
  const admin = db.prepare('SELECT id, role FROM users WHERE username=?').get('admin');
  if (!admin) return;
  if (String(admin.role) === 'director') return;

  db.prepare(`
    UPDATE users
    SET role='director',
        display_name=COALESCE(NULLIF(display_name,''), '원장'),
        updated_at=datetime('now')
    WHERE id=?
  `).run(admin.id);
}

export function initDb() {
  bootstrap();
  const backfilled = backfillRound4LastWeekTasksFromRound3ThisWeek();
  if (backfilled > 0) {
    // eslint-disable-next-line no-console
    console.log(`[db] Backfilled round-4 last-week daily tasks for ${backfilled} record(s).`);
  }
  seedDemoUsers();
  migrateLegacyAdminRole();
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
export const dbFilePath = dbFile;
export default db;

