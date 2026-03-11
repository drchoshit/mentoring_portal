import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import BetterSqlite from 'better-sqlite3';
import { requireRole } from '../lib/auth.js';
import { dbFilePath } from '../lib/db.js';

const execFileAsync = promisify(execFile);
const ROUTE_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolveForensicScriptPath() {
  const envPath = String(process.env.FORENSIC_SCRIPT_PATH || '').trim();
  const candidates = [];
  if (envPath) {
    candidates.push(path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath));
  }
  candidates.push(path.resolve(process.cwd(), 'scripts/forensic-dump.mjs'));
  candidates.push(path.resolve(process.cwd(), 'apps/server/scripts/forensic-dump.mjs'));
  candidates.push(path.resolve(ROUTE_DIR, '../../scripts/forensic-dump.mjs'));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return candidates[0] || path.resolve(process.cwd(), 'scripts/forensic-dump.mjs');
}

function timestampStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function uniqPaths(items) {
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const key = path.resolve(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function resolvePersistentRoot(dbPath) {
  const explicit = String(process.env.RENDER_DISK_PATH || process.env.PERSISTENT_DATA_DIR || '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_INSTANCE_ID) return '/var/data';

  const dbDir = path.dirname(String(dbPath || ''));
  if (dbDir) {
    if (path.basename(dbDir) === 'backups') return path.dirname(dbDir);
    return dbDir;
  }

  return path.resolve(process.cwd(), 'data');
}

function resolveForensicDirs({ dbPath, explicitForensicDir }) {
  const persistentRoot = resolvePersistentRoot(dbPath);
  const dirs = [];
  if (explicitForensicDir) dirs.push(explicitForensicDir);
  dirs.push(path.join(persistentRoot, 'forensics'));
  dirs.push(path.join(path.dirname(dbPath), 'forensics'));
  dirs.push(path.resolve(process.cwd(), 'forensics'));
  dirs.push(path.resolve(process.cwd(), 'apps/server/forensics'));
  return uniqPaths(dirs);
}

function resolvePrimaryDbPath(activeDbPath) {
  const explicit = String(process.env.DB_PATH || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  }
  const persistentRoot = resolvePersistentRoot(activeDbPath);
  return path.join(persistentRoot, 'db.sqlite');
}

function isPathWithin(baseDir, targetPath) {
  const base = path.resolve(String(baseDir || ''));
  const target = path.resolve(String(targetPath || ''));
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

export default function backupRoutes(db) {
  const router = express.Router();
  router.use(requireRole('director', 'admin'));

  const FULL_IMPORT_MAX_BYTES = Math.max(
    50 * 1024 * 1024,
    Number(process.env.FULL_IMPORT_MAX_BYTES || 1024 * 1024 * 1024)
  );
  const BACKUP_MIN_HEADROOM_BYTES = Math.max(
    32 * 1024 * 1024,
    Number(process.env.BACKUP_MIN_HEADROOM_BYTES || 64 * 1024 * 1024)
  );
  const FULL_IMPORT_TMP_DIR = path.join(os.tmpdir(), 'mentoring-full-imports');
  if (!fs.existsSync(FULL_IMPORT_TMP_DIR)) fs.mkdirSync(FULL_IMPORT_TMP_DIR, { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
  });
  const fullUpload = multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        cb(null, FULL_IMPORT_TMP_DIR);
      },
      filename(req, file, cb) {
        const ext = String(path.extname(String(file?.originalname || '')).toLowerCase() || '.sqlite');
        cb(null, `full-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      }
    }),
    limits: { fileSize: FULL_IMPORT_MAX_BYTES }
  });

  const DB_PATH = dbFilePath;
  const PRIMARY_DB_PATH = resolvePrimaryDbPath(DB_PATH);
  const BACKUP_DIR = process.env.BACKUP_DIR
    ? (path.isAbsolute(process.env.BACKUP_DIR) ? process.env.BACKUP_DIR : path.resolve(process.cwd(), process.env.BACKUP_DIR))
    : path.join(path.dirname(PRIMARY_DB_PATH), 'backups');
  const EXPLICIT_FORENSIC_DIR = process.env.FORENSIC_DIR
    ? (path.isAbsolute(process.env.FORENSIC_DIR) ? process.env.FORENSIC_DIR : path.resolve(process.cwd(), process.env.FORENSIC_DIR))
    : '';
  const FORENSIC_DIRS = resolveForensicDirs({
    dbPath: DB_PATH,
    explicitForensicDir: EXPLICIT_FORENSIC_DIR
  });
  const FORENSIC_DIR = FORENSIC_DIRS[0];
  const FORENSIC_SCRIPT_PATH = resolveForensicScriptPath();
  const FORENSIC_TIMEOUT_MS = Math.max(15000, Number(process.env.FORENSIC_TIMEOUT_MS || 120000));
  const BACKUP_KEEP_MAX = Math.max(10, Number(process.env.BACKUP_KEEP_MAX || 200));
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (FORENSIC_DIR && !fs.existsSync(FORENSIC_DIR)) fs.mkdirSync(FORENSIC_DIR, { recursive: true });

  function listBackupFiles() {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sqlite'))
      .sort((a, b) => b.localeCompare(a));
  }

  function pruneByKeepMax() {
    const files = listBackupFiles();
    const targets = files.slice(BACKUP_KEEP_MAX);
    for (const file of targets) {
      const filePath = path.join(BACKUP_DIR, file);
      try { fs.unlinkSync(filePath); } catch {}
    }
    return targets;
  }

  function isSafeBackupFilename(file) {
    const name = String(file || '').trim();
    if (!name) return false;
    if (name !== path.basename(name)) return false;
    if (!name.endsWith('.sqlite')) return false;
    return true;
  }

  function isSafeForensicFilename(file) {
    const name = String(file || '').trim();
    if (!name) return false;
    if (name !== path.basename(name)) return false;
    if (!name.endsWith('.json')) return false;
    if (!name.startsWith('forensic-')) return false;
    return true;
  }

  function removeSqliteSidecars(filePath) {
    const target = String(filePath || '').trim();
    if (!target) return [];
    const sidecars = [`${target}-wal`, `${target}-shm`, `${target}-journal`];
    const removed = [];
    for (const side of sidecars) {
      try {
        if (fs.existsSync(side)) {
          fs.unlinkSync(side);
          removed.push(side);
        }
      } catch {}
    }
    return removed;
  }

  function resolveBackupSourceCandidates() {
    const candidates = uniqPaths([PRIMARY_DB_PATH, DB_PATH]).filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    const outsideBackup = candidates.filter((p) => !isPathWithin(BACKUP_DIR, p));
    return outsideBackup.length ? [...outsideBackup, ...candidates.filter((p) => isPathWithin(BACKUP_DIR, p))] : candidates;
  }

  function pruneOldestBackupsUntilBytes(requiredBytes, keepMin = 1) {
    const files = listBackupFiles();
    const removed = [];
    let free = getDiskFreeBytes(BACKUP_DIR);
    if (free == null) return { freeBytes: null, removed };

    for (let i = files.length - 1; i >= keepMin && free < requiredBytes; i -= 1) {
      const file = files[i];
      const fullPath = path.join(BACKUP_DIR, file);
      try {
        fs.unlinkSync(fullPath);
        removed.push(file);
      } catch {}
      free = getDiskFreeBytes(BACKUP_DIR);
      if (free == null) break;
    }
    return { freeBytes: free, removed };
  }

  function ensureBackupSpaceForSource(sourcePath) {
    const src = String(sourcePath || '').trim();
    if (!src) return;
    const sourceSize = Number(fs.statSync(src).size || 0);
    const required = sourceSize + BACKUP_MIN_HEADROOM_BYTES;
    let free = getDiskFreeBytes(BACKUP_DIR);

    if (free != null && free < required) {
      pruneOldestBackupsUntilBytes(required, 1);
      free = getDiskFreeBytes(BACKUP_DIR);
    }

    if (free != null && free < required) {
      const err = new Error(
        `ENOSPC not enough space for backup copy (required=${formatBytes(required)}, free=${formatBytes(free)}, source=${src})`
      );
      err.code = 'ENOSPC';
      throw err;
    }
  }

  function backupNow(reason = 'manual') {
    const stamp = timestampStamp();
    const out = path.join(BACKUP_DIR, `db-${stamp}-${reason}.sqlite`);
    const sources = resolveBackupSourceCandidates();
    if (!sources.length) {
      throw new Error(`No backup source DB found (active=${DB_PATH}, primary=${PRIMARY_DB_PATH})`);
    }

    let lastError = null;
    for (const source of sources) {
      if (reason === 'interval' && isPathWithin(BACKUP_DIR, source)) {
        const err = new Error(`Skipped interval backup from backup-origin source: ${source}`);
        err.code = 'BACKUP_SOURCE_LOOP';
        lastError = err;
        continue;
      }
      try {
        ensureBackupSpaceForSource(source);
        fs.copyFileSync(source, out);
        pruneByKeepMax();
        return { out, source };
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError || new Error('copyFile failed for all source candidates');
  }

  function quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  }

  function listTables() {
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  }

  function normalizeTimestamp(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  function parseIntRange(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

  function listForensicReports() {
    const bestByName = new Map();

    for (const dir of FORENSIC_DIRS) {
      if (!dir || !fs.existsSync(dir)) continue;
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }

      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const fullPath = path.join(dir, name);
        let stat = null;
        try {
          stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
        } catch {
          continue;
        }

        const cur = bestByName.get(name);
        const mtimeMs = Number(stat.mtimeMs || 0);
        if (!cur || mtimeMs > cur.mtimeMs) {
          bestByName.set(name, { name, path: fullPath, mtimeMs });
        }
      }
    }

    return Array.from(bestByName.values()).sort((a, b) => b.name.localeCompare(a.name));
  }

  function listForensicFiles() {
    return listForensicReports().map((r) => r.name);
  }

  function findForensicReportPathByName(name) {
    const target = String(name || '').trim();
    if (!target) return '';
    const reports = listForensicReports();
    const found = reports.find((r) => r.name === target);
    return found?.path || '';
  }

  function loadForensicReport(reportPath) {
    const raw = fs.readFileSync(reportPath, 'utf8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid forensic report payload');
    }
    return payload;
  }

  function getTableColumns(tableName) {
    const safe = quoteIdent(tableName);
    return new Set(
      db.prepare(`PRAGMA table_info(${safe})`).all().map((c) => String(c.name || '').trim()).filter(Boolean)
    );
  }

  function rowTimestamp(row = {}) {
    return normalizeTimestamp(row?.updated_at || row?.created_at || '');
  }

  function collectMergeRowsFromForensicPayload(payload, { since = '', cutoff = '', tableFilter = null } = {}) {
    const allowedTables = new Set(
      Array.isArray(tableFilter) && tableFilter.length
        ? tableFilter
        : ['week_records', 'subject_records', 'feeds', 'penalties', 'students']
    );

    const rowsByTable = new Map();
    const extracts = Array.isArray(payload?.extracts) ? payload.extracts : [];
    for (const extract of extracts) {
      const tables = extract?.tables || {};
      for (const tableName of Object.keys(tables)) {
        if (!allowedTables.has(tableName)) continue;
        const tableInfo = tables[tableName] || {};
        const rows = Array.isArray(tableInfo.rows) ? tableInfo.rows : [];
        if (!rows.length) continue;

        if (!rowsByTable.has(tableName)) rowsByTable.set(tableName, new Map());
        const idMap = rowsByTable.get(tableName);

        for (const rawRow of rows) {
          if (!rawRow || typeof rawRow !== 'object') continue;
          if (rawRow.id === null || rawRow.id === undefined) continue;
          const id = Number(rawRow.id);
          if (!Number.isFinite(id)) continue;

          const ts = rowTimestamp(rawRow);
          if (since && ts && ts < since) continue;
          if (cutoff && ts && ts > cutoff) continue;

          const prev = idMap.get(id);
          if (!prev) {
            idMap.set(id, { row: rawRow, ts });
            continue;
          }
          // Keep the newest timestamp row for the same id.
          if (ts && prev.ts) {
            if (ts > prev.ts) idMap.set(id, { row: rawRow, ts });
            continue;
          }
          if (ts && !prev.ts) {
            idMap.set(id, { row: rawRow, ts });
          }
        }
      }
    }

    return rowsByTable;
  }

  function pickTopCandidateFromReport(payload) {
    const topCandidates = Array.isArray(payload?.topCandidates) ? payload.topCandidates : [];
    for (const c of topCandidates) {
      const p = String(c?.path || '').trim();
      if (p) return p;
    }

    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    for (const c of candidates) {
      const p = String(c?.path || '').trim();
      if (!p) continue;
      if (String(c?.openError || '').trim()) continue;
      if (Boolean(c?.schemaKnown) || Boolean(c?.hasRecoverableTables)) return p;
    }

    return '';
  }

  function resolvePromotionCandidatePath({ reportFile, candidatePath }) {
    const direct = String(candidatePath || '').trim();
    if (direct) {
      return path.isAbsolute(direct) ? direct : path.resolve(process.cwd(), direct);
    }

    const targetReport = String(reportFile || '').trim();
    if (targetReport) {
      const reportPath = findForensicReportPathByName(targetReport);
      if (!reportPath || !fs.existsSync(reportPath)) {
        throw new Error(`Forensic report not found: ${targetReport}`);
      }
      const payload = loadForensicReport(reportPath);
      const picked = pickTopCandidateFromReport(payload);
      if (!picked) throw new Error(`No promotable candidate in report: ${targetReport}`);
      return path.isAbsolute(picked) ? picked : path.resolve(process.cwd(), picked);
    }

    const latest = listForensicReports()[0];
    if (!latest) throw new Error('No forensic report found');
    const payload = loadForensicReport(latest.path);
    const picked = pickTopCandidateFromReport(payload);
    if (!picked) throw new Error('No promotable candidate in latest forensic report');
    return path.isAbsolute(picked) ? picked : path.resolve(process.cwd(), picked);
  }

  function inspectSchema(filePath) {
    let tmp = null;
    try {
      tmp = new BetterSqlite(filePath, { readonly: true, fileMustExist: true });
      const names = new Set(
        tmp.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name || ''))
      );
      const schemaKnown = names.has('users') && names.has('students') && names.has('weeks');
      const hasRecoverableTables =
        names.has('week_records') ||
        names.has('subject_records') ||
        names.has('feeds') ||
        names.has('penalties') ||
        names.has('students');
      return { schemaKnown, hasRecoverableTables };
    } finally {
      try { tmp?.close(); } catch {}
    }
  }

  function canOpenAsSqlite(filePath) {
    const target = String(filePath || '').trim();
    if (!target) return false;
    try {
      const fd = fs.openSync(target, 'r');
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
      return buf.toString('utf8', 0, 15) === 'SQLite format 3';
    } catch {
      return false;
    }
  }

  function removeFileQuietly(filePath) {
    const target = String(filePath || '').trim();
    if (!target) return;
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {}
  }

  function promoteCandidateToPrimary(rawCandidatePath) {
    const candidatePath = path.resolve(String(rawCandidatePath || '').trim());
    if (!candidatePath) throw new Error('Candidate path is required');
    if (!fs.existsSync(candidatePath)) throw new Error(`Candidate not found: ${candidatePath}`);
    if (!fs.statSync(candidatePath).isFile()) throw new Error(`Candidate is not a file: ${candidatePath}`);
    if (!candidatePath.endsWith('.sqlite') && !candidatePath.endsWith('.db')) {
      throw new Error(`Invalid candidate extension: ${candidatePath}`);
    }

    const allowedRoots = uniqPaths([
      resolvePersistentRoot(PRIMARY_DB_PATH),
      path.dirname(PRIMARY_DB_PATH),
      BACKUP_DIR,
      ...FORENSIC_DIRS
    ]);
    const inAllowed = allowedRoots.some((root) => root && isPathWithin(root, candidatePath));
    if (!inAllowed) {
      throw new Error(`Candidate path is outside allowed storage roots: ${candidatePath}`);
    }

    const target = path.resolve(PRIMARY_DB_PATH);
    const schema = inspectSchema(candidatePath);
    if (!schema.schemaKnown && !schema.hasRecoverableTables) {
      throw new Error('Candidate does not contain recognizable schema/tables');
    }

    if (candidatePath === target) {
      return {
        source: candidatePath,
        target,
        mode: 'already_primary',
        previous_primary_path: null,
        warnings: ['Target already points to candidate file'],
        schema
      };
    }

    const stamp = timestampStamp();
    const previousPrimaryPath = path.join(path.dirname(target), `db.prepromote-${stamp}.sqlite`);
    const warnings = [];
    let mode = 'copy';

    removeSqliteSidecars(target);

    try {
      fs.copyFileSync(candidatePath, target);
    } catch (e) {
      if (String(e?.code || '') !== 'ENOSPC') throw e;

      warnings.push('copy failed with ENOSPC; fallback to rename strategy');
      if (fs.existsSync(target)) {
        fs.renameSync(target, previousPrimaryPath);
      }
      try {
        fs.renameSync(candidatePath, target);
        mode = 'rename';
      } catch (renameError) {
        if (fs.existsSync(previousPrimaryPath) && !fs.existsSync(target)) {
          try { fs.renameSync(previousPrimaryPath, target); } catch {}
        }
        throw renameError;
      }
    }

    removeSqliteSidecars(target);

    return {
      source: candidatePath,
      target,
      mode,
      previous_primary_path: fs.existsSync(previousPrimaryPath) ? previousPrimaryPath : null,
      warnings,
      schema
    };
  }

  function buildRecoveredDbFromPrimary(sourceDbPath) {
    const source = String(sourceDbPath || '').trim();
    if (!source || !fs.existsSync(source)) {
      throw new Error(`Primary DB not found: ${source}`);
    }

    const stamp = timestampStamp();
    const recoveredPath = path.join(FORENSIC_DIR, `db.primary.recovered-${stamp}.sqlite`);

    const recoverDump = spawnSync('sqlite3', [source, '.recover'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 256
    });
    const sqlDump = String(recoverDump.stdout || '');

    if (recoverDump.error) {
      throw new Error(`sqlite3 .recover failed: ${String(recoverDump.error?.message || recoverDump.status || 'unknown')}`);
    }
    if (!sqlDump.trim()) {
      throw new Error('sqlite3 .recover returned empty output');
    }

    try { fs.unlinkSync(recoveredPath); } catch {}

    const recoverInput = `.bail off\nPRAGMA foreign_keys = OFF;\n${sqlDump}\n`;
    const loadRecovered = spawnSync('sqlite3', [recoveredPath], {
      input: recoverInput,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 256
    });

    if (loadRecovered.error) {
      try { fs.unlinkSync(recoveredPath); } catch {}
      throw new Error(`sqlite3 load failed: ${String(loadRecovered.error?.message || loadRecovered.status || 'unknown')}`);
    }

    if (!fs.existsSync(recoveredPath)) {
      throw new Error(`Recovered DB was not created: ${recoveredPath}`);
    }

    return {
      recoveredPath,
      recoverStatus: Number(recoverDump.status ?? 0),
      loadStatus: Number(loadRecovered.status ?? 0),
      recoverStderr: String(recoverDump.stderr || ''),
      loadStderr: String(loadRecovered.stderr || '')
    };
  }

  function summarizeForensicPayload(payload, previewRows = 10) {
    const maxPreviewRows = parseIntRange(previewRows, 0, 50, 10);
    const extracts = Array.isArray(payload.extracts) ? payload.extracts : [];
    return {
      generatedAt: payload.generatedAt || null,
      params: payload.params || {},
      candidateCount: Number(payload.candidateCount || 0),
      topCandidates: Array.isArray(payload.topCandidates) ? payload.topCandidates : [],
      candidates: Array.isArray(payload.candidates)
        ? payload.candidates.slice(0, 20).map((c) => ({
            path: c.path || '',
            marker: c.marker || '',
            fileMtime: c.fileMtime || '',
            openError: c.openError || '',
            schemaKnown: Boolean(c.schemaKnown),
            tableCounts: c.tableCounts || {}
          }))
        : [],
      extracts: extracts.map((ext) => {
        const tableEntries = Object.entries(ext?.tables || {});
        const tables = tableEntries.map(([table, detail]) => ({
          table,
          timestampColumn: detail?.timestampColumn || '',
          rowCount: Number(detail?.rowCount || 0),
          previewRows: Array.isArray(detail?.rows) ? detail.rows.slice(0, maxPreviewRows) : []
        }));
        return {
          path: ext?.path || '',
          error: ext?.error || '',
          totalRows: tables.reduce((sum, t) => sum + Number(t.rowCount || 0), 0),
          tables
        };
      })
    };
  }

  router.get('/list', (req, res) => {
    const files = listBackupFiles().slice(0, 200);
    res.json({ backups: files });
  });

  router.post('/now', (req, res) => {
    try {
      const { out, source } = backupNow('manual');
      res.json({ ok: true, file: path.basename(out), source });
    } catch (e) {
      const code = String(e?.code || '').trim();
      const msg = String(e?.message || '').trim();
      const detail = [code, msg].filter(Boolean).join(' ');
      res.status(500).json({ error: `Backup failed${detail ? ` (${detail})` : ''}` });
    }
  });

  router.post('/prune', (req, res) => {
    try {
      const modeRaw = String(req.body?.mode || 'oldest').toLowerCase();
      const mode = modeRaw === 'oldest' ? 'oldest' : 'latest';
      const ratioRaw = Number(req.body?.ratio ?? 0.5);
      const ratio = Number.isFinite(ratioRaw) ? Math.min(0.95, Math.max(0.05, ratioRaw)) : 0.5;
      const keepMinRaw = Number(req.body?.keep_min ?? 1);
      const keepMin = Number.isFinite(keepMinRaw) ? Math.max(0, Math.floor(keepMinRaw)) : 1;

      const files = listBackupFiles();
      if (!files.length) return res.json({ ok: true, total: 0, deleted_count: 0, deleted: [] });

      let deleteCount = Math.floor(files.length * ratio);
      if (deleteCount < 1) deleteCount = 1;
      if (files.length - deleteCount < keepMin) {
        deleteCount = Math.max(0, files.length - keepMin);
      }
      if (deleteCount < 1) return res.json({ ok: true, total: files.length, deleted_count: 0, deleted: [] });

      const targets = mode === 'latest' ? files.slice(0, deleteCount) : files.slice(files.length - deleteCount);
      const deleted = [];
      const failed = [];

      for (const file of targets) {
        const filePath = path.join(BACKUP_DIR, file);
        try {
          fs.unlinkSync(filePath);
          deleted.push(file);
        } catch (e) {
          failed.push({ file, reason: e?.message || 'unlink failed' });
        }
      }

      return res.json({
        ok: true,
        mode,
        ratio,
        total: files.length,
        deleted_count: deleted.length,
        failed_count: failed.length,
        deleted,
        failed
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Prune failed' });
    }
  });

  router.delete('/file/:name', (req, res) => {
    try {
      const name = String(req.params.name || '');
      if (!isSafeBackupFilename(name)) return res.status(400).json({ error: 'Invalid filename' });
      const filePath = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });
      fs.unlinkSync(filePath);
      return res.json({ ok: true, deleted: name });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Delete failed' });
    }
  });

  router.get('/forensics/list', (req, res) => {
    try {
      const files = listForensicFiles().slice(0, 100);
      return res.json({ reports: files });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Failed to list forensic reports' });
    }
  });

  router.get('/forensics/latest', (req, res) => {
    try {
      const reports = listForensicReports();
      if (!reports.length) return res.status(404).json({ error: 'No forensic report found' });
      const previewRows = parseIntRange(req.query?.preview_rows, 0, 50, 10);
      const latest = reports[0];
      const reportPath = latest.path;
      const payload = loadForensicReport(reportPath);
      return res.json({
        ok: true,
        report_file: latest.name,
        report_path: reportPath,
        summary: summarizeForensicPayload(payload, previewRows)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Failed to load forensic report' });
    }
  });

  router.get('/forensics/file/:name', (req, res) => {
    try {
      const name = String(req.params.name || '');
      if (!isSafeForensicFilename(name)) return res.status(400).json({ error: 'Invalid filename' });
      const filePath = findForensicReportPathByName(name);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Forensic report not found' });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return res.send(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Failed to download forensic report' });
    }
  });

  router.post('/forensics/run', async (req, res) => {
    try {
      if (!fs.existsSync(FORENSIC_SCRIPT_PATH)) {
        return res.status(500).json({ error: `Forensic script not found: ${FORENSIC_SCRIPT_PATH}` });
      }

      const since = normalizeTimestamp(req.body?.since);
      const cutoff = normalizeTimestamp(req.body?.cutoff);
      const top = parseIntRange(req.body?.top, 1, 10, 3);
      const limit = parseIntRange(req.body?.limit, 10, 5000, 500);
      const previewRows = parseIntRange(req.body?.preview_rows, 0, 50, 10);
      const recoverPrimary = Boolean(req.body?.recover_primary);
      let recoveredMeta = null;

      const args = [FORENSIC_SCRIPT_PATH, '--top', String(top), '--limit', String(limit)];
      if (recoverPrimary) {
        recoveredMeta = buildRecoveredDbFromPrimary(PRIMARY_DB_PATH);
      }
      if (since) args.push('--since', since);
      if (cutoff) args.push('--cutoff', cutoff);

      const { stdout = '', stderr = '' } = await execFileAsync(process.execPath, args, {
        cwd: process.cwd(),
        timeout: FORENSIC_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env
      });

      const mergedLogs = `${stdout}\n${stderr}`;
      let reportPath = '';
      const found = mergedLogs.match(/\[forensic\]\s+wrote report:\s*(.+)/i);
      if (found && found[1]) {
        reportPath = found[1].trim();
      }

      if (!reportPath) {
        const reports = listForensicReports();
        if (!reports.length) return res.status(500).json({ error: 'Forensic report path not found in process output' });
        reportPath = reports[0].path;
      } else if (!path.isAbsolute(reportPath)) {
        reportPath = path.resolve(process.cwd(), reportPath);
      }

      if (!fs.existsSync(reportPath)) {
        return res.status(500).json({ error: `Forensic report file not found: ${reportPath}` });
      }

      const payload = loadForensicReport(reportPath);
      const reportFile = path.basename(reportPath);
      const baseLogs = mergedLogs.split(/\r?\n/).filter(Boolean).slice(-30);
      if (recoverPrimary && recoveredMeta) {
        baseLogs.unshift(
          `[forensic] recover_primary=1 source=${PRIMARY_DB_PATH}`,
          `[forensic] recovered_candidate=${recoveredMeta.recoveredPath}`,
          `[forensic] sqlite3_recover_status=${recoveredMeta.recoverStatus}`,
          `[forensic] sqlite3_load_status=${recoveredMeta.loadStatus}`
        );
        if (recoveredMeta.recoverStderr) baseLogs.push(`[forensic] recover_stderr=${recoveredMeta.recoverStderr}`);
        if (recoveredMeta.loadStderr) baseLogs.push(`[forensic] load_stderr=${recoveredMeta.loadStderr}`);
      }
      return res.json({
        ok: true,
        report_file: reportFile,
        report_path: reportPath,
        recover_primary: recoverPrimary,
        recovered_candidate_path: recoveredMeta?.recoveredPath || null,
        summary: summarizeForensicPayload(payload, previewRows),
        logs: baseLogs.slice(-60)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Forensic run failed' });
    }
  });

  router.post('/forensics/promote', (req, res) => {
    try {
      const reportFile = String(req.body?.report_file || '').trim();
      const candidatePathInput = String(req.body?.candidate_path || '').trim();
      const restartAfter = Boolean(req.body?.restart_after);

      const candidatePath = resolvePromotionCandidatePath({
        reportFile,
        candidatePath: candidatePathInput
      });
      const promoted = promoteCandidateToPrimary(candidatePath);

      const logs = [
        `[promote] source=${promoted.source}`,
        `[promote] target=${promoted.target}`,
        `[promote] mode=${promoted.mode}`,
        `[promote] active_db_path=${DB_PATH}`,
        `[promote] primary_db_path=${PRIMARY_DB_PATH}`,
        `[promote] schema_known=${promoted.schema?.schemaKnown ? 1 : 0}`,
        `[promote] has_recoverable_tables=${promoted.schema?.hasRecoverableTables ? 1 : 0}`
      ];
      if (promoted.previous_primary_path) {
        logs.push(`[promote] previous_primary_moved=${promoted.previous_primary_path}`);
      }
      for (const w of promoted.warnings || []) logs.push(`[promote] warning=${w}`);

      const response = {
        ok: true,
        report_file: reportFile || null,
        promoted_from: promoted.source,
        promoted_to: promoted.target,
        mode: promoted.mode,
        previous_primary_path: promoted.previous_primary_path,
        warnings: promoted.warnings || [],
        restart_required: true,
        logs
      };

      res.json(response);

      if (restartAfter) {
        setTimeout(() => process.exit(0), 400);
      }
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Promote failed' });
    }
  });

  router.post('/forensics/merge-report', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Forensic report file is required' });
    let payload = null;
    try {
      payload = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid forensic report JSON' });
    }
    if (!payload || !Array.isArray(payload.extracts)) {
      return res.status(400).json({ error: 'Invalid forensic report format' });
    }

    const since = normalizeTimestamp(req.body?.since);
    const cutoff = normalizeTimestamp(req.body?.cutoff);
    const selectedTablesRaw = String(req.body?.tables || '').trim();
    const tableFilter = selectedTablesRaw
      ? selectedTablesRaw.split(',').map((t) => String(t || '').trim()).filter(Boolean)
      : null;

    const rowsByTable = collectMergeRowsFromForensicPayload(payload, {
      since,
      cutoff,
      tableFilter
    });

    const summary = {};
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    try {
      db.pragma('foreign_keys = OFF');
      const tx = db.transaction(() => {
        for (const [tableName, idMap] of rowsByTable.entries()) {
          const stats = {
            input_rows: idMap.size,
            inserted: 0,
            updated: 0,
            skipped_older: 0,
            skipped_invalid: 0,
            skipped_no_ts: 0
          };
          summary[tableName] = stats;

          const safe = quoteIdent(tableName);
          const cols = getTableColumns(tableName);
          if (!cols.size || !cols.has('id')) {
            stats.skipped_invalid += idMap.size;
            totalSkipped += idMap.size;
            continue;
          }

          const selectById = db.prepare(`SELECT * FROM ${safe} WHERE id = ?`);

          for (const { row } of idMap.values()) {
            const id = Number(row.id);
            if (!Number.isFinite(id)) {
              stats.skipped_invalid += 1;
              totalSkipped += 1;
              continue;
            }

            const existing = selectById.get(id);
            if (!existing) {
              const insertCols = Object.keys(row).filter((c) => cols.has(c));
              if (!insertCols.length) {
                stats.skipped_invalid += 1;
                totalSkipped += 1;
                continue;
              }
              const colSql = insertCols.map(quoteIdent).join(', ');
              const placeholders = insertCols.map((c) => `@${c}`).join(', ');
              const insertStmt = db.prepare(`INSERT INTO ${safe} (${colSql}) VALUES (${placeholders})`);
              const data = {};
              for (const c of insertCols) data[c] = row[c] ?? null;
              insertStmt.run(data);
              stats.inserted += 1;
              totalInserted += 1;
              continue;
            }

            const incomingTs = rowTimestamp(row);
            const existingTs = rowTimestamp(existing);
            if (!incomingTs && existingTs) {
              stats.skipped_no_ts += 1;
              totalSkipped += 1;
              continue;
            }
            if (incomingTs && existingTs && incomingTs <= existingTs) {
              stats.skipped_older += 1;
              totalSkipped += 1;
              continue;
            }

            const updateCols = Object.keys(row).filter((c) => c !== 'id' && cols.has(c));
            if (!updateCols.length) {
              stats.skipped_invalid += 1;
              totalSkipped += 1;
              continue;
            }
            const setSql = updateCols.map((c) => `${quoteIdent(c)}=@${c}`).join(', ');
            const updateStmt = db.prepare(`UPDATE ${safe} SET ${setSql} WHERE id=@id`);
            const data = { id };
            for (const c of updateCols) data[c] = row[c] ?? null;
            updateStmt.run(data);
            stats.updated += 1;
            totalUpdated += 1;
          }
        }
      });

      tx();
      db.pragma('foreign_keys = ON');
      return res.json({
        ok: true,
        since: since || null,
        cutoff: cutoff || null,
        merged_tables: Object.keys(summary).length,
        inserted: totalInserted,
        updated: totalUpdated,
        skipped: totalSkipped,
        summary
      });
    } catch (e) {
      db.pragma('foreign_keys = ON');
      return res.status(500).json({ error: e?.message || 'Forensic merge failed' });
    }
  });

  router.get('/full-export', (req, res) => {
    try {
      const sources = resolveBackupSourceCandidates();
      if (!sources.length) {
        return res.status(500).json({ error: `No DB source found (active=${DB_PATH}, primary=${PRIMARY_DB_PATH})` });
      }
      const source = sources.find((p) => !isPathWithin(BACKUP_DIR, p)) || sources[0];
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}

      const stamp = timestampStamp();
      const fileName = `mentoring_full_${stamp}.sqlite`;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-Backup-Source', source);

      const stream = fs.createReadStream(source);
      stream.on('error', (e) => {
        if (!res.headersSent) {
          res.status(500).json({ error: e?.message || 'Failed to stream DB file' });
        } else {
          res.destroy(e);
        }
      });
      return stream.pipe(res);
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Full export failed' });
    }
  });

  router.post('/full-import', fullUpload.single('file'), (req, res) => {
    const uploadedPath = String(req.file?.path || '').trim();
    if (!uploadedPath) return res.status(400).json({ error: '업로드 파일이 없습니다.' });

    let tmpTargetPath = '';
    try {
      if (!canOpenAsSqlite(uploadedPath)) {
        return res.status(400).json({ error: 'SQLite 파일 형식이 아닙니다.' });
      }

      const schema = inspectSchema(uploadedPath);
      if (!schema.schemaKnown && !schema.hasRecoverableTables) {
        return res.status(400).json({ error: '복원 가능한 테이블 구조를 찾지 못했습니다.' });
      }

      let quick = null;
      let probe = null;
      try {
        probe = new BetterSqlite(uploadedPath, { readonly: true, fileMustExist: true });
        const row = probe.prepare('PRAGMA quick_check').get();
        quick = String(row?.quick_check || '').trim().toLowerCase();
      } finally {
        try { probe?.close(); } catch {}
      }
      if (quick && quick !== 'ok') {
        return res.status(400).json({ error: `업로드 파일 무결성 검사 실패: ${quick}` });
      }

      const target = path.resolve(PRIMARY_DB_PATH);
      const sourceBytes = Number(fs.statSync(uploadedPath).size || 0);
      const free = getDiskFreeBytes(path.dirname(target));
      const required = sourceBytes + BACKUP_MIN_HEADROOM_BYTES;
      if (free != null && free < required) {
        return res.status(507).json({
          error: `ENOSPC not enough space for full import (required=${formatBytes(required)}, free=${formatBytes(free)})`
        });
      }

      let preImportBackup = null;
      let preImportBackupSource = null;
      const warnings = [];
      try {
        const saved = backupNow('preimport');
        preImportBackup = path.basename(saved.out);
        preImportBackupSource = saved.source;
      } catch (e) {
        warnings.push(`preimport backup failed: ${String(e?.message || e)}`);
      }

      removeSqliteSidecars(target);
      tmpTargetPath = `${target}.import-${Date.now()}.tmp`;
      fs.copyFileSync(uploadedPath, tmpTargetPath);

      try {
        fs.renameSync(tmpTargetPath, target);
      } catch {
        removeFileQuietly(target);
        fs.renameSync(tmpTargetPath, target);
      }

      removeSqliteSidecars(target);

      return res.json({
        ok: true,
        imported_to: target,
        bytes: sourceBytes,
        schema,
        pre_import_backup: preImportBackup,
        pre_import_backup_source: preImportBackupSource,
        warnings,
        restart_required: true
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Full import failed' });
    } finally {
      removeFileQuietly(uploadedPath);
      removeFileQuietly(tmpTargetPath);
    }
  });

  router.get('/export', (req, res) => {
    try {
      const tables = [];
      for (const name of listTables()) {
        const safe = quoteIdent(name);
        const columns = db.prepare(`PRAGMA table_info(${safe})`).all().map((c) => c.name);
        const rows = db.prepare(`SELECT * FROM ${safe}`).all();
        tables.push({ name, columns, rows });
      }

      const payload = {
        meta: {
          version: 1,
          exported_at: new Date().toISOString()
        },
        tables
      };

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mentoring_backup_${stamp}.json"`);
      res.send(JSON.stringify(payload));
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Export failed' });
    }
  });

  router.post('/import', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
    let payload = null;
    try {
      payload = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    if (!payload || !Array.isArray(payload.tables)) {
      return res.status(400).json({ error: 'Invalid backup format' });
    }

    const existingTables = new Set(listTables());

    try {
      db.pragma('foreign_keys = OFF');
      const tx = db.transaction(() => {
        for (const t of payload.tables) {
          if (!existingTables.has(t.name)) continue;
          const safe = quoteIdent(t.name);
          db.prepare(`DELETE FROM ${safe}`).run();
        }

        for (const t of payload.tables) {
          if (!existingTables.has(t.name)) continue;
          const safe = quoteIdent(t.name);
          const currentCols = new Set(db.prepare(`PRAGMA table_info(${safe})`).all().map((c) => c.name));
          const columns = (t.columns || []).filter((c) => currentCols.has(c));
          if (!columns.length) continue;

          const colSql = columns.map(quoteIdent).join(',');
          const placeholders = columns.map((c) => `@${c}`).join(',');
          const stmt = db.prepare(`INSERT INTO ${safe} (${colSql}) VALUES (${placeholders})`);

          const rows = Array.isArray(t.rows) ? t.rows : [];
          for (const row of rows) {
            const data = {};
            for (const c of columns) data[c] = row?.[c] ?? null;
            stmt.run(data);
          }
        }
      });

      tx();
      db.pragma('foreign_keys = ON');
      return res.json({ ok: true });
    } catch (e) {
      db.pragma('foreign_keys = ON');
      return res.status(500).json({ error: e?.message || 'Import failed' });
    }
  });

  return router;
}
