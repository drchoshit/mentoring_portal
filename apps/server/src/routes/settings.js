import express from 'express';
import { requireRole } from '../lib/auth.js';

const DEFAULT_PARENT_MENTOR_NOTICE = '멘토 및 멘토링 요일은 학생의 일정에 따라 변경될 수 있습니다.';

function ensureAppSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function getSetting(db, key) {
  ensureAppSettingsTable(db);
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function setSetting(db, key, value) {
  ensureAppSettingsTable(db);
  db.prepare(
    `
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=datetime('now')
    `
  ).run(key, JSON.stringify(value));
}

export default function settingsRoutes(db) {
  const router = express.Router();

  router.get('/parent-mentor-notice', (req, res) => {
    const stored = getSetting(db, 'parent_mentor_notice');
    if (stored && Object.prototype.hasOwnProperty.call(stored, 'text')) {
      return res.json({ value: String(stored.text ?? '') });
    }
    return res.json({ value: DEFAULT_PARENT_MENTOR_NOTICE });
  });

  router.put('/parent-mentor-notice', requireRole('director'), (req, res) => {
    const value = typeof req.body?.value === 'string' ? req.body.value : '';
    setSetting(db, 'parent_mentor_notice', { text: value });
    return res.json({ ok: true, value });
  });

  return router;
}
