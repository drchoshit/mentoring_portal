import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

import { requireAuth } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import {
  MENTOR_BRIEFING_DEFAULT_EXPIRES_IN,
  MENTOR_BRIEFING_TTL_HOURS,
  signMentorBriefingToken,
  verifyMentorBriefingToken
} from '../lib/mentorBriefingToken.js';

const KO_DAY = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_ORDER_MAP = new Map([
  ['월', 1],
  ['화', 2],
  ['수', 3],
  ['목', 4],
  ['금', 5],
  ['토', 6],
  ['일', 7]
]);
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
const DEFAULT_SOLAPI_SENDER = '01055132733';

function isTruthyEnv(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('82') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

function maskPhoneNumber(value) {
  const digits = normalizePhoneNumber(value);
  if (!digits) return '';
  if (digits.length < 8) return digits;
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function getSolapiConfig() {
  const apiKey = String(process.env.SOLAPI_API_KEY || process.env.COOLSMS_API_KEY || '').trim();
  const apiSecret = String(process.env.SOLAPI_API_SECRET || process.env.COOLSMS_API_SECRET || '').trim();
  const senderNumber = normalizePhoneNumber(
    process.env.SOLAPI_SENDER_NUMBER || process.env.COOLSMS_SENDER_NUMBER || DEFAULT_SOLAPI_SENDER
  );
  const apiBase = String(process.env.SOLAPI_API_BASE || 'https://api.solapi.com').trim().replace(/\/+$/, '');

  return { apiKey, apiSecret, senderNumber, apiBase };
}

function buildSolapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${date}${salt}`)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function sendSolapiTextMessage({ to, from, text }) {
  const { apiKey, apiSecret, apiBase } = getSolapiConfig();
  if (!apiKey || !apiSecret) {
    throw new Error('SOLAPI API 인증키가 설정되지 않았습니다.');
  }
  if (!from) throw new Error('발신 번호가 설정되지 않았습니다.');
  if (!to) throw new Error('수신 번호가 필요합니다.');
  if (!text) throw new Error('문자 내용이 비어 있습니다.');

  const endpoint = `${apiBase}/messages/v4/send`;
  const authHeader = buildSolapiAuthHeader(apiKey, apiSecret);
  const bodyText = String(text || '').slice(0, 2000);
  const subject = String(bodyText.split('\n')[0] || '멘토링 포털 브리핑').slice(0, 40);
  const payload = {
    message: {
      to,
      from,
      type: 'LMS',
      subject,
      text: bodyText
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader
    },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    const message = String(
      data?.message ||
      data?.errorMessage ||
      data?.errorCode ||
      raw ||
      `HTTP ${response.status}`
    ).trim();
    throw new Error(`SOLAPI 전송 실패: ${message}`);
  }
  return data || { ok: true };
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

function toAbsoluteUrl(baseUrl, rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return value;
  if (value.startsWith('/')) return `${base}${value}`;
  return `${base}/${value}`;
}

function normalizeMentorKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMentorRole(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['mentor', 'lead', 'director', 'admin'].includes(raw)) return raw;
  return 'mentor';
}

function normalizeDayLabel(value) {
  const raw = String(value || '').trim();
  if (DAY_ORDER_MAP.has(raw)) return raw;
  return '';
}

function parseTimePart(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
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

function parseIsoDateValue(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function isDateWithinWeek(week, date) {
  const start = parseIsoDateValue(week?.start_date);
  const end = parseIsoDateValue(week?.end_date);
  if (!start || !end || !date) return false;
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return target >= startOnly && target <= endOnly;
}

function resolveAssignmentTargetWeekId(weeks, assignment, fallbackWeek = null) {
  const month = Number(assignment?.session_month || 0);
  const day = Number(assignment?.session_day || 0);
  const fallbackWeekId = Number(fallbackWeek?.id || 0) || 0;
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return fallbackWeekId;
  }

  const years = [];
  const addYear = (value) => {
    const year = Number(value);
    if (Number.isInteger(year) && !years.includes(year)) years.push(year);
  };

  addYear(parseIsoDateValue(fallbackWeek?.start_date)?.getFullYear());
  addYear(parseIsoDateValue(fallbackWeek?.end_date)?.getFullYear());
  addYear(new Date().getFullYear());

  for (const year of years) {
    const date = new Date(year, month - 1, day);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      continue;
    }
    const matchedWeek = (Array.isArray(weeks) ? weeks : []).find((week) => isDateWithinWeek(week, date));
    if (matchedWeek?.id) return Number(matchedWeek.id);
  }

  return fallbackWeekId;
}

function resolveSessionDayLabel(week, assignment) {
  const explicitDay = normalizeDayLabel(assignment?.session_day_label);
  if (explicitDay) return explicitDay;

  const month = Number(assignment?.session_month || 0);
  const day = Number(assignment?.session_day || 0);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return '-';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '-';
  const years = [];
  const addYear = (value) => {
    const year = Number(value);
    if (Number.isInteger(year) && !years.includes(year)) years.push(year);
  };
  addYear(parseIsoDateValue(week?.start_date)?.getFullYear());
  addYear(parseIsoDateValue(week?.end_date)?.getFullYear());
  addYear(new Date().getFullYear());
  const year = years[0];
  if (!year) return '-';
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return '-';
  return KO_DAY[date.getDay()] || '-';
}

function dayOrderValue(day) {
  const key = String(day || '').trim();
  return DAY_ORDER_MAP.get(key) || 99;
}

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

function ensureMentorBriefingTokensTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mentor_briefing_tokens (
      token_id TEXT PRIMARY KEY,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      mentor_name TEXT NOT NULL,
      mentor_key TEXT NOT NULL,
      mentor_role TEXT NOT NULL DEFAULT 'mentor',
      mentor_phone TEXT,
      pin_hash TEXT NOT NULL,
      issued_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      issued_by_role TEXT,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_accessed_at TEXT,
      revoked_at TEXT,
      revoked_by_user_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mentor_briefing_tokens_week_mentor
      ON mentor_briefing_tokens(week_id, mentor_key, revoked_at, expires_at);
  `);
}

