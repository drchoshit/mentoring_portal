import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

function randomLower(n) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < n; i++) out += letters[crypto.randomInt(0, letters.length)];
  return out;
}
function randomDigits(n) {
  let out = '';
  for (let i = 0; i < n; i++) out += String(crypto.randomInt(0, 10));
  return out;
}
function genParentPassword() {
  return `${randomLower(2)}${randomDigits(4)}`; // 예: dw7894
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function userRoutes(db) {
  const router = express.Router();

  // -------------------------
  // 관리자(직원) 유저 목록/생성/수정/삭제
  // -------------------------

  router.get('/', requireRole('director'), (req, res) => {
    const users = db.prepare(`
      SELECT id, username, display_name, role, is_active
      FROM users
      ORDER BY id
    `).all();
    return res.json({ users });
  });

  router.post('/', requireRole('director'), (req, res) => {
    const { username, password, display_name, role } = req.body || {};
    const u = String(username || '').trim();
    const p = String(password || '').trim();
    const dn = String(display_name || '').trim();
    const r = String(role || 'mentor').trim();

    if (!u) return res.status(400).json({ error: 'Missing username' });
    if (!p) return res.status(400).json({ error: 'Missing password' });

    const exists = db.prepare('SELECT id FROM users WHERE username=?').get(u);
    if (exists) return res.status(400).json({ error: 'Username exists' });

    const password_hash = bcrypt.hashSync(p, 10);

    const info = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, display_name, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(u, `${u}@demo.local`, password_hash, r, dn || u);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'create',
      entity: 'user',
      entity_id: info.lastInsertRowid,
      details: { username: u, role: r }
    });

    return res.json({ id: info.lastInsertRowid });
  });

  router.put('/:id', requireRole('director'), (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { display_name, role, is_active, password } = req.body || {};

    // 대상이 parent 계정이면: 이 PUT으로 비번 변경 금지(원칙적으로 발급 API로만)
    if (String(existing.role) === 'parent' && password && String(password).trim()) {
      return res.status(400).json({ error: '학부모 계정 비밀번호는 이 화면에서 변경할 수 없습니다.' });
    }

    db.prepare('UPDATE users SET display_name=?, updated_at=datetime("now") WHERE id=?')
      .run((display_name ?? existing.display_name) ?? existing.username, id);

    db.prepare('UPDATE users SET role=?, updated_at=datetime("now") WHERE id=?')
      .run(String(role || existing.role || 'mentor'), id);

    const v = (is_active === 0 || is_active === 1) ? is_active : existing.is_active;
    db.prepare('UPDATE users SET is_active=?, updated_at=datetime("now") WHERE id=?')
      .run(v ?? 1, id);

    if (password && String(password).trim()) {
      const password_hash = bcrypt.hashSync(String(password).trim(), 10);
      db.prepare('UPDATE users SET password_hash=?, updated_at=datetime("now") WHERE id=?')
        .run(password_hash, id);
    }

    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'user', entity_id: id });
    return res.json({ ok: true });
  });

  router.delete('/:id', requireRole('director'), (req, res) => {
    const id = Number(req.params.id);
    if (id === Number(req.user.id)) return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });

    const existing = db.prepare('SELECT id, username, role FROM users WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    try {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM parent_credentials WHERE user_id=?').run(id);
        db.prepare('DELETE FROM users WHERE id=?').run(id);
      });
      tx();

      writeAudit(db, {
        user_id: req.user.id,
        action: 'delete',
        entity: 'user',
        entity_id: id,
        details: { username: existing.username, role: existing.role }
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error('Delete user failed:', e);
      return res.status(500).json({ error: e?.message || 'Delete failed' });
    }
  });

  // -------------------------
  // 유저 권한(학생=학부모) : 학생ID 고정, 랜덤 비번 발급/조회/다운로드
  // -------------------------

  // 발급/갱신
  // - username = students.external_id (고정)
  // - role = parent (고정)
  // - display_name = 학생이름
  // - password = 랜덤(소문자2+숫자4)
  // - 옵션 reset_existing=true면 기존 계정도 비번 재발급(새 랜덤)
  router.post('/parents/issue', requireRole('director'), (req, res) => {
    const resetExisting = !!req.body?.reset_existing;

    const students = db.prepare(`
      SELECT id AS student_id, external_id, name
      FROM students
      ORDER BY id
    `).all();

    const findUserByUsername = db.prepare(`SELECT id, role FROM users WHERE username=?`);
    const insertUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, display_name, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'parent', ?, 1, datetime('now'), datetime('now'))
    `);
    const updateUserBase = db.prepare(`
      UPDATE users
      SET role='parent', display_name=?, is_active=1, updated_at=datetime('now')
      WHERE id=?
    `);
    const updateUserPw = db.prepare(`
      UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?
    `);

    const upsertCred = db.prepare(`
      INSERT INTO parent_credentials (student_id, user_id, username, password_plain, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(student_id) DO UPDATE SET
        user_id=excluded.user_id,
        username=excluded.username,
        password_plain=excluded.password_plain,
        updated_at=datetime('now')
    `);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let reset = 0;

    const tx = db.transaction(() => {
      for (const s of students) {
        const username = String(s.external_id || '').trim();
        const displayName = String(s.name || '').trim() || username;

        if (!username) { skipped += 1; continue; }

        const user = findUserByUsername.get(username);
        if (!user) {
          const pw = genParentPassword();
          const password_hash = bcrypt.hashSync(pw, 10);

          const info = insertUser.run(username, `${username}@demo.local`, password_hash, displayName);
          upsertCred.run(s.student_id, info.lastInsertRowid, username, pw);

          created += 1;
        } else {
          updateUserBase.run(displayName, user.id);

          if (resetExisting) {
            const pw = genParentPassword();
            const password_hash = bcrypt.hashSync(pw, 10);
            updateUserPw.run(password_hash, user.id);
            upsertCred.run(s.student_id, user.id, username, pw);
            reset += 1;
          } else {
            // 비번은 유지. 다만 credentials가 없을 수 있으니(과거 데이터) 있으면 유지, 없으면 새로 발급
            const cred = db.prepare('SELECT password_plain FROM parent_credentials WHERE student_id=?').get(s.student_id);
            if (!cred?.password_plain) {
              const pw = genParentPassword();
              const password_hash = bcrypt.hashSync(pw, 10);
              updateUserPw.run(password_hash, user.id);
              upsertCred.run(s.student_id, user.id, username, pw);
              reset += 1;
            } else {
              upsertCred.run(s.student_id, user.id, username, cred.password_plain);
            }
          }

          updated += 1;
        }
      }
    });
    tx();

    writeAudit(db, {
      user_id: req.user.id,
      action: 'issue',
      entity: 'parent_accounts',
      details: { created, updated, skipped, reset_existing: resetExisting, reset_count: reset }
    });

    return res.json({ created, updated, skipped, reset_count: reset });
  });

  // 목록(학생 리스트 기반)
  router.get('/parents', requireRole('director'), (req, res) => {
    const rows = db.prepare(`
      SELECT
        s.id AS student_id,
        s.external_id AS username,
        s.name,
        u.id AS user_id,
        u.is_active,
        u.role,
        pc.password_plain
      FROM students s
      LEFT JOIN users u ON u.username = s.external_id
      LEFT JOIN parent_credentials pc ON pc.student_id = s.id
      ORDER BY s.id
    `).all();

    // role은 화면에서 parent 하나만 쓰니까 강제로 parent로 맞춰서 내려도 됨
    const items = rows.map(r => ({
      student_id: r.student_id,
      user_id: r.user_id ?? null,
      username: r.username ?? '',
      name: r.name ?? '',
      role: 'parent',
      is_active: r.is_active ?? 1,
      password: r.password_plain ?? ''
    }));

    return res.json({ users: items });
  });

  // 활성 토글(학생=학부모)
  router.put('/parents/:studentId/active', requireRole('director'), (req, res) => {
    const studentId = Number(req.params.studentId);
    const active = req.body?.is_active ? 1 : 0;

    const row = db.prepare(`
      SELECT u.id AS user_id
      FROM students s
      JOIN users u ON u.username = s.external_id
      WHERE s.id=?
    `).get(studentId);

    if (!row?.user_id) return res.status(404).json({ error: 'User not found for student' });

    db.prepare(`UPDATE users SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(active, row.user_id);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'update',
      entity: 'parent_account_active',
      details: { student_id: studentId, is_active: active }
    });

    return res.json({ ok: true });
  });

  // JSON 다운로드
  router.get('/parents/export.json', requireRole('director'), (req, res) => {
    const rows = db.prepare(`
      SELECT
        s.external_id AS username,
        s.name,
        pc.password_plain AS password,
        'parent' AS role,
        COALESCE(u.is_active, 1) AS is_active
      FROM students s
      LEFT JOIN users u ON u.username = s.external_id
      LEFT JOIN parent_credentials pc ON pc.student_id = s.id
      ORDER BY s.id
    `).all();

    const payload = {
      generated_at: new Date().toISOString(),
      users: rows.map(r => ({
        username: r.username ?? '',
        name: r.name ?? '',
        password: r.password ?? '',
        role: 'parent',
        is_active: Number(r.is_active ?? 1)
      }))
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="parent_users_${new Date().toISOString().slice(0,10)}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  });

  // Excel 호환 CSV 다운로드 (엑셀에서 바로 열림)
  router.get('/parents/export.csv', requireRole('director'), (req, res) => {
    const rows = db.prepare(`
      SELECT
        s.external_id AS username,
        s.name,
        pc.password_plain AS password,
        COALESCE(u.is_active, 1) AS is_active
      FROM students s
      LEFT JOIN users u ON u.username = s.external_id
      LEFT JOIN parent_credentials pc ON pc.student_id = s.id
      ORDER BY s.id
    `).all();

    const header = ['이름', 'ID(username)', '비밀번호', '역할', '활성'];
    const lines = [header.join(',')];

    for (const r of rows) {
      lines.push([
        escapeCsv(r.name ?? ''),
        escapeCsv(r.username ?? ''),
        escapeCsv(r.password ?? ''),
        escapeCsv('parent'),
        escapeCsv(Number(r.is_active ?? 1) ? 'on' : 'off')
      ].join(','));
    }

    const csv = '\uFEFF' + lines.join('\n'); // BOM 넣어서 한글 깨짐 방지
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="parent_users_${new Date().toISOString().slice(0,10)}.csv"`);
    return res.send(csv);
  });

  return router;
}