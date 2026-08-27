import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const LEAD_ASSIGNMENT_BOARD_KEY = 'lead_assignment_board';
let mediWeeklyToken = '';
let mediWeeklyTokenAt = 0;
let mediWeeklyLastPullAt = 0;
let mediWeeklyLastError = '';
let mediScheduleToken = '';
let mediScheduleTokenAt = 0;
let mediScheduleLastPullAt = 0;
let mediScheduleLastError = '';
let mediScheduleLastResult = { configured: false, updated: false, error: '' };
let liveSyncStarted = false;
let liveSyncPromise = null;

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

function syncClinicMentorInfo(db, state) {
  const byDay = state?.clinicMentorsByDay;
  if (!byDay || typeof byDay !== 'object') return 0;

  const dayAliases = {
    '월': 'Mon', '화': 'Tue', '수': 'Wed', '목': 'Thu', '금': 'Fri', '토': 'Sat', '일': 'Sun',
    Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun'
  };
  const clinicByName = new Map();
  for (const [rawDay, rows] of Object.entries(byDay)) {
    const day = dayAliases[String(rawDay || '').trim()];
    if (!day || !Array.isArray(rows)) continue;
    for (const row of rows) {
      const name = String(row?.name || '').trim();
      if (!name) continue;
      let mentor = clinicByName.get(name);
      if (!mentor) {
        mentor = {
          mentor_id: '',
          name,
          role: 'mentor',
          note: '',
          subjects: [],
          schedule: { Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: [] }
        };
        clinicByName.set(name, mentor);
      }
      const note = String(row?.note || '').trim();
      if (note) mentor.note = note;
      const time = String(row?.time || '').trim();
      if (time && !mentor.schedule[day].some((item) => item.time === time)) {
        mentor.schedule[day].push({ time, title: '클리닉 멘토 근무', type: 'mentor' });
      }
    }
  }
  if (!clinicByName.size) return 0;

  ensureAppSettingsTable(db);
  const existingRow = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get('mentor_info');
  let existing = {};
  try { existing = JSON.parse(existingRow?.value_json || '{}'); } catch { existing = {}; }
  const existingMentors = Array.isArray(existing?.mentors) ? existing.mentors : [];
  const retained = existingMentors.filter((mentor) => String(mentor?.role || 'mentor') !== 'mentor');
  for (const mentor of clinicByName.values()) {
    const previous = existingMentors.find((item) =>
      String(item?.role || 'mentor') === 'mentor' && String(item?.name || '').trim() === mentor.name
    );
    if (previous) {
      mentor.mentor_id = String(previous.mentor_id || '').trim();
      mentor.subjects = Array.isArray(previous.subjects) ? previous.subjects : [];
    }
  }
  const normalized = {
    updatedAt: new Date().toISOString(),
    mentors: [...retained, ...clinicByName.values()]
  };
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=datetime('now')
  `).run('mentor_info', JSON.stringify(normalized));
  return clinicByName.size;
}

function parsePayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return { students: payload };
  if (Array.isArray(payload.students)) return payload;
  return null;
}

function ensureLeadMentoringStatusTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_mentoring_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_date TEXT NOT NULL,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      mentor_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('completed','missed')),
      reason TEXT,
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(assignment_date, student_id, week_id, mentor_name)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_mentoring_status_date_mentor
      ON lead_mentoring_status(assignment_date, mentor_name, status);
  `);
}

function ensureLeadMentoringReassignmentTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_mentoring_reassignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      source_assignment_date TEXT NOT NULL,
      source_mentor_name TEXT NOT NULL,
      target_assignment_date TEXT NOT NULL,
      target_mentor_name TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(week_id, student_id, source_assignment_date, source_mentor_name)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_reassignments_target
      ON lead_mentoring_reassignments(week_id, target_assignment_date, target_mentor_name);
  `);
}

function koreanDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const dayMap = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
  return { date: `${pick('year')}-${pick('month')}-${pick('day')}`, day: dayMap[pick('weekday')] || '' };
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

function resolveCurrentWeek(db, dateText) {
  return db.prepare(`
    SELECT * FROM weeks
    WHERE date(?) BETWEEN date(start_date) AND date(end_date)
    ORDER BY id DESC LIMIT 1
  `).get(dateText) || db.prepare('SELECT * FROM weeks ORDER BY id DESC LIMIT 1').get();
}

function dateForWeekDay(week, dayLabel, fallbackDate = '') {
  const startMatch = String(week?.start_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endText = String(week?.end_date || '').slice(0, 10);
  if (!startMatch || !DAY_LABELS.includes(dayLabel)) return fallbackDate;
  const start = new Date(Date.UTC(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])));
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    const dateText = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (endText && dateText > endText) break;
    const label = DAY_LABELS[(date.getUTCDay() + 6) % 7];
    if (label === dayLabel) return dateText;
  }
  return String(week?.start_date || '').slice(0, 10) || fallbackDate;
}

function resolveLeadTodayWeek(db, requestedWeekId, today) {
  const weekId = parsePositiveInt(requestedWeekId);
  if (weekId) {
    const selected = db.prepare('SELECT * FROM weeks WHERE id=?').get(weekId);
    if (selected?.id) return selected;
  }
  return resolveCurrentWeek(db, today.date);
}

function resolveLeadAssignmentDate(db, weekId, requestedDate) {
  const week = db.prepare('SELECT * FROM weeks WHERE id=?').get(weekId);
  const dateText = String(requestedDate || '').slice(0, 10);
  if (week?.id && /^\d{4}-\d{2}-\d{2}$/.test(dateText)
    && dateText >= String(week.start_date || '').slice(0, 10)
    && dateText <= String(week.end_date || '').slice(0, 10)) return dateText;
  const today = koreanDateParts();
  return week?.id ? dateForWeekDay(week, today.day, today.date) : today.date;
}

function periodDateRange(value) {
  const dates = String(value || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
  return dates.length >= 2 ? { start: dates[0], end: dates[1] } : null;
}

function periodMatchesWeek(value, weekStart, weekEnd) {
  const start = String(weekStart || '').slice(0, 10);
  const end = String(weekEnd || '').slice(0, 10);
  const range = periodDateRange(value);
  if (range) return range.start === start && range.end === end;
  const compactDates = String(value || '').match(/\d{1,2}\/\d{1,2}/g) || [];
  if (compactDates.length < 2) return false;
  const compact = (dateText) => {
    const match = String(dateText || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${Number(match[1])}/${Number(match[2])}`;
  };
  return compactDates[0] === compact(start) && compactDates[1] === compact(end);
}

