import express from 'express';
import { canEditField, filterObjectByView } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';
import { signWrongAnswerUploadToken } from '../lib/problemUploadToken.js';

function ensureWeekRecord(db, student_id, week_id) {
  const existing = db.prepare('SELECT id FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);
  if (existing) return existing.id;
  const info = db.prepare(
    'INSERT INTO week_records (student_id, week_id, b_daily_tasks, b_daily_tasks_this_week, b_lead_daily_feedback, d_clinic_records, e_wrong_answer_distribution, scores_json) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    student_id,
    week_id,
    JSON.stringify({}),
    JSON.stringify({}),
    JSON.stringify({}),
    JSON.stringify([]),
    JSON.stringify({}),
    JSON.stringify([])
  );
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

function getWeekRound(week) {
  const label = String(week?.label || '');
  const m = label.match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const idNum = Number(week?.id || 0);
  if (Number.isInteger(idNum) && idNum > 0) return idNum;
  return 0;
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

function ensureAppSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function safeJson(text, fallback) {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function requestPublicBaseUrl(req) {
  const protoRaw = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const hostRaw = String(req.headers['x-forwarded-host'] || req.get('host') || '');
  const proto = protoRaw.split(',')[0].trim() || 'http';
  const host = hostRaw.split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

const DEFAULT_WRONG_ANSWER_ITEM = {
  subject: '',
  material: '',
  problem_name: '',
  problem_type: '',
  note: '',
  images: []
};

const KO_DAY = ['일', '월', '화', '수', '목', '금', '토'];

function ensureWrongAnswerImagesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wrong_answer_images (
      id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      problem_index INTEGER NOT NULL,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      data_blob BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wrong_answer_images_student_week
      ON wrong_answer_images(student_id, week_id, problem_index, created_at);
  `);
}

function normalizeWrongAnswerItem(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WRONG_ANSWER_ITEM };
  return {
    subject: String(raw.subject || '').trim(),
    material: String(raw.material || '').trim(),
    problem_name: String(raw.problem_name || '').trim(),
    problem_type: String(raw.problem_type || '').trim(),
    note: String(raw.note || '').trim(),
    images: Array.isArray(raw.images)
      ? raw.images
          .map((img) => ({
            id: String(img?.id || '').trim(),
            url: String(img?.url || '').trim(),
            filename: String(img?.filename || '').trim(),
            stored_name: String(img?.stored_name || '').trim(),
            mime_type: String(img?.mime_type || '').trim(),
            size: Number(img?.size || 0) || 0,
            uploaded_at: String(img?.uploaded_at || '').trim(),
            uploaded_via: String(img?.uploaded_via || '').trim()
          }))
          .filter((img) => img.id || img.url)
      : []
  };
}

function normalizeWrongAnswerDistribution(value) {
  if (!value || typeof value !== 'object') {
    return { problems: [{ ...DEFAULT_WRONG_ANSWER_ITEM }], assignment: null, searched_at: '' };
  }
  const problemsRaw = Array.isArray(value.problems)
    ? value.problems
    : Array.isArray(value.items)
      ? value.items
      : [];
  const problems = problemsRaw.length
    ? problemsRaw.map(normalizeWrongAnswerItem)
    : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
  const assignment = value.assignment && typeof value.assignment === 'object'
    ? {
        ...value.assignment,
        mentor_id: String(value.assignment.mentor_id || '').trim(),
        mentor_name: String(value.assignment.mentor_name || '').trim(),
        mentor_role: String(value.assignment.mentor_role || '').trim(),
        session_month: String(value.assignment.session_month || '').trim(),
        session_day: String(value.assignment.session_day || '').trim(),
        session_start_time: String(value.assignment.session_start_time || value.assignment.session_time || '').trim(),
        session_duration_minutes: Number(value.assignment.session_duration_minutes || 20) || 20,
        session_time: String(value.assignment.session_time || '').trim()
      }
    : null;
  return {
    problems,
    assignment,
    searched_at: String(value.searched_at || '').trim()
  };
}

function parseTimePart(value) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function toHHMM(totalMinutes) {
  const mins = Number(totalMinutes || 0);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeMentorName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function resolveSessionDayLabel(week, assignment) {
  const month = Number(assignment?.session_month || 0);
  const day = Number(assignment?.session_day || 0);
  const weekStart = String(week?.start_date || '').trim();
  const ym = weekStart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ym && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    const y = Number(ym[1]);
    const d = new Date(y, month - 1, day);
    if (!Number.isNaN(d.getTime())) return KO_DAY[d.getDay()] || '';
  }

  const preview = Array.isArray(assignment?.overlap_preview) ? assignment.overlap_preview : [];
  const first = String(preview[0] || '').trim();
  const ch = first ? first.slice(0, 1) : '';
  if (['월', '화', '수', '목', '금', '토', '일'].includes(ch)) return ch;
  return '';
}

function getMentorInfoSetting(db) {
  ensureAppSettingsTable(db);
  const row = db.prepare('SELECT value_json, updated_at FROM app_settings WHERE key=?').get('mentor_info');
  if (!row?.value_json) return { mentors: [], updated_at: row?.updated_at || null };

  const parsed = safeJson(row.value_json, null);
  const mentors = Array.isArray(parsed?.mentors) ? parsed.mentors : [];
  return {
    mentors,
    updated_at: parsed?.updatedAt || row?.updated_at || null
  };
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

    if (req.user.role === 'parent' || req.user.role === 'mentor') return res.status(403).json({ error: 'Forbidden' });

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
    if (req.user.role === 'mentor') return res.status(403).json({ error: 'Forbidden' });
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
    const weekRound = getWeekRound(week);
    const useNewDailyTaskLayout = weekRound >= 4;

    const { preferenceWeekId, effectiveWeekId: curriculumSourceWeekId } = resolveCurriculumSourceWeekId(db, student_id, week_id);
    const previousWeekId = getPreviousWeekId(db, week_id);

    ensureWeekRecord(db, student_id, week_id);
    if (useNewDailyTaskLayout) {
      hydrateDailyTasksFromPreviousWeekIfEmpty(db, student_id, week_id, previousWeekId);
    }

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
    const mentorInfo = getMentorInfoSetting(db);

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
      mentor_info: mentorInfo,
      use_new_daily_task_layout: useNewDailyTaskLayout,
      curriculum_source_week_id: curriculumSourceWeekId || null,
      curriculum_source_preference_week_id: preferenceWeekId || null
    });
  });

  router.put('/curriculum-source', (req, res) => {
    const student_id = toPositiveInt(req.body?.student_id ?? req.body?.studentId);
    const week_id = toPositiveInt(req.body?.week_id ?? req.body?.weekId);
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role === 'parent' || req.user.role === 'mentor') return res.status(403).json({ error: 'Forbidden' });

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
    if (req.user.role === 'parent' || req.user.role === 'mentor') return res.status(403).json({ error: 'Forbidden' });

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
    const week = db.prepare('SELECT id, label FROM weeks WHERE id=?').get(row.week_id);
    const weekRound = getWeekRound(week);
    const clinicEnabled = weekRound >= 5;

    const updates = {};
    for (const key of ['b_daily_tasks','b_daily_tasks_this_week','b_lead_daily_feedback','c_lead_weekly_feedback','c_director_commentary','d_clinic_records','e_wrong_answer_distribution','scores_json']) {
      if (key === 'd_clinic_records' && !clinicEnabled) continue;
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

    const mentorEditableKeys = new Set(clinicEnabled ? ['d_clinic_records'] : []);
    const allowed = keys.filter((k) => {
      if (k === 'shared_with_parent') return true;
      if (req.user.role === 'mentor') return mentorEditableKeys.has(k) && canEditField(db, req.user.role, k);
      return canEditField(db, req.user.role, k);
    });
    if (!allowed.length) return res.status(403).json({ error: 'No editable fields' });

    const normalized = {};
    for (const k of allowed) {
      if (k === 'scores_json' || k === 'b_daily_tasks' || k === 'b_daily_tasks_this_week' || k === 'b_lead_daily_feedback' || k === 'e_wrong_answer_distribution') {
        normalized[k] = JSON.stringify(updates[k] ?? {});
      } else if (k === 'd_clinic_records') {
        normalized[k] = JSON.stringify(Array.isArray(updates[k]) ? updates[k] : []);
      } else if (k === 'shared_with_parent') {
        normalized[k] = updates[k] ? 1 : 0;
      } else {
        normalized[k] = updates[k] == null ? null : String(updates[k]);
      }
    }

    let wrongAnswerImageKeepIds = null;
    if (allowed.includes('e_wrong_answer_distribution')) {
      const parsedWrongAnswer = normalizeWrongAnswerDistribution(safeJson(normalized.e_wrong_answer_distribution, {}));
      const keepIds = new Set();
      for (const problem of Array.isArray(parsedWrongAnswer.problems) ? parsedWrongAnswer.problems : []) {
        for (const img of Array.isArray(problem?.images) ? problem.images : []) {
          const id = String(img?.id || '').trim();
          if (id) keepIds.add(id);
        }
      }
      wrongAnswerImageKeepIds = Array.from(keepIds);
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
    const tx = db.transaction(() => {
      db.prepare(`UPDATE week_records SET ${setSql}, updated_at=datetime('now'), updated_by=? WHERE id=?`)
        .run(...values, req.user.id, id);

      if (Array.isArray(wrongAnswerImageKeepIds)) {
        ensureWrongAnswerImagesTable(db);
        if (wrongAnswerImageKeepIds.length) {
          const placeholders = wrongAnswerImageKeepIds.map(() => '?').join(', ');
          db.prepare(
            `UPDATE wrong_answer_images
             SET deleted_at=datetime('now')
             WHERE student_id=? AND week_id=? AND deleted_at IS NULL
               AND id NOT IN (${placeholders})`
          ).run(row.student_id, row.week_id, ...wrongAnswerImageKeepIds);
        } else {
          db.prepare(
            `UPDATE wrong_answer_images
             SET deleted_at=datetime('now')
             WHERE student_id=? AND week_id=? AND deleted_at IS NULL`
          ).run(row.student_id, row.week_id);
        }
      }
    });
    tx();

    writeAudit(db, { user_id: req.user.id, action: 'update', entity: 'week_record', entity_id: id, details: { fields: allowed } });
    res.json({ ok: true, updated_fields: allowed });
  });

  router.post('/wrong-answer/upload-link', (req, res) => {
    const student_id = Number(req.body?.student_id || 0);
    const week_id = Number(req.body?.week_id || 0);
    const problem_index = Number(req.body?.problem_index ?? -1);
    if (!student_id || !week_id || !Number.isInteger(problem_index) || problem_index < 0 || problem_index > 99) {
      return res.status(400).json({ error: 'Missing or invalid student_id/week_id/problem_index' });
    }
    if (req.user.role === 'parent' || req.user.role === 'mentor') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const student = db.prepare('SELECT id FROM students WHERE id=?').get(student_id);
    const week = db.prepare('SELECT id FROM weeks WHERE id=?').get(week_id);
    if (!student || !week) return res.status(404).json({ error: 'Not found' });

    ensureWeekRecord(db, student_id, week_id);

    const token = signWrongAnswerUploadToken({
      student_id,
      week_id,
      problem_index,
      issued_by: req.user.id
    });
    const baseUrl = requestPublicBaseUrl(req);
    const uploadPath = `/api/problem-upload/mobile?token=${encodeURIComponent(token)}`;
    const upload_url = baseUrl ? `${baseUrl}${uploadPath}` : uploadPath;

    return res.json({
      ok: true,
      upload_url,
      token
    });
  });

  router.post('/wrong-answer/delete-image', (req, res) => {
    const student_id = Number(req.body?.student_id || 0);
    const week_id = Number(req.body?.week_id || 0);
    const problem_index = Number(req.body?.problem_index ?? -1);
    const image_id = String(req.body?.image_id || '').trim();
    if (!student_id || !week_id || !Number.isInteger(problem_index) || problem_index < 0 || !image_id) {
      return res.status(400).json({ error: 'Missing or invalid student_id/week_id/problem_index/image_id' });
    }
    if (req.user.role === 'parent' || req.user.role === 'mentor') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    ensureWrongAnswerImagesTable(db);

    const weekRecord = db
      .prepare('SELECT id, e_wrong_answer_distribution FROM week_records WHERE student_id=? AND week_id=?')
      .get(student_id, week_id);
    if (!weekRecord?.id) return res.status(404).json({ error: 'Week record not found' });

    const current = normalizeWrongAnswerDistribution(safeJson(weekRecord.e_wrong_answer_distribution, {}));
    const problems = Array.isArray(current.problems) ? [...current.problems] : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
    if (!problems[problem_index]) return res.status(404).json({ error: 'Problem record not found' });

    const target = normalizeWrongAnswerItem(problems[problem_index]);
    const nextImages = target.images.filter((img) => String(img?.id || '').trim() !== image_id);
    if (nextImages.length === target.images.length) {
      return res.status(404).json({ error: 'Image metadata not found' });
    }
    problems[problem_index] = { ...target, images: nextImages };
    const next = { ...current, problems };

    const tx = db.transaction(() => {
      db.prepare("UPDATE week_records SET e_wrong_answer_distribution=?, updated_at=datetime('now'), updated_by=? WHERE id=?")
        .run(JSON.stringify(next), req.user.id, weekRecord.id);
      db.prepare("UPDATE wrong_answer_images SET deleted_at=datetime('now') WHERE id=?")
        .run(image_id);
    });
    tx();

    writeAudit(db, {
      user_id: req.user.id,
      action: 'delete',
      entity: 'wrong_answer_image',
      details: { student_id, week_id, problem_index, image_id }
    });

    return res.json({ ok: true, e_wrong_answer_distribution: next });
  });

  router.get('/assignment-status', (req, res) => {
    const week_id = Number(req.query.weekId || 0);
    if (!week_id) return res.status(400).json({ error: 'Missing weekId' });

    const week = db.prepare('SELECT id, label, start_date, end_date FROM weeks WHERE id=?').get(week_id);
    if (!week?.id) return res.status(404).json({ error: 'Week not found' });

    const rows = db
      .prepare(
        `SELECT wr.id AS week_record_id, wr.student_id, wr.e_wrong_answer_distribution, s.external_id, s.name AS student_name
         FROM week_records wr
         JOIN students s ON s.id = wr.student_id
         WHERE wr.week_id = ?
         ORDER BY s.name`
      )
      .all(week_id);

    const isMentorRole = req.user.role === 'mentor';
    const meNameRaw = String(req.user?.display_name || '').trim();
    const meUserRaw = String(req.user?.username || '').trim();
    const meName = normalizeMentorName(meNameRaw);
    const meUser = normalizeMentorName(meUserRaw);

    const assignments = [];
    for (const row of rows) {
      const dist = normalizeWrongAnswerDistribution(safeJson(row.e_wrong_answer_distribution, {}));
      const assignment = dist.assignment && typeof dist.assignment === 'object' ? dist.assignment : null;
      if (!assignment?.mentor_name) continue;

      const mentorName = String(assignment.mentor_name || '').trim();
      const mentorRole = String(assignment.mentor_role || '').trim();
      const normalizedMentorName = normalizeMentorName(mentorName);
      const normalizedMentorId = normalizeMentorName(String(assignment.mentor_id || '').trim());

      if (isMentorRole) {
        if (mentorRole !== 'mentor') continue;
        const matched =
          (meName && (normalizedMentorName.includes(meName) || meName.includes(normalizedMentorName))) ||
          (meUser && (
            normalizedMentorName.includes(meUser) ||
            meUser.includes(normalizedMentorName) ||
            normalizedMentorId === meUser
          ));
        if (!matched) continue;
      }

      const startTime = String(assignment.session_start_time || assignment.session_time || '').trim();
      const duration = Math.max(5, Math.min(240, Number(assignment.session_duration_minutes || 20) || 20));
      const startMinutes = parseTimePart(startTime);
      const endTime = startMinutes == null ? '' : toHHMM(startMinutes + duration);
      const dayLabel = resolveSessionDayLabel(week, assignment) || '-';
      const sessionDateLabel = assignment.session_month && assignment.session_day
        ? `${assignment.session_month}/${assignment.session_day}`
        : '-';

      assignments.push({
        week_record_id: row.week_record_id,
        student_id: row.student_id,
        student_name: String(row.student_name || '').trim(),
        external_id: String(row.external_id || '').trim(),
        mentor_name: mentorName,
        mentor_role: mentorRole,
        day_label: dayLabel,
        session_date_label: sessionDateLabel,
        session_start_time: startTime,
        session_end_time: endTime,
        session_duration_minutes: duration,
        session_range_text: startTime && endTime ? `${startTime} ~ ${endTime}` : '-',
        assigned_at: String(assignment.assigned_at || '').trim()
      });
    }

    assignments.sort((a, b) => {
      const mentorCmp = String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''));
      if (mentorCmp !== 0) return mentorCmp;
      const dayCmp = String(a.day_label || '').localeCompare(String(b.day_label || ''));
      if (dayCmp !== 0) return dayCmp;
      return String(a.student_name || '').localeCompare(String(b.student_name || ''));
    });

    return res.json({
      week,
      assignments,
      viewer: {
        role: req.user.role,
        display_name: req.user.display_name || req.user.username || ''
      }
    });
  });

  router.post('/workflow/submit', (req, res) => {
    const { student_id, week_id } = req.body || {};
    if (!student_id || !week_id) return res.status(400).json({ error: 'Missing student_id/week_id' });
    if (req.user.role !== 'mentor') return res.status(403).json({ error: 'Only mentor can submit' });

    const student = db.prepare('SELECT name FROM students WHERE id=?').get(Number(student_id));
    const week = db.prepare('SELECT label FROM weeks WHERE id=?').get(Number(week_id));
    const leads = db.prepare("SELECT id FROM users WHERE role IN ('lead','director') AND is_active=1").all();

    const body = `${student?.name || '학생'} ${week?.label || ''} 멘토링 기록이 클리닉 멘토에 의해 제출되었습니다.`;
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