function normalizeAssignment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mentorName = String(raw.mentor_name || '').trim();
  if (!mentorName) return null;
  const startTime = String(raw.session_start_time || raw.session_time || '').trim();
  return {
    mentor_name: mentorName,
    mentor_role: normalizeMentorRole(raw.mentor_role),
    session_day_label: normalizeDayLabel(raw.session_day_label),
    session_month: String(raw.session_month || '').replace(/\D/g, '').slice(0, 2),
    session_day: String(raw.session_day || '').replace(/\D/g, '').slice(0, 2),
    session_start_time: startTime,
    session_duration_minutes: Math.max(
      5,
      Math.min(240, Number(raw.session_duration_minutes || 20) || 20)
    ),
    assigned_at: String(raw.assigned_at || '').trim()
  };
}

function normalizeImage(raw, baseUrl) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const url = toAbsoluteUrl(baseUrl, raw.url);
  if (!id && !url) return null;
  return {
    id,
    url,
    filename: String(raw.filename || '').trim()
  };
}

function listWrongAnswerImagesByProblem(db, studentId, weekId, baseUrl) {
  const rows = db
    .prepare(
      `
      SELECT id, problem_index, filename, mime_type, created_at
      FROM wrong_answer_images
      WHERE student_id=? AND week_id=? AND deleted_at IS NULL
      ORDER BY problem_index, created_at, id
      `
    )
    .all(studentId, weekId);

  const byProblem = new Map();
  for (const row of rows) {
    const problemIndex = Math.max(0, Number(row?.problem_index || 0) || 0);
    if (!byProblem.has(problemIndex)) byProblem.set(problemIndex, []);
    byProblem.get(problemIndex).push({
      id: String(row?.id || '').trim(),
      filename: String(row?.filename || '').trim(),
      mime_type: String(row?.mime_type || '').trim(),
      uploaded_at: String(row?.created_at || '').trim(),
      url: toAbsoluteUrl(baseUrl, `/api/problem-upload/image/${encodeURIComponent(String(row?.id || '').trim())}`)
    });
  }
  return byProblem;
}

function mergeProblemImages(problemImages, tableImages, baseUrl) {
  const merged = [];
  const seen = new Set();

  const pushImage = (image) => {
    if (!image) return;
    const id = String(image.id || '').trim();
    const url = String(image.url || '').trim();
    const key = id || url;
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(image);
  };

  for (const img of Array.isArray(tableImages) ? tableImages : []) {
    pushImage(normalizeImage(img, baseUrl));
  }
  for (const raw of Array.isArray(problemImages) ? problemImages : []) {
    pushImage(normalizeImage(raw, baseUrl));
  }

  return merged;
}

function assignmentSortValue(item) {
  const month = Number(item?.session_month || 0);
  const day = Number(item?.session_day || 0);
  const hasDate = Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31;
  const startMinutes = parseTimePart(item?.session_start_time);
  const startValue = startMinutes == null ? 9999 : startMinutes;

  if (hasDate) return month * 100000 + day * 1000 + startValue;
  return 9000000 + dayOrderValue(item?.day_label) * 1000 + startValue;
}