function assignmentsForWeek(source, week, todayDate) {
  const start = String(week?.start_date || '').slice(0, 10);
  const end = String(week?.end_date || '').slice(0, 10);
  const byPeriod = source?.assignments_by_period && typeof source.assignments_by_period === 'object'
    ? source.assignments_by_period
    : {};
  for (const [periodId, assignments] of Object.entries(byPeriod)) {
    if (periodMatchesWeek(periodId, start, end) && Array.isArray(assignments) && assignments.length) {
      return assignments;
    }
  }
  if (periodMatchesWeek(source?.periodId, start, end) && Array.isArray(source?.assignments)) {
    return source.assignments;
  }
  if (todayDate >= start && todayDate <= end && Array.isArray(source?.assignments)) return source.assignments;
  return [];
}

function weekDateEntries(week) {
  const startMatch = String(week?.start_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endText = String(week?.end_date || '').slice(0, 10);
  if (!startMatch) return [];
  const start = new Date(Date.UTC(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])));
  const entries = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    const dateText = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (endText && dateText > endText) break;
    entries.push({ date: dateText, day_label: DAY_LABELS[(date.getUTCDay() + 6) % 7] });
  }
  return entries;
}

function loadWrongAnswerQuestionCounts(db, weekId) {
  const rows = db.prepare(
    'SELECT student_id, e_wrong_answer_distribution FROM week_records WHERE week_id=? AND e_wrong_answer_distribution IS NOT NULL'
  ).all(weekId);
  const counts = new Map();
  for (const row of rows) {
    const distribution = safeJson(row.e_wrong_answer_distribution, {});
    const problems = Array.isArray(distribution?.problems) ? distribution.problems : [];
    const count = problems.filter((problem, index) => {
      if (!problem || typeof problem !== 'object' || String(problem.deleted_at || '').trim()) return false;
      if (!String(problem.submitted_at || '').trim()) return false;
      const assignment = problem.assignment || (index === 0 ? distribution.assignment : null);
      return Boolean(String(assignment?.mentor_name || '').trim());
    }).length;
    counts.set(Number(row.student_id), count);
  }
  return counts;
}

function buildLeadRowsForDay(db, { week, assignmentDate, dayLabel, currentDate, source, students, questionCounts }) {
  const rows = [];
  const weekAssignments = assignmentsForWeek(source, week, currentDate);
  for (const raw of weekAssignments) {
    const mentorName = firstNonEmptyText(raw?.lead_mentor, raw?.leadMentor, raw?.mentor);
    if (!mentorName) continue;
    const days = normalizeDays(raw?.scheduledDays).map(normalizeDayLabel).filter(Boolean);
    if (!days.includes(dayLabel)) continue;
    const studentId = parsePositiveInt(raw?.student_id);
    const student = students.get(studentId);
    if (!student) continue;
    rows.push({
      student_id: studentId,
      external_id: student.external_id || '',
      student_name: student.name || raw?.name || '',
      grade: student.grade || '',
      mentor_name: mentorName,
      schedule: safeJson(student.schedule_json, {}),
      schedule_updated_at: student.updated_at || '',
      question_count: Number(questionCounts.get(studentId) || 0),
      forced: false,
      reassigned: false
    });
  }

  const state = loadLeadAssignmentBoardState(db);
  const bucket = getBoardWeekBucket(state, week.id);
  for (const forced of bucket.forced_assignments || []) {
    if (normalizeDayLabel(forced.target_day_label) !== dayLabel) continue;
    const studentId = parsePositiveInt(forced.student_id);
    const student = students.get(studentId);
    const mentorName = String(forced.target_mentor_name || '').trim();
    if (!student || !mentorName) continue;
    const duplicate = rows.some((row) => row.student_id === studentId && row.mentor_name === mentorName);
    if (!duplicate) rows.push({
      student_id: studentId,
      external_id: student.external_id || '',
      student_name: student.name || '',
      grade: student.grade || '',
      mentor_name: mentorName,
      schedule: safeJson(student.schedule_json, {}),
      schedule_updated_at: student.updated_at || '',
      question_count: Number(questionCounts.get(studentId) || 0),
      forced: true,
      forced_time: forced.target_time || '',
      reassigned: false
    });
  }

  ensureLeadMentoringReassignmentTable(db);
  const reassignments = db.prepare(`
    SELECT id, student_id, source_assignment_date, source_mentor_name,
           target_assignment_date, target_mentor_name, created_at
    FROM lead_mentoring_reassignments
    WHERE week_id=? AND target_assignment_date=?
    ORDER BY created_at
  `).all(week.id, assignmentDate);
  for (const reassignment of reassignments) {
    const studentId = parsePositiveInt(reassignment.student_id);
    const student = students.get(studentId);
    const mentorName = String(reassignment.target_mentor_name || '').trim();
    if (!student || !mentorName) continue;
    const duplicate = rows.find((row) => row.student_id === studentId && row.mentor_name === mentorName);
    if (duplicate) {
      duplicate.reassigned = true;
      duplicate.reassignment = reassignment;
      continue;
    }
    rows.push({
      student_id: studentId,
      external_id: student.external_id || '',
      student_name: student.name || '',
      grade: student.grade || '',
      mentor_name: mentorName,
      schedule: safeJson(student.schedule_json, {}),
      schedule_updated_at: student.updated_at || '',
      question_count: Number(questionCounts.get(studentId) || 0),
      forced: false,
      reassigned: true,
      reassignment
    });
  }

  const statuses = db.prepare(`
    SELECT student_id, mentor_name, status, reason, updated_at
    FROM lead_mentoring_status WHERE assignment_date=? AND week_id=?
  `).all(assignmentDate, week.id);
  const statusMap = new Map(statuses.map((item) => [`${item.student_id}:${item.mentor_name}`, item]));
  return rows.map((row) => ({ ...row, status: statusMap.get(`${row.student_id}:${row.mentor_name}`) || null }));
}

