import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import db, { initDb, dbFilePath } from './lib/db.js';
import { requireAuth } from './lib/auth.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import weekRoutes from './routes/weeks.js';
import permissionRoutes from './routes/permissions.js';
import studentRoutes from './routes/students.js';
import importRoutes from './routes/import.js';
import feedRoutes from './routes/feeds.js';
import mentoringRoutes from './routes/mentoring.js';
import parentRoutes from './routes/parent.js';
import parentLinkRoutes from './routes/parentLinks.js';
import penaltiesRoutes from './routes/penalties.js';
import printRoutes from './routes/print.js';
import backupRoutes from './routes/backups.js';
import settingsRoutes from './routes/settings.js';
import mentorAssignmentsRoutes from './routes/mentorAssignments.js';
import problemUploadRoutes from './routes/problemUploads.js';

dotenv.config();

const DB_PATH = dbFilePath;
const PRIMARY_DB_PATH = (() => {
  const explicit = String(process.env.DB_PATH || '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_INSTANCE_ID) return '/var/data/db.sqlite';
  const dbDir = path.dirname(DB_PATH);
  if (path.basename(dbDir) === 'backups') return path.join(path.dirname(dbDir), 'db.sqlite');
  return path.join(dbDir, 'db.sqlite');
})();
const BACKUP_DIR = process.env.BACKUP_DIR
  ? (path.isAbsolute(process.env.BACKUP_DIR) ? process.env.BACKUP_DIR : path.resolve(process.cwd(), process.env.BACKUP_DIR))
  : path.join(path.dirname(PRIMARY_DB_PATH), 'backups');
const BACKUP_KEEP_MAX = Math.max(10, Number(process.env.BACKUP_KEEP_MAX || 200));
const BACKUP_MIN_HEADROOM_BYTES = Math.max(
  32 * 1024 * 1024,
  Number(process.env.BACKUP_MIN_HEADROOM_BYTES || 64 * 1024 * 1024)
);
const PROBLEM_IMAGE_DIR = path.resolve(process.cwd(), 'data', 'problem-images');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(PROBLEM_IMAGE_DIR)) fs.mkdirSync(PROBLEM_IMAGE_DIR, { recursive: true });

function listBackupFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sqlite'))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

function pruneBackupFilesByCount(keepMax = BACKUP_KEEP_MAX) {
  const files = listBackupFiles();
  const targets = files.slice(keepMax);
  for (const file of targets) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, file)); } catch {}
  }
  return targets;
}

function pruneOldestHalfBackups(keepMin = 1) {
  const files = listBackupFiles();
  if (!files.length) return [];

  let deleteCount = Math.floor(files.length * 0.5);
  if (deleteCount < 1) deleteCount = 1;
  if (files.length - deleteCount < keepMin) deleteCount = Math.max(0, files.length - keepMin);
  if (deleteCount < 1) return [];

  const targets = files.slice(files.length - deleteCount); // 오래된 파일부터 삭제
  for (const file of targets) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, file)); } catch {}
  }
  return targets;
}

