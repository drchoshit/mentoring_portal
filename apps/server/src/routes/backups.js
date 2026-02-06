import express from 'express';
import fs from 'fs';
import path from 'path';
import { requireRole } from '../lib/auth.js';
import { dbFilePath } from '../lib/db.js';

export default function backupRoutes(db) {
  const router = express.Router();
  router.use(requireRole('director'));

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

  return router;
}