function mentorNameKey(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function isDirectorMentorName(value, directorNames = new Set()) {
  const key = mentorNameKey(value);
  if (!key) return false;
  if (key.includes('원장') || key === 'director') return true;
  return directorNames.has(key);
}

function buildDirectorConsultingRows({ week, currentDate, source, students, questionCounts, directorNames }) {
  const rows = [];
  for (const raw of assignmentsForWeek(source, week, currentDate)) {
    const mentorName = firstNonEmptyText(raw?.lead_mentor, raw?.leadMentor, raw?.mentor);
    if (!isDirectorMentorName(mentorName, directorNames)) continue;
    const studentId = parsePositiveInt(raw?.student_id);
    const student = students.get(studentId);
    if (!student) continue;
    rows.push({
      student_id: studentId,
      external_id: student.external_id || '',
      student_name: student.name || raw?.name || '',
      grade: student.grade || '',
      mentor_name: mentorName,
      consulting_days: Array.from(new Set(normalizeDays(raw?.scheduledDays).map(normalizeDayLabel).filter(Boolean))),
      schedule: safeJson(student.schedule_json, {}),
      schedule_updated_at: student.updated_at || '',
      question_count: Number(questionCounts.get(studentId) || 0)
    });
  }
  return rows.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || ''), 'ko'));
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
  const englishDay = { mon: '월', monday: '월', tue: '화', tuesday: '화', wed: '수', wednesday: '수', thu: '목', thursday: '목', fri: '금', friday: '금', sat: '토', saturday: '토', sun: '일', sunday: '일' };
  if (englishDay[raw.toLowerCase()]) return englishDay[raw.toLowerCase()];
  if (raw === '월요일') return '월';
  if (raw === '화요일') return '화';
  if (raw === '수요일') return '수';
  if (raw === '목요일') return '목';
  if (raw === '금요일') return '금';
  if (raw === '토요일') return '토';
  if (raw === '일요일') return '일';
  const koreanDay = raw.match(/(?:^|[\s,(/])(?:([월화수목금토일])요일|([월화수목금토일]))(?=$|[\s,()/.:-])/);
  if (koreanDay?.[1] || koreanDay?.[2]) return koreanDay[1] || koreanDay[2];
  const englishMatch = raw.toLowerCase().match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/);
  if (englishMatch?.[1]) return englishDay[englishMatch[1]] || '';
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
          role: normalizeMentorRole(item?.role),
          schedule: item?.schedule && typeof item.schedule === 'object' ? item.schedule : {}
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

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(process.env.LIVE_SYNC_TIMEOUT_MS || 15000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function mondayForDate(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function addIsoDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildLiveScheduleJson(weekStart, rows) {
  const dayMap = { '월': 'Mon', '화': 'Tue', '수': 'Wed', '목': 'Thu', '금': 'Fri', '토': 'Sat', '일': 'Sun' };
  const result = {
    week_start: weekStart,
    week_range_text: `${weekStart} ~ ${addIsoDays(weekStart, 6)}`,
    Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [], Sun: []
  };
  for (const row of rows || []) {
    const day = dayMap[String(row?.day || '').trim()];
    if (!day) continue;
    const start = String(row?.start || '').trim();
    const end = String(row?.end || '').trim();
    if (!start || !end) continue;
    const type = String(row?.type || '').trim();
    const description = String(row?.description || '').trim();
    result[day].push({
      time: `${start}~${end}`,
      title: description ? `${type} ${description}`.trim() : type,
      type
    });
  }
  for (const day of Object.values(dayMap)) {
    result[day].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }
  return result;
}

async function pullMediSchedule(db, { force = false } = {}) {
  const baseUrl = String(process.env.MEDI_SCHEDULE_BASE_URL || '').trim().replace(/\/+$/, '');
  const username = String(process.env.MEDI_SCHEDULE_USERNAME || '').trim();
  const password = String(process.env.MEDI_SCHEDULE_PASSWORD || '').trim();
  const allowCreate = /^(1|true|yes|on)$/i.test(String(process.env.MEDI_SCHEDULE_ALLOW_CREATE || 'false').trim());
  const syncProfiles = /^(1|true|yes|on)$/i.test(String(process.env.MEDI_SCHEDULE_SYNC_PROFILES || 'false').trim());
  if (!baseUrl || !username || !password) return { configured: false, updated: false, error: '' };
  if (!force && Date.now() - mediScheduleLastPullAt < 30000) {
    return { ...mediScheduleLastResult, updated: false, error: mediScheduleLastError };
  }
  mediScheduleLastPullAt = Date.now();

  try {
    if (!mediScheduleToken || Date.now() - mediScheduleTokenAt > 10 * 60 * 1000) {
      const login = await fetchJson(`${baseUrl}/api/admin/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
      });
      mediScheduleToken = String(login?.token || '').trim();
      mediScheduleTokenAt = Date.now();
      if (!mediScheduleToken) throw new Error('메디 스케줄 인증 토큰이 없습니다.');
    }

    const weekStart = mondayForDate(koreanDateParts().date);
    let snapshot;
    try {
      snapshot = await fetchJson(`${baseUrl}/api/admin/studentschedules?weekStart=${encodeURIComponent(weekStart)}`, {
        headers: { Authorization: `Bearer ${mediScheduleToken}` }
      });
    } catch (error) {
      if (!/401|token|auth/i.test(String(error?.message || ''))) throw error;
      mediScheduleToken = '';
      mediScheduleTokenAt = 0;
      throw error;
    }

    const sourceStudents = Array.isArray(snapshot?.students) ? snapshot.students : [];
    const sourceSchedules = Array.isArray(snapshot?.schedules) ? snapshot.schedules : [];
    if (!sourceStudents.length) throw new Error('메디 스케줄 학생 목록이 비어 있습니다.');

    const schedulesByStudent = new Map();
    for (const row of sourceSchedules) {
      const key = String(row?.student_id ?? row?.student_code ?? '').trim();
      if (!key) continue;
      if (!schedulesByStudent.has(key)) schedulesByStudent.set(key, []);
      schedulesByStudent.get(key).push(row);
    }

    const byName = buildStudentsByName(db);
    const findByExternal = db.prepare('SELECT id, external_id, name, grade, student_phone, parent_phone, schedule_json FROM students WHERE external_id=?');
    const findById = db.prepare('SELECT id, external_id, name, grade, student_phone, parent_phone, schedule_json FROM students WHERE id=?');
    const insertStudent = db.prepare(`
      INSERT INTO students
        (external_id, name, grade, student_phone, parent_phone, schedule_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const updateSchedule = db.prepare(`
      UPDATE students
      SET schedule_json=?, updated_at=datetime('now')
      WHERE id=?
    `);
    const updateStudentProfileAndSchedule = db.prepare(`
      UPDATE students
      SET external_id=?, name=?, grade=?, student_phone=?, parent_phone=?, schedule_json=?, updated_at=datetime('now')
      WHERE id=?
    `);
    let matched = 0;
    let changed = 0;
    let created = 0;
    const unmatched = [];
    const applyRows = db.transaction(() => {
      for (const raw of sourceStudents) {
        const sourceId = String(raw?.id ?? '').trim();
        let student = sourceId ? findByExternal.get(sourceId) : null;
        if (!student && /^\d+$/.test(sourceId)) {
          const byInternalId = findById.get(Number(sourceId));
          if (byInternalId && String(byInternalId.name || '').trim() === String(raw?.name || '').trim()) {
            student = byInternalId;
          }
        }
        if (!student) {
          const nameMatches = byName.get(String(raw?.name || '').trim()) || [];
          if (nameMatches.length === 1) student = nameMatches[0];
        }
        const scheduleJson = JSON.stringify(buildLiveScheduleJson(weekStart, schedulesByStudent.get(sourceId) || []));
        if (!student) {
          const name = String(raw?.name || '').trim();
          if (!allowCreate || !sourceId || !name) {
            unmatched.push({ external_id: sourceId, name });
            continue;
          }
          const inserted = insertStudent.run(
            sourceId,
            name,
            String(raw?.grade || '').trim(),
            String(raw?.studentPhone || '').trim(),
            String(raw?.parentPhone || '').trim(),
            scheduleJson
          );
          student = { id: Number(inserted.lastInsertRowid), external_id: sourceId, name, schedule_json: scheduleJson };
          created += 1;
          changed += 1;
          matched += 1;
          continue;
        }
        matched += 1;
        if (!syncProfiles) {
          if (scheduleJson !== String(student.schedule_json || '')) {
            updateSchedule.run(scheduleJson, student.id);
            changed += 1;
          }
          continue;
        }
        const next = {
          external_id: String(student.external_id || sourceId).trim(),
          name: String(raw?.name || student.name || '').trim(),
          grade: String(raw?.grade || student.grade || '').trim(),
          student_phone: String(raw?.studentPhone || student.student_phone || '').trim(),
          parent_phone: String(raw?.parentPhone || student.parent_phone || '').trim()
        };
        const hasChange =
          next.external_id !== String(student.external_id || '') ||
          next.name !== String(student.name || '') ||
          next.grade !== String(student.grade || '') ||
          next.student_phone !== String(student.student_phone || '') ||
          next.parent_phone !== String(student.parent_phone || '') ||
          scheduleJson !== String(student.schedule_json || '');
        if (hasChange) {
          updateStudentProfileAndSchedule.run(
            next.external_id,
            next.name,
            next.grade,
            next.student_phone,
            next.parent_phone,
            scheduleJson,
            student.id
          );
          changed += 1;
        }
      }
    });
    applyRows();

    mediScheduleLastError = unmatched.length
      ? `메디 스케줄 학생 매칭 불일치 (${matched}/${sourceStudents.length})`
      : '';
    mediScheduleLastResult = {
      configured: true,
      updated: changed > 0,
      matched,
      created,
      source_students: sourceStudents.length,
      schedule_rows: sourceSchedules.length,
      week_start: weekStart,
      allow_create: allowCreate,
      sync_profiles: syncProfiles,
      error: mediScheduleLastError
    };
    return mediScheduleLastResult;
  } catch (error) {
    mediScheduleLastError = String(error?.message || '메디 스케줄 동기화 실패');
    mediScheduleLastResult = { configured: true, updated: false, error: mediScheduleLastError };
    return mediScheduleLastResult;
  }
}

async function pullMediWeeklyAssignments(db) {
  const baseUrl = String(process.env.MEDI_WEEKLY_BASE_URL || '').trim().replace(/\/+$/, '');
  const username = String(process.env.MEDI_WEEKLY_USERNAME || '').trim();
  const password = String(process.env.MEDI_WEEKLY_PASSWORD || '').trim();
  const jwtSecret = String(process.env.MEDI_WEEKLY_JWT_SECRET || '').trim();
  if (!baseUrl || !username || (!password && !jwtSecret)) return { configured: false, updated: false, error: '' };
  if (Date.now() - mediWeeklyLastPullAt < 30000) {
    return { configured: true, updated: false, error: mediWeeklyLastError };
  }
  mediWeeklyLastPullAt = Date.now();

  try {
    if (!mediWeeklyToken || Date.now() - mediWeeklyTokenAt > 10 * 60 * 1000) {
      if (jwtSecret) {
        mediWeeklyToken = jwt.sign({ username }, jwtSecret, { expiresIn: '12m' });
      } else {
        const login = await fetchJson(`${baseUrl}/api/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
        });
        mediWeeklyToken = String(login?.token || '').trim();
      }
      mediWeeklyTokenAt = Date.now();
      if (!mediWeeklyToken) throw new Error('메디위클리 인증 토큰이 없습니다.');
    }

    let snapshot;
    try {
      snapshot = await fetchJson(`${baseUrl}/api/state`, { headers: { Authorization: `Bearer ${mediWeeklyToken}` } });
    } catch (error) {
      if (!/401|token|auth/i.test(String(error?.message || ''))) throw error;
      mediWeeklyToken = '';
      mediWeeklyTokenAt = 0;
      throw error;
    }
    const state = snapshot?.state || {};
    syncClinicMentorInfo(db, state);
    const periodId = firstNonEmptyText(state.selectedPeriod, state.currentPeriodId, state.periods?.[state.periods.length - 1]?.id);
    if (!periodId || !Array.isArray(state.students)) throw new Error('메디위클리의 현재 배정 회차를 찾지 못했습니다.');

    const byName = buildStudentsByName(db);
    const findByExternal = db.prepare('SELECT id, external_id, name FROM students WHERE external_id=?');
    const findById = db.prepare('SELECT id, external_id, name FROM students WHERE id=?');
    const buildPeriodAssignments = (targetPeriodId) => {
      const assignments = [];
      let sourceAssignedCount = 0;
      for (const raw of state.students) {
        if (raw?.mentoringOptOut === true) continue;
        const record = raw?.mentorHistory?.[targetPeriodId] || {};
        const mentor = firstNonEmptyText(
          record.actualMentor,
          record.mentor,
          targetPeriodId === periodId ? raw.fixedMentor : ''
        );
        if (!mentor) continue;
        sourceAssignedCount += 1;
        let student = null;
        for (const candidate of normalizedIdCandidates(raw?.id ?? raw?.external_id)) {
          student = findByExternal.get(candidate);
          if (student) break;
          const numeric = Number(candidate);
          if (Number.isSafeInteger(numeric) && String(numeric) === candidate) student = findById.get(numeric);
          if (student) break;
        }
        if (!student) {
          const matches = byName.get(String(raw?.name || '').trim()) || [];
          if (matches.length === 1) student = matches[0];
        }
        if (!student) continue;
        let scheduledDays = normalizeDays(record.day || (targetPeriodId === periodId ? raw.selectedMentorDay : ''))
          .map(normalizeDayLabel)
          .filter(Boolean);
        if (!scheduledDays.length && targetPeriodId === periodId) {
          scheduledDays = DAY_LABELS.filter((day) =>
            (Array.isArray(state?.mentorsByDay?.[day]) ? state.mentorsByDay[day] : []).some(
              (item) => String(item?.name || '').trim() === mentor
            )
          );
        }
        assignments.push({ student_id: student.id, external_id: student.external_id || '', name: student.name || raw?.name || '', mentor, lead_mentor: mentor, scheduledDays });
      }
      return { assignments, sourceAssignedCount };
    };

    const periodIds = Array.from(new Set([
      ...((Array.isArray(state.periods) ? state.periods : []).map((item) => firstNonEmptyText(item?.id, item)).filter(Boolean)),
      periodId
    ]));
    const previousSource = loadAssignments(db) || {};
    const assignmentsByPeriod = previousSource.assignments_by_period && typeof previousSource.assignments_by_period === 'object'
      ? { ...previousSource.assignments_by_period }
      : {};
    let currentResult = { assignments: [], sourceAssignedCount: 0 };
    for (const targetPeriodId of periodIds) {
      const result = buildPeriodAssignments(targetPeriodId);
      if (result.sourceAssignedCount > 0 || !Array.isArray(assignmentsByPeriod[targetPeriodId])) {
        assignmentsByPeriod[targetPeriodId] = result.assignments;
      }
      if (targetPeriodId === periodId) currentResult = result;
    }
    const assignments = currentResult.assignments;
    const sourceAssignedCount = currentResult.sourceAssignedCount;
    if (sourceAssignedCount > 0 && assignments.length !== sourceAssignedCount) {
      throw new Error(`메디위클리 학생 매칭 불일치 (${assignments.length}/${sourceAssignedCount})`);
    }
    saveAssignments(db, {
      periodId,
      exportedAt: snapshot?.updatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'medi-weekly-live',
      assignments,
      assignments_by_period: assignmentsByPeriod
    });
    mediWeeklyLastError = '';
    return { configured: true, updated: true, error: '' };
  } catch (error) {
    mediWeeklyLastError = String(error?.message || '메디위클리 동기화 실패');
    return { configured: true, updated: false, error: mediWeeklyLastError };
  }
}

export async function refreshMediWeeklyMentorInfo(db) {
  if (liveSyncPromise) {
    await liveSyncPromise;
    return { configured: true, updated: false, error: mediWeeklyLastError };
  }
  return pullMediWeeklyAssignments(db);
}

async function syncLiveSources(db, { force = false } = {}) {
  if (liveSyncPromise) return liveSyncPromise;
  if (force) {
    mediWeeklyLastPullAt = 0;
    mediScheduleLastPullAt = 0;
  }
  liveSyncPromise = pullMediSchedule(db, { force })
    .then(async (schedule) => ({ schedule, weekly: await pullMediWeeklyAssignments(db) }))
    .finally(() => { liveSyncPromise = null; });
  return liveSyncPromise;
}

export default function mentorAssignmentsRoutes(db) {
  const router = express.Router();

  if (!liveSyncStarted) {
    liveSyncStarted = true;
    const intervalMs = Math.max(15000, Number(process.env.LIVE_SYNC_INTERVAL_MS || 60000));
    const initialTimer = setTimeout(() => {
      syncLiveSources(db, { force: true }).catch((error) => console.error('[live-sync] initial sync failed:', error));
    }, 1000);
    initialTimer.unref?.();
    const interval = setInterval(() => {
      syncLiveSources(db, { force: true }).catch((error) => console.error('[live-sync] interval sync failed:', error));
    }, intervalMs);
    interval.unref?.();
  }

  router.get('/lead-today', requireRole('director', 'admin', 'lead'), async (req, res) => {
    ensureLeadMentoringStatusTable(db);
    const liveSources = await syncLiveSources(db);
    const liveSync = liveSources.weekly;
    const scheduleSync = liveSources.schedule;
    const today = koreanDateParts();
    const week = resolveLeadTodayWeek(db, req.query.weekId || req.query.week_id, today);
    const assignmentDate = week?.id ? dateForWeekDay(week, today.day, today.date) : today.date;
    if (!week?.id) return res.json({ date: assignmentDate, day_label: today.day, week: null, lead_mentors: [], assignments: [] });

    const source = loadAssignments(db) || {};
    const mentorInfo = loadMentorInfoSetting(db);
    const directorNames = new Set(
      (mentorInfo.mentors || [])
        .filter((item) => item.role === 'director')
        .map((item) => mentorNameKey(item.name))
        .filter(Boolean)
    );
    const leads = new Set(
      (mentorInfo.mentors || []).filter((item) => item.role === 'lead').map((item) => item.name).filter(Boolean)
    );
    const studentRows = db.prepare('SELECT id, external_id, name, grade, schedule_json, updated_at FROM students').all();
    const students = new Map(studentRows.map((student) => [Number(student.id), student]));
    const weekAssignments = assignmentsForWeek(source, week, today.date);
    for (const raw of weekAssignments) {
      const mentorName = firstNonEmptyText(raw?.lead_mentor, raw?.leadMentor, raw?.mentor);
      if (mentorName && !isDirectorMentorName(mentorName, directorNames)) leads.add(mentorName);
    }
    const questionCounts = loadWrongAnswerQuestionCounts(db, week.id);
    const weekRows = [];
    for (const entry of weekDateEntries(week)) {
      const dayRows = buildLeadRowsForDay(db, {
        week,
        assignmentDate: entry.date,
        dayLabel: entry.day_label,
        currentDate: today.date,
        source,
        students,
        questionCounts
      });
      for (const row of dayRows) {
        if (isDirectorMentorName(row.mentor_name, directorNames)) continue;
        const scopedRow = { ...row, assignment_date: entry.date, day_label: entry.day_label };
        weekRows.push(scopedRow);
        leads.add(row.mentor_name);
      }
    }

    // 회차 전체 화면에서는 여러 출근 요일 때문에 같은 배정 학생을 중복 집계하지 않는다.
    const uniqueWeekRows = [];
    const uniqueAssignmentKeys = new Set();
    for (const row of weekRows) {
      const assignmentKey = `${row.student_id}:${mentorNameKey(row.mentor_name)}`;
      if (uniqueAssignmentKeys.has(assignmentKey)) continue;
      uniqueAssignmentKeys.add(assignmentKey);
      uniqueWeekRows.push(row);
    }
    weekRows.length = 0;
    weekRows.push(...uniqueWeekRows);

    // 배정 요일이 비어 있어도 배정된 학생을 누락하지 않는다.
    // 날짜별 빌더에서 이미 만들어진 학생은 유지하고, 빠진 원본 배정만 한 번 보충한다.
    const representedAssignments = new Set(
      weekRows.map((row) => `${row.student_id}:${mentorNameKey(row.mentor_name)}`)
    );
    const statusForAssignment = db.prepare(`
      SELECT assignment_date, status, reason, updated_at
      FROM lead_mentoring_status
      WHERE week_id=? AND student_id=? AND mentor_name=?
      ORDER BY updated_at DESC, assignment_date DESC
      LIMIT 1
    `);
    for (const raw of weekAssignments) {
      const mentorName = firstNonEmptyText(raw?.lead_mentor, raw?.leadMentor, raw?.mentor);
      if (!mentorName || isDirectorMentorName(mentorName, directorNames)) continue;
      const studentId = parsePositiveInt(raw?.student_id);
      const student = students.get(studentId);
      if (!student) continue;
      const assignmentKey = `${studentId}:${mentorNameKey(mentorName)}`;
      if (representedAssignments.has(assignmentKey)) continue;
      const scheduledDay = normalizeDays(raw?.scheduledDays).map(normalizeDayLabel).find(Boolean) || '';
      const savedStatus = statusForAssignment.get(week.id, studentId, mentorName) || null;
      const fallbackDate = savedStatus?.assignment_date
        || (scheduledDay ? dateForWeekDay(week, scheduledDay, week.start_date) : week.start_date);
      weekRows.push({
        student_id: studentId,
        external_id: student.external_id || '',
        student_name: student.name || raw?.name || '',
        grade: student.grade || '',
        mentor_name: mentorName,
        schedule: safeJson(student.schedule_json, {}),
        schedule_updated_at: student.updated_at || '',
        question_count: Number(questionCounts.get(studentId) || 0),
        forced: false,
        reassigned: false,
        assignment_date: fallbackDate,
        day_label: scheduledDay,
        schedule_missing: !scheduledDay,
        status: savedStatus
      });
      representedAssignments.add(assignmentKey);
      leads.add(mentorName);
    }
    weekRows.sort((a, b) => String(a.assignment_date || '').localeCompare(String(b.assignment_date || ''))
      || String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''), 'ko')
      || String(a.student_name || '').localeCompare(String(b.student_name || ''), 'ko'));
    const weeklyAssignmentCounts = { all: weekRows.length };
    for (const row of weekRows) {
      weeklyAssignmentCounts[row.mentor_name] = (weeklyAssignmentCounts[row.mentor_name] || 0) + 1;
    }
    const assignments = weekRows;
    const directorConsultingAssignments = req.user.role === 'director'
      ? buildDirectorConsultingRows({
          week,
          currentDate: today.date,
          source,
          students,
          questionCounts,
          directorNames
        })
      : [];

    return res.json({
      date: assignmentDate,
      day_label: today.day,
      week,
      source_updated_at: source.updatedAt || '',
      source: source.source || 'portal-import',
      live_sync: liveSync,
      schedule_sync: scheduleSync,
      viewer: { role: req.user.role, display_name: req.user.display_name || '' },
      view_scope: 'week',
      lead_mentors: Array.from(leads).sort((a, b) => a.localeCompare(b, 'ko')),
      lead_mentor_details: Array.from(leads).map((name) => {
        const info = (mentorInfo.mentors || []).find((item) => item.name === name);
        return { name, schedule: info?.schedule || {} };
      }),
      weekly_assignment_counts: weeklyAssignmentCounts,
      ...(req.user.role === 'director' ? {
        director_consulting_assignments: directorConsultingAssignments,
        director_consulting_count: directorConsultingAssignments.length
      } : {}),
      assignments
    });
  });

  router.get('/lead-week-status', requireRole('director', 'admin'), async (req, res) => {
    ensureLeadMentoringStatusTable(db);
    ensureLeadMentoringReassignmentTable(db);
    const liveSources = await syncLiveSources(db);
    const today = koreanDateParts();
    const week = resolveLeadTodayWeek(db, req.query.weekId || req.query.week_id, today);
    if (!week?.id) return res.status(404).json({ error: '회차를 찾지 못했습니다.' });

    const source = loadAssignments(db) || {};
    const mentorInfo = loadMentorInfoSetting(db);
    const studentRows = db.prepare('SELECT id, external_id, name, grade, schedule_json, updated_at FROM students').all();
    const students = new Map(studentRows.map((student) => [Number(student.id), student]));
    const questionCounts = loadWrongAnswerQuestionCounts(db, week.id);
    const days = weekDateEntries(week).map((entry) => ({
      ...entry,
      assignments: buildLeadRowsForDay(db, {
        week,
        assignmentDate: entry.date,
        dayLabel: entry.day_label,
        currentDate: today.date,
        source,
        students,
        questionCounts
      })
    }));
    const assignments = days.flatMap((day) => day.assignments.map((row) => ({
      ...row,
      assignment_date: day.date,
      day_label: day.day_label
    })));
    const leads = new Set(
      (mentorInfo.mentors || []).filter((item) => item.role === 'lead').map((item) => item.name).filter(Boolean)
    );
    for (const row of assignments) leads.add(row.mentor_name);

    return res.json({
      week,
      days,
      assignments,
      lead_mentors: Array.from(leads).sort((a, b) => a.localeCompare(b, 'ko')),
      lead_mentor_details: Array.from(leads).map((name) => {
        const info = (mentorInfo.mentors || []).find((item) => item.name === name);
        return { name, schedule: info?.schedule || {} };
      }),
      source_updated_at: source.updatedAt || '',
      live_sync: liveSources.weekly,
      schedule_sync: liveSources.schedule
    });
  });

  router.post('/lead-today/reassign', requireRole('director', 'admin', 'lead'), (req, res) => {
    ensureLeadMentoringStatusTable(db);
    ensureLeadMentoringReassignmentTable(db);
    const weekId = parsePositiveInt(req.body?.week_id);
    const studentId = parsePositiveInt(req.body?.student_id);
    const sourceDate = String(req.body?.source_assignment_date || '').slice(0, 10);
    const sourceMentorName = String(req.body?.source_mentor_name || '').trim();
    const targetDate = String(req.body?.target_assignment_date || '').slice(0, 10);
    const targetMentorName = String(req.body?.target_mentor_name || '').trim();
    if (!weekId || !studentId || !sourceDate || !sourceMentorName || !targetDate || !targetMentorName) {
      return res.status(400).json({ error: '재배정할 학생, 날짜, 총괄멘토 정보가 필요합니다.' });
    }
    const week = db.prepare('SELECT id, start_date, end_date FROM weeks WHERE id=?').get(weekId);
    if (!week?.id) return res.status(404).json({ error: '회차를 찾지 못했습니다.' });
    const weekStart = String(week.start_date || '').slice(0, 10);
    const weekEnd = String(week.end_date || '').slice(0, 10);
    if (targetDate < weekStart || targetDate > weekEnd) {
      return res.status(400).json({ error: '선택한 회차 안의 날짜로 재배정해 주세요.' });
    }
    const missed = db.prepare(`
      SELECT id FROM lead_mentoring_status
      WHERE assignment_date=? AND student_id=? AND week_id=? AND mentor_name=? AND status='missed'
    `).get(sourceDate, studentId, weekId, sourceMentorName);
    if (!missed?.id) return res.status(400).json({ error: '미진행 처리된 총괄멘토링만 재배정할 수 있습니다.' });

    db.prepare(`
      INSERT INTO lead_mentoring_reassignments
        (week_id, student_id, source_assignment_date, source_mentor_name,
         target_assignment_date, target_mentor_name, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(week_id, student_id, source_assignment_date, source_mentor_name) DO UPDATE SET
        target_assignment_date=excluded.target_assignment_date,
        target_mentor_name=excluded.target_mentor_name,
        created_by=excluded.created_by,
        updated_at=datetime('now')
    `).run(weekId, studentId, sourceDate, sourceMentorName, targetDate, targetMentorName, req.user.id);
    writeAudit(db, {
      user_id: req.user.id,
      action: 'update',
      entity: 'lead_mentoring_reassignment',
      details: {
        week_id: weekId,
        student_id: studentId,
        source_assignment_date: sourceDate,
        source_mentor_name: sourceMentorName,
        target_assignment_date: targetDate,
        target_mentor_name: targetMentorName
      }
    });
    return res.json({ ok: true });
  });

  router.put('/lead-today/status', requireRole('director', 'admin', 'lead'), (req, res) => {
    ensureLeadMentoringStatusTable(db);
    const studentId = parsePositiveInt(req.body?.student_id);
    const weekId = parsePositiveInt(req.body?.week_id);
    const mentorName = String(req.body?.mentor_name || '').trim();
    const requestedStatus = String(req.body?.status || 'pending').trim().toLowerCase();
    const status = ['pending', 'completed', 'missed'].includes(requestedStatus) ? requestedStatus : '';
    const reason = String(req.body?.reason || '').replace(/\r\n/g, '\n').trim().slice(0, 1000);
    if (!studentId || !weekId || !mentorName || !status) {
      return res.status(400).json({ error: '학생, 회차, 총괄멘토, 상태 정보가 필요합니다.' });
    }
    if (status === 'missed' && !reason) {
      return res.status(400).json({ error: '미진행 사유를 입력해 주세요.' });
    }
    const assignmentDate = resolveLeadAssignmentDate(db, weekId, req.body?.assignment_date);
    if (status === 'pending') {
      db.prepare(`
        DELETE FROM lead_mentoring_status
        WHERE assignment_date=? AND student_id=? AND week_id=? AND mentor_name=?
      `).run(assignmentDate, studentId, weekId, mentorName);
    } else {
      db.prepare(`
        INSERT INTO lead_mentoring_status
          (assignment_date, student_id, week_id, mentor_name, status, reason, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(assignment_date, student_id, week_id, mentor_name) DO UPDATE SET
          status=excluded.status, reason=excluded.reason, updated_by=excluded.updated_by, updated_at=datetime('now')
      `).run(assignmentDate, studentId, weekId, mentorName, status, status === 'missed' ? reason : null, req.user.id);
    }
    writeAudit(db, {
      user_id: req.user.id,
      action: 'update',
      entity: 'lead_mentoring_status',
      details: { student_id: studentId, week_id: weekId, mentor_name: mentorName, assignment_date: assignmentDate, status, reason: status === 'missed' ? reason : '' }
    });
    return res.json({ ok: true, status, reason: status === 'missed' ? reason : '' });
  });

  router.post('/lead-today/missed', requireRole('admin', 'lead'), (req, res) => {
    ensureLeadMentoringStatusTable(db);
    const studentId = parsePositiveInt(req.body?.student_id);
    const weekId = parsePositiveInt(req.body?.week_id);
    const mentorName = String(req.body?.mentor_name || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!studentId || !weekId || !mentorName) return res.status(400).json({ error: '학생과 총괄멘토 정보가 필요합니다.' });
    if (!reason) return res.status(400).json({ error: '미진행 사유를 반드시 입력해 주세요.' });
    const assignmentDate = resolveLeadAssignmentDate(db, weekId, req.body?.assignment_date);
    db.prepare(`
      INSERT INTO lead_mentoring_status
        (assignment_date, student_id, week_id, mentor_name, status, reason, updated_by, updated_at)
      VALUES (?, ?, ?, ?, 'missed', ?, ?, datetime('now'))
      ON CONFLICT(assignment_date, student_id, week_id, mentor_name) DO UPDATE SET
        status='missed', reason=excluded.reason, updated_by=excluded.updated_by, updated_at=datetime('now')
    `).run(assignmentDate, studentId, weekId, mentorName, reason, req.user.id);
    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'lead_mentoring_missed', details: { student_id: studentId, week_id: weekId, mentor_name: mentorName, reason, assignment_date: assignmentDate } });
    return res.json({ ok: true });
  });

  router.post('/lead-today/completed', requireRole('admin', 'lead'), (req, res) => {
    ensureLeadMentoringStatusTable(db);
    const studentId = parsePositiveInt(req.body?.student_id);
    const weekId = parsePositiveInt(req.body?.week_id);
    const mentorName = String(req.body?.mentor_name || '').trim();
    if (!studentId || !weekId || !mentorName) return res.status(400).json({ error: '학생과 총괄멘토 정보가 필요합니다.' });
    const assignmentDate = resolveLeadAssignmentDate(db, weekId, req.body?.assignment_date);
    db.prepare(`
      INSERT INTO lead_mentoring_status
        (assignment_date, student_id, week_id, mentor_name, status, reason, updated_by, updated_at)
      VALUES (?, ?, ?, ?, 'completed', NULL, ?, datetime('now'))
      ON CONFLICT(assignment_date, student_id, week_id, mentor_name) DO UPDATE SET
        status='completed', reason=NULL, updated_by=excluded.updated_by, updated_at=datetime('now')
    `).run(assignmentDate, studentId, weekId, mentorName, req.user.id);
    writeAudit(db, { user_id: req.user.id, action: 'workflow', entity: 'lead_mentoring_completed', details: { student_id: studentId, week_id: weekId, mentor_name: mentorName, assignment_date: assignmentDate } });
    return res.json({ ok: true });
  });

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

    const periodId = parsed.periodId ? String(parsed.periodId).trim() : '';
    const previous = loadAssignments(db) || {};
    const assignmentsByPeriod = previous.assignments_by_period && typeof previous.assignments_by_period === 'object'
      ? { ...previous.assignments_by_period }
      : {};
    if (periodId) assignmentsByPeriod[periodId] = assignments;
    const stored = {
      ...previous,
      periodId,
      exportedAt: parsed.exportedAt ? String(parsed.exportedAt).trim() : '',
      updatedAt: new Date().toISOString(),
      source: 'portal-import',
      assignments,
      assignments_by_period: assignmentsByPeriod
    };

    saveAssignments(db, stored);

    writeAudit(db, {
      user_id: req.user.id,
      action: 'import',
      entity: 'mentor_assignments',
      details: { stored: assignments.length, missing: missing.length, period_id: periodId, preserved_periods: Object.keys(assignmentsByPeriod).length }
    });

    return res.json({ data: stored, missing });
  });

  router.get('/lead-board', requireRole('director', 'admin', 'lead'), (req, res) => {
    const weekId = resolveWeekId(db, req.query.weekId || req.query.week_id);
    if (!weekId) return res.status(404).json({ error: 'Week not found' });

    const assignmentData = loadAssignments(db);
    const boardWeek = db.prepare('SELECT id, start_date, end_date FROM weeks WHERE id=?').get(weekId);
    const boardSourceAssignments = boardWeek?.id
      ? assignmentsForWeek(assignmentData || {}, boardWeek, koreanDateParts().date)
      : [];
    const assignments = Array.isArray(boardSourceAssignments)
      ? boardSourceAssignments.map((item) => ({
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
      .prepare('SELECT id, external_id, name, schedule_json FROM students')
      .all();
    const studentMap = new Map(
      studentRows.map((row) => [
        Number(row?.id || 0),
        {
          external_id: String(row?.external_id || '').trim(),
          name: String(row?.name || '').trim(),
          schedule: safeJson(row?.schedule_json, {})
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
      lead_mentor_details: leadMentors.map((name) => {
        const info = (mentorInfo.mentors || []).find((item) => String(item?.name || '').trim() === name);
        return { name, schedule: info?.schedule || {} };
      }),
      student_schedules: Object.fromEntries(
        Array.from(studentMap.entries()).map(([studentId, student]) => [String(studentId), student.schedule || {}])
      ),
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
