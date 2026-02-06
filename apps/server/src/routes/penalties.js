// apps/server/src/routes/penalties.js
import express from 'express';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { withParentStudent } from '../lib/parentScope.js';

function hasColumn(db, table, col) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === col);
  } catch {
    return false;
  }
}

export default function penaltiesRoutes(db) {
  const router = express.Router();

  router.use(withParentStudent(db));

  const pointsCol = hasColumn(db, 'penalties', 'points') ? 'points' : (hasColumn(db, 'penalties', 'amount') ? 'amount' : 'points');
  const dateCol = hasColumn(db, 'penalties', 'created_at')
    ? 'created_at'
    : (hasColumn(db, 'penalties', 'date') ? 'date' : null);
  const hasWeekId = hasColumn(db, 'penalties', 'week_id');

  // 요약: 학생별 누적 벌점
  router.get('/summary', (req, res) => {
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const rows = db.prepare(
      `SELECT student_id, SUM(${pointsCol}) as totalPoints, COUNT(*) as count
       FROM penalties GROUP BY student_id`
    ).all();

    return res.json({ items: rows });
  });

  // 조회: parent는 본인 student만 강제
  router.get('/', (req, res) => {
    let student_id = Number(req.query.studentId || 0);
    const week_id = req.query.weekId != null ? Number(req.query.weekId) : null;

    if (req.user.role === 'parent') {
      student_id = Number(req.parentStudent?.id || 0);
    }
    if (!student_id) return res.status(400).json({ error: 'Missing studentId' });

    const weekSelect = hasWeekId ? 'week_id' : 'NULL as week_id';
    const dateSelect = dateCol ? `${dateCol} as created_at` : 'NULL as created_at';
    const orderBy = dateCol ? `${dateCol} DESC, id DESC` : 'id DESC';
    const baseSql = `SELECT id, student_id, ${weekSelect}, ${pointsCol} as points, reason, ${dateSelect}
         FROM penalties WHERE student_id=?`;
    const sql = hasWeekId && week_id
      ? `${baseSql} AND week_id=? ORDER BY ${orderBy}`
      : `${baseSql} ORDER BY ${orderBy}`;

    const rows = hasWeekId && week_id
      ? db.prepare(sql).all(student_id, week_id)
      : db.prepare(sql).all(student_id);

    const total = rows.reduce((acc, r) => acc + Number(r.points || 0), 0);
    return res.json({ items: rows, totalPoints: total });
  });

  // 생성/수정/삭제는 관리자권한(원장/관리자 등)만
  router.post('/', requireRole('director', 'admin'), (req, res) => {
    const { student_id, week_id, points, reason } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });

    const v = Number(points || 0);
    const info = db.prepare(
      `INSERT INTO penalties (student_id, week_id, ${pointsCol}, reason, created_at, updated_at)
       VALUES (?,?,?,?, datetime('now'), datetime('now'))`
    ).run(Number(student_id), Number(week_id), v, reason ? String(reason) : null);

    writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'penalty', entity_id: info.lastInsertRowid, details: { student_id, week_id, points: v } });
    return res.json({ id: info.lastInsertRowid });
  });

  router.delete('/:id', requireRole('director', 'admin'), (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare(`SELECT id, student_id, week_id, ${pointsCol} as points, reason FROM penalties WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    db.prepare('DELETE FROM penalties WHERE id=?').run(id);
    writeAudit(db, { user_id: req.user.id, action: 'delete', entity: 'penalty', entity_id: id, details: row });
    return res.json({ ok: true });
  });

  return router;
}
