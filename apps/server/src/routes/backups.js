import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireRole } from '../lib/auth.js';
import { dbFilePath } from '../lib/db.js';

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
  const BACKUP_KEEP_MAX = Math.max(10, Number(process.env.BACKUP_KEEP_MAX || 200));
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

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
