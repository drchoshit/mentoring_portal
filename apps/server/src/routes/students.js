import express from 'express';
import multer from 'multer';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const MAX_LEGACY_IMAGES = 3;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

function legacyUploadHandler(req, res, next) {
  upload.array('files', MAX_LEGACY_IMAGES)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '이미지 파일은 15MB 이하만 업로드할 수 있습니다.' });
    }
    return res.status(400).json({ error: err.message || '업로드에 실패했습니다.' });
  });
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnInfo(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function columnAllowsNull(db, table, column) {
  const cols = columnInfo(db, table);
  const c = cols.find(x => x.name === column);
  if (!c) return true; // 없으면 영향 없음
  // PRAGMA table_info: notnull = 1이면 NULL 불가
  return Number(c.notnull || 0) !== 1;
}

export default function studentRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    // 학부모는 "본인 username = 학생 external_id" 로 1명만 조회
    if (req.user.role === 'parent') {
      const ext = String(req.user.username || '').trim();
      if (!ext) return res.json({ students: [] });

      const row = db.prepare('SELECT * FROM students WHERE external_id=?').get(ext);
      return res.json({ students: row ? [row] : [] });
    }

    const rows = db.prepare('SELECT * FROM students ORDER BY id').all();
    return res.json({ students: rows });
  });

  router.post('/', requireRole('director', 'admin'), (req, res) => {
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const { external_id, name, grade, student_phone, parent_phone, schedule } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Missing name' });

    const ext = String(external_id || '').trim();
    const externalId = ext ? ext : null;
    const schedule_json = schedule ? JSON.stringify(schedule) : null;

    try {
      const info = db.prepare(`
        INSERT INTO students (external_id, name, grade, student_phone, parent_phone, schedule_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        externalId,
        cleanName,
        grade ? String(grade).trim() : null,
        student_phone ? String(student_phone).trim() : null,
        parent_phone ? String(parent_phone).trim() : null,
        schedule_json
      );

      writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'student', entity_id: info.lastInsertRowid, details: { name: cleanName, external_id: externalId } });
      return res.json({ id: info.lastInsertRowid });
    } catch (e) {
      const msg = String(e?.message || '');
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        return res.status(400).json({ error: '이미 사용 중인 학생 ID입니다.' });
      }
      return res.status(500).json({ error: e?.message || 'Create failed' });
    }
  });

  router.get('/share-dates', requireRole('director', 'admin'), (req, res) => {
    try {
      const weekId = Number(req.query.weekId);
      if (!weekId) return res.status(400).json({ error: 'Missing weekId' });

      const rows = db.prepare(`
        SELECT student_id, COALESCE(shared_at, updated_at) as shared_at
        FROM week_records
        WHERE week_id=? AND shared_with_parent=1
      `).all(weekId);
      return res.json({ items: rows });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Failed to load share dates' });
    }
  });

  router.get('/workflow-dates', requireRole('director', 'admin'), (req, res) => {
    try {
      const weekId = Number(req.query.weekId);
      if (!weekId) return res.status(400).json({ error: 'Missing weekId' });

      const byStudent = {};
      const submitRows = db.prepare(`
        SELECT entity, details_json, created_at
        FROM audit_logs
        WHERE action='workflow'
          AND entity IN ('submit', 'submit_to_director')
        ORDER BY id DESC
      `).all();

      for (const row of submitRows) {
        let details = null;
        try {
          details = row?.details_json ? JSON.parse(row.details_json) : null;
        } catch {
          details = null;
        }
        const studentId = Number(details?.student_id || 0);
        const rowWeekId = Number(details?.week_id || 0);
        if (!studentId || rowWeekId !== weekId) continue;

        if (!byStudent[studentId]) {
          byStudent[studentId] = {
            student_id: studentId,
            mentor_submitted_at: null,
            lead_submitted_at: null,
            shared_at: null
          };
        }

        if (row.entity === 'submit') {
          const prev = byStudent[studentId].mentor_submitted_at;
          byStudent[studentId].mentor_submitted_at = !prev || row.created_at > prev ? row.created_at : prev;
        } else if (row.entity === 'submit_to_director') {
          const prev = byStudent[studentId].lead_submitted_at;
          byStudent[studentId].lead_submitted_at = !prev || row.created_at > prev ? row.created_at : prev;
        }
      }

      const shareRows = db.prepare(`
        SELECT student_id, COALESCE(shared_at, updated_at) as shared_at
        FROM week_records
        WHERE week_id=? AND shared_with_parent=1
      `).all(weekId);

      for (const row of shareRows) {
        const studentId = Number(row.student_id || 0);
        if (!studentId) continue;
        if (!byStudent[studentId]) {
          byStudent[studentId] = {
            student_id: studentId,
            mentor_submitted_at: null,
            lead_submitted_at: null,
            shared_at: null
          };
        }
        byStudent[studentId].shared_at = row.shared_at || null;
      }

      return res.json({ items: Object.values(byStudent) });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Failed to load workflow dates' });
    }
  });

  router.get('/:id/legacy-images', requireRole('director'), (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid student id' });

      const exists = db.prepare('SELECT id FROM students WHERE id=?').get(id);
      if (!exists) return res.status(404).json({ error: 'Not found' });

      const rows = db
        .prepare('SELECT id, mime_type, data_base64, created_at FROM parent_legacy_images WHERE student_id=? ORDER BY id')
        .all(id);
      return res.json({ images: rows });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Failed to load images' });
    }
  });

  router.post('/:id/legacy-images', requireRole('director'), legacyUploadHandler, (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid student id' });

      const exists = db.prepare('SELECT id FROM students WHERE id=?').get(id);
      if (!exists) return res.status(404).json({ error: 'Not found' });

      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: '파일이 없습니다.' });

      if (files.some((f) => !ALLOWED_IMAGE_TYPES.has(String(f.mimetype || '').toLowerCase()))) {
        return res.status(400).json({ error: '이미지 파일만 업로드할 수 있습니다.' });
      }

      const current = db.prepare('SELECT COUNT(1) as cnt FROM parent_legacy_images WHERE student_id=?').get(id);
      const currentCount = Number(current?.cnt || 0);
      if (currentCount + files.length > MAX_LEGACY_IMAGES) {
        return res.status(400).json({ error: '최대 3장까지만 업로드할 수 있습니다.' });
      }

      const ins = db.prepare(`
        INSERT INTO parent_legacy_images (student_id, mime_type, data_base64, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `);

      const tx = db.transaction(() => {
        for (const f of files) {
          const base64 = f.buffer.toString('base64');
          ins.run(id, f.mimetype, base64);
        }
      });

      tx();

      writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'parent_legacy_images', entity_id: id, details: { count: files.length } });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Upload failed' });
    }
  });

  router.delete('/:id/legacy-images/:imageId', requireRole('director'), (req, res) => {
    const id = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    if (!id || !imageId) return res.status(400).json({ error: 'Invalid id' });

    const row = db
      .prepare('SELECT id FROM parent_legacy_images WHERE id=? AND student_id=?')
      .get(imageId, id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    db.prepare('DELETE FROM parent_legacy_images WHERE id=?').run(imageId);
    writeAudit(db, { user_id: req.user.id, action: 'delete', entity: 'parent_legacy_images', entity_id: imageId, details: { student_id: id } });
    return res.json({ ok: true });
  });

  // 학생 "프로필(성적/목표대학 등)" 저장
  // 멘토링 페이지에서 사용하는 저장 버튼용
  router.put('/:id/profile', requireRole('director','admin','lead','mentor'), (req, res) => {
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM students WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { profile_json, profile } = req.body || {};

    let normalized = null;

    if (typeof profile_json === 'string') {
      normalized = profile_json;
      // JSON 유효성만 체크(깨진 값 저장 방지)
      try {
        JSON.parse(normalized);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    } else if (profile != null) {
      try {
        normalized = JSON.stringify(profile);
      } catch {
        return res.status(400).json({ error: 'Invalid profile' });
      }
    } else {
      normalized = null;
    }

    db.prepare(`
      UPDATE students
      SET profile_json=?, updated_at=datetime('now')
      WHERE id=?
    `).run(normalized, id);

    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'student_profile', entity_id: id });
    return res.json({ ok: true });
  });

  router.put('/:id', requireRole('director','admin'), (req, res) => {
    // 정책상 parent는 절대 수정 불가(안전장치)
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM students WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { name, grade, student_phone, parent_phone, schedule } = req.body || {};
    const cleanName = String(name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Missing name' });

    const schedule_json = schedule ? JSON.stringify(schedule) : null;

    db.prepare(`
      UPDATE students
      SET name=?, grade=?, student_phone=?, parent_phone=?, schedule_json=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      cleanName,
      grade ? String(grade).trim() : null,
      student_phone ? String(student_phone).trim() : null,
      parent_phone ? String(parent_phone).trim() : null,
      schedule_json,
      id
    );

    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'student', entity_id: id });
    return res.json({ ok: true });
  });

  router.delete('/:id', requireRole('director','admin'), (req, res) => {
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, name, external_id FROM students WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    try {
      const tx = db.transaction(() => {
        // 1) 연결/로그인 발급 테이블들 정리
        if (tableExists(db, 'parent_links')) {
          db.prepare('DELETE FROM parent_links WHERE student_id=?').run(id);
        }
        if (tableExists(db, 'parent_credentials')) {
          db.prepare('DELETE FROM parent_credentials WHERE student_id=?').run(id);
        }

        // 2) feeds 정리: NULL 가능하면 NULL로, 아니면 삭제
        if (tableExists(db, 'feeds')) {
          const canNull = columnAllowsNull(db, 'feeds', 'student_id');
          if (canNull) {
            db.prepare('UPDATE feeds SET student_id=NULL WHERE student_id=?').run(id);
          } else {
            db.prepare('DELETE FROM feeds WHERE student_id=?').run(id);
          }
        }

        // 3) 멘토링/벌점 관련 테이블 정리(존재하는 것만)
        if (tableExists(db, 'mentoring_records')) {
          db.prepare('DELETE FROM mentoring_records WHERE student_id=?').run(id);
        }
        if (tableExists(db, 'week_records')) {
          db.prepare('DELETE FROM week_records WHERE student_id=?').run(id);
        }
        if (tableExists(db, 'subject_records')) {
          db.prepare('DELETE FROM subject_records WHERE student_id=?').run(id);
        }
        if (tableExists(db, 'mentoring_subjects')) {
          db.prepare('DELETE FROM mentoring_subjects WHERE student_id=?').run(id);
        }
        if (tableExists(db, 'penalties')) {
          db.prepare('DELETE FROM penalties WHERE student_id=?').run(id);
        }
        if (tableExists(db, 'parent_legacy_images')) {
          db.prepare('DELETE FROM parent_legacy_images WHERE student_id=?').run(id);
        }

        // 4) 마지막에 학생 삭제
        db.prepare('DELETE FROM students WHERE id=?').run(id);
      });

      tx();

      writeAudit(db, {
        user_id: req.user.id,
        action: 'delete',
        entity: 'student',
        entity_id: id,
        details: { name: existing.name, external_id: existing.external_id }
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error('Delete student failed:', e);
      return res.status(500).json({ error: e?.message || 'Delete failed' });
    }
  });

  return router;
}
