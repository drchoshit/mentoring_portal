import express from 'express';
import multer from 'multer';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

function parseJsonFile(req) {
  if (!req.file) throw new Error('Missing file');
  const txt = req.file.buffer.toString('utf-8');
  return JSON.parse(txt);
}

function ensureAppSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function normalizeDays(input) {
  if (Array.isArray(input)) {
    return input.map((d) => String(d || '').trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[,\/\s]+/)
      .map((d) => d.trim())
      .filter(Boolean);
  }
  return [];
}

function loadAssignments(db) {
  ensureAppSettingsTable(db);
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get('mentor_assignments');
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function saveAssignments(db, payload) {
  ensureAppSettingsTable(db);
  db.prepare(
    `
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=datetime('now')
    `
  ).run('mentor_assignments', JSON.stringify(payload));
}

function parsePayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return { students: payload };
  if (Array.isArray(payload.students)) return payload;
  return null;
}

function normalizedIdCandidates(rawId) {
  const out = [];
  const add = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };

  add(rawId);

  const key = String(rawId ?? '').trim();
  if (!key) return out;

  // Some JSON exporters stringify integer-like numbers as "... .0".
  if (/^-?\d+\.0+$/.test(key)) {
    add(key.replace(/\.0+$/, ''));
  }

  const asNumber = Number(key);
  if (Number.isFinite(asNumber)) {
    add(String(asNumber));
    if (Number.isInteger(asNumber)) add(String(asNumber));
  }

  return out;
}

function buildStudentsByName(db) {
  const map = new Map();
  const rows = db.prepare('SELECT id, external_id, name FROM students WHERE name IS NOT NULL AND name != ?').all('');
  rows.forEach((row) => {
    const key = String(row?.name || '').trim();
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

export default function mentorAssignmentsRoutes(db) {
  const router = express.Router();

  router.get('/', requireRole('director', 'admin'), (req, res) => {
    const data = loadAssignments(db);
    return res.json({ data });
  });

  router.post('/import', requireRole('director', 'admin'), upload.single('file'), (req, res) => {
    let payload;
    try {
      payload = parseJsonFile(req);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const parsed = parsePayload(payload);
    if (!parsed) return res.status(400).json({ error: 'Expected students array' });

    const rows = parsed.students || [];
    const findByExternal = db.prepare('SELECT id, external_id, name FROM students WHERE external_id=?');
    const findById = db.prepare('SELECT id, external_id, name FROM students WHERE id=?');
    const studentsByName = buildStudentsByName(db);

    const byStudentId = new Map();
    const missing = [];
    const missingSet = new Set();

    rows.forEach((row) => {
      if (!row) return;
      const rawId = row.id;
      if (rawId === undefined || rawId === null || rawId === '') return;
      const key = String(rawId).trim();
      if (!key) return;

      let student = null;
      const idCandidates = normalizedIdCandidates(rawId);

      for (const candidate of idCandidates) {
        student = findByExternal.get(candidate);
        if (student) break;
      }

      if (!student) {
        for (const candidate of idCandidates) {
          const numeric = Number(candidate);
          if (!Number.isSafeInteger(numeric)) continue;
          if (String(numeric) !== candidate) continue;
          student = findById.get(numeric);
          if (student) break;
        }
      }

      if (!student) {
        const nameKey = String(row?.name || '').trim();
        const nameMatches = nameKey ? (studentsByName.get(nameKey) || []) : [];
        if (nameMatches.length === 1) {
          student = nameMatches[0];
        }
      }

      if (!student) {
        if (!missingSet.has(key)) {
          missingSet.add(key);
          missing.push({ id: key, name: String(row?.name || '').trim() });
        }
        return;
      }

      const mentor = String(row?.mentor ?? row?.mentor_name ?? '').trim();
      const scheduledDays = normalizeDays(row?.scheduledDays ?? row?.scheduled_days ?? row?.days);

      byStudentId.set(String(student.id), {
        student_id: student.id,
        external_id: student.external_id || '',
        name: student.name || '',
        mentor,
        scheduledDays
      });
    });

    const assignments = Array.from(byStudentId.values());
    const stored = {
      periodId: parsed.periodId ? String(parsed.periodId).trim() : '',
      exportedAt: parsed.exportedAt ? String(parsed.exportedAt).trim() : '',
      updatedAt: new Date().toISOString(),
      assignments
    };

    saveAssignments(db, stored);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'import',
      entity: 'mentor_assignments',
      details: { stored: assignments.length, missing: missing.length }
    });

    return res.json({ data: stored, missing });
  });

  return router;
}
