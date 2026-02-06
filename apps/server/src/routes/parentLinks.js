import express from 'express';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

export default function parentLinkRoutes(db) {
  const router = express.Router();
  router.use(requireRole('director'));

  router.get('/', (req, res) => {
    const rows = db.prepare(
      `SELECT p.parent_user_id, u.display_name as parent_name, u.username as parent_username,
              p.student_id, s.name as student_name
       FROM parent_links p
       JOIN users u ON u.id=p.parent_user_id
       JOIN students s ON s.id=p.student_id
       ORDER BY u.id, s.id`
    ).all();
    res.json({ links: rows });
  });

  router.post('/', (req, res) => {
    const { parent_user_id, student_id } = req.body || {};
    if (!parent_user_id || !student_id) return res.status(400).json({ error: 'Missing fields' });
    const parent = db.prepare("SELECT id, role FROM users WHERE id=?").get(Number(parent_user_id));
    if (!parent || parent.role !== 'parent') return res.status(400).json({ error: 'Invalid parent user' });
    const student = db.prepare('SELECT id FROM students WHERE id=?').get(Number(student_id));
    if (!student) return res.status(404).json({ error: 'Student not found' });
    db.prepare('INSERT OR IGNORE INTO parent_links (parent_user_id, student_id) VALUES (?,?)')
      .run(Number(parent_user_id), Number(student_id));
    writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'parent_link', details: { parent_user_id, student_id } });
    res.json({ ok: true });
  });

  router.delete('/', (req, res) => {
    const parent_user_id = Number(req.query.parent_user_id);
    const student_id = Number(req.query.student_id);
    if (!parent_user_id || !student_id) return res.status(400).json({ error: 'Missing query params' });
    db.prepare('DELETE FROM parent_links WHERE parent_user_id=? AND student_id=?').run(parent_user_id, student_id);
    writeAudit(db, { user_id: req.user.id, action: 'delete', entity: 'parent_link', details: { parent_user_id, student_id } });
    res.json({ ok: true });
  });

  return router;
}
