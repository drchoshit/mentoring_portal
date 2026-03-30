import express from 'express';
import multer from 'multer';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const LEAD_ASSIGNMENT_BOARD_KEY = 'lead_assignment_board';

function parseJsonFile(req) {
  if (!req.file) throw new Error('Missing file');
  const txt = req.file.buffer.toString('utf-8');
  return JSON.parse(txt);
}

function importUploadHandler(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '파일이 너무 큽니다. 5MB 이하 JSON 파일만 업로드할 수 있습니다.' });
    }
    return res.status(400).json({ error: String(err?.message || '파일 업로드에 실패했습니다.') });
  });
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

function normalizeDays(input) {
  if (Array.isArray(input)) {
    return input.map((d) => String(d || '').trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[,\/\s]+/)
      .map((d) => d.trim())
      .filter(Boolean);
  }
  return [];
}

function loadAssignments(db) {
  ensureAppSettingsTable(db);
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get('mentor_assignments');
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function saveAssignments(db, payload) {
  ensureAppSettingsTable(db);
  db.prepare(
    `
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=datetime('now')
    `
  ).run('mentor_assignments', JSON.stringify(payload));
}

function parsePayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return { students: payload };
  if (Array.isArray(payload.students)) return payload;
  return null;
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeDayLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (DAY_LABELS.includes(raw)) return raw;
  if (raw === '월요일') return '월';
  if (raw === '화요일') return '화';
  if (raw === '수요일') return '수';
  if (raw === '목요일') return '목';
  if (raw === '금요일') return '금';
  if (raw === '토요일') return '토';
  if (raw === '일요일') return '일';
  return '';
}

function normalizeTimeText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (
    !Number.isInteger(hh) ||
    !Number.isInteger(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return '';
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeMentorRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'lead' || raw.includes('총괄') || raw.includes('field') || raw.includes('total')) return 'lead';
  if (raw === 'mentor' || raw.includes('클리닉')) return 'mentor';
  if (raw === 'director' || raw.includes('원장')) return 'director';
  return raw;
}

function loadMentorInfoSetting(db) {
  ensureAppSettingsTable(db);
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get('mentor_info');
  if (!row?.value_json) return { mentors: [] };
  try {
    const parsed = JSON.parse(row.value_json);
    const mentors = Array.isArray(parsed?.mentors)
      ? parsed.mentors.map((item) => ({
          name: String(item?.name || item?.display_name || '').trim(),
          role: normalizeMentorRole(item?.role)
        }))
      : [];
    return { mentors };
  } catch {
    return { mentors: [] };
  }
}