function collectMentorBriefingItems(db, { weekId, mentorKey, baseUrl }) {
  const weeks = db
    .prepare('SELECT id, label, start_date, end_date FROM weeks ORDER BY id')
    .all();
  const weekById = new Map((weeks || []).map((item) => [Number(item?.id || 0), item]));
  const targetWeek = weekById.get(Number(weekId || 0)) || null;

  const rows = db
    .prepare(
      `
      SELECT wr.id AS week_record_id, wr.week_id AS source_week_id, wr.student_id, wr.e_wrong_answer_distribution, s.external_id, s.name AS student_name
      FROM week_records wr
      JOIN students s ON s.id = wr.student_id
      WHERE wr.e_wrong_answer_distribution IS NOT NULL
      ORDER BY s.name
      `
    )
    .all();

  const items = [];
  for (const row of rows) {
    const sourceWeekId = Number(row?.source_week_id || 0) || 0;
    const sourceWeek = weekById.get(sourceWeekId) || targetWeek;
    const distribution = safeJson(row.e_wrong_answer_distribution, {});
    const problems = Array.isArray(distribution?.problems) ? distribution.problems : [];
    const topAssignment = normalizeAssignment(distribution?.assignment || null);
    const tableImagesByProblem = listWrongAnswerImagesByProblem(db, row.student_id, sourceWeekId || weekId, baseUrl);
    const maxProblemIndex = Math.max(
      problems.length - 1,
      ...Array.from(tableImagesByProblem.keys(), (v) => Number(v || 0))
    );
    if (maxProblemIndex < 0) continue;

    for (let index = 0; index <= maxProblemIndex; index += 1) {
      const rawProblem = problems[index] && typeof problems[index] === 'object' ? problems[index] : {};
      const deletedAt = String(rawProblem?.deleted_at || '').trim();
      if (deletedAt) continue;

      const assignment = normalizeAssignment(rawProblem?.assignment || (index === 0 ? topAssignment : null));
      if (!assignment?.mentor_name) continue;
      if (normalizeMentorKey(assignment.mentor_name) !== mentorKey) continue;
      const targetWeekId = resolveAssignmentTargetWeekId(weeks, assignment, sourceWeek || targetWeek);
      if (targetWeekId !== Number(weekId || 0)) continue;

      const duration = Math.max(
        5,
        Math.min(240, Number(assignment.session_duration_minutes || 20) || 20)
      );
      const startMinutes = parseTimePart(assignment.session_start_time);
      const endTime = startMinutes == null ? '' : toHHMM(startMinutes + duration);
      const weekForSchedule = weekById.get(targetWeekId) || sourceWeek || targetWeek || null;
      const dayLabel = resolveSessionDayLabel(weekForSchedule, assignment);
      const sessionDateLabel = assignment.session_month && assignment.session_day
        ? `${assignment.session_month}/${assignment.session_day}`
        : '-';

      const images = mergeProblemImages(rawProblem?.images, tableImagesByProblem.get(index) || [], baseUrl);
      const statusRaw = String(rawProblem?.completion_status || '').trim();
      const completionStatus = statusRaw === 'done' || statusRaw === 'incomplete' ? statusRaw : 'pending';
      const incompleteReasonRaw = String(rawProblem?.incomplete_reason || '').replace(/\r\n/g, '\n');
      const incompleteReason = completionStatus === 'incomplete' ? incompleteReasonRaw.trim().slice(0, 1000) : '';

      items.push({
        week_record_id: Number(row.week_record_id || 0) || 0,
        student_id: Number(row.student_id || 0) || 0,
        student_name: String(row.student_name || '').trim(),
        external_id: String(row.external_id || '').trim(),
        problem_index: index,
        problem_order: index + 1,
        mentor_name: assignment.mentor_name,
        mentor_role: assignment.mentor_role,
        session_day_label: assignment.session_day_label || '',
        day_label: dayLabel || '-',
        session_month: assignment.session_month || '',
        session_day: assignment.session_day || '',
        session_date_label: sessionDateLabel,
        session_start_time: assignment.session_start_time || '',
        session_end_time: endTime,
        session_duration_minutes: duration,
        session_range_text: assignment.session_start_time && endTime ? `${assignment.session_start_time} ~ ${endTime}` : '-',
        assigned_at: String(assignment.assigned_at || '').trim(),
        completion_status: completionStatus,
        incomplete_reason: incompleteReason,
        problem: {
          subject: String(rawProblem?.subject || '').trim(),
          material: String(rawProblem?.material || '').trim(),
          problem_name: String(rawProblem?.problem_name || '').trim(),
          problem_type: String(rawProblem?.problem_type || '').trim(),
          note: String(rawProblem?.note || '').trim(),
          images
        }
      });
    }
  }

  items.sort((a, b) => {
    const scheduleDiff = assignmentSortValue(a) - assignmentSortValue(b);
    if (scheduleDiff !== 0) return scheduleDiff;
    const studentCmp = String(a.student_name || '').localeCompare(String(b.student_name || ''));
    if (studentCmp !== 0) return studentCmp;
    return String(a.external_id || '').localeCompare(String(b.external_id || ''));
  });
  return items;
}

function toIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function buildShareUrlForTokenRow(req, tokenRow) {
  const tokenId = String(tokenRow?.token_id || '').trim();
  if (!tokenId) return { shareUrl: '', token: '' };

  const baseUrl = requestPublicBaseUrl(req);
  const viewPath = `/api/mentor-briefings/v/${encodeURIComponent(tokenId)}`;
  return {
    shareUrl: baseUrl ? `${baseUrl}${viewPath}` : viewPath,
    token: ''
  };
}

