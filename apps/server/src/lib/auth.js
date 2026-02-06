import jwt from 'jsonwebtoken';

const DEFAULT_SECRET = 'dev-secret-change-me';

export function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_SECRET;
}

// parent(학생) 계정이면 username == students.external_id 로 1:1 매핑
function resolveParentStudentId(db, username) {
  if (!username) return null;
  const s = db
    .prepare('SELECT id FROM students WHERE external_id=?')
    .get(String(username).trim());
  return s?.id ? Number(s.id) : null;
}

export function signToken(user) {
  const payload = {
    sub: String(user.id),
    role: user.role,
    display_name: user.display_name || user.username,
    username: user.username
  };

  // parent 전용: 학생 매핑 정보 포함(클라이언트 편의 + 서버도 재검증함)
  if (user.role === 'parent' && user.student_id) {
    payload.student_id = Number(user.student_id);
  }

  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function requireAuth(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      const userId = Number(decoded.sub);

      const user = db
        .prepare('SELECT id, username, role, display_name, is_active FROM users WHERE id=?')
        .get(userId);

      if (!user || user.is_active !== 1) return res.status(401).json({ error: 'Unauthorized' });

      // parent는 반드시 student_id가 확정되어야 함 (username == external_id)
      if (user.role === 'parent') {
        const student_id = resolveParentStudentId(db, user.username);
        if (!student_id) {
          // 매핑되는 학생이 없으면 이 계정은 사용할 수 없음
          return res.status(401).json({ error: 'Unauthorized' });
        }
        user.student_id = student_id;
      }

      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}