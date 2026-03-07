import express from 'express';
import { canEditField, filterObjectByView } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

function ensureWeekRecord(db, student_id, week_id) {
  const existing = db.prepare('SELECT id FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);
  if (existing) return existing.id;
  const info = db.prepare(
    'INSERT INTO week_records (student_id, week_id, b_daily_tasks, b_daily_tasks_this_week, b_lead_daily_feedback, scores_json) VALUES (?,?,?,?,?,?)'
  ).run(student_id, week_id, JSON.stringify({}), JSON.stringify({}), JSON.stringify({}), JSON.stringify([]));
  return info.lastInsertRowid;
}

function normalizeHomeworkTask(raw) {
  if (!raw) return { text: '' };
  if (typeof raw === 'string') return { text: raw };
  if (typeof raw === 'object') return { text: String(raw.text || '').trim() };
  return { text: String(raw || '').trim() };
}

function parseHomeworkTasks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeHomeworkTask);

  if (typeof value === 'object') {
    const arr = value.tasks || value.items || value.list;
    if (Array.isArray(arr)) return arr.map(normalizeHomeworkTask);
  }

  const raw = String(value);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(normalizeHomeworkTask);
    if (parsed && typeof parsed === 'object') {
      const arr = parsed.tasks || parsed.items || parsed.list;
      if (Array.isArray(arr)) return arr.map(normalizeHomeworkTask);
    }
  } catch {
    // fallback below
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text }));
}

function hasThisWeekHomework(value) {
  const tasks = parseHomeworkTasks(value);
  return tasks.some((task) => String(task?.text || '').trim().length > 0);
}

function hasMeaningfulText(value) {
  if (value == null) return false;

  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return hasMeaningfulText(parsed);
    } catch {
      return true;
    }
  }

  if (Array.isArray(value)) return value.some((item) => hasMeaningfulText(item));

  if (typeof value === 'object') {
    const values = Object.values(value);
    if (!values.length) return false;
    return values.some((item) => hasMeaningfulText(item));
  }

  return String(value).trim().length > 0;
}

