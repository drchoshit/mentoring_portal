// apps/server/src/lib/parentScope.js
export function getParentStudentOrThrow(db, req) {
  if (!req.user || req.user.role !== 'parent') return null;

  const ext = String(req.user.username || '').trim();
  if (!ext) {
    const err = new Error('No username for parent');
    err.status = 403;
    throw err;
  }

  const row = db.prepare('SELECT id, external_id, name, grade FROM students WHERE external_id=?').get(ext);
  if (!row) {
    const err = new Error('Student not found for this account');
    err.status = 403;
    throw err;
  }
  return row; // {id, external_id, name, grade}
}

export function withParentStudent(db) {
  return (req, res, next) => {
    try {
      req.parentStudent = getParentStudentOrThrow(db, req);
      next();
    } catch (e) {
      const code = Number(e?.status || 403);
      return res.status(code).json({ error: e?.message || 'Forbidden' });
    }
  };
}
