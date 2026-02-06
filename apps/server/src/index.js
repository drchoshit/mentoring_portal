import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import db, { initDb } from './lib/db.js';
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

dotenv.config();

initDb();

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
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.sqlite');
const BACKUP_DIR = path.resolve(process.cwd(), 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function backupNow(reason = 'interval') {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(BACKUP_DIR, `db-${stamp}-${reason}.sqlite`);
    fs.copyFileSync(DB_PATH, out);
    return out;
  } catch {
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
