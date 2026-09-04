import express from 'express';
import { safeJson } from '../lib/permissions.js';

export default function parentRoutes(db) {
  const router = express.Router();

  function ensureAppSettingsTable() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  function getMentorAssignment(studentId) {
    ensureAppSettingsTable();
    const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get('mentor_assignments');
    if (!row?.value_json) return null;
    try {
      const payload = JSON.parse(row.value_json);
      const list = Array.isArray(payload?.assignments) ? payload.assignments : [];
      return list.find((a) => String(a?.student_id) === String(studentId)) || null;
    } catch {
      return null;
    }
  }

  function hasColumn(table, col) {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.some((r) => r.name === col);
    } catch {
      return false;
    }
  }

  router.get('/overview', (req, res) => {
    if (req.user.role !== 'parent') return res.status(403).json({ error: 'Forbidden' });
    if (!req.user.student_id) return res.status(401).json({ error: 'Unauthorized' });

    const s = db.prepare('SELECT id, name, grade, schedule_json FROM students WHERE id=?').get(Number(req.user.student_id));
    if (!s) return res.json({ items: [] });

    const weeks = db.prepare(
      `SELECT w.id, w.label, w.start_date, w.end_date, wr.shared_with_parent, wr.updated_at
       FROM weeks w
       JOIN week_records wr ON wr.week_id=w.id AND wr.student_id=?
       WHERE wr.shared_with_parent=1
       ORDER BY w.id DESC`
    ).all(s.id);

    const pointsCol = hasColumn('penalties', 'points')
      ? 'points'
      : (hasColumn('penalties', 'amount') ? 'amount' : 'points');
    const dateCol = hasColumn('penalties', 'created_at')
      ? 'created_at'
      : (hasColumn('penalties', 'date') ? 'date' : null);
    const dateSelect = dateCol ? `${dateCol} as created_at` : 'NULL as created_at';
    const orderBy = dateCol ? `${dateCol} DESC, id DESC` : 'id DESC';

    const penalties = db.prepare(
      `SELECT id, ${pointsCol} as points, reason, ${dateSelect}
       FROM penalties
       WHERE student_id=?
       ORDER BY ${orderBy}`
    ).all(s.id);

    const totalPoints = penalties.reduce((acc, p) => acc + Number(p.points || 0), 0);
    const schedule = safeJson(s?.schedule_json, {});

    const mentorAssignment = getMentorAssignment(s.id);
    const out = [{
      student: { id: s.id, name: s.name, grade: s.grade, schedule },
      weeks,
      penalties: { totalPoints, items: penalties },
      mentor_assignment: mentorAssignment
    }];

    res.json({ items: out });
  });

  // Studycat needs the current assignment before a full mentoring round is
  // shared with the parent. Keep this deliberately narrower than /overview:
  // the authenticated parent's own student, round metadata, subject names,
  // and this week's homework are the only values exposed here.
  router.get('/assignments', (req, res) => {
    if (req.user.role !== 'parent') return res.status(403).json({ error: 'Forbidden' });
    res.set('Cache-Control', 'no-store');

    const studentId = Number(req.user.student_id);
    if (!studentId) return res.status(401).json({ error: 'Unauthorized' });

    const student = db.prepare('SELECT id FROM students WHERE id=?').get(studentId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const weeks = db.prepare(
      `SELECT id, label, start_date, end_date
       FROM weeks
       ORDER BY id DESC`
    ).all();

    const requestedWeekId = Number(req.query.weekId);
    const selectedWeek = Number.isInteger(requestedWeekId) && requestedWeekId > 0
      ? weeks.find((week) => Number(week.id) === requestedWeekId)
      : weeks[0];
    if (!selectedWeek) {
      if (Number.isInteger(requestedWeekId) && requestedWeekId > 0) {
        return res.status(404).json({ error: 'Week not found' });
      }
      return res.json({ student: { id: student.id }, weeks, selected_week_id: null, subject_records: [] });
    }

    const subjectRecords = db.prepare(
      `SELECT r.id, s.name AS subject_name, r.a_this_hw
       FROM subject_records r
       JOIN mentoring_subjects s ON s.id=r.subject_id
       WHERE r.student_id=? AND r.week_id=?
         AND s.student_id=r.student_id
         AND (s.deleted_from_week_id IS NULL OR s.deleted_from_week_id > ?)
       ORDER BY s.id`
    ).all(student.id, selectedWeek.id, selectedWeek.id);

    return res.json({
      student: { id: student.id },
      weeks,
      selected_week_id: selectedWeek.id,
      subject_records: subjectRecords
    });
  });

  router.get('/legacy-images', (req, res) => {
    if (req.user.role !== 'parent') return res.status(403).json({ error: 'Forbidden' });
    if (!req.user.student_id) return res.status(401).json({ error: 'Unauthorized' });

    const images = db
      .prepare('SELECT id, mime_type, data_base64, created_at FROM parent_legacy_images WHERE student_id=? ORDER BY id')
      .all(Number(req.user.student_id));

    res.json({ images });
  });

  return router;
}
