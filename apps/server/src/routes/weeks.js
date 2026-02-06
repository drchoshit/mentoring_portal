import express from 'express';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

export default function weekRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const weeks = db.prepare('SELECT id, label, start_date, end_date FROM weeks ORDER BY id').all();
    res.json({ weeks });
  });

  router.post('/', requireRole('director'), (req, res) => {
    const { label, start_date, end_date } = req.body || {};
    if (!label) return res.status(400).json({ error: 'Missing label' });
    try {
      const info = db.prepare('INSERT INTO weeks (label, start_date, end_date) VALUES (?,?,?)')
        .run(label, start_date || null, end_date || null);
      const newWeekId = info.lastInsertRowid;

      const prevWeek = db.prepare('SELECT id FROM weeks WHERE id < ? ORDER BY id DESC LIMIT 1').get(newWeekId);
      if (prevWeek?.id) {
        // Carry over "이번주 과제" -> next week "지난주 과제"
        db.prepare(
          `
          INSERT INTO subject_records (student_id, week_id, subject_id, a_last_hw, updated_at)
          SELECT student_id, ?, subject_id, a_this_hw, datetime('now')
          FROM subject_records
          WHERE week_id = ? AND a_this_hw IS NOT NULL AND TRIM(a_this_hw) != ''
          ON CONFLICT(student_id, week_id, subject_id)
          DO UPDATE SET a_last_hw=excluded.a_last_hw, updated_at=datetime('now')
          WHERE subject_records.a_last_hw IS NULL OR TRIM(subject_records.a_last_hw) = ''
          `
        ).run(newWeekId, prevWeek.id);
      }
      writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'week', entity_id: newWeekId, details: { label } });
      return res.json({ id: newWeekId });
    } catch {
      return res.status(400).json({ error: 'Week label exists' });
    }
  });

  router.put('/:id', requireRole('director'), (req, res) => {
    const id = Number(req.params.id);
    const { label, start_date, end_date } = req.body || {};
    const existing = db.prepare('SELECT id FROM weeks WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.prepare('UPDATE weeks SET label=?, start_date=?, end_date=? WHERE id=?')
      .run(label, start_date || null, end_date || null, id);
    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'week', entity_id: id, details: { label } });
    return res.json({ ok: true });
  });

  return router;
}
