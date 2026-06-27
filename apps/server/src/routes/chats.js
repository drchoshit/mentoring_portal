import express from 'express';
import multer from 'multer';
import { writeAudit } from '../lib/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

const CENTRAL_ROLES = new Set(['director', 'admin']);
const CHAT_ROLES = new Set(['director', 'admin', 'lead', 'mentor']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function canChat(fromRole, toRole) {
  const from = String(fromRole || '').trim();
  const to = String(toRole || '').trim();
  if (!CHAT_ROLES.has(from) || !CHAT_ROLES.has(to)) return false;
  if (from === 'parent' || to === 'parent') return false;
  return CENTRAL_ROLES.has(from) || CENTRAL_ROLES.has(to);
}

function loadUser(db, id) {
  return db
    .prepare('SELECT id, display_name, role, is_active FROM users WHERE id=?')
    .get(Number(id));
}

function assertChatPartner(db, req, partnerId) {
  const partner = loadUser(db, partnerId);
  if (!partner || Number(partner.is_active) !== 1) {
    const err = new Error('Partner not found');
    err.status = 404;
    throw err;
  }
  if (!canChat(req.user.role, partner.role)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return partner;
}

function normalizeMessage(row) {
  return {
    id: Number(row.id),
    from_user_id: Number(row.from_user_id),
    to_user_id: Number(row.to_user_id),
    body: String(row.body || ''),
    image_name: row.image_name || null,
    image_mime: row.image_mime || null,
    image_base64: row.image_base64 || null,
    tag_student_id: row.tag_student_id ? Number(row.tag_student_id) : null,
    tag_student_name: row.tag_student_name || null,
    read_at: row.read_at || null,
    created_at: row.created_at
  };
}

function chatUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '이미지는 8MB 이하만 첨부할 수 있습니다.' });
    }
    return res.status(400).json({ error: err.message || '이미지 첨부에 실패했습니다.' });
  });
}

export default function chatRoutes(db) {
  const router = express.Router();

  router.get('/partners', (req, res) => {
    if (!CHAT_ROLES.has(String(req.user.role || ''))) return res.json({ partners: [] });

    const users = db
      .prepare(
        `SELECT id, display_name, role
         FROM users
         WHERE is_active=1
           AND role!='parent'
           AND id!=?
         ORDER BY CASE role
            WHEN 'director' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'lead' THEN 3
            WHEN 'mentor' THEN 4
            ELSE 9 END, display_name, id`
      )
      .all(req.user.id)
      .filter((user) => canChat(req.user.role, user.role));

    const lastMessageStmt = db.prepare(
      `SELECT body, image_name, tag_student_id, created_at
       FROM chat_messages
       WHERE deleted_at IS NULL
         AND (
           (from_user_id=? AND to_user_id=?)
           OR (from_user_id=? AND to_user_id=?)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    );
    const unreadStmt = db.prepare(
      `SELECT COUNT(*) AS cnt
       FROM chat_messages
       WHERE deleted_at IS NULL
         AND from_user_id=?
         AND to_user_id=?
         AND read_at IS NULL`
    );

    const partners = users.map((user) => {
      const last = lastMessageStmt.get(req.user.id, user.id, user.id, req.user.id) || null;
      const unread = unreadStmt.get(user.id, req.user.id);
      return {
        id: Number(user.id),
        display_name: user.display_name,
        role: user.role,
        last_body: last?.body || '',
        last_has_image: Boolean(last?.image_name),
        last_tag_student_id: last?.tag_student_id ? Number(last.tag_student_id) : null,
        last_message_at: last?.created_at || null,
        unread_count: Number(unread?.cnt || 0)
      };
    });

    partners.sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      if (at !== bt) return bt - at;
      return String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ko');
    });

    res.json({ partners });
  });

  router.get('/messages', (req, res) => {
    const partnerId = toPositiveInt(req.query.partnerId);
    if (!partnerId) return res.status(400).json({ error: 'Missing partnerId' });

    try {
      assertChatPartner(db, req, partnerId);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message || 'Failed' });
    }

    db.prepare(
      `UPDATE chat_messages
       SET read_at=datetime('now')
       WHERE deleted_at IS NULL
         AND from_user_id=?
         AND to_user_id=?
         AND read_at IS NULL`
    ).run(partnerId, req.user.id);

    const rows = db
      .prepare(
        `SELECT m.*, s.name AS tag_student_name
         FROM chat_messages m
         LEFT JOIN students s ON s.id=m.tag_student_id
         WHERE m.deleted_at IS NULL
           AND (
             (m.from_user_id=? AND m.to_user_id=?)
             OR (m.from_user_id=? AND m.to_user_id=?)
           )
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT 300`
      )
      .all(req.user.id, partnerId, partnerId, req.user.id);

    res.json({ messages: rows.map(normalizeMessage) });
  });

  router.post('/messages', chatUpload, (req, res) => {
    const toUserId = toPositiveInt(req.body?.to_user_id);
    if (!toUserId) return res.status(400).json({ error: 'Missing to_user_id' });

    let partner;
    try {
      partner = assertChatPartner(db, req, toUserId);
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message || 'Failed' });
    }

    const body = String(req.body?.body || '').trim();
    const tagStudentId = toPositiveInt(req.body?.tag_student_id);
    const file = req.file || null;

    if (tagStudentId) {
      const student = db.prepare('SELECT id FROM students WHERE id=?').get(tagStudentId);
      if (!student) return res.status(404).json({ error: 'Student not found' });
    }

    let imageName = null;
    let imageMime = null;
    let imageBase64 = null;
    if (file) {
      imageMime = String(file.mimetype || '').toLowerCase();
      if (!IMAGE_TYPES.has(imageMime)) {
        return res.status(400).json({ error: '이미지 파일만 첨부할 수 있습니다.' });
      }
      imageName = String(file.originalname || 'image').slice(0, 160);
      imageBase64 = file.buffer.toString('base64');
    }

    if (!body && !imageBase64 && !tagStudentId) {
      return res.status(400).json({ error: '메시지 내용이 없습니다.' });
    }

    const info = db.prepare(
      `INSERT INTO chat_messages
        (from_user_id, to_user_id, body, image_name, image_mime, image_base64, tag_student_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id,
      partner.id,
      body || null,
      imageName,
      imageMime,
      imageBase64,
      tagStudentId || null
    );

    writeAudit(db, {
      user_id: req.user.id,
      action: 'create',
      entity: 'chat_message',
      entity_id: info.lastInsertRowid,
      details: { to_user_id: partner.id, tag_student_id: tagStudentId || null, has_image: Boolean(imageBase64) }
    });

    const row = db
      .prepare(
        `SELECT m.*, s.name AS tag_student_name
         FROM chat_messages m
         LEFT JOIN students s ON s.id=m.tag_student_id
         WHERE m.id=?`
      )
      .get(info.lastInsertRowid);

    res.json({ message: normalizeMessage(row) });
  });

  return router;
}