function buildMentorBriefingSmsText({
  weekLabel = '',
  mentorName = '',
  shareUrl = '',
  senderNumber = DEFAULT_SOLAPI_SENDER,
  expiresAt = ''
} = {}) {
  const lines = [
    '[멘토링 포털] 사전 브리핑 안내',
    mentorName ? `${mentorName} 멘토님 배정 문제 확인 링크입니다.` : '배정 문제 확인 링크입니다.',
    weekLabel ? `회차: ${weekLabel}` : '',
    shareUrl || '',
    expiresAt ? `만료: ${String(expiresAt).replace('T', ' ').slice(0, 16)} (48시간)` : '만료: 발급 후 48시간',
    `문의: ${senderNumber}`
  ].filter(Boolean);
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMentorBriefingPage({
  token = '',
  tokenId = '',
  openPath = '/api/mentor-briefings/open',
  error = ''
} = {}) {
  const escapedError = escapeHtml(error);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>멘토 배정 브리핑</title>
    <style>
      :root{
        --bg:#eff5ff;
        --card:#ffffff;
        --line:#d6e2f5;
        --text:#182b46;
        --muted:#4f6785;
        --brand:#1f5ed6;
        --brand-soft:#e8f0ff;
      }
      *{box-sizing:border-box}
      body{margin:0;background:radial-gradient(circle at top right,#f7fbff 0%,var(--bg) 50%,#eef3f9 100%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif}
      .wrap{max-width:980px;margin:0 auto;padding:18px}
      .panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 14px 36px rgba(18,44,89,.10)}
      .head h1{margin:0;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-.02em}
      .head p{margin:10px 0 0;color:var(--muted);font-size:15px}
      .error{margin-top:12px;color:#b42318;font-size:13px}
      .toolbar{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}
      .btn{height:40px;border-radius:12px;border:1px solid var(--line);background:#fff;padding:0 14px;font-size:14px;font-weight:700;color:#304b6f;cursor:pointer}
      .btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
      .btn:disabled{opacity:.7;cursor:not-allowed}
      .status{margin-top:12px;padding:10px 12px;border-radius:12px;background:#f4f8ff;border:1px solid #dce8ff;color:var(--muted);font-size:13px}
      .status.error{background:#fff1f1;border-color:#f7caca;color:#9f1239}
      .pin-box{display:none;margin-top:12px;padding:12px;border:1px solid #f1dca4;background:#fff9e8;border-radius:12px}
      .pin-box.open{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .pin-box input{height:40px;border-radius:10px;border:1px solid #d8c892;padding:0 10px;font-size:15px;width:170px}
      .meta{margin-top:14px;background:var(--brand-soft);border:1px solid #cfe0ff;border-radius:14px;padding:14px}
      .meta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .meta-item{background:#fff;border:1px solid #dbe7ff;border-radius:10px;padding:10px}
      .meta-label{font-size:12px;color:#5a7499}
      .meta-value{margin-top:4px;font-size:16px;font-weight:700;color:#143a71}
      .list{margin-top:16px;display:flex;flex-direction:column;gap:12px}
      .item{border:1px solid var(--line);border-radius:16px;background:#f7faff;padding:14px}
      .item-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
      .item-title{font-size:20px;font-weight:800;line-height:1.25}
      .item-sub{margin-top:6px;font-size:14px;color:var(--muted)}
      .badge{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:999px;border:1px solid #c6d8ff;background:#edf4ff;font-size:12px;font-weight:700;color:#1f4f93}
      .problem{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}
      .problem-head{font-size:12px;color:#5b7398}
      .problem-line{margin-top:6px;font-size:18px;line-height:1.45;font-weight:700;word-break:keep-all}
      .note{margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid #dee8f8;background:#f8fbff;font-size:15px;white-space:pre-wrap;line-height:1.45}
      .warn{margin-top:10px;padding:10px 12px;border-radius:10px;border:1px solid #f7d39b;background:#fff7e8;font-size:14px;white-space:pre-wrap;color:#92400e}
      .images{margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
      .images a{display:block;border:1px solid #d6e2f5;background:#fff;border-radius:10px;overflow:hidden;transition:transform .12s ease}
      .images a:hover{transform:translateY(-1px)}
      .images img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}
      .empty{margin-top:14px;padding:14px;border:1px dashed #cfdcf2;border-radius:12px;text-align:center;color:#5a7499}
      @media (max-width:760px){
        .head h1{font-size:24px}
        .meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
        .item-title{font-size:18px}
        .problem-line{font-size:16px}
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <div class="head">
          <h1>멘토 배정 브리핑</h1>
          <p>링크를 열면 배정된 문제 내용과 이미지를 바로 확인할 수 있습니다.</p>
          ${escapedError ? `<div class="error">${escapedError}</div>` : ''}
        </div>
        <div class="toolbar">
          <button id="reloadBtn" type="button" class="btn primary">새로고침</button>
        </div>
        <div id="status" class="status">브리핑 내용을 불러오는 중입니다...</div>
        <div id="pinBox" class="pin-box">
          <span style="font-size:13px;color:#8c5a13">PIN 인증이 필요합니다.</span>
          <input id="pinInput" type="password" inputmode="numeric" maxlength="6" placeholder="PIN 6자리" />
          <button id="pinSubmitBtn" type="button" class="btn primary">인증 후 열기</button>
        </div>
        <div id="meta" class="meta" style="display:none"></div>
        <div id="list" class="list"></div>
      </div>
    </div>
    <script>
      const token = ${JSON.stringify(String(token || ''))};
      const tokenId = ${JSON.stringify(String(tokenId || ''))};
      const openPath = ${JSON.stringify(String(openPath || '/api/mentor-briefings/open'))};
      const statusEl = document.getElementById('status');
      const metaEl = document.getElementById('meta');
      const listEl = document.getElementById('list');
      const reloadBtn = document.getElementById('reloadBtn');
      const pinBox = document.getElementById('pinBox');
      const pinInput = document.getElementById('pinInput');
      const pinSubmitBtn = document.getElementById('pinSubmitBtn');

      function escapeText(value) {
        return String(value || '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function fmtDateTime(value) {
        if (!value) return '-';
        return String(value).replace('T', ' ').slice(0, 16);
      }

      function statusLabel(value) {
        if (value === 'done') return '완료';
        if (value === 'incomplete') return '미완료';
        return '진행중';
      }

      function setStatus(text, isError = false) {
        statusEl.textContent = String(text || '');
        statusEl.className = isError ? 'status error' : 'status';
      }

      function problemLine(problem) {
        const subject = String(problem?.subject || '').trim() || '과목 미입력';
        const problemName = String(problem?.problem_name || '').trim();
        const material = String(problem?.material || '').trim();
        const problemType = String(problem?.problem_type || '').trim();
        const parts = [subject];
        if (problemName) parts.push(problemName);
        if (material) parts.push(material);
        if (problemType) parts.push(problemType);
        return parts.join(' · ');
      }

      function renderItems(data) {
        const mentorName = escapeText(data?.mentor_name || '-');
        const weekLabel = escapeText(data?.week?.label || '-');
        const expiresAt = escapeText(fmtDateTime(data?.expires_at));
        const itemCount = Number(data?.item_count || 0);

        metaEl.style.display = 'block';
        metaEl.innerHTML =
          '<div class="meta-grid">' +
            '<div class="meta-item"><div class="meta-label">멘토</div><div class="meta-value">' + mentorName + '</div></div>' +
            '<div class="meta-item"><div class="meta-label">회차</div><div class="meta-value">' + weekLabel + '</div></div>' +
            '<div class="meta-item"><div class="meta-label">총 배정</div><div class="meta-value">' + itemCount + '건</div></div>' +
            '<div class="meta-item"><div class="meta-label">만료 시각</div><div class="meta-value" style="font-size:14px">' + expiresAt + '</div></div>' +
          '</div>';

        const rows = Array.isArray(data?.items) ? data.items : [];
        if (!rows.length) {
          listEl.innerHTML = '<div class="empty">현재 배정된 항목이 없습니다.</div>';
          return;
        }

        const html = rows.map((item) => {
          const title = (item?.external_id ? escapeText(item.external_id) + ' · ' : '') + escapeText(item?.student_name || '-') + ' · 오답 기록 ' + Number(item?.problem_order || 1);
          const schedule = [
            item?.day_label ? escapeText(item.day_label) + '요일' : '요일 미정',
            item?.session_date_label && item.session_date_label !== '-' ? escapeText(item.session_date_label) : '',
            item?.session_range_text && item.session_range_text !== '-' ? escapeText(item.session_range_text) : '시간 미정'
          ].filter(Boolean).join(' · ');
          const status = statusLabel(item?.completion_status);
          const noteText = String(item?.problem?.note || '').trim();
          const incompleteReason = String(item?.incomplete_reason || '').trim();
          const imageHtml = (Array.isArray(item?.problem?.images) ? item.problem.images : []).map((img, idx) => {
            const href = escapeText(img?.url || '');
            if (!href) return '';
            const alt = escapeText(img?.filename || ('문제 이미지 ' + (idx + 1)));
            return '<a href="' + href + '" target="_blank" rel="noreferrer"><img src="' + href + '" alt="' + alt + '" loading="lazy" /></a>';
          }).join('');

          return '<article class="item">' +
            '<div class="item-top">' +
              '<div>' +
                '<div class="item-title">' + title + '</div>' +
                '<div class="item-sub">예정: ' + schedule + ' · 배정일시: ' + escapeText(fmtDateTime(item?.assigned_at)) + '</div>' +
              '</div>' +
              '<span class="badge">' + escapeText(status) + '</span>' +
            '</div>' +
            '<section class="problem">' +
              '<div class="problem-head">해결 예정 문제</div>' +
              '<div class="problem-line">' + escapeText(problemLine(item?.problem || {})) + '</div>' +
              (noteText ? '<div class="note">' + escapeText(noteText) + '</div>' : '') +
              (incompleteReason ? '<div class="warn">미완료 사유\\n' + escapeText(incompleteReason) + '</div>' : '') +
              (imageHtml ? '<div class="images">' + imageHtml + '</div>' : '') +
            '</section>' +
          '</article>';
        }).join('');
        listEl.innerHTML = html;
      }

      async function openBriefing(pinCode) {
        if (!token && !tokenId) {
          setStatus('유효하지 않은 링크입니다.', true);
          return;
        }

        setStatus('브리핑 내용을 불러오는 중입니다...');
        reloadBtn.disabled = true;
        pinSubmitBtn.disabled = true;
        try {
          const payload = token
            ? (pinCode ? { token, pin_code: pinCode } : { token })
            : (pinCode ? { token_id: tokenId, pin_code: pinCode } : { token_id: tokenId });
          const res = await fetch(openPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (data?.code === 'PIN_REQUIRED') {
              pinBox.className = 'pin-box open';
              setStatus('PIN 번호를 입력해 주세요.', true);
              return;
            }
            throw new Error(data?.error || ('HTTP ' + res.status));
          }

          pinBox.className = 'pin-box';
          renderItems(data);
          setStatus('조회 완료');
        } catch (err) {
          metaEl.style.display = 'none';
          listEl.innerHTML = '';
          setStatus(err && err.message ? err.message : '브리핑 조회에 실패했습니다.', true);
        } finally {
          reloadBtn.disabled = false;
          pinSubmitBtn.disabled = false;
        }
      }

      reloadBtn.addEventListener('click', () => openBriefing(pinInput.value));
      pinSubmitBtn.addEventListener('click', () => openBriefing(pinInput.value));
      pinInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          openBriefing(pinInput.value);
        }
      });

      openBriefing('');
    </script>
  </body>
</html>`;
}

export default function mentorBriefingsRoutes(db) {
  const router = express.Router();
  const auth = requireAuth(db);

  ensureWrongAnswerImagesTable(db);
  ensureMentorBriefingTokensTable(db);

  router.get('/view', (req, res) => {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res
        .status(400)
        .type('html')
        .send(renderMentorBriefingPage({ error: '유효하지 않은 링크입니다.' }));
    }
    return res.type('html').send(renderMentorBriefingPage({ token }));
  });

  router.get('/v/:tokenId', (req, res) => {
    const tokenId = String(req.params?.tokenId || '').trim();
    if (!tokenId) {
      return res
        .status(400)
        .type('html')
        .send(renderMentorBriefingPage({ error: '유효하지 않은 링크입니다.' }));
    }
    return res.type('html').send(renderMentorBriefingPage({ tokenId }));
  });

  router.post('/issue', auth, (req, res) => {
    if (!['director', 'lead', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only director/lead/admin can issue briefing links' });
    }

    const weekId = Number(req.body?.week_id || 0);
    const mentorName = String(req.body?.mentor_name || '').trim();
    const mentorKey = normalizeMentorKey(mentorName);
    const mentorRole = normalizeMentorRole(req.body?.mentor_role);
    const mentorPhone = String(req.body?.mentor_phone || '').trim().slice(0, 30);
    if (!weekId) return res.status(400).json({ error: 'week_id is required' });
    if (!mentorName || !mentorKey) return res.status(400).json({ error: 'mentor_name is required' });

    const week = db.prepare('SELECT id, label FROM weeks WHERE id=?').get(weekId);
    if (!week?.id) return res.status(404).json({ error: 'Week not found' });

    const tokenId = `mbt_${crypto.randomBytes(12).toString('base64url')}`;
    const pinCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const pinHash = bcrypt.hashSync(pinCode, 10);
    const expiresAt = new Date(Date.now() + (MENTOR_BRIEFING_TTL_HOURS * 60 * 60 * 1000)).toISOString();

    db.prepare(
      `
      INSERT INTO mentor_briefing_tokens
        (token_id, week_id, mentor_name, mentor_key, mentor_role, mentor_phone, pin_hash, issued_by_user_id, issued_by_role, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      tokenId,
      weekId,
      mentorName,
      mentorKey,
      mentorRole,
      mentorPhone,
      pinHash,
      Number(req.user.id || 0) || null,
      String(req.user.role || '').trim() || '',
      expiresAt
    );

    const token = signMentorBriefingToken({
      token_id: tokenId,
      week_id: weekId,
      mentor_name: mentorName,
      mentor_role: mentorRole,
      issued_by: req.user.id
    }, MENTOR_BRIEFING_DEFAULT_EXPIRES_IN);

    const baseUrl = requestPublicBaseUrl(req);
    const viewPath = `/api/mentor-briefings/v/${encodeURIComponent(tokenId)}`;
    const shareUrl = baseUrl ? `${baseUrl}${viewPath}` : viewPath;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(shareUrl)}`;
    const { senderNumber } = getSolapiConfig();

    writeAudit(db, {
      user_id: req.user.id,
      action: 'create',
      entity: 'mentor_briefing_token',
      entity_id: tokenId,
      details: {
        week_id: weekId,
        mentor_name: mentorName,
        mentor_role: mentorRole,
        expires_at: expiresAt
      }
    });

    return res.json({
      ok: true,
      week: { id: Number(week.id), label: String(week.label || '').trim() },
      mentor_name: mentorName,
      mentor_role: mentorRole,
      mentor_phone: mentorPhone,
      token_id: tokenId,
      token,
      pin_code: pinCode,
      ttl_hours: MENTOR_BRIEFING_TTL_HOURS,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      share_url: shareUrl,
      qr_url: qrUrl,
      sender_phone: senderNumber || DEFAULT_SOLAPI_SENDER
    });
  });

  router.post('/open', (req, res) => {
    const tokenRaw = String(req.body?.token || '').trim();
    const tokenIdRaw = String(req.body?.token_id || '').trim();
    const pinCode = String(req.body?.pin_code || '').trim();
    const requirePin = isTruthyEnv(process.env.MENTOR_BRIEFING_REQUIRE_PIN);
    if (!tokenRaw && !tokenIdRaw) return res.status(400).json({ error: 'token or token_id is required' });
    if (pinCode && !/^\d{6}$/.test(pinCode)) {
      return res.status(400).json({ error: 'PIN 6자리를 입력해 주세요.' });
    }

    let decoded = null;
    let tokenId = tokenIdRaw;
    if (tokenRaw) {
      try {
        decoded = verifyMentorBriefingToken(tokenRaw);
      } catch {
        return res.status(400).json({ error: '유효하지 않거나 만료된 링크입니다.' });
      }
      tokenId = String(decoded?.token_id || '').trim();
    }

    if (!tokenId) return res.status(400).json({ error: '유효하지 않은 토큰입니다.' });

    const row = db
      .prepare(
        `
        SELECT token_id, week_id, mentor_name, mentor_key, mentor_role, pin_hash, issued_at, expires_at,
               failed_attempts, locked_until, revoked_at
        FROM mentor_briefing_tokens
        WHERE token_id=?
        `
      )
      .get(tokenId);
    if (!row?.token_id) return res.status(404).json({ error: '브리핑 링크를 찾을 수 없습니다.' });
    if (row.revoked_at) return res.status(410).json({ error: '회수된 링크입니다.' });

    const now = new Date();
    const expiresAt = toIso(row.expires_at);
    if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
      return res.status(410).json({ error: '링크 유효기간이 만료되었습니다.' });
    }

    if (decoded) {
      const decodedWeekId = Number(decoded?.week_id || 0);
      if (decodedWeekId && Number(row.week_id || 0) && decodedWeekId !== Number(row.week_id || 0)) {
        return res.status(400).json({ error: '토큰 정보가 일치하지 않습니다.' });
      }
      const decodedMentorKey = normalizeMentorKey(decoded?.mentor_name || '');
      if (decodedMentorKey && decodedMentorKey !== String(row.mentor_key || '')) {
        return res.status(400).json({ error: '토큰 정보가 일치하지 않습니다.' });
      }
    }

    const shouldCheckPin = requirePin || Boolean(pinCode);
    if (shouldCheckPin) {
      if (!pinCode) {
        return res.status(400).json({
          error: 'PIN 번호가 필요합니다.',
          code: 'PIN_REQUIRED'
        });
      }

      const lockedUntilIso = toIso(row.locked_until);
      if (lockedUntilIso && new Date(lockedUntilIso).getTime() > now.getTime()) {
        return res.status(429).json({ error: `PIN 입력 실패로 잠금 중입니다. 잠시 후 다시 시도해 주세요. (잠금 해제: ${lockedUntilIso.replace('T', ' ').slice(0, 16)})` });
      }

      const pinMatched = bcrypt.compareSync(pinCode, String(row.pin_hash || ''));
      if (!pinMatched) {
        const failedAttempts = Number(row.failed_attempts || 0) + 1;
        if (failedAttempts >= PIN_MAX_ATTEMPTS) {
          const nextLock = new Date(now.getTime() + (PIN_LOCK_MINUTES * 60 * 1000)).toISOString();
          db.prepare(
            `
            UPDATE mentor_briefing_tokens
            SET failed_attempts=0, locked_until=?, last_accessed_at=datetime('now')
            WHERE token_id=?
            `
          ).run(nextLock, tokenId);
          return res.status(429).json({ error: `PIN 입력을 ${PIN_MAX_ATTEMPTS}회 실패하여 ${PIN_LOCK_MINUTES}분 잠금되었습니다.` });
        }

        db.prepare(
          `
          UPDATE mentor_briefing_tokens
          SET failed_attempts=?, locked_until=NULL, last_accessed_at=datetime('now')
          WHERE token_id=?
          `
        ).run(failedAttempts, tokenId);
        return res.status(401).json({ error: `PIN 번호가 올바르지 않습니다. (${failedAttempts}/${PIN_MAX_ATTEMPTS})` });
      }

      db.prepare(
        `
        UPDATE mentor_briefing_tokens
        SET failed_attempts=0, locked_until=NULL, last_accessed_at=datetime('now')
        WHERE token_id=?
        `
      ).run(tokenId);
    } else {
      db.prepare("UPDATE mentor_briefing_tokens SET last_accessed_at=datetime('now') WHERE token_id=?").run(tokenId);
    }

    const week = db
      .prepare('SELECT id, label, start_date, end_date FROM weeks WHERE id=?')
      .get(Number(row.week_id || 0));
    if (!week?.id) return res.status(404).json({ error: '회차 정보를 찾을 수 없습니다.' });

    const baseUrl = requestPublicBaseUrl(req);
    const items = collectMentorBriefingItems(db, {
      weekId: Number(row.week_id || 0),
      mentorKey: String(row.mentor_key || ''),
      baseUrl
    });

    return res.json({
      ok: true,
      mentor_name: String(row.mentor_name || '').trim(),
      mentor_role: normalizeMentorRole(row.mentor_role),
      week: {
        id: Number(week.id || 0),
        label: String(week.label || '').trim(),
        start_date: String(week.start_date || '').trim(),
        end_date: String(week.end_date || '').trim()
      },
      issued_at: toIso(row.issued_at),
      expires_at: expiresAt,
      item_count: items.length,
      items
    });
  });

  router.post('/send-sms', auth, async (req, res) => {
    if (!['director', 'lead', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only director/lead/admin can send briefing SMS' });
    }

    const tokenId = String(req.body?.token_id || '').trim();
    const toPhone = normalizePhoneNumber(req.body?.to_phone);
    if (!tokenId) return res.status(400).json({ error: 'token_id is required' });
    if (!toPhone) return res.status(400).json({ error: '수신 번호를 입력해 주세요.' });

    const tokenRow = db
      .prepare(
        `
        SELECT token_id, week_id, mentor_name, mentor_role, mentor_phone, issued_by_user_id, expires_at, revoked_at
        FROM mentor_briefing_tokens
        WHERE token_id=?
        `
      )
      .get(tokenId);
    if (!tokenRow?.token_id) return res.status(404).json({ error: '브리핑 링크를 찾을 수 없습니다.' });
    if (tokenRow.revoked_at) return res.status(410).json({ error: '회수된 링크입니다.' });

    const expiresAtIso = toIso(tokenRow.expires_at);
    if (!expiresAtIso || new Date(expiresAtIso).getTime() <= Date.now()) {
      return res.status(410).json({ error: '링크 유효기간이 만료되었습니다. 새 링크를 발급해 주세요.' });
    }

    const week = db
      .prepare('SELECT id, label FROM weeks WHERE id=?')
      .get(Number(tokenRow.week_id || 0));
    if (!week?.id) return res.status(404).json({ error: '회차 정보를 찾을 수 없습니다.' });

    const { shareUrl } = buildShareUrlForTokenRow(req, tokenRow);
    if (!shareUrl) return res.status(500).json({ error: '브리핑 링크 생성에 실패했습니다.' });

    const { senderNumber } = getSolapiConfig();
    const normalizedSender = normalizePhoneNumber(senderNumber || DEFAULT_SOLAPI_SENDER);
    if (!normalizedSender) {
      return res.status(500).json({ error: '발신 번호 설정이 올바르지 않습니다.' });
    }

    const smsText = buildMentorBriefingSmsText({
      weekLabel: String(week.label || '').trim(),
      mentorName: String(tokenRow.mentor_name || '').trim(),
      shareUrl,
      senderNumber: normalizedSender,
      expiresAt: expiresAtIso
    });

    try {
      const providerResult = await sendSolapiTextMessage({
        to: toPhone,
        from: normalizedSender,
        text: smsText
      });

      db.prepare('UPDATE mentor_briefing_tokens SET mentor_phone=? WHERE token_id=?')
        .run(toPhone, tokenId);

      writeAudit(db, {
        user_id: req.user.id,
        action: 'create',
        entity: 'mentor_briefing_sms',
        entity_id: tokenId,
        details: {
          week_id: Number(week.id || 0),
          mentor_name: String(tokenRow.mentor_name || '').trim(),
          to_phone_masked: maskPhoneNumber(toPhone),
          from_phone: normalizedSender
        }
      });

      return res.json({
        ok: true,
        provider: 'solapi',
        token_id: tokenId,
        mentor_name: String(tokenRow.mentor_name || '').trim(),
        week_label: String(week.label || '').trim(),
        to_phone: toPhone,
        to_phone_masked: maskPhoneNumber(toPhone),
        from_phone: normalizedSender,
        share_url: shareUrl,
        expires_at: expiresAtIso,
        provider_result: providerResult
      });
    } catch (err) {
      return res.status(502).json({
        error: err?.message || '문자 전송에 실패했습니다. SOLAPI 설정을 확인해 주세요.'
      });
    }
  });

  router.post('/revoke', auth, (req, res) => {
    if (!['director', 'lead', 'admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Only director/lead/admin can revoke briefing links' });
    }
    const tokenId = String(req.body?.token_id || '').trim();
    if (!tokenId) return res.status(400).json({ error: 'token_id is required' });

    const info = db.prepare(
      `
      UPDATE mentor_briefing_tokens
      SET revoked_at=datetime('now'), revoked_by_user_id=?
      WHERE token_id=? AND revoked_at IS NULL
      `
    ).run(Number(req.user.id || 0) || null, tokenId);
    if (!info?.changes) return res.status(404).json({ error: 'Token not found or already revoked' });

    writeAudit(db, {
      user_id: req.user.id,
      action: 'update',
      entity: 'mentor_briefing_token',
      entity_id: tokenId,
      details: { revoked: true }
    });

    return res.json({ ok: true, token_id: tokenId, revoked: true });
  });

  return router;
}
