/**
 * Field-level permissions are stored in field_permissions.
 * roles_view_json / roles_edit_json: JSON arrays of roles.
 */

export function safeJsonArray(v) {
  try {
    const parsed = JSON.parse(v || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function safeJson(v, fallback) {
  try {
    return JSON.parse(v ?? JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

export function getAllFieldPermissions(db) {
  const rows = db.prepare('SELECT * FROM field_permissions ORDER BY id').all();
  return rows.map((r) => ({
    ...r,
    roles_view: safeJsonArray(r.roles_view_json),
    roles_edit: safeJsonArray(r.roles_edit_json)
  }));
}

export function canViewField(db, role, field_key) {
  const p = db.prepare('SELECT roles_view_json FROM field_permissions WHERE field_key=?').get(field_key);
  if (!p) return false;
  return safeJsonArray(p.roles_view_json).includes(role);
}

export function canEditField(db, role, field_key) {
  const p = db.prepare('SELECT roles_edit_json FROM field_permissions WHERE field_key=?').get(field_key);
  if (!p) return false;
  return safeJsonArray(p.roles_edit_json).includes(role);
}

export function isParentVisible(db, field_key) {
  const p = db.prepare('SELECT parent_visible FROM field_permissions WHERE field_key=?').get(field_key);
  if (!p) return false;
  return Number(p.parent_visible) === 1;
}

export function filterObjectByView(db, role, obj, { parentMode = false } = {}) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (!key.match(/^(a_|b_|c_|scores_json)/)) continue;
    if (parentMode) {
      const parentOk = isParentVisible(db, key);
      if (!parentOk) out[key] = null;
    } else {
      const ok = canViewField(db, role, key);
      if (!ok) out[key] = null;
    }
  }
  return out;
}