function isPathWithin(baseDir, targetPath) {
  const base = path.resolve(String(baseDir || ''));
  const target = path.resolve(String(targetPath || ''));
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function getDiskFreeBytes(targetPath) {
  try {
    const stat = fs.statfsSync(targetPath);
    const blockSize = Number(stat?.bsize || stat?.frsize || 0);
    const blocks = Number(stat?.bavail ?? stat?.bfree ?? 0);
    if (!Number.isFinite(blockSize) || !Number.isFinite(blocks) || blockSize <= 0 || blocks < 0) return null;
    return blockSize * blocks;
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function resolveBackupSourceCandidates() {
  const candidates = Array.from(new Set([PRIMARY_DB_PATH, DB_PATH].filter(Boolean))).filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  const outsideBackup = candidates.filter((p) => !isPathWithin(BACKUP_DIR, p));
  return outsideBackup.length ? [...outsideBackup, ...candidates.filter((p) => isPathWithin(BACKUP_DIR, p))] : candidates;
}

function ensureBackupSpaceForSource(sourcePath) {
  const src = String(sourcePath || '').trim();
  if (!src) return;
  const srcBytes = Number(fs.statSync(src).size || 0);
  const required = srcBytes + BACKUP_MIN_HEADROOM_BYTES;
  let free = getDiskFreeBytes(BACKUP_DIR);
  if (free != null && free < required) {
    pruneOldestHalfBackups(1);
    free = getDiskFreeBytes(BACKUP_DIR);
  }
  if (free != null && free < required) {
    const err = new Error(
      `ENOSPC not enough space for interval backup (required=${formatBytes(required)}, free=${formatBytes(free)}, source=${src})`
    );
    err.code = 'ENOSPC';
    throw err;
  }
}

function isSqliteFullError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === 'SQLITE_FULL' || /database or disk is full/i.test(msg);
}

try {
  initDb();
} catch (e) {
  if (!isSqliteFullError(e)) throw e;
  const removed = pruneOldestHalfBackups(1);
  console.error(`[startup] SQLITE_FULL detected. Removed ${removed.length} backup file(s), then retrying initDb.`);
  if (!removed.length) throw e;
  initDb();
}

const app = express();
app.use(express.json({ limit: '10mb' }));

function normalizeOrigin(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

const originList = String(process.env.WEB_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => normalizeOrigin(s))
  .filter(Boolean);

const allowedOrigins = new Set(originList);
const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser requests (no Origin header)
    if (!origin) return callback(null, true);
    return callback(null, allowedOrigins.has(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/uploads/problem-images', express.static(PROBLEM_IMAGE_DIR));
app.use('/api/problem-upload', problemUploadRoutes(db));

app.use('/api/auth', authRoutes(db));
app.use('/api/users', requireAuth(db), userRoutes(db));
app.use('/api/weeks', requireAuth(db), weekRoutes(db));
app.use('/api/permissions', requireAuth(db), permissionRoutes(db));
app.use('/api/students', requireAuth(db), studentRoutes(db));
app.use('/api/import', requireAuth(db), importRoutes(db));
app.use('/api/feeds', requireAuth(db), feedRoutes(db));
app.use('/api/mentoring', requireAuth(db), mentoringRoutes(db));
app.use('/api/parent', requireAuth(db), parentRoutes(db));
app.use('/api/parent-links', requireAuth(db), parentLinkRoutes(db));
app.use('/api/penalties', requireAuth(db), penaltiesRoutes(db));
app.use('/api/print', requireAuth(db), printRoutes(db));
app.use('/api/backups', requireAuth(db), backupRoutes(db));
app.use('/api/settings', requireAuth(db), settingsRoutes(db));
app.use('/api/mentor-assignments', requireAuth(db), mentorAssignmentsRoutes(db));

// ---- Backups (best-effort) ----
function backupNow(reason = 'interval') {
  try {
    const sources = resolveBackupSourceCandidates();
    if (!sources.length) {
      console.error(`[backup] skip ${reason}: no source DB found (active=${DB_PATH}, primary=${PRIMARY_DB_PATH})`);
      return null;
    }
    const source = sources[0];
    if (reason === 'interval' && isPathWithin(BACKUP_DIR, source)) {
      console.error(`[backup] skip ${reason}: source is already in backup dir (${source})`);
      return null;
    }
    ensureBackupSpaceForSource(source);
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(BACKUP_DIR, `db-${stamp}-${reason}.sqlite`);
    fs.copyFileSync(source, out);
    pruneBackupFilesByCount(BACKUP_KEEP_MAX);
    return out;
  } catch (e) {
    console.error(`[backup] ${reason} failed: ${String(e?.message || e)}`);
    return null;
  }
}

setInterval(() => backupNow('interval'), 30 * 60 * 1000);
process.on('SIGINT', () => {
  backupNow('sigint');
  process.exit(0);
});
process.on('SIGTERM', () => {
  backupNow('sigterm');
  process.exit(0);
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`Allowed web origin(s): ${originList.join(', ')}`);
});
