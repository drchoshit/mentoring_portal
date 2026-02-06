import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getJwtSecret, signToken } from '../lib/auth.js';

function resolveParentStudentId(db, username) {
  if (!username) return null;
  const s = db
    .prepare('SELECT id FROM students WHERE external_id=?')
    .get(String(username).trim());
  return s?.id ? Number(s.id) : null;
}

export default function authRoutes(db) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = db
      .prepare('SELECT id, username, password_hash, role, display_name, is_active FROM users WHERE username=?')
      .get(username);

    if (!user || user.is_active !== 1) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // parent는 반드시 학생과 1:1 매핑이 되어야 로그인 허용
    let student_id = null;
    if (user.role === 'parent') {
      student_id = resolveParentStudentId(db, user.username);
      if (!student_id) return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({ ...user, student_id });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        student_id: student_id || undefined
      }
    });
  });

  router.get('/me', (req, res) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(200).json({ user: null });

    try {
      const token = header.slice(7);
      const decoded = jwt.verify(token, getJwtSecret());
      const userId = Number(decoded.sub);

      const user = db
        .prepare('SELECT id, username, role, display_name, is_active FROM users WHERE id=?')
        .get(userId);

      if (!user || user.is_active !== 1) return res.status(200).json({ user: null });

      let student_id = null;
      if (user.role === 'parent') {
        student_id = resolveParentStudentId(db, user.username);
        if (!student_id) return res.status(200).json({ user: null });
      }

      return res.status(200).json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          display_name: user.display_name,
          student_id: student_id || undefined
        }
      });
    } catch {
      return res.status(200).json({ user: null });
    }
  });

  return router;
}