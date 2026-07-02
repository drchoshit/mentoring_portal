import express from 'express';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const ASSIGNMENT_KEEP_RECENT_WEEKS = Math.max(
  1,
  Number(process.env.ASSIGNMENT_KEEP_RECENT_WEEKS || 3)
);

function cleanupOldAssignmentHistory(db, keepRecentWeeks = ASSIGNMENT_KEEP_RECENT_WEEKS) {
  const keepCount = Math.max(1, Number(keepRecentWeeks || 3));
  const keepRows = db
    .prepare('SELECT id FROM weeks ORDER BY id DESC LIMIT ?')
    .all(keepCount);
  const keepIds = keepRows
    .map((row) => Number(row?.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!keepIds.length) {
    return {
      keep_week_ids: [],
      cleared_week_records: 0,
      deleted_wrong_answer_images: 0,
      preserved: true
    };
  }

  return {
    keep_week_ids: keepIds,
    cleared_week_records: 0,
    deleted_wrong_answer_images: 0,
    preserved: true,
    note: '멘토링 기록 보존 정책에 따라 회차 추가 시 과거 오답 배분 기록과 이미지를 삭제하지 않습니다.'
  };
}

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
      const cleanupResult = cleanupOldAssignmentHistory(db, ASSIGNMENT_KEEP_RECENT_WEEKS);
      writeAudit(db, {
        user_id: req.user.id,
        action: 'create',
        entity: 'week',
        entity_id: newWeekId,
        details: { label, cleanup: cleanupResult }
      });
      return res.json({
        id: newWeekId,
        cleanup: cleanupResult
      });
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

  router.delete('/:id', requireRole('director'), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid week id' });
    }

    const existing = db.prepare('SELECT id, label FROM weeks WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const totalWeeks = Number(db.prepare('SELECT COUNT(*) AS cnt FROM weeks').get()?.cnt || 0);
    if (totalWeeks <= 1) {
      return res.status(400).json({ error: 'At least one week must remain' });
    }

    db.prepare('DELETE FROM weeks WHERE id=?').run(id);
    writeAudit(db, {
      user_id: req.user.id,
      action: 'delete',
      entity: 'week',
      entity_id: id,
      details: { label: String(existing.label || '') }
    });
    return res.json({ ok: true, deleted_id: id });
  });

  return router;
}
