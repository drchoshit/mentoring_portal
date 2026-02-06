import express from 'express';
import { writeAudit } from '../lib/audit.js';

function canSend(fromRole, toRole) {
  if (fromRole === 'parent' || toRole === 'parent') return false;
  if (fromRole === 'mentor' && toRole === 'admin') return false;
  return true;
}

function parsePositiveInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
}

export default function feedRoutes(db) {
  const router = express.Router();

  // Allowed recipients for the current user (for UI dropdowns)
  router.get('/recipients', (req, res) => {
    const candidates = db.prepare(
      `SELECT id, display_name, role
       FROM users
       WHERE is_active=1 AND role!='parent'
       ORDER BY CASE role
          WHEN 'director' THEN 1
          WHEN 'lead' THEN 2
          WHEN 'mentor' THEN 3
          WHEN 'admin' THEN 4
          ELSE 9 END, id`
    ).all();

    const allowed = candidates
      .filter((u) => u.id !== req.user.id)
      .filter((u) => canSend(req.user.role, u.role));

    res.json({ recipients: allowed });
  });

  // 학생 기준 피드 (alias)
  router.get('/by-student', (req, res) => {
    const studentId = parsePositiveInt(req.query.studentId);
    if (!studentId) return res.status(400).json({ error: 'Missing studentId' });

    // 내부적으로 동일 처리
    req.query.studentId = String(studentId);
    return router.handle(req, res, () => {});
  });

  router.get('/', (req, res) => {
    const studentId = parsePositiveInt(req.query.studentId);
    const limitReq = parsePositiveInt(req.query.limit);
    const limit = Math.min(limitReq || 300, 500);

    const isPrivileged = ['director','admin','lead'].includes(req.user.role);

    const where = [];
    const params = [];

    where.push('f.deleted_at IS NULL');

    // parent가 끼는 피드들은 애초에 생성 불가 정책이라 대부분 없겠지만, 안전장치
    where.push("u1.role!='parent' AND u2.role!='parent'");

    if (!isPrivileged) {
      where.push('(f.from_user_id=? OR f.to_user_id=?)');
      params.push(req.user.id, req.user.id);
    }

    if (studentId) {
      where.push('f.student_id=?');
      params.push(studentId);
    }

    const sql = `
      SELECT f.*,
             u1.display_name as from_name, u1.role as from_role,
             u2.display_name as to_name, u2.role as to_role,
             s.name as student_name
      FROM feeds f
      JOIN users u1 ON u1.id=f.from_user_id
      JOIN users u2 ON u2.id=f.to_user_id
      LEFT JOIN students s ON s.id=f.student_id
      WHERE ${where.join(' AND ')}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params, limit);

    const ids = rows.map(r => r.id);
    const commentsByFeed = new Map();

    if (ids.length) {
      const comments = db.prepare(
        `SELECT c.*, u.display_name as from_name, u.role as from_role
         FROM feed_comments c
         JOIN users u ON u.id=c.from_user_id
         WHERE c.feed_id IN (${ids.map(() => '?').join(',')})
         ORDER BY c.created_at ASC, c.id ASC`
      ).all(...ids);

      for (const c of comments) {
        const arr = commentsByFeed.get(c.feed_id) || [];
        arr.push(c);
        commentsByFeed.set(c.feed_id, arr);
      }
    }

    res.json({
      feeds: rows.map(r => ({ ...r, comments: commentsByFeed.get(r.id) || [] }))
    });
  });

  router.post('/', (req, res) => {
    const { to_user_id, student_id = null, target_field = null, title = null, body } = req.body || {};
    if (!to_user_id || !body) return res.status(400).json({ error: 'Missing fields' });

    const to = db.prepare('SELECT id, role FROM users WHERE id=?').get(Number(to_user_id));
    if (!to) return res.status(404).json({ error: 'Recipient not found' });
    if (!canSend(req.user.role, to.role)) return res.status(403).json({ error: 'Not allowed' });

    const info = db.prepare(
      'INSERT INTO feeds (from_user_id, to_user_id, student_id, target_field, title, body) VALUES (?,?,?,?,?,?)'
    ).run(
      req.user.id,
      Number(to_user_id),
      student_id ? Number(student_id) : null,
      target_field,
      title,
      String(body)
    );

    writeAudit(db, {
      user_id: req.user.id,
      action: 'create',
      entity: 'feed',
      entity_id: info.lastInsertRowid,
      details: { to_user_id: Number(to_user_id), student_id }
    });

    res.json({ id: info.lastInsertRowid });
  });

  router.post('/:id/comments', (req, res) => {
    const feedId = Number(req.params.id);
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'Missing body' });

    const feed = db.prepare('SELECT * FROM feeds WHERE id=? AND deleted_at IS NULL').get(feedId);
    if (!feed) return res.status(404).json({ error: 'Not found' });

    const canSee = ['director','admin','lead'].includes(req.user.role)
      ? true
      : (feed.from_user_id === req.user.id || feed.to_user_id === req.user.id);

    if (!canSee) return res.status(403).json({ error: 'Forbidden' });

    const info = db.prepare('INSERT INTO feed_comments (feed_id, from_user_id, body) VALUES (?,?,?)')
      .run(feedId, req.user.id, String(body));

    writeAudit(db, { user_id: req.user.id, action: 'comment', entity: 'feed', entity_id: feedId });
    res.json({ id: info.lastInsertRowid });
  });

  router.delete('/:id', (req, res) => {
    const feedId = Number(req.params.id);
    const feed = db.prepare('SELECT * FROM feeds WHERE id=? AND deleted_at IS NULL').get(feedId);
    if (!feed) return res.status(404).json({ error: 'Not found' });

    const canDelete = req.user.role === 'director' || feed.from_user_id === req.user.id;
    if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

    db.prepare("UPDATE feeds SET deleted_at=datetime('now') WHERE id=?").run(feedId);

    writeAudit(db, { user_id: req.user.id, action: 'delete', entity: 'feed', entity_id: feedId });
    res.json({ ok: true });
  });

  return router;
}