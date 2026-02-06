import express from 'express';
import { requireRole } from '../lib/auth.js';
import { getAllFieldPermissions } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

export default function permissionRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const perms = getAllFieldPermissions(db);
    res.json({ permissions: perms });
  });

  router.put('/:id', requireRole('director'), (req, res) => {
    const id = Number(req.params.id);
    const { roles_view, roles_edit, parent_visible, label } = req.body || {};
    const existing = db.prepare('SELECT id, field_key, label FROM field_permissions WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const rv = JSON.stringify(Array.isArray(roles_view) ? roles_view : []);
    const re = JSON.stringify(Array.isArray(roles_edit) ? roles_edit : []);
    db.prepare('UPDATE field_permissions SET roles_view_json=?, roles_edit_json=?, parent_visible=?, label=? WHERE id=?')
      .run(rv, re, parent_visible ? 1 : 0, label || existing.label, id);
    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'field_permission', entity_id: id, details: { field_key: existing.field_key } });
    return res.json({ ok: true });
  });

  return router;
}
