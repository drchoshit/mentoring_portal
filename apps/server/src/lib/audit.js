export function writeAudit(db, { user_id, action, entity, entity_id = null, details = {} }) {
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, details_json) VALUES (?,?,?,?,?)'
  ).run(user_id, action, entity, entity_id, JSON.stringify(details ?? {}));
}