function toPositiveInt(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function getPreviousWeekId(db, week_id) {
  const row = db.prepare('SELECT id FROM weeks WHERE id < ? ORDER BY id DESC LIMIT 1').get(week_id);
  return toPositiveInt(row?.id);
}

function hydrateDailyTasksFromPreviousWeekIfEmpty(db, student_id, week_id, previous_week_id) {
  const prevWeekId = toPositiveInt(previous_week_id);
  if (!prevWeekId || prevWeekId === Number(week_id)) return;

  db.prepare(
    `
    UPDATE week_records
    SET
      b_daily_tasks = COALESCE(
        (
          SELECT prev.b_daily_tasks_this_week
          FROM week_records prev
          WHERE prev.student_id = week_records.student_id
            AND prev.week_id = ?
          LIMIT 1
        ),
        (
          SELECT prev.b_daily_tasks
          FROM week_records prev
          WHERE prev.student_id = week_records.student_id
            AND prev.week_id = ?
          LIMIT 1
        )
      ),
      updated_at = datetime('now')
    WHERE student_id = ?
      AND week_id = ?
      AND (
        b_daily_tasks IS NULL
        OR TRIM(b_daily_tasks) = ''
        OR TRIM(b_daily_tasks) = '{}'
      )
      AND (
        EXISTS (
          SELECT 1
          FROM week_records prev
          WHERE prev.student_id = week_records.student_id
            AND prev.week_id = ?
            AND prev.b_daily_tasks_this_week IS NOT NULL
            AND TRIM(prev.b_daily_tasks_this_week) != ''
            AND TRIM(prev.b_daily_tasks_this_week) != '{}'
        )
        OR EXISTS (
          SELECT 1
          FROM week_records prev
          WHERE prev.student_id = week_records.student_id
            AND prev.week_id = ?
            AND prev.b_daily_tasks IS NOT NULL
            AND TRIM(prev.b_daily_tasks) != ''
            AND TRIM(prev.b_daily_tasks) != '{}'
        )
      )
    `
  ).run(prevWeekId, prevWeekId, student_id, week_id, prevWeekId, prevWeekId);
}

function getStoredCurriculumSourceWeekId(db, student_id) {
  const row = db.prepare('SELECT source_week_id FROM student_curriculum_sources WHERE student_id=?').get(student_id);
  return toPositiveInt(row?.source_week_id);
}

function resolveCurriculumSourceWeekId(db, student_id, week_id) {
  const preferred = getStoredCurriculumSourceWeekId(db, student_id);
  const prefExists = preferred
    ? db.prepare('SELECT id FROM weeks WHERE id=?').get(preferred)
    : null;
  const preferenceWeekId = prefExists ? preferred : null;
  const effectiveWeekId = preferenceWeekId && preferenceWeekId < week_id
    ? preferenceWeekId
    : getPreviousWeekId(db, week_id);
  return { preferenceWeekId, effectiveWeekId };
}

function ensureSubjectRecord(db, student_id, week_id, subject_id, source_week_id = null) {
  const existing = db.prepare('SELECT id FROM subject_records WHERE student_id=? AND week_id=? AND subject_id=?').get(student_id, week_id, subject_id);
  if (existing) return existing.id;
  const sourceWeekId = toPositiveInt(source_week_id);
  let seedCurriculum = null;
  if (sourceWeekId && sourceWeekId !== Number(week_id)) {
    const source = db
      .prepare('SELECT a_curriculum FROM subject_records WHERE student_id=? AND week_id=? AND subject_id=?')
      .get(student_id, sourceWeekId, subject_id);
    if (source?.a_curriculum != null) seedCurriculum = String(source.a_curriculum);
  }
  const info = db.prepare('INSERT INTO subject_records (student_id, week_id, subject_id, a_curriculum) VALUES (?,?,?,?)')
    .run(student_id, week_id, subject_id, seedCurriculum);
  return info.lastInsertRowid;
}

function hydrateCurriculumFromSourceIfEmpty(db, student_id, week_id, source_week_id) {
  const sourceWeekId = toPositiveInt(source_week_id);
  if (!sourceWeekId || sourceWeekId === Number(week_id)) return;

  db.prepare(
    `
    UPDATE subject_records
    SET
      a_curriculum = (
        SELECT src.a_curriculum
        FROM subject_records src
        WHERE src.student_id = subject_records.student_id
          AND src.subject_id = subject_records.subject_id
          AND src.week_id = ?
        LIMIT 1
      ),
      updated_at = datetime('now')
    WHERE student_id = ?
      AND week_id = ?
      AND (a_curriculum IS NULL OR TRIM(a_curriculum) = '')
      AND EXISTS (
        SELECT 1
        FROM subject_records src
        WHERE src.student_id = subject_records.student_id
          AND src.subject_id = subject_records.subject_id
          AND src.week_id = ?
          AND src.a_curriculum IS NOT NULL
          AND TRIM(src.a_curriculum) != ''
      )
    `
  ).run(sourceWeekId, student_id, week_id, sourceWeekId);
}

function hydrateLastHomeworkFromPreviousWeekIfEmpty(db, student_id, week_id, previous_week_id) {
  const prevWeekId = toPositiveInt(previous_week_id);
  if (!prevWeekId || prevWeekId === Number(week_id)) return;

  db.prepare(
    `
    UPDATE subject_records
    SET
      a_last_hw = (
        SELECT prev.a_this_hw
        FROM subject_records prev
        WHERE prev.student_id = subject_records.student_id
          AND prev.subject_id = subject_records.subject_id
          AND prev.week_id = ?
        LIMIT 1
      ),
      updated_at = datetime('now')
    WHERE student_id = ?
      AND week_id = ?
      AND (a_last_hw IS NULL OR TRIM(a_last_hw) = '')
      AND EXISTS (
        SELECT 1
        FROM subject_records prev
        WHERE prev.student_id = subject_records.student_id
          AND prev.subject_id = subject_records.subject_id
          AND prev.week_id = ?
          AND prev.a_this_hw IS NOT NULL
          AND TRIM(prev.a_this_hw) != ''
      )
    `
  ).run(prevWeekId, student_id, week_id, prevWeekId);
}

function applyCurriculumSourceToWeek(db, student_id, week_id, source_week_id, updated_by) {
  const sourceWeekId = toPositiveInt(source_week_id);
  if (!sourceWeekId || sourceWeekId === Number(week_id)) return 0;

  const info = db.prepare(
    `
    INSERT INTO subject_records (student_id, week_id, subject_id, a_curriculum, updated_at, updated_by)
    SELECT student_id, ?, subject_id, a_curriculum, datetime('now'), ?
    FROM subject_records
    WHERE student_id = ? AND week_id = ?
    ON CONFLICT(student_id, week_id, subject_id)
    DO UPDATE SET
      a_curriculum = excluded.a_curriculum,
      updated_at = datetime('now'),
      updated_by = excluded.updated_by
    `
  ).run(week_id, updated_by ?? null, student_id, sourceWeekId);

  return Number(info?.changes || 0);
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
    const week_id = Number(req.query.weekId || 0);
    try {
      assertParentOwnsStudent(req, student_id);
    } catch (e) {
      return res.status(e.message === 'Forbidden' ? 403 : 401).json({ error: e.message });
    }

    const rows = week_id
      ? db
          .prepare('SELECT id, name FROM mentoring_subjects WHERE student_id=? AND (deleted_from_week_id IS NULL OR deleted_from_week_id > ?) ORDER BY id')
          .all(student_id, week_id)
      : db.prepare('SELECT id, name FROM mentoring_subjects WHERE student_id=? ORDER BY id').all(student_id);
    res.json({ subjects: rows });
  });

  router.post('/subjects/:studentId', (req, res) => {
    const student_id = Number(req.params.studentId);
    const { name } = req.body || {};
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return res.status(400).json({ error: 'Missing name' });

    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const existing = db
      .prepare('SELECT id, name, deleted_from_week_id FROM mentoring_subjects WHERE student_id=? AND name=?')
      .get(student_id, normalizedName);
    if (existing?.id) {
      if (existing.deleted_from_week_id != null) {
        db.prepare("UPDATE mentoring_subjects SET deleted_from_week_id=NULL, updated_at=datetime('now') WHERE id=?").run(existing.id);
        writeAudit(db, {
          user_id: req.user.id,
          action: 'restore',
          entity: 'mentoring_subject',
          entity_id: existing.id,
          details: { student_id, name: normalizedName }
        });
        return res.json({ id: existing.id, restored: true });
      }
      return res.status(400).json({ error: 'Subject exists' });
    }

    try {
      const info = db.prepare('INSERT INTO mentoring_subjects (student_id, name) VALUES (?,?)').run(student_id, normalizedName);
      writeAudit(db, { user_id: req.user.id, action: 'create', entity: 'mentoring_subject', entity_id: info.lastInsertRowid, details: { student_id, name: normalizedName } });
      return res.json({ id: info.lastInsertRowid });
    } catch {
      return res.status(400).json({ error: 'Subject exists' });
    }
  });

  router.delete('/subjects/:studentId/:subjectId', (req, res) => {
    const student_id = Number(req.params.studentId);
    const subject_id = Number(req.params.subjectId);
    const week_id = Number(req.query.weekId || req.body?.week_id || 0);
    if (!student_id || !subject_id) return res.status(400).json({ error: 'Missing studentId/subjectId' });
    if (!week_id) return res.status(400).json({ error: 'Missing weekId' });
    if (req.user.role === 'parent') {
      try {
        assertParentOwnsStudent(req, student_id);
      } catch (e) {
        return res.status(e.message === 'Forbidden' ? 403 : 401).json({ error: e.message });
      }
    }

    const week = db.prepare('SELECT id FROM weeks WHERE id=?').get(week_id);
    if (!week?.id) return res.status(404).json({ error: 'Week not found' });

    const row = db.prepare('SELECT id, name, deleted_from_week_id FROM mentoring_subjects WHERE id=? AND student_id=?').get(subject_id, student_id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const nextDeletedFromWeekId = row.deleted_from_week_id
      ? Math.min(Number(row.deleted_from_week_id), week_id)
      : week_id;

    const clearRecordsFromWeek = db.prepare(
      'DELETE FROM subject_records WHERE student_id=? AND subject_id=? AND week_id>=?'
    );
    const markSubjectDeletedFromWeek = db.prepare(
      "UPDATE mentoring_subjects SET deleted_from_week_id=?, updated_at=datetime('now') WHERE id=? AND student_id=?"
    );

    let removedRecordCount = 0;
    const tx = db.transaction(() => {
      const clearInfo = clearRecordsFromWeek.run(student_id, subject_id, nextDeletedFromWeekId);
      removedRecordCount = Number(clearInfo?.changes || 0);
      markSubjectDeletedFromWeek.run(nextDeletedFromWeekId, subject_id, student_id);
    });
    tx();

    writeAudit(db, {
      user_id: req.user.id,
      action: 'delete',
      entity: 'mentoring_subject',
      entity_id: subject_id,
      details: {
        student_id,
        name: row.name,
        deleted_from_week_id: nextDeletedFromWeekId,
        removed_record_count: removedRecordCount
      }
    });
    return res.json({
      ok: true,
      subject_id,
      deleted_from_week_id: nextDeletedFromWeekId,
      removed_record_count: removedRecordCount
    });
  });

  router.get('/record', (req, res) => {
    const student_id = Number(req.query.studentId);
    const week_id = Number(req.query.weekId);
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing studentId/weekId' });

    // parent는 본인 student만 접근 가능 + 공유된 회차만 열람
    if (req.user.role === 'parent') {
      try {
        assertParentOwnsStudent(req, student_id);
      } catch (e) {
        return res.status(e.message === 'Forbidden' ? 403 : 401).json({ error: e.message });
      }

      const shared = db.prepare('SELECT shared_with_parent FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);
      if (!shared || Number(shared.shared_with_parent) !== 1) return res.status(403).json({ error: 'Not shared' });
    }

    const student = db.prepare('SELECT * FROM students WHERE id=?').get(student_id);
    const week = db.prepare('SELECT * FROM weeks WHERE id=?').get(week_id);
    if (!student || !week) return res.status(404).json({ error: 'Not found' });

    const { preferenceWeekId, effectiveWeekId: curriculumSourceWeekId } = resolveCurriculumSourceWeekId(db, student_id, week_id);
    const previousWeekId = getPreviousWeekId(db, week_id);

    ensureWeekRecord(db, student_id, week_id);
    hydrateDailyTasksFromPreviousWeekIfEmpty(db, student_id, week_id, previousWeekId);

    const subjects = db
      .prepare('SELECT id, name FROM mentoring_subjects WHERE student_id=? AND (deleted_from_week_id IS NULL OR deleted_from_week_id > ?) ORDER BY id')
      .all(student_id, week_id);
    for (const s of subjects) ensureSubjectRecord(db, student_id, week_id, s.id, curriculumSourceWeekId);

    hydrateCurriculumFromSourceIfEmpty(db, student_id, week_id, curriculumSourceWeekId);
    hydrateLastHomeworkFromPreviousWeekIfEmpty(db, student_id, week_id, previousWeekId);

    const subject_records_raw = db.prepare(
      `SELECT r.*, s.name as subject_name
       FROM subject_records r
       JOIN mentoring_subjects s ON s.id=r.subject_id
       WHERE r.student_id=? AND r.week_id=? AND (s.deleted_from_week_id IS NULL OR s.deleted_from_week_id > ?)
       ORDER BY s.id`
    ).all(student_id, week_id, week_id);

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

    res.json({
      student,
      week,
      subjects,
      subject_records,
      week_record,
      curriculum_source_week_id: curriculumSourceWeekId || null,
      curriculum_source_preference_week_id: preferenceWeekId || null
    });
  });

  router.put('/curriculum-source', (req, res) => {
    const student_id = toPositiveInt(req.body?.student_id ?? req.body?.studentId);
    const week_id = toPositiveInt(req.body?.week_id ?? req.body?.weekId);
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role === 'parent') return res.status(403).json({ error: 'Forbidden' });

    const student = db.prepare('SELECT id FROM students WHERE id=?').get(student_id);
    const week = db.prepare('SELECT id FROM weeks WHERE id=?').get(week_id);
    if (!student || !week) return res.status(404).json({ error: 'Not found' });

    const rawSource = req.body?.source_week_id ?? req.body?.sourceWeekId;
    let sourceWeekId = rawSource == null || rawSource === '' ? null : toPositiveInt(rawSource);
    if (rawSource != null && rawSource !== '' && !sourceWeekId) {
      return res.status(400).json({ error: 'Invalid source_week_id' });
    }

    if (sourceWeekId) {
      const sourceWeek = db.prepare('SELECT id FROM weeks WHERE id=?').get(sourceWeekId);
      if (!sourceWeek) return res.status(404).json({ error: 'Source week not found' });
      if (sourceWeekId >= week_id) {
        return res.status(400).json({ error: 'Source week must be before current week' });
      }
    }

    const result = db.transaction(() => {
      if (sourceWeekId) {
        db.prepare(
          `
          INSERT INTO student_curriculum_sources (student_id, source_week_id, updated_at, updated_by)
          VALUES (?, ?, datetime('now'), ?)
          ON CONFLICT(student_id)
          DO UPDATE SET
            source_week_id = excluded.source_week_id,
            updated_at = datetime('now'),
            updated_by = excluded.updated_by
          `
        ).run(student_id, sourceWeekId, req.user.id);
      } else {
        db.prepare('DELETE FROM student_curriculum_sources WHERE student_id=?').run(student_id);
      }

      ensureWeekRecord(db, student_id, week_id);
      const effectiveWeekId = sourceWeekId || getPreviousWeekId(db, week_id);
      const copiedCount = effectiveWeekId
        ? applyCurriculumSourceToWeek(db, student_id, week_id, effectiveWeekId, req.user.id)
        : 0;

      writeAudit(db, {
        user_id: req.user.id,
        action: 'update',
        entity: 'curriculum_source',
        entity_id: student_id,
        details: {
          student_id,
          week_id,
          source_week_id: sourceWeekId,
          applied_source_week_id: effectiveWeekId || null,
          copied_count: copiedCount
        }
      });

      return { effectiveWeekId, copiedCount };
    })();

    return res.json({
      ok: true,
      curriculum_source_week_id: result.effectiveWeekId || null,
      curriculum_source_preference_week_id: sourceWeekId || null,
      copied_count: result.copiedCount
    });
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
    for (const key of ['b_daily_tasks','b_daily_tasks_this_week','b_lead_daily_feedback','c_lead_weekly_feedback','c_director_commentary','scores_json']) {
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
      if (k === 'scores_json' || k === 'b_daily_tasks' || k === 'b_daily_tasks_this_week' || k === 'b_lead_daily_feedback') {
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

  router.post('/workflow/share-with-parent/force', (req, res) => {
    const { student_id, week_id } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role !== 'director') {
      return res.status(403).json({ error: 'Only director can force share' });
    }

    ensureWeekRecord(db, Number(student_id), Number(week_id));
    const info = db
      .prepare("UPDATE week_records SET shared_with_parent=1, shared_at=datetime('now'), updated_at=datetime('now'), updated_by=? WHERE student_id=? AND week_id=?")
      .run(req.user.id, Number(student_id), Number(week_id));

    if (!info.changes) {
      return res.status(500).json({ error: 'Force share failed: week record not updated' });
    }

    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'share_with_parent_force', details: { student_id, week_id } });
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

      const week = db.prepare('SELECT id FROM weeks WHERE id=?').get(weekId);
      if (!week?.id) return res.status(404).json({ error: 'Week not found' });

      const actor = db
        .prepare('SELECT id FROM users WHERE id=?')
        .get(Number(req.user.id));
      const actorId = actor?.id ? Number(actor.id) : null;

      const findStudent = db.prepare('SELECT id, external_id, name FROM students WHERE id=?');
      const findWeekRecord = db.prepare(
        'SELECT id, shared_with_parent FROM week_records WHERE student_id=? AND week_id=?'
      );
      const findSubjectRecords = db.prepare(
        `
        SELECT id, a_this_hw, a_curriculum
        FROM subject_records
        WHERE student_id=? AND week_id=?
        ORDER BY id
        `
      );
      const markShared = db.prepare(
        "UPDATE week_records SET shared_with_parent=1, shared_at=datetime('now'), updated_at=datetime('now'), updated_by=? WHERE student_id=? AND week_id=?"
      );

      const updated = [];
      const skipped = [];
      const tx = db.transaction(() => {
        for (const studentId of requested) {
          const student = findStudent.get(studentId) || null;
          const studentName = String(student?.name || '').trim();
          const externalId = String(student?.external_id || '').trim();

          const weekRow = findWeekRecord.get(studentId, weekId);
          if (Number(weekRow?.shared_with_parent) === 1) {
            skipped.push({
              student_id: studentId,
              external_id: externalId || null,
              student_name: studentName || null,
              reason: 'already_shared',
              reason_codes: ['already_shared'],
              reason_ko: '이미 학부모 공유된 학생입니다.',
              reasons_ko: ['이미 학부모 공유된 학생입니다.']
            });
            continue;
          }

          const subjectRows = findSubjectRecords.all(studentId, weekId);
          const subjectCount = subjectRows.length;
          const homeworkSubjectCount = subjectRows.filter((row) => hasThisWeekHomework(row?.a_this_hw)).length;
          const curriculumSubjectCount = subjectRows.filter((row) => hasMeaningfulText(row?.a_curriculum)).length;

          const reasonCodes = [];
          const reasonMessages = [];

          if (!subjectCount) {
            reasonCodes.push('no_subject_records');
            reasonMessages.push('수강 진도(과목 별)에 등록된 과목이 없어 공유를 건너뜁니다.');
          } else {
            if (homeworkSubjectCount === 0) {
              reasonCodes.push('no_this_week_homework');
              reasonMessages.push(`이번주 과제가 과목 ${subjectCount}개 모두 비어 있어 공유를 건너뜁니다.`);
            }
            if (curriculumSubjectCount === 0) {
              reasonCodes.push('no_curriculum_content');
              reasonMessages.push(`학습 커리큘럼이 과목 ${subjectCount}개 모두 비어 있어 공유를 건너뜁니다.`);
            }
          }

          if (reasonCodes.length) {
            skipped.push({
              student_id: studentId,
              external_id: externalId || null,
              student_name: studentName || null,
              reason: reasonCodes[0],
              reason_codes: reasonCodes,
              reason_ko: reasonMessages.join(' / '),
              reasons_ko: reasonMessages,
              subject_count: subjectCount,
              homework_subject_count: homeworkSubjectCount,
              curriculum_subject_count: curriculumSubjectCount
            });
            continue;
          }

          ensureWeekRecord(db, studentId, weekId);
          const info = markShared.run(actorId, studentId, weekId);
          if (info.changes) {
            updated.push(studentId);
          } else {
            throw new Error(`Share failed: not updated (student_id=${studentId}, week_id=${weekId})`);
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

  router.post('/workflow/unshare-with-parent/bulk', (req, res) => {
    try {
      const { student_ids, week_id } = req.body || {};
      const weekId = Number(week_id);
      if (!weekId) return res.status(400).json({ error: 'Missing week_id' });
      if (req.user.role !== 'director') {
        return res.status(403).json({ error: 'Only director can bulk unshare' });
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
      const markUnshared = db.prepare(
        "UPDATE week_records SET shared_with_parent=0, shared_at=NULL, updated_at=datetime('now'), updated_by=? WHERE student_id=? AND week_id=?"
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
          if (Number(weekRow.shared_with_parent) !== 1) {
            skipped.push({ student_id: studentId, reason: 'already_unshared' });
            continue;
          }

          const info = markUnshared.run(actorId, studentId, weekId);
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
        entity: 'unshare_with_parent_bulk',
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
      return res.status(500).json({ error: e?.message || 'Bulk unshare failed' });
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
