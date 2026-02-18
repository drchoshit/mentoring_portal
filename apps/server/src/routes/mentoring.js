import express from 'express';
import { canEditField, canViewField, filterObjectByView } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

function ensureWeekRecord(db, student_id, week_id) {
  const existing = db.prepare('SELECT id FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);
  if (existing) return existing.id;
  const info = db.prepare(
    'INSERT INTO week_records (student_id, week_id, b_daily_tasks, b_lead_daily_feedback, scores_json) VALUES (?,?,?,?,?)'
  ).run(student_id, week_id, JSON.stringify({}), JSON.stringify({}), JSON.stringify([]));
  return info.lastInsertRowid;
}

function ensureSubjectRecord(db, student_id, week_id, subject_id) {
  const existing = db.prepare('SELECT id FROM subject_records WHERE student_id=? AND week_id=? AND subject_id=?').get(student_id, week_id, subject_id);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO subject_records (student_id, week_id, subject_id) VALUES (?,?,?)')
    .run(student_id, week_id, subject_id);
  return info.lastInsertRowid;
}

function assertParentOwnsStudent(req, student_id) {
  if (req.user?.role !== 'parent') return;
  if (!req.user.student_id) throw new Error('Unauthorized');
  if (Number(req.user.student_id) !== Number(student_id)) throw new Error('Forbidden');
}

export default function mentoringRoutes(db) {
  const router = express.Router();

  router.get('/subjects/:studentId', (req, res) => {
    const student_id = Number(req.params.studentId);
    try {
      assertParentOwnsStudent(req, student_id);
    } catch (e) {
      return res.status(e.message === 'Forbidden' ? 403 : 401).json({ error: e.message });
    }

    const rows = db.prepare('SELECT id, name FROM mentoring_subjects WHERE student_id=? ORDER BY id').all(student_id);
    res.json({ subjects: rows });
  });

  router.post('/subjects/:studentId', (req, res) => {
    const student_id = Number(req.params.studentId);
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Missing name' });

    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    try {
      const info = db.prepare('INSERT INTO mentoring_subjects (student_id, name) VALUES (?,?)').run(student_id, String(name));
      writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'mentoring_subject', entity_id: info.lastInsertRowid, details: { student_id, name } });
      return res.json({ id: info.lastInsertRowid });
    } catch {
      return res.status(400).json({ error: 'Subject exists' });
    }
  });

  router.delete('/subjects/:studentId/:subjectId', (req, res) => {
    const student_id = Number(req.params.studentId);
    const subject_id = Number(req.params.subjectId);
    if (!student_id || !subject_id) return res.status(400).json({ error: 'Missing studentId/subjectId' });
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const row = db.prepare('SELECT id, name FROM mentoring_subjects WHERE id=? AND student_id=?').get(subject_id, student_id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    db.prepare('DELETE FROM mentoring_subjects WHERE id=?').run(subject_id);
    writeAudit(db, {
      user_id: req.user.id,
      action: 'delete',
      entity: 'mentoring_subject',
      entity_id: subject_id,
      details: { student_id, name: row.name }
    });
    return res.json({ ok: true });
  });

  router.get('/record', (req, res) => {
    const student_id = Number(req.query.studentId);
    const week_id = Number(req.query.weekId);
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing studentId/weekId' });

    // parent는 본인 student만 접근 가능 + 공유된 주차만 열람
    if (req.user.role === 'parent') {
      try {
        assertParentOwnsStudent(req, student_id);
      } catch (e) {
        return res.status(e.message === 'Forbidden' ? 403 : 401).json({ error: e.message });
      }

      const shared = db.prepare('SELECT shared_with_parent FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);
      if (!shared || Number(shared.shared_with_parent) !== 1) return res.status(403).json({ error: 'Not shared' });
    }

    ensureWeekRecord(db, student_id, week_id);

    const student = db.prepare('SELECT * FROM students WHERE id=?').get(student_id);
    const week = db.prepare('SELECT * FROM weeks WHERE id=?').get(week_id);
    if (!student || !week) return res.status(404).json({ error: 'Not found' });

    const subjects = db.prepare('SELECT id, name FROM mentoring_subjects WHERE student_id=? ORDER BY id').all(student_id);
    for (const s of subjects) ensureSubjectRecord(db, student_id, week_id, s.id);

    const subject_records_raw = db.prepare(
      `SELECT r.*, s.name as subject_name
       FROM subject_records r
       JOIN mentoring_subjects s ON s.id=r.subject_id
       WHERE r.student_id=? AND r.week_id=?
       ORDER BY s.id`
    ).all(student_id, week_id);

    const weekRecord = db.prepare('SELECT * FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);

    const parentMode = req.user.role === 'parent';

    const subject_records = parentMode
      ? subject_records_raw.map((r) => {
          const filtered = { ...r };
          for (const k of ['a_curriculum','a_last_hw','a_hw_exec','a_progress','a_this_hw','a_comment']) {
            const parentOk = Number(db.prepare('SELECT parent_visible FROM field_permissions WHERE field_key=?').get(k)?.parent_visible ?? 0) === 1;
            if (!parentOk) filtered[k] = null;
          }
          return filtered;
        })
      : subject_records_raw;

    const week_record = parentMode
      ? filterObjectByView(db, req.user.role, weekRecord, { parentMode })
      : weekRecord;

    res.json({ student, week, subjects, subject_records, week_record });
  });

  router.put('/subject-record/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM subject_records WHERE id=?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const updates = {};
    for (const key of ['a_curriculum','a_last_hw','a_hw_exec','a_progress','a_this_hw','a_comment']) {
      if (key in (req.body || {})) updates[key] = req.body[key];
    }
    const keys = Object.keys(updates);
    if (!keys.length) return res.json({ ok: true });

    const allowed = keys.filter((k) => canEditField(db, req.user.role, k));
    if (!allowed.length) return res.status(403).json({ error: 'No editable fields' });

    const setSql = allowed.map((k) => `${k}=?`).join(', ');
    const values = allowed.map((k) => updates[k] == null ? null : String(updates[k]));
    db.prepare(`UPDATE subject_records SET ${setSql}, updated_at=datetime('now'), updated_by=? WHERE id=?`)
      .run(...values, req.user.id, id);

    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'subject_record', entity_id: id, details: { fields: allowed } });
    res.json({ ok: true, updated_fields: allowed });
  });

  router.put('/week-record/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM week_records WHERE id=?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const updates = {};
    for (const key of ['b_daily_tasks','b_lead_daily_feedback','c_lead_weekly_feedback','c_director_commentary','scores_json']) {
      if (key in (req.body || {})) updates[key] = req.body[key];
    }
    if ('shared_with_parent' in (req.body || {})) {
      if (!['lead','director','admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Only lead/director/admin can share' });
      }
      updates.shared_with_parent = req.body.shared_with_parent ? 1 : 0;
    }
    const keys = Object.keys(updates);
    if (!keys.length) return res.json({ ok: true });

    const allowed = keys.filter((k) => k === 'shared_with_parent' || canEditField(db, req.user.role, k));
    if (!allowed.length) return res.status(403).json({ error: 'No editable fields' });

    const normalized = {};
    for (const k of allowed) {
      if (k === 'scores_json' || k === 'b_daily_tasks' || k === 'b_lead_daily_feedback') {
        normalized[k] = JSON.stringify(updates[k] ?? {});
      } else if (k === 'shared_with_parent') {
        normalized[k] = updates[k] ? 1 : 0;
      } else {
        normalized[k] = updates[k] == null ? null : String(updates[k]);
      }
    }

    let setSql = allowed.map((k) => `${k}=?`).join(', ');
    const values = allowed.map((k) => normalized[k]);
    if (allowed.includes('shared_with_parent')) {
      if (normalized.shared_with_parent) {
        setSql += `, shared_at=datetime('now')`;
      } else {
        setSql += `, shared_at=NULL`;
      }
    }
    db.prepare(`UPDATE week_records SET ${setSql}, updated_at=datetime('now'), updated_by=? WHERE id=?`)
      .run(...values, req.user.id, id);

    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'week_record', entity_id: id, details: { fields: allowed } });
    res.json({ ok: true, updated_fields: allowed });
  });

  router.post('/workflow/submit', (req, res) => {
    const { student_id, week_id } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role !== 'mentor') return res.status(403).json({ error: 'Only mentor can submit' });

    const student = db.prepare('SELECT name FROM students WHERE id=?').get(Number(student_id));
    const week = db.prepare('SELECT label FROM weeks WHERE id=?').get(Number(week_id));
    const leads = db.prepare("SELECT id FROM users WHERE role IN ('lead','director') AND is_active=1").all();

    const body = `${student?.name || '학생'} ${week?.label || ''} 멘토링 기록이 학습멘토에 의해 제출되었습니다.`;
    const tx = db.transaction(() => {
      for (const u of leads) {
        db.prepare('INSERT INTO feeds (from_user_id, to_user_id, student_id, target_field, title, body) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, u.id, Number(student_id), 'workflow_submit', '멘토링 제출', body);
      }
    });
    tx();

    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'submit', details: { student_id, week_id } });
    res.json({ ok: true });
  });

  router.post('/workflow/share-with-parent', (req, res) => {
    const { student_id, week_id } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (!['lead','director','admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only lead/director/admin' });
    }

    ensureWeekRecord(db, Number(student_id), Number(week_id));
    const info = db
      .prepare("UPDATE week_records SET shared_with_parent=1, shared_at=datetime('now'), updated_at=datetime('now'), updated_by=? WHERE student_id=? AND week_id=?")
      .run(req.user.id, Number(student_id), Number(week_id));

    if (!info.changes) {
      return res.status(500).json({ error: 'Share failed: week record not updated' });
    }

    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'share_with_parent', details: { student_id, week_id } });
    res.json({ ok: true, shared_with_parent: 1 });
  });

  router.post('/workflow/share-with-parent/bulk', (req, res) => {
    try {
      const { student_ids, week_id } = req.body || {};
      const weekId = Number(week_id);
      if (!weekId) return res.status(400).json({ error: 'Missing week_id' });
      if (req.user.role !== 'director') {
        return res.status(403).json({ error: 'Only director can bulk share' });
      }

      const requested = Array.isArray(student_ids)
        ? Array.from(
            new Set(
              student_ids
                .map((v) => Number(v))
                .filter((n) => Number.isInteger(n) && n > 0)
            )
          )
        : [];
      if (!requested.length) {
        return res.status(400).json({ error: 'Missing student_ids' });
      }

      const actor = db
        .prepare('SELECT id FROM users WHERE id=?')
        .get(Number(req.user.id));
      const actorId = actor?.id ? Number(actor.id) : null;

      const findStudent = db.prepare('SELECT id FROM students WHERE id=?');
      const findWeekRecord = db.prepare(
        'SELECT id, shared_with_parent FROM week_records WHERE student_id=? AND week_id=?'
      );
      const markShared = db.prepare(
        "UPDATE week_records SET shared_with_parent=1, shared_at=datetime('now'), updated_at=datetime('now'), updated_by=? WHERE student_id=? AND week_id=?"
      );

      const updated = [];
      const skipped = [];
      const tx = db.transaction(() => {
        for (const studentId of requested) {
          if (!findStudent.get(studentId)?.id) {
            skipped.push({ student_id: studentId, reason: 'student_not_found' });
            continue;
          }

          const weekRow = findWeekRecord.get(studentId, weekId);
          if (!weekRow?.id) {
            skipped.push({ student_id: studentId, reason: 'week_record_not_found' });
            continue;
          }
          if (Number(weekRow.shared_with_parent) === 1) {
            skipped.push({ student_id: studentId, reason: 'already_shared' });
            continue;
          }

          const info = markShared.run(actorId, studentId, weekId);
          if (info.changes) {
            updated.push(studentId);
          } else {
            skipped.push({ student_id: studentId, reason: 'not_updated' });
          }
        }
      });
      tx();

      writeAudit(db, {
        user_id: req.user.id,
        action: 'workflow',
        entity: 'share_with_parent_bulk',
        details: {
          week_id: weekId,
          requested_count: requested.length,
          updated_count: updated.length,
          skipped_count: skipped.length,
          student_ids: requested
        }
      });

      return res.json({
        ok: true,
        week_id: weekId,
        requested_count: requested.length,
        updated_count: updated.length,
        skipped_count: skipped.length,
        updated,
        skipped
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'Bulk share failed' });
    }
  });

  router.post('/workflow/submit-to-director', (req, res) => {
    const { student_id, week_id, reason } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role !== 'lead') return res.status(403).json({ error: 'Only lead' });

    const student = db.prepare('SELECT name FROM students WHERE id=?').get(Number(student_id));
    const week = db.prepare('SELECT label FROM weeks WHERE id=?').get(Number(week_id));
    const directors = db.prepare("SELECT id FROM users WHERE role='director' AND is_active=1").all();

    const body = `${student?.name || '학생'} ${week?.label || ''} 기록을 원장에게 제출합니다.\n사유: ${reason || ''}`;
    const tx = db.transaction(() => {
      for (const u of directors) {
        db.prepare('INSERT INTO feeds (from_user_id, to_user_id, student_id, target_field, title, body) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, u.id, Number(student_id), 'workflow_submit_to_director', '원장님께 제출', body);
      }
    });
    tx();

    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'submit_to_director', details: { student_id, week_id } });
    res.json({ ok: true });
  });

  router.post('/workflow/send-to-lead', (req, res) => {
    const { student_id, week_id, note } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Only director' });

    const student = db.prepare('SELECT name FROM students WHERE id=?').get(Number(student_id));
    const week = db.prepare('SELECT label FROM weeks WHERE id=?').get(Number(week_id));
    const leads = db.prepare("SELECT id FROM users WHERE role='lead' AND is_active=1").all();

    const body = `${student?.name || '학생'} ${week?.label || ''} 기록 관련 원장 피드백입니다.\n${note || ''}`;
    const tx = db.transaction(() => {
      for (const u of leads) {
        db.prepare('INSERT INTO feeds (from_user_id, to_user_id, student_id, target_field, title, body) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, u.id, Number(student_id), 'workflow_send_to_lead', '총괄멘토에게 전송', body);
      }
    });
    tx();

    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'send_to_lead', details: { student_id, week_id } });
    res.json({ ok: true });
  });

  return router;
}
