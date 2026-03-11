import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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

export default function backupRoutes(db) {
  const router = express.Router();
  router.use(requireRole('director', 'admin'));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
  });

  const DB_PATH = dbFilePath;
  const BACKUP_DIR = process.env.BACKUP_DIR
    ? (path.isAbsolute(process.env.BACKUP_DIR) ? process.env.BACKUP_DIR : path.resolve(process.cwd(), process.env.BACKUP_DIR))
    : path.join(path.dirname(DB_PATH), 'backups');
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

  function backupNow(reason = 'manual') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(BACKUP_DIR, `db-${stamp}-${reason}.sqlite`);
    fs.copyFileSync(DB_PATH, out);
    pruneByKeepMax();
    return out;
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
      const filePath = backupNow('manual');
      res.json({ ok: true, file: path.basename(filePath) });
    } catch (e) {
      res.status(500).json({ error: 'Backup failed' });
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

      const args = [FORENSIC_SCRIPT_PATH, '--top', String(top), '--limit', String(limit)];
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
      return res.json({
        ok: true,
        report_file: reportFile,
        report_path: reportPath,
        summary: summarizeForensicPayload(payload, previewRows),
        logs: mergedLogs.split(/\r?\n/).filter(Boolean).slice(-30)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Forensic run failed' });
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
