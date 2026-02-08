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
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  function backupNow(reason = 'manual') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(BACKUP_DIR, `db-${stamp}-${reason}.sqlite`);
    fs.copyFileSync(DB_PATH, out);
    return out;
  }

  function quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
  }

  function listTables() {
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  }

  router.get('/list', (req, res) => {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sqlite'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 200);
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