function makeRandomId(prefix) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${rand}`;
}

function normalizeMissingMark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim() || makeRandomId('missing');
  const studentId = parsePositiveInt(raw.student_id);
  const mentorName = String(raw.mentor_name || '').trim();
  const dayLabel = normalizeDayLabel(raw.day_label);
  if (!studentId || !mentorName) return null;
  return {
    id,
    student_id: studentId,
    mentor_name: mentorName,
    day_label: dayLabel,
    marked_at: String(raw.marked_at || '').trim(),
    marked_by: String(raw.marked_by || '').trim()
  };
}

function normalizeForcedAssignment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim() || makeRandomId('forced');
  const missingId = String(raw.missing_id || '').trim();
  const studentId = parsePositiveInt(raw.student_id);
  const targetMentorName = String(raw.target_mentor_name || '').trim();
  if (!missingId || !studentId || !targetMentorName) return null;
  return {
    id,
    missing_id: missingId,
    student_id: studentId,
    source_mentor_name: String(raw.source_mentor_name || '').trim(),
    source_day_label: normalizeDayLabel(raw.source_day_label),
    target_mentor_name: targetMentorName,
    target_day_label: normalizeDayLabel(raw.target_day_label),
    target_time: normalizeTimeText(raw.target_time),
    assigned_at: String(raw.assigned_at || '').trim(),
    assigned_by: String(raw.assigned_by || '').trim()
  };
}

function normalizeBoardWeekBucket(raw) {
  const missing = Array.isArray(raw?.missing_marks)
    ? raw.missing_marks.map(normalizeMissingMark).filter(Boolean)
    : [];
  const forced = Array.isArray(raw?.forced_assignments)
    ? raw.forced_assignments.map(normalizeForcedAssignment).filter(Boolean)
    : [];
  return {
    missing_marks: missing,
    forced_assignments: forced
  };
}

function normalizeLeadAssignmentBoardState(raw) {
  const byWeekRaw = raw && typeof raw === 'object' ? raw.by_week : {};
  const byWeek = {};
  if (byWeekRaw && typeof byWeekRaw === 'object') {
    for (const [weekKey, weekValue] of Object.entries(byWeekRaw)) {
      const weekId = parsePositiveInt(weekKey);
      if (!weekId) continue;
      byWeek[String(weekId)] = normalizeBoardWeekBucket(weekValue);
    }
  }
  return {
    updatedAt: String(raw?.updatedAt || '').trim(),
    by_week: byWeek
  };
}

function loadLeadAssignmentBoardState(db) {
  ensureAppSettingsTable(db);
  const row = db
    .prepare('SELECT value_json FROM app_settings WHERE key=?')
    .get(LEAD_ASSIGNMENT_BOARD_KEY);
  if (!row?.value_json) return normalizeLeadAssignmentBoardState({});
  try {
    return normalizeLeadAssignmentBoardState(JSON.parse(row.value_json));
  } catch {
    return normalizeLeadAssignmentBoardState({});
  }
}

function saveLeadAssignmentBoardState(db, state) {
  ensureAppSettingsTable(db);
  const payload = normalizeLeadAssignmentBoardState({
    ...state,
    updatedAt: new Date().toISOString()
  });
  db.prepare(
    `
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=datetime('now')
    `
  ).run(LEAD_ASSIGNMENT_BOARD_KEY, JSON.stringify(payload));
  return payload;
}

function getBoardWeekBucket(state, weekId) {
  const key = String(parsePositiveInt(weekId) || '');
  if (!key) return normalizeBoardWeekBucket({});
  return normalizeBoardWeekBucket(state?.by_week?.[key]);
}

function setBoardWeekBucket(state, weekId, bucket) {
  const normalizedState = normalizeLeadAssignmentBoardState(state || {});
  const key = String(parsePositiveInt(weekId) || '');
  if (!key) return normalizedState;
  normalizedState.by_week[key] = normalizeBoardWeekBucket(bucket);
  return normalizedState;
}

function resolveWeekId(db, requestedWeekId) {
  const weekId = parsePositiveInt(requestedWeekId);
  if (weekId) {
    const found = db.prepare('SELECT id FROM weeks WHERE id=?').get(weekId);
    if (found?.id) return weekId;
  }
  const latest = db.prepare('SELECT id FROM weeks ORDER BY id DESC LIMIT 1').get();
  return parsePositiveInt(latest?.id);
}

function normalizedIdCandidates(rawId) {
  const out = [];
  const add = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };

  add(rawId);

  const key = String(rawId ?? '').trim();
  if (!key) return out;

  // Some JSON exporters stringify integer-like numbers as "... .0".
  if (/^-?\d+\.0+$/.test(key)) {
    add(key.replace(/\.0+$/, ''));
  }

  const asNumber = Number(key);
  if (Number.isFinite(asNumber)) {
    add(String(asNumber));
    if (Number.isInteger(asNumber)) add(String(asNumber));
  }

  return out;
}

function buildStudentsByName(db) {
  const map = new Map();
  const rows = db.prepare('SELECT id, external_id, name FROM students WHERE name IS NOT NULL AND name != ?').all('');
  rows.forEach((row) => {
    const key = String(row?.name || '').trim();
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

export default function mentorAssignmentsRoutes(db) {
  const router = express.Router();

  router.get('/', requireRole('director', 'admin'), (req, res) => {
    const data = loadAssignments(db);
    return res.json({ data });
  });

  router.post('/import', requireRole('director', 'admin'), importUploadHandler, (req, res) => {
    let payload;
    try {
      payload = parseJsonFile(req);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const parsed = parsePayload(payload);
    if (!parsed) return res.status(400).json({ error: 'Expected students array' });

    const rows = parsed.students || [];
    const findByExternal = db.prepare('SELECT id, external_id, name FROM students WHERE external_id=?');
    const findById = db.prepare('SELECT id, external_id, name FROM students WHERE id=?');
    const studentsByName = buildStudentsByName(db);

    const byStudentId = new Map();
    const missing = [];
    const missingSet = new Set();

    rows.forEach((row) => {
      if (!row) return;
      const rawId = firstNonEmptyText(
        row?.id,
        row?.student_id,
        row?.studentId,
        row?.external_id,
        row?.externalId
      );
      if (rawId === undefined || rawId === null || rawId === '') return;
      const key = String(rawId).trim();
      if (!key) return;

      let student = null;
      const idCandidates = normalizedIdCandidates(rawId);

      for (const candidate of idCandidates) {
        student = findByExternal.get(candidate);
        if (student) break;
      }

      if (!student) {
        for (const candidate of idCandidates) {
          const numeric = Number(candidate);
          if (!Number.isSafeInteger(numeric)) continue;
          if (String(numeric) !== candidate) continue;
          student = findById.get(numeric);
          if (student) break;
        }
      }

      if (!student) {
        const nameKey = firstNonEmptyText(
          row?.name,
          row?.student_name,
          row?.studentName
        );
        const nameMatches = nameKey ? (studentsByName.get(nameKey) || []) : [];
        if (nameMatches.length === 1) {
          student = nameMatches[0];
        }
      }

      if (!student) {
        if (!missingSet.has(key)) {
          missingSet.add(key);
          missing.push({
            id: key,
            name: firstNonEmptyText(row?.name, row?.student_name, row?.studentName)
          });
        }
        return;
      }

      const mentor = firstNonEmptyText(
        row?.mentor,
        row?.manualMentor,
        row?.mentor_name,
        row?.clinic_mentor,
        row?.clinicMentor,
        row?.clinic_mentor_name,
        row?.clinicMentorName
      );
      const leadMentor = firstNonEmptyText(
        row?.lead_mentor,
        row?.leadMentor,
        row?.lead_name,
        row?.leadName,
        row?.total_mentor,
        row?.totalMentor,
        row?.total_mentor_name,
        row?.totalMentorName,
        row?.field_mentor,
        row?.fieldMentor,
        row?.overall_mentor,
        row?.overallMentor,
        row?.manager_mentor,
        row?.managerMentor,
        row?.master_mentor,
        row?.masterMentor
      );
      const scheduledDays = normalizeDays(
        row?.scheduledDays ?? row?.scheduled_days ?? row?.days ?? row?.day ?? row?.rescheduleDay
      );

      byStudentId.set(String(student.id), {
        student_id: student.id,
        external_id: student.external_id || '',
        name: student.name || '',
        mentor,
        lead_mentor: leadMentor || mentor,
        scheduledDays
      });
    });

    const assignments = Array.from(byStudentId.values());
    if (rows.length > 0 && assignments.length === 0) {
      return res.status(422).json({
        error: '학생 매칭 0건으로 반영을 중단했습니다. 파일 형식(아이디/이름 키)을 확인해 주세요.',
        missing
      });
    }

    const stored = {
      periodId: parsed.periodId ? String(parsed.periodId).trim() : '',
      exportedAt: parsed.exportedAt ? String(parsed.exportedAt).trim() : '',
      updatedAt: new Date().toISOString(),
      assignments
    };

    saveAssignments(db, stored);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'import',
      entity: 'mentor_assignments',
      details: { stored: assignments.length, missing: missing.length }
    });

    return res.json({ data: stored, missing });
  });

  router.get('/lead-board', requireRole('director', 'admin', 'lead'), (req, res) => {
    const weekId = resolveWeekId(db, req.query.weekId || req.query.week_id);
    if (!weekId) return res.status(404).json({ error: 'Week not found' });

    const assignmentData = loadAssignments(db);
    const assignments = Array.isArray(assignmentData?.assignments)
      ? assignmentData.assignments.map((item) => ({
          student_id: parsePositiveInt(item?.student_id) || 0,
          external_id: String(item?.external_id || '').trim(),
          name: String(item?.name || '').trim(),
          mentor: String(item?.mentor || '').trim(),
          lead_mentor: firstNonEmptyText(
            item?.lead_mentor,
            item?.leadMentor,
            item?.lead_name,
            item?.leadName,
            item?.total_mentor,
            item?.totalMentor,
            item?.mentor
          ),
          scheduledDays: Array.isArray(item?.scheduledDays)
            ? item.scheduledDays.map((d) => normalizeDayLabel(d)).filter(Boolean)
            : []
        }))
      : [];

    const state = loadLeadAssignmentBoardState(db);
    const bucket = getBoardWeekBucket(state, weekId);

    const studentRows = db
      .prepare('SELECT id, external_id, name FROM students')
      .all();
    const studentMap = new Map(
      studentRows.map((row) => [
        Number(row?.id || 0),
        {
          external_id: String(row?.external_id || '').trim(),
          name: String(row?.name || '').trim()
        }
      ])
    );

    const missingMarks = bucket.missing_marks.map((mark) => {
      const student = studentMap.get(Number(mark.student_id || 0)) || {};
      return {
        ...mark,
        external_id: student.external_id || '',
        student_name: student.name || ''
      };
    });
    const forcedAssignments = bucket.forced_assignments.map((item) => {
      const student = studentMap.get(Number(item.student_id || 0)) || {};
      return {
        ...item,
        external_id: student.external_id || '',
        student_name: student.name || ''
      };
    });
    const mentorInfo = loadMentorInfoSetting(db);
    const leadMentorNameSet = new Set();
    for (const mentor of mentorInfo.mentors || []) {
      if (String(mentor?.role || '') !== 'lead') continue;
      const name = String(mentor?.name || '').trim();
      if (name) leadMentorNameSet.add(name);
    }
    for (const item of forcedAssignments) {
      const name = String(item?.target_mentor_name || '').trim();
      if (name) leadMentorNameSet.add(name);
    }
    if (!leadMentorNameSet.size) {
      for (const item of assignments) {
        const name = String(item?.lead_mentor || '').trim();
        if (name) leadMentorNameSet.add(name);
      }
    }
    const leadMentors = Array.from(leadMentorNameSet).sort((a, b) => a.localeCompare(b));

    return res.json({
      ok: true,
      week_id: weekId,
      board_updated_at: state.updatedAt || '',
      source_updated_at: String(assignmentData?.updatedAt || '').trim(),
      lead_mentors: leadMentors,
      assignments,
      missing_marks: missingMarks,
      forced_assignments: forcedAssignments
    });
  });

  router.post('/lead-board/missing/toggle', requireRole('director', 'admin'), (req, res) => {
    const weekId = resolveWeekId(db, req.body?.week_id ?? req.body?.weekId);
    if (!weekId) return res.status(404).json({ error: 'Week not found' });

    const studentId = parsePositiveInt(req.body?.student_id ?? req.body?.studentId);
    const mentorName = String(req.body?.mentor_name || '').trim();
    const dayLabel = normalizeDayLabel(req.body?.day_label || req.body?.dayLabel);
    if (!studentId || !mentorName) {
      return res.status(400).json({ error: 'Missing student_id/mentor_name' });
    }

    const state = loadLeadAssignmentBoardState(db);
    const bucket = getBoardWeekBucket(state, weekId);
    const idx = bucket.missing_marks.findIndex(
      (item) =>
        Number(item?.student_id || 0) === studentId &&
        String(item?.mentor_name || '').trim() === mentorName &&
        String(item?.day_label || '').trim() === dayLabel
    );

    let action = '';
    if (idx >= 0) {
      const target = bucket.missing_marks[idx];
      bucket.missing_marks = bucket.missing_marks.filter((_, i) => i !== idx);
      bucket.forced_assignments = bucket.forced_assignments.filter(
        (item) => String(item?.missing_id || '').trim() !== String(target?.id || '').trim()
      );
      action = 'unmarked';
    } else {
      bucket.missing_marks = [
        ...bucket.missing_marks,
        {
          id: makeRandomId('missing'),
          student_id: studentId,
          mentor_name: mentorName,
          day_label: dayLabel,
          marked_at: new Date().toISOString(),
          marked_by: String(req.user?.role || '').trim()
        }
      ];
      action = 'marked';
    }

    const nextState = setBoardWeekBucket(state, weekId, bucket);
    saveLeadAssignmentBoardState(db, nextState);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'update',
      entity: 'lead_assignment_missing',
      details: {
        week_id: weekId,
        student_id: studentId,
        mentor_name: mentorName,
        day_label: dayLabel,
        action
      }
    });

    return res.json({
      ok: true,
      action,
      week_id: weekId,
      missing_marks: bucket.missing_marks,
      forced_assignments: bucket.forced_assignments
    });
  });

  router.post('/lead-board/force-assign', requireRole('director', 'admin'), (req, res) => {
    const weekId = resolveWeekId(db, req.body?.week_id ?? req.body?.weekId);
    if (!weekId) return res.status(404).json({ error: 'Week not found' });

    const missingId = String(req.body?.missing_id || req.body?.missingId || '').trim();
    const targetMentorName = String(req.body?.target_mentor_name || req.body?.targetMentorName || '').trim();
    const targetDayLabel = normalizeDayLabel(req.body?.target_day_label || req.body?.targetDayLabel);
    const targetTime = normalizeTimeText(req.body?.target_time || req.body?.targetTime);
    if (!missingId || !targetMentorName) {
      return res.status(400).json({ error: 'Missing missing_id/target_mentor_name' });
    }

    const state = loadLeadAssignmentBoardState(db);
    const bucket = getBoardWeekBucket(state, weekId);
    const missing = bucket.missing_marks.find((item) => String(item?.id || '').trim() === missingId);
    if (!missing?.id) return res.status(404).json({ error: 'Missing mark not found' });

    const nextItem = {
      id: makeRandomId('forced'),
      missing_id: String(missing.id),
      student_id: Number(missing.student_id),
      source_mentor_name: String(missing.mentor_name || '').trim(),
      source_day_label: normalizeDayLabel(missing.day_label),
      target_mentor_name: targetMentorName,
      target_day_label: targetDayLabel,
      target_time: targetTime,
      assigned_at: new Date().toISOString(),
      assigned_by: String(req.user?.role || '').trim()
    };

    const existsIndex = bucket.forced_assignments.findIndex(
      (item) => String(item?.missing_id || '').trim() === missingId
    );
    if (existsIndex >= 0) {
      const copied = [...bucket.forced_assignments];
      copied[existsIndex] = nextItem;
      bucket.forced_assignments = copied;
    } else {
      bucket.forced_assignments = [...bucket.forced_assignments, nextItem];
    }

    const nextState = setBoardWeekBucket(state, weekId, bucket);
    saveLeadAssignmentBoardState(db, nextState);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'update',
      entity: 'lead_assignment_force',
      details: {
        week_id: weekId,
        missing_id: missingId,
        student_id: Number(missing.student_id),
        target_mentor_name: targetMentorName,
        target_day_label: targetDayLabel || '',
        target_time: targetTime || ''
      }
    });

    return res.json({
      ok: true,
      week_id: weekId,
      missing_marks: bucket.missing_marks,
      forced_assignments: bucket.forced_assignments
    });
  });

  router.post('/lead-board/force-assign/remove', requireRole('director', 'admin'), (req, res) => {
    const weekId = resolveWeekId(db, req.body?.week_id ?? req.body?.weekId);
    if (!weekId) return res.status(404).json({ error: 'Week not found' });

    const missingId = String(req.body?.missing_id || req.body?.missingId || '').trim();
    if (!missingId) return res.status(400).json({ error: 'Missing missing_id' });

    const state = loadLeadAssignmentBoardState(db);
    const bucket = getBoardWeekBucket(state, weekId);
    const before = bucket.forced_assignments.length;
    bucket.forced_assignments = bucket.forced_assignments.filter(
      (item) => String(item?.missing_id || '').trim() !== missingId
    );
    const removed = before - bucket.forced_assignments.length;

    const nextState = setBoardWeekBucket(state, weekId, bucket);
    saveLeadAssignmentBoardState(db, nextState);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'delete',
      entity: 'lead_assignment_force',
      details: {
        week_id: weekId,
        missing_id: missingId,
        removed_count: removed
      }
    });

    return res.json({
      ok: true,
      week_id: weekId,
      removed_count: removed,
      missing_marks: bucket.missing_marks,
      forced_assignments: bucket.forced_assignments
    });
  });

  return router;
}
