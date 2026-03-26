// Mentoring.jsx (FULL REPLACEMENT)
// ?�번 반영: (1) 그라?�이???�거 + ?��? ?�색 ?�색 배경
//          (2) ?�생 ?�보 ?�역 분리 ???�적/?�신 카드 ?�에 가로형 ?�력 �?//          (3) ?�드 모음: ?�드�??��? ?�성/목록 + ?�장/총괄/관리자 ??�� 버튼
//          (4) 과제?�행???�력 ?�역 ?�이 = ?�옆 textarea 카드 ?�이?� ?�일
//          (5) 모든 ???�역(최외�?card) ?�두�? ??굵고 진한 골드
//          (6) 과목 ?�환 ???�동?�??+ 과목 ?�??버튼?� "모든 과목" ?�괄 ?�??// ?�른 기능?��? ?��?(캘린???�크?�로???�드 ?�송/과목 추�?/주간 과제·?�드�??�쇄/과거기록)

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { API_BASE, api, getToken } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
const KO_WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const JS_DAY_TO_KO = ['일', '월', '화', '수', '목', '금', '토'];

const ROLE_KO = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '클리닉 멘토',
  admin: '관리자',
  parent: '학부모'
};
const ROLE_ORDER = {
  director: 0,
  lead: 1,
  admin: 2,
  mentor: 3,
  parent: 4
};

function wrongAnswerRoleLabel(role) {
  if (role === 'mentor') return '클리닉 멘토';
  return ROLE_KO[role] || role || '멘토';
}

function wrongAnswerRoleRowTone(role) {
  if (role === 'mentor') return 'bg-emerald-50/70';
  if (role === 'lead') return 'bg-sky-50/70';
  return 'bg-white/70';
}

const SUBJECT_FIELD_KEYS = ['a_curriculum', 'a_last_hw', 'a_hw_exec', 'a_progress', 'a_this_hw', 'a_comment'];
const SUBJECT_TONES = [
  'border-emerald-200/60 bg-emerald-50/35',
  'border-teal-200/60 bg-teal-50/35',
  'border-rose-200/60 bg-rose-50/30',
  'border-violet-200/60 bg-violet-50/30',
  'border-sky-200/60 bg-sky-50/30'
];
const SUBJECT_INNER_TONES = [
  'border-emerald-100/80 bg-emerald-50/55',
  'border-teal-100/80 bg-teal-50/55',
  'border-rose-100/80 bg-rose-50/50',
  'border-violet-100/80 bg-violet-50/50',
  'border-sky-100/80 bg-sky-50/50'
];
const WRONG_ANSWER_TONES = [
  {
    card: 'border-emerald-300/90 bg-emerald-50/35',
    ring: 'ring-emerald-200',
    assignButton: 'btn border border-emerald-700 bg-emerald-700 text-white hover:border-emerald-800 hover:bg-emerald-800',
    assignButtonSoft: 'btn border border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100'
  },
  {
    card: 'border-amber-300/90 bg-amber-50/35',
    ring: 'ring-amber-200',
    assignButton: 'btn border border-amber-700 bg-amber-600 text-white hover:border-amber-800 hover:bg-amber-700',
    assignButtonSoft: 'btn border border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 hover:bg-amber-100'
  },
  {
    card: 'border-sky-300/90 bg-sky-50/35',
    ring: 'ring-sky-200',
    assignButton: 'btn border border-sky-700 bg-sky-600 text-white hover:border-sky-800 hover:bg-sky-700',
    assignButtonSoft: 'btn border border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-400 hover:bg-sky-100'
  },
  {
    card: 'border-violet-300/90 bg-violet-50/35',
    ring: 'ring-violet-200',
    assignButton: 'btn border border-violet-700 bg-violet-600 text-white hover:border-violet-800 hover:bg-violet-700',
    assignButtonSoft: 'btn border border-violet-300 bg-violet-50 text-violet-800 hover:border-violet-400 hover:bg-violet-100'
  },
  {
    card: 'border-rose-300/90 bg-rose-50/35',
    ring: 'ring-rose-200',
    assignButton: 'btn border border-rose-700 bg-rose-600 text-white hover:border-rose-800 hover:bg-rose-700',
    assignButtonSoft: 'btn border border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-400 hover:bg-rose-100'
  }
];

function wrongAnswerToneByIndex(index) {
  const tones = WRONG_ANSWER_TONES.length
    ? WRONG_ANSWER_TONES
    : [
        {
          card: 'border-slate-200 bg-white/70',
          ring: 'ring-brand-200',
          assignButton: 'btn-primary',
          assignButtonSoft: 'btn-ghost'
        }
      ];
  return tones[Math.abs(Number(index) || 0) % tones.length];
}

function safeJson(v, fallback) {
  try {
    return JSON.parse(v || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function fmtKoreanDateTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function fmtMD(d) {
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${m}/${dd}`;
}

function toRoundLabel(label) {
  return String(label || '').replace(/주차/g, '회차');
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

function fmtWeekLabel(week) {
  if (!week) return '';
  const start = parseDateOnly(week.start_date);
  const end = parseDateOnly(week.end_date);
  const label = toRoundLabel(week.label);
  if (start && end) return `${label} (${fmtMD(start)} ~ ${fmtMD(end)})`;
  return label || '';
}

function resolveWeekBaseYear(week) {
  const start = parseDateOnly(week?.start_date);
  if (start) return start.getFullYear();
  const end = parseDateOnly(week?.end_date);
  if (end) return end.getFullYear();
  return new Date().getFullYear();
}

function toPadded2(value) {
  return String(value).padStart(2, '0');
}

function buildDateInputValue(month, day, fallbackYear = new Date().getFullYear()) {
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  const year = Number(fallbackYear);
  if (!Number.isInteger(year) || year < 1000) return '';
  const date = new Date(year, m - 1, d);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return '';
  }
  return `${year}-${toPadded2(m)}-${toPadded2(d)}`;
}

function parseDateInputValue(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return {
    year,
    month,
    day,
    dayLabel: JS_DAY_TO_KO[date.getDay()] || ''
  };
}

function normalizeLastHwTask(raw) {
  if (!raw) return { text: '', done: null, progress: '' };
  if (typeof raw === 'string') return { text: raw, done: null, progress: '' };
  return {
    text: String(raw.text || '').trim(),
    done: raw.done === true ? true : raw.done === false ? false : null,
    progress: raw.progress ? String(raw.progress) : ''
  };
}

function parseLastHwTasks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeLastHwTask);
  if (typeof value === 'object') {
    const arr = value.tasks || value.items || value.list;
    if (Array.isArray(arr)) return arr.map(normalizeLastHwTask);
  }
  const raw = String(value);
  const parsed = safeJson(raw, null);
  if (Array.isArray(parsed)) return parsed.map(normalizeLastHwTask);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((text) => ({ text, done: null, progress: '' }));
}

function serializeLastHwTasks(tasks) {
  const cleaned = (tasks || []).map((t) => ({
    text: String(t?.text || '').trim(),
    done: t?.done === true ? true : t?.done === false ? false : null,
    progress: t?.done === false ? String(t?.progress || '') : ''
  }));
  return cleaned.length ? JSON.stringify(cleaned) : '';
}

const DEFAULT_CLINIC_ENTRY = {
  mentor_name: '',
  subject: '',
  material: '',
  problem_name: '',
  problem_type: '',
  solved_date: '',
  summary: ''
};

function normalizeClinicEntry(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLINIC_ENTRY };
  return {
    mentor_name: String(raw.mentor_name || '').trim(),
    subject: String(raw.subject || '').trim(),
    material: String(raw.material || '').trim(),
    problem_name: String(raw.problem_name || '').trim(),
    problem_type: String(raw.problem_type || '').trim(),
    solved_date: String(raw.solved_date || '').trim(),
    summary: String(raw.summary || '').trim()
  };
}

function parseClinicEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeClinicEntry);
  if (typeof value === 'object' && Array.isArray(value.entries)) {
    return value.entries.map(normalizeClinicEntry);
  }
  const raw = String(value);
  const parsed = safeJson(raw, []);
  if (Array.isArray(parsed)) return parsed.map(normalizeClinicEntry);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
    return parsed.entries.map(normalizeClinicEntry);
  }
  return [];
}

const DEFAULT_WRONG_ANSWER_ITEM = {
  subject: '',
  material: '',
  problem_name: '',
  problem_type: '',
  note: '',
  images: [],
  assignment: null,
  completion_status: 'pending',
  completion_feedback: '',
  incomplete_reason: '',
  status_updated_at: '',
  status_updated_by: '',
  deleted_at: '',
  deleted_by: ''
};

const MIN_MENTOR_OVERLAP_MINUTES = 10;

function normalizeWrongAnswerAssignment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mentorName = String(raw.mentor_name || '').trim();
  const mentorId = String(raw.mentor_id || '').trim();
  const role = String(raw.mentor_role || '').trim() || 'mentor';
  const sessionMonth = String(raw.session_month || '').trim();
  const sessionDay = String(raw.session_day || '').trim();
  const sessionStart = String(raw.session_start_time || raw.session_time || '').trim();
  const dayLabel = String(raw.session_day_label || '').trim();
  const duration = Math.max(1, Math.min(240, Number(raw.session_duration_minutes || 20) || 20));

  if (!mentorName && !mentorId && !sessionMonth && !sessionDay && !sessionStart && !dayLabel) return null;

  return {
    mentor_id: mentorId,
    mentor_name: mentorName,
    mentor_role: role,
    mentor_subjects: Array.isArray(raw.mentor_subjects)
      ? raw.mentor_subjects.map((v) => String(v || '').trim()).filter(Boolean)
      : [],
    mentor_work_slots: Array.isArray(raw.mentor_work_slots)
      ? raw.mentor_work_slots
          .map((slot) => ({
            day: String(slot?.day || '').trim(),
            time: String(slot?.time || '').trim()
          }))
          .filter((slot) => slot.day && slot.time)
      : [],
    overlap_count: Math.max(0, Number(raw.overlap_count || 0) || 0),
    overlap_preview: Array.isArray(raw.overlap_preview)
      ? raw.overlap_preview
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      : [],
    session_day_label: dayLabel,
    session_month: sessionMonth,
    session_day: sessionDay,
    session_start_time: sessionStart,
    session_duration_minutes: duration,
    assigned_at: String(raw.assigned_at || '').trim(),
    assigned_by: String(raw.assigned_by || '').trim()
  };
}

function normalizeWrongAnswerImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim();
  if (!url) return null;
  return {
    id: String(raw.id || '').trim() || `img_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
    filename: String(raw.filename || '').trim(),
    stored_name: String(raw.stored_name || '').trim(),
    url,
    mime_type: String(raw.mime_type || '').trim(),
    size: Number(raw.size || 0) || 0,
    uploaded_at: String(raw.uploaded_at || '').trim(),
    uploaded_via: String(raw.uploaded_via || '').trim()
  };
}

function normalizeWrongAnswerItem(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WRONG_ANSWER_ITEM };
  const statusRaw = String(raw.completion_status || '').trim();
  const completionStatus = statusRaw === 'done' || statusRaw === 'incomplete' ? statusRaw : 'pending';
  const completionFeedbackRaw = String(raw.completion_feedback || '').replace(/\r\n/g, '\n');
  const completionFeedback = completionStatus === 'done' ? completionFeedbackRaw.trim().slice(0, 1000) : '';
  const incompleteReasonRaw = String(raw.incomplete_reason || '').replace(/\r\n/g, '\n');
  const incompleteReason = completionStatus === 'incomplete' ? incompleteReasonRaw.trim().slice(0, 1000) : '';
  return {
    subject: String(raw.subject || '').trim(),
    material: String(raw.material || '').trim(),
    problem_name: String(raw.problem_name || '').trim(),
    problem_type: String(raw.problem_type || '').trim(),
    note: String(raw.note || '').trim(),
    completion_status: completionStatus,
    completion_feedback: completionFeedback,
    incomplete_reason: incompleteReason,
    status_updated_at: String(raw.status_updated_at || '').trim(),
    status_updated_by: String(raw.status_updated_by || '').trim(),
    deleted_at: String(raw.deleted_at || '').trim(),
    deleted_by: String(raw.deleted_by || '').trim(),
    images: Array.isArray(raw.images) ? raw.images.map(normalizeWrongAnswerImage).filter(Boolean) : [],
    assignment: normalizeWrongAnswerAssignment(raw.assignment)
  };
}

function wrongAnswerImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${API_BASE}${raw}`;
  return `${API_BASE}/${raw}`;
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
  const topLevelAssignment = normalizeWrongAnswerAssignment(value.assignment);
  const problems = problemsRaw.length
    ? problemsRaw.map((item, idx) => {
        const normalized = normalizeWrongAnswerItem(item);
        return {
          ...normalized,
          assignment: normalizeWrongAnswerAssignment(
            normalized.assignment || (idx === 0 ? topLevelAssignment : null)
          )
        };
      })
    : [{ ...DEFAULT_WRONG_ANSWER_ITEM, assignment: topLevelAssignment }];
  const assignment = normalizeWrongAnswerAssignment(
    topLevelAssignment || problems.find((item) => item?.assignment)?.assignment || null
  );
  return {
    problems,
    assignment,
    searched_at: String(value.searched_at || '').trim()
  };
}

function pickSummaryAssignmentFromProblems(problems, fallback = null) {
  const list = Array.isArray(problems) ? problems : [];
  for (const item of list) {
    const assignment = normalizeWrongAnswerAssignment(item?.assignment || null);
    if (assignment) return assignment;
  }
  return normalizeWrongAnswerAssignment(fallback);
}

function normalizeWrongAnswerDraftWithSummary(value) {
  const base = normalizeWrongAnswerDistribution(value);
  const list = Array.isArray(base.problems) ? base.problems : [];
  const firstAssignment = pickSummaryAssignmentFromProblems(list, base.assignment || null);
  return {
    ...base,
    problems: list.map((item, idx) => ({
      ...normalizeWrongAnswerItem(item),
      assignment: normalizeWrongAnswerAssignment(item?.assignment || (idx === 0 ? firstAssignment : null))
    })),
    assignment: pickSummaryAssignmentFromProblems(list, firstAssignment || base.assignment || null)
  };
}

function mergeWrongAnswerDraftKeepingLocalInputs(localValue, remoteValue) {
  const local = normalizeWrongAnswerDraftWithSummary(localValue);
  const remote = normalizeWrongAnswerDraftWithSummary(remoteValue);
  const localProblems = Array.isArray(local.problems) ? local.problems : [];
  const remoteProblems = Array.isArray(remote.problems) ? remote.problems : [];
  const maxLen = Math.max(localProblems.length, remoteProblems.length, 1);

  const mergedProblems = Array.from({ length: maxLen }, (_, idx) => {
    const hasLocal = idx < localProblems.length;
    const hasRemote = idx < remoteProblems.length;
    const localItem = normalizeWrongAnswerItem(localProblems[idx] || {});
    const remoteItem = normalizeWrongAnswerItem(remoteProblems[idx] || {});

    if (!hasLocal && hasRemote) return remoteItem;
    if (!hasLocal) return { ...DEFAULT_WRONG_ANSWER_ITEM };

    return {
      ...localItem,
      // 이미지 목록만 서버 최신값으로 동기화해서, 입력 중 텍스트/배정 정보는 유지
      images: hasRemote ? remoteItem.images : localItem.images
    };
  });

  return {
    ...local,
    searched_at: local.searched_at || remote.searched_at || '',
    problems: mergedProblems,
    assignment: pickSummaryAssignmentFromProblems(mergedProblems, null)
  };
}

function buildForcedAssignmentSeed(problem) {
  const assignment = normalizeWrongAnswerAssignment(problem?.assignment || null);
  return {
    mentor_name: String(assignment?.mentor_name || '').trim(),
    mentor_role: String(assignment?.mentor_role || 'mentor').trim() || 'mentor',
    session_day_label: String(assignment?.session_day_label || '').trim(),
    session_month: String(assignment?.session_month || '').trim(),
    session_day: String(assignment?.session_day || '').trim(),
    session_start_time: String(assignment?.session_start_time || '').trim(),
    session_duration_minutes: Math.max(
      1,
      Math.min(240, Number(assignment?.session_duration_minutes || 20) || 20)
    )
  };
}

const KO_TO_EN_DAY = {
  월: 'Mon',
  화: 'Tue',
  수: 'Wed',
  목: 'Thu',
  금: 'Fri',
  토: 'Sat',
  일: 'Sun',
  월요일: 'Mon',
  화요일: 'Tue',
  수요일: 'Wed',
  목요일: 'Thu',
  금요일: 'Fri',
  토요일: 'Sat',
  일요일: 'Sun'
};

function normalizeDayKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (DAYS.includes(raw)) return raw;
  const lowered = raw.toLowerCase();
  if (lowered === 'mon' || lowered === 'monday') return 'Mon';
  if (lowered === 'tue' || lowered === 'tuesday') return 'Tue';
  if (lowered === 'wed' || lowered === 'wednesday') return 'Wed';
  if (lowered === 'thu' || lowered === 'thursday') return 'Thu';
  if (lowered === 'fri' || lowered === 'friday') return 'Fri';
  if (lowered === 'sat' || lowered === 'saturday') return 'Sat';
  if (lowered === 'sun' || lowered === 'sunday') return 'Sun';
  return KO_TO_EN_DAY[raw] || '';
}

function normalizeMentorScheduleMap(schedule) {
  const parsed = typeof schedule === 'string' ? safeJson(schedule, {}) : (schedule || {});
  const out = {};
  for (const day of DAYS) out[day] = [];
  if (!parsed || typeof parsed !== 'object') return out;

  for (const [key, value] of Object.entries(parsed)) {
    const day = normalizeDayKey(key);
    if (!day) continue;
    const list = Array.isArray(value) ? value : [value];
    const normalized = list
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return { time: item.trim(), title: '', type: '' };
        const timeDirect = String(item.time || item.time_range || item.timeRange || '').trim();
        const start = String(item.start || item.start_time || item.startTime || '').trim();
        const end = String(item.end || item.end_time || item.endTime || '').trim();
        const time = timeDirect || (start && end ? `${start}~${end}` : '');
        if (!time) return null;
        return {
          time,
          title: String(item.title || item.description || item.memo || '').trim(),
          type: String(item.type || item.kind || '').trim()
        };
      })
      .filter(Boolean);
    out[day] = normalized;
  }
  return out;
}

function normalizeMentorInfo(value) {
  const info = value && typeof value === 'object' ? value : {};
  const mentors = Array.isArray(info.mentors) ? info.mentors : [];
  return {
    updated_at: String(info.updated_at || info.updatedAt || '').trim(),
    mentors: mentors
      .map((mentor) => ({
        mentor_id: String(mentor?.mentor_id || mentor?.id || mentor?.user_id || '').trim(),
        name: String(mentor?.name || mentor?.display_name || '').trim(),
        role: String(mentor?.role || 'mentor').trim(),
        subjects: Array.isArray(mentor?.subjects)
          ? mentor.subjects.map((s) => String(s || '').trim()).filter(Boolean)
          : [],
        schedule: normalizeMentorScheduleMap(mentor?.schedule)
      }))
      .filter((mentor) => mentor.name || mentor.mentor_id)
  };
}

function parseTimePart(value) {
  const m = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatTimePart(totalMinutes) {
  const mins = Number(totalMinutes || 0);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function makeSessionRangeText(startTime, durationMinutes) {
  const start = parseTimePart(startTime);
  const duration = Math.max(1, Math.min(240, Number(durationMinutes || 20) || 20));
  if (start == null) return '';
  const end = start + duration;
  return `${formatTimePart(start)} ~ ${formatTimePart(end)} (${duration}분)`;
}

function parseTimeRange(value) {
  const text = String(value || '').trim().replace(/\s+/g, '');
  if (!text) return null;
  const m = text.match(/(\d{1,2}:\d{2})[-~](\d{1,2}:\d{2})/);
  if (!m) return null;
  const start = parseTimePart(m[1]);
  const end = parseTimePart(m[2]);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function getOverlapMinutes(a, b) {
  if (!a || !b) return 0;
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (end <= start) return 0;
  return end - start;
}

function buildOverlapCandidates(studentSchedule, mentorInfo) {
  const candidates = [];
  const mentors = Array.isArray(mentorInfo?.mentors) ? mentorInfo.mentors : [];
  for (const mentor of mentors) {
    const overlaps = [];
    for (const day of DAYS) {
      const studentItems = Array.isArray(studentSchedule?.[day]) ? studentSchedule[day] : [];
      const mentorItems = Array.isArray(mentor?.schedule?.[day]) ? mentor.schedule[day] : [];
      if (!studentItems.length || !mentorItems.length) continue;

      for (const s of studentItems) {
        const scheduleType = classifySchedule(s);
        if (scheduleType === 'external' || scheduleType === 'absence') continue;
        const sRange = parseTimeRange(s?.time);
        if (!sRange) continue;
        for (const m of mentorItems) {
          const mRange = parseTimeRange(m?.time);
          if (!mRange) continue;
          const overlapMinutes = getOverlapMinutes(sRange, mRange);
          if (overlapMinutes >= MIN_MENTOR_OVERLAP_MINUTES) {
            overlaps.push({
              day,
              student_time: String(s?.time || ''),
              mentor_time: String(m?.time || ''),
              student_title: String(s?.title || ''),
              mentor_title: String(m?.title || ''),
              overlap_minutes: overlapMinutes
            });
          }
        }
      }
    }
    if (!overlaps.length) continue;
    const mentorWorkSlots = DAYS.flatMap((day) =>
      (Array.isArray(mentor?.schedule?.[day]) ? mentor.schedule[day] : []).map((slot) => ({
        day,
        time: String(slot?.time || '').trim()
      }))
    ).filter((slot) => slot.time);

    candidates.push({
      mentor_id: mentor.mentor_id || mentor.name,
      mentor_name: mentor.name || mentor.mentor_id || '멘토',
      mentor_role: mentor.role || 'mentor',
      mentor_subjects: Array.isArray(mentor.subjects) ? mentor.subjects : [],
      mentor_work_slots: mentorWorkSlots,
      overlaps
    });
  }

  candidates.sort((a, b) => {
    const byCount = Number(b.overlaps?.length || 0) - Number(a.overlaps?.length || 0);
    if (byCount !== 0) return byCount;
    return String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''));
  });
  return candidates;
}

function getPerm(perms, field_key) {
  const p = (perms || []).find((x) => x.field_key === field_key);
  const roles_view = p?.roles_view || safeJson(p?.roles_view_json, []);
  const roles_edit = p?.roles_edit || safeJson(p?.roles_edit_json, []);
  return {
    label: p?.label || field_key,
    roles_view: Array.isArray(roles_view) ? roles_view : [],
    roles_edit: Array.isArray(roles_edit) ? roles_edit : []
  };
}

function canEdit(perms, role, field_key) {
  const p = getPerm(perms, field_key);
  return (p.roles_edit || []).includes(role);
}

function canView(perms, role, field_key) {
  const p = getPerm(perms, field_key);
  return (p.roles_view || []).includes(role);
}

// ??�� 기반 ??권한 가?�화)
function toneByRoles(roles) {
  const rs = new Set(roles || []);
  if (rs.has('director')) {
    return {
      shell: 'border-slate-200/80 bg-slate-50/70',
      badge: 'border-slate-200 bg-slate-100 text-slate-800'
    };
  }
  if (rs.has('lead')) {
    return {
      shell: 'border-emerald-200 bg-emerald-50/70',
      badge: 'border-emerald-200 bg-emerald-100/70 text-emerald-900'
    };
  }
  if (rs.has('mentor')) {
    return {
      shell: 'border-violet-200 bg-violet-50/70',
      badge: 'border-violet-200 bg-violet-100/70 text-violet-900'
    };
  }
  if (rs.has('admin')) {
    return {
      shell: 'border-slate-200 bg-slate-50/70',
      badge: 'border-slate-200 bg-slate-100 text-slate-800'
    };
  }
  return {
    shell: 'border-slate-200 bg-white/60',
    badge: 'border-slate-200 bg-white text-slate-700'
  };
}

function RoleTag({ role, active }) {
  const cls = active ? 'border-brand-900 bg-brand-900 text-white' : 'border-slate-200 bg-white text-slate-700';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      {ROLE_KO[role] || role}
    </span>
  );
}

function AutoGrowTextarea({ value, onValueChange, onBlur, disabled, minHeight = 240 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    const next = Math.max(ref.current.scrollHeight, minHeight);
    ref.current.style.height = `${next}px`;
  }, [value, minHeight]);

  return (
    <textarea
      ref={ref}
      className="textarea mt-3 w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 focus:ring-0 focus:border-transparent"
      value={value}
      onChange={(e) => {
        const el = e.target;
        el.style.height = 'auto';
        const next = Math.max(el.scrollHeight, minHeight);
        el.style.height = `${next}px`;
        onValueChange?.(e.target.value);
      }}
      onBlur={onBlur}
      disabled={disabled}
      rows={1}
      style={{ minHeight }}
    />
  );
}

function LastHwTasksEditor({ value, editable, percentOptions, onChangeValue, onBlur, showProgress = true }) {
  const [tasks, setTasks] = useState(() => parseLastHwTasks(value));

  useEffect(() => {
    setTasks(parseLastHwTasks(value));
  }, [value]);

  function commit(next) {
    setTasks(next);
    onChangeValue?.(serializeLastHwTasks(next));
  }

  function updateTask(idx, patch) {
    const next = tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    commit(next);
  }

  function addTask() {
    commit([...(tasks || []), { text: '', done: null, progress: '' }]);
  }

  function removeTask(idx) {
    const next = tasks.filter((_, i) => i !== idx);
    commit(next);
  }

  if (!editable) {
    const list = parseLastHwTasks(value);
    return (
      <div className="mt-3 space-y-2">
        {list.length ? (
          list.map((t, idx) => (
            <div key={`${t.text}-${idx}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm">
              <div className="flex-1 whitespace-pre-wrap text-slate-900">{t.text}</div>
              {t.done === true ? (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                  완료
                </span>
              ) : t.done === false ? (
                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800">
                  진행중{showProgress && t.progress ? ` · ${t.progress}` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                  상태 미선택
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="text-sm text-slate-500">기록 없음</div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {tasks.map((t, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-start">
          <div className={showProgress ? 'col-span-12 lg:col-span-6' : 'col-span-12 lg:col-span-7'}>
            <input
              className="input"
              value={t.text || ''}
              placeholder="과제 입력"
              onChange={(e) => updateTask(idx, { text: e.target.value })}
              onBlur={onBlur}
            />
          </div>
          <div className={showProgress ? 'col-span-12 lg:col-span-3 flex gap-2' : 'col-span-12 lg:col-span-4 flex gap-2'}>
            <button
              type="button"
              className={['btn', t.done === true ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-700'].join(' ')}
              onClick={() => updateTask(idx, { done: true, progress: '' })}
              onBlur={onBlur}
            >
              완료
            </button>
            <button
              type="button"
              className={['btn', t.done === false ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200 text-slate-700'].join(' ')}
              onClick={() => updateTask(idx, { done: false })}
              onBlur={onBlur}
            >
              진행중
            </button>
          </div>
          {showProgress ? (
            <div className="col-span-12 lg:col-span-2">
              {t.done === false ? (
                <select
                  className="input"
                  value={t.progress || ''}
                  onChange={(e) => updateTask(idx, { progress: e.target.value })}
                  onBlur={onBlur}
                >
                  {percentOptions.map((v) => (
                    <option key={v || '__empty__'} value={v}>
                      {v || '선택'}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-slate-500 pt-2">이행도 선택</div>
              )}
            </div>
          ) : null}
          <div className="col-span-12 lg:col-span-1 flex justify-end">
            <button type="button" className="btn-ghost text-red-700" onClick={() => removeTask(idx)}>
              삭제
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-ghost text-brand-800" onClick={addTask}>
        과제 추가
      </button>
    </div>
  );
}
function FieldShell({ title, subtitle, editRoles, currentRole, right, children, className = '' }) {
  const tone = toneByRoles(editRoles);
  const roles = Array.isArray(editRoles) ? editRoles : [];
  const active = roles.includes(currentRole);

  return (
    <div className={['rounded-2xl border p-5 shadow-sm backdrop-blur', tone.shell, className].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-brand-900">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-slate-600">{subtitle}</div> : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-600">편집 가능</span>
            {roles.length ? roles.map((r) => <RoleTag key={r} role={r} active={r === currentRole} />) : <span className="text-[11px] text-slate-500">없음</span>}
            <span className={['ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]', tone.badge].join(' ')}>
              {active ? '현재 역할 편집 가능' : '읽기 전용'}
            </span>
          </div>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}

function confirmOrThrow(message) {
  const ok = window.confirm(message);
  if (!ok) throw new Error('__CANCEL__');
}

function PageBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-gradient-to-b from-stone-50 to-stone-200" />
  );
}

function GoldCard({ className = '', children }) {
  return (
    <div className={['card border-2 border-[#b58a2a] bg-white/70 shadow-sm', className].join(' ')}>
      {children}
    </div>
  );
}

export default function Mentoring() {
  const { studentId } = useParams();
  const [sp, setSp] = useSearchParams();
  const { user } = useAuth();

  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(sp.get('week') || '');
  const [perms, setPerms] = useState([]);
  const [rec, setRec] = useState(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [recipients, setRecipients] = useState([]);
  const [feedForm, setFeedForm] = useState({ to_user_id: '', target_field: '', title: '', body: '' });
  const [studentFeeds, setStudentFeeds] = useState([]);
  const [feedsError, setFeedsError] = useState('');

  const [newSubject, setNewSubject] = useState('');
  const [curriculumSourceSelection, setCurriculumSourceSelection] = useState('auto');
  const [curriculumSourceEffectiveWeekId, setCurriculumSourceEffectiveWeekId] = useState('');
  const [showCalendar, setShowCalendar] = useState(true);
  const [showWrongAnswerSection, setShowWrongAnswerSection] = useState(false);
  const [showLegacyRecordsModal, setShowLegacyRecordsModal] = useState(false);
  const [showEntryNotice, setShowEntryNotice] = useState(true);
  const [wrongAnswerUploadModal, setWrongAnswerUploadModal] = useState({
    open: false,
    loading: false,
    error: '',
    uploadUrl: '',
    problemIndex: -1
  });
  const weeksDesc = useMemo(() => [...(weeks || [])].reverse(), [weeks]);

  // 과목 ?�력 보존/?�동?�?�용 draft
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const draftScopeRef = useRef('');
  const profileRef = useRef(null);

  const parentMode = user?.role === 'parent';
  const mentorMode = user?.role === 'mentor';
  const canViewLegacyRecords = ['director', 'admin', 'lead'].includes(String(user?.role || ''));
  const weekRecordId = rec?.week_record?.id;

  function setQueryParams(patch) {
    const cur = Object.fromEntries([...sp.entries()]);
    const next = { ...cur, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] === '' || next[k] == null) delete next[k];
    });
    setSp(next, { replace: true });
  }

  async function loadStudentFeeds() {
    setFeedsError('');
    try {
      const data = await api(`/api/feeds?studentId=${encodeURIComponent(studentId)}&limit=300`);
      setStudentFeeds(Array.isArray(data?.feeds) ? data.feeds : []);
    } catch {
      setStudentFeeds([]);
      setFeedsError('피드 모음을 불러오지 못했습니다.');
    }
  }

  async function loadAll() {
    setError('');
    try {
      const w = await api('/api/weeks');
      const weekList = Array.isArray(w.weeks) ? w.weeks : [];
      setWeeks(weekList);

      const p = await api('/api/permissions');
      setPerms(p.permissions || []);

      if (user?.role && user.role !== 'parent') {
        const rcp = await api('/api/feeds/recipients');
        setRecipients(rcp.recipients || []);
      }

      const hasWeekId = weekId && weekList.some((week) => String(week.id) === String(weekId));
      const effectiveWeek = hasWeekId
        ? weekId
        : (weekList[weekList.length - 1]?.id ? String(weekList[weekList.length - 1].id) : '');
      if (!hasWeekId && effectiveWeek) {
        setWeekId(effectiveWeek);
        setQueryParams({ week: effectiveWeek });
      }

      if (effectiveWeek) {
        const r = await api(
          `/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(effectiveWeek)}`
        );
        setRec(r);
      }

      await loadStudentFeeds();
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    setShowEntryNotice(true);
  }, [studentId]);

  // subjectDrafts 초기??병합: 회차 ?�는 ?�생??바뀌면 reset, 같�? 범위�??�규 과목�?추�?
  useEffect(() => {
    if (!rec?.subject_records) return;
    const scopeKey = `${studentId}:${weekId || ''}`;
    const records = rec.subject_records || [];

    const build = () => {
      const next = {};
      for (const r of records) {
        const id = String(r.id);
        next[id] = {};
        for (const k of SUBJECT_FIELD_KEYS) next[id][k] = r?.[k] ?? '';
      }
      return next;
    };

    if (draftScopeRef.current !== scopeKey) {
      draftScopeRef.current = scopeKey;
      setSubjectDrafts(build());
      return;
    }

    // 같�? 범위�? ?�는 과목�?채�?
    setSubjectDrafts((prev) => {
      const next = { ...(prev || {}) };
      for (const r of records) {
        const id = String(r.id);
        if (!next[id]) {
          next[id] = {};
          for (const k of SUBJECT_FIELD_KEYS) next[id][k] = r?.[k] ?? '';
        }
      }
      return next;
    });
  }, [rec?.subject_records, studentId, weekId]);

  useEffect(() => {
    const preferenceWeekId = rec?.curriculum_source_preference_week_id;
    const effectiveWeekId = rec?.curriculum_source_week_id;
    const preferenceForCurrentWeek = Number(preferenceWeekId) > 0 && Number(preferenceWeekId) < Number(weekId || 0);
    setCurriculumSourceSelection(preferenceForCurrentWeek ? String(preferenceWeekId) : 'auto');
    setCurriculumSourceEffectiveWeekId(effectiveWeekId ? String(effectiveWeekId) : '');
  }, [rec?.curriculum_source_preference_week_id, rec?.curriculum_source_week_id, weekId]);

  async function changeWeek(id) {
    setWeekId(id);
    setQueryParams({ week: id });
    try {
      const r = await api(
        `/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(id)}`
      );
      setRec(r);

      await loadStudentFeeds();
    } catch (e) {
      setError(e.message);
    }
  }

  async function openPrintPage() {
    if (!weekId) {
      setError('회차를 먼저 선택해 주세요.');
      return;
    }

    let popup = null;
    try {
      popup = window.open('about:blank', '_blank');
      if (!popup) throw new Error('팝업이 차단되었습니다. 팝업 차단을 해제해 주세요.');

      popup.document.write(
        '<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family: Malgun Gothic, sans-serif; padding: 20px;">인쇄 페이지를 준비 중입니다...</body></html>'
      );
      popup.document.close();

      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const url = `${API_BASE}/api/print?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(weekId)}&autoprint=1`;
      const res = await fetch(url, { method: 'GET', headers });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          msg = data?.error || data?.message || msg;
        } catch {}
        throw new Error(msg);
      }

      const html = await res.text();
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
    } catch (e) {
      if (popup && !popup.closed) {
        popup.document.open();
        popup.document.write(
          `<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family: Malgun Gothic, sans-serif; padding: 20px;">인쇄 페이지를 열지 못했습니다.<br/><br/>${String(e?.message || '알 수 없는 오류')}</body></html>`
        );
        popup.document.close();
      }
      setError(e?.message || '인쇄 페이지를 열지 못했습니다.');
    }
  }

  const schedule = useMemo(() => safeJson(rec?.student?.schedule_json, {}), [rec]);
  const mentorInfo = useMemo(() => normalizeMentorInfo(rec?.mentor_info), [rec?.mentor_info]);
  const scheduleWeekStart = schedule?.week_start || rec?.week?.start_date || '';
  const weekBaseYear = useMemo(
    () => resolveWeekBaseYear(rec?.week),
    [rec?.week?.start_date, rec?.week?.end_date]
  );
  const currentWeekRound = useMemo(() => getWeekRound(rec?.week), [rec?.week?.id, rec?.week?.label]);
  const showClinicSection = currentWeekRound >= 5 && mentorMode;
  const useNewDailyTaskLayout = useMemo(() => {
    if (typeof rec?.use_new_daily_task_layout === 'boolean') return rec.use_new_daily_task_layout;
    return currentWeekRound >= 4;
  }, [rec?.use_new_daily_task_layout, currentWeekRound]);
  const dailyTasksLastWeekValue = useMemo(() => safeJson(rec?.week_record?.b_daily_tasks, {}), [rec]);
  const dailyTasksThisWeekValue = useMemo(() => safeJson(rec?.week_record?.b_daily_tasks_this_week, {}), [rec]);
  const dailyFeedbackValue = useMemo(() => safeJson(rec?.week_record?.b_lead_daily_feedback, {}), [rec]);
  const clinicEntriesValue = useMemo(() => parseClinicEntries(rec?.week_record?.d_clinic_records), [rec]);
  const wrongAnswerDistributionValue = useMemo(
    () => normalizeWrongAnswerDraftWithSummary(safeJson(rec?.week_record?.e_wrong_answer_distribution, {})),
    [rec]
  );
  const [dailyTasksLastWeekDraft, setDailyTasksLastWeekDraft] = useState(dailyTasksLastWeekValue);
  const [dailyTasksThisWeekDraft, setDailyTasksThisWeekDraft] = useState(dailyTasksThisWeekValue);
  const [dailyFeedbackDraft, setDailyFeedbackDraft] = useState(dailyFeedbackValue);
  const [clinicEntriesDraft, setClinicEntriesDraft] = useState(clinicEntriesValue);
  const [wrongAnswerDistributionDraft, setWrongAnswerDistributionDraft] = useState(wrongAnswerDistributionValue);
  const [wrongAnswerCandidates, setWrongAnswerCandidates] = useState([]);
  const [wrongAnswerSearched, setWrongAnswerSearched] = useState(false);
  const [wrongAnswerTargetProblemIndex, setWrongAnswerTargetProblemIndex] = useState(0);
  const [forcedWrongAnswerAssignment, setForcedWrongAnswerAssignment] = useState(buildForcedAssignmentSeed(null));
  const [collapsedWrongAnswerProblems, setCollapsedWrongAnswerProblems] = useState({});
  const [leadWeeklyDraft, setLeadWeeklyDraft] = useState(rec?.week_record?.c_lead_weekly_feedback || '');
  const [directorCommentDraft, setDirectorCommentDraft] = useState(rec?.week_record?.c_director_commentary || '');

  useEffect(() => setDailyTasksLastWeekDraft(dailyTasksLastWeekValue), [dailyTasksLastWeekValue]);
  useEffect(() => setDailyTasksThisWeekDraft(dailyTasksThisWeekValue), [dailyTasksThisWeekValue]);
  useEffect(() => setDailyFeedbackDraft(dailyFeedbackValue), [dailyFeedbackValue]);
  useEffect(() => setClinicEntriesDraft(clinicEntriesValue), [clinicEntriesValue]);
  useEffect(() => {
    setWrongAnswerDistributionDraft(wrongAnswerDistributionValue);
    const problems = Array.isArray(wrongAnswerDistributionValue?.problems) ? wrongAnswerDistributionValue.problems : [];
    const safeIdx = Math.max(0, Math.min(Number(wrongAnswerTargetProblemIndex || 0), Math.max(0, problems.length - 1)));
    setWrongAnswerTargetProblemIndex(safeIdx);
    setForcedWrongAnswerAssignment(buildForcedAssignmentSeed(problems[safeIdx]));
    setCollapsedWrongAnswerProblems({});
  }, [wrongAnswerDistributionValue]);
  useEffect(() => setLeadWeeklyDraft(rec?.week_record?.c_lead_weekly_feedback || ''), [rec?.week_record?.c_lead_weekly_feedback]);
  useEffect(() => setDirectorCommentDraft(rec?.week_record?.c_director_commentary || ''), [rec?.week_record?.c_director_commentary]);
  useEffect(() => {
    setWrongAnswerCandidates([]);
    setWrongAnswerSearched(false);
    setWrongAnswerTargetProblemIndex(0);
    setForcedWrongAnswerAssignment(buildForcedAssignmentSeed(null));
    setCollapsedWrongAnswerProblems({});
  }, [weekId, studentId]);

  // 보기 ?�책: parent�?server-permission 기반, �??�는 "?�션?� ?�출"
  const canEditA = (field) => canEdit(perms, user?.role, field);
  const canViewA = (field) => (parentMode ? canView(perms, user?.role, field) : true);
  const curriculumSourceOptions = useMemo(
    () =>
      [...(weeks || [])]
        .filter((w) => Number(w?.id) < Number(weekId || 0))
        .reverse(),
    [weeks, weekId]
  );
  const curriculumSourceWeek = useMemo(
    () => (weeks || []).find((w) => String(w.id) === String(curriculumSourceEffectiveWeekId)),
    [weeks, curriculumSourceEffectiveWeekId]
  );

  async function addSubject() {
    if (!newSubject.trim()) return;
    setBusy(true);
    try {
      confirmOrThrow('과목을 추가할까요?');
      await api(`/api/mentoring/subjects/${studentId}`, { method: 'POST', body: { name: newSubject.trim() } });
      setNewSubject('');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSubject(subjectId, subjectName) {
    if (!subjectId) return;
    if (!weekId) {
      setError('회차를 먼저 선택해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const label = subjectName ? `"${subjectName}"` : '해당 과목';
      confirmOrThrow(`과목 ${label} 삭제할까요?\n현재 선택한 회차 이후의 기록만 삭제됩니다.`);
      await api(`/api/mentoring/subjects/${studentId}/${subjectId}?weekId=${encodeURIComponent(weekId)}`, { method: 'DELETE' });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyCurriculumSourceSelection() {
    if (!weekId) {
      setError('회차를 먼저 선택해 주세요.');
      return;
    }

    const sourceWeekId = curriculumSourceSelection === 'auto'
      ? null
      : Number(curriculumSourceSelection);
    const sourceWeekLabel = sourceWeekId
      ? toRoundLabel((weeks || []).find((w) => Number(w.id) === sourceWeekId)?.label || `${sourceWeekId}회차`)
      : '자동(이전 회차)';

    setBusy(true);
    try {
      confirmOrThrow(
        sourceWeekId
          ? `${sourceWeekLabel} 커리큘럼을 현재 회차에 불러오고, 다음 회차에도 이 선택을 유지할까요?`
          : '커리큘럼 불러오기 기준을 자동(이전 회차)으로 전환하고 현재 회차에 적용할까요?'
      );
      const result = await api('/api/mentoring/curriculum-source', {
        method: 'PUT',
        body: {
          student_id: Number(studentId),
          week_id: Number(weekId),
          source_week_id: sourceWeekId
        }
      });
      setCurriculumSourceSelection(result?.curriculum_source_preference_week_id ? String(result.curriculum_source_preference_week_id) : 'auto');
      setCurriculumSourceEffectiveWeekId(result?.curriculum_source_week_id ? String(result.curriculum_source_week_id) : '');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveWeekRecord(patch) {
    if (!weekRecordId) return;
    setBusy(true);
    try {
      confirmOrThrow('주간 기록을 저장할까요?');
      await api(`/api/mentoring/week-record/${weekRecordId}`, { method: 'PUT', body: patch });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function autoSaveWeekRecord(patch) {
    if (!weekRecordId || parentMode) return;
    try {
      await api(`/api/mentoring/week-record/${weekRecordId}`, { method: 'PUT', body: patch });
    } catch (e) {
      setError(e?.message || '주간 기록 저장에 실패했습니다.');
    }
  }

  function updateWrongAnswerProblem(index, patch) {
    setWrongAnswerDistributionDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      const list = Array.isArray(base.problems) ? [...base.problems] : [];
      if (!list[index]) list[index] = { ...DEFAULT_WRONG_ANSWER_ITEM, assignment: null };
      const currentItem = normalizeWrongAnswerItem(list[index]);
      list[index] = { ...currentItem, ...patch };
      return {
        ...base,
        problems: list,
        assignment: pickSummaryAssignmentFromProblems(list, null)
      };
    });
  }

  function addWrongAnswerProblem() {
    setWrongAnswerDistributionDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      return {
        ...base,
        problems: [...(base.problems || []), { ...DEFAULT_WRONG_ANSWER_ITEM, assignment: null }]
      };
    });
  }

  function removeWrongAnswerProblem(index) {
    setWrongAnswerDistributionDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      const next = (base.problems || []).filter((_, idx) => idx !== index);
      const nextProblems = next.length ? next : [{ ...DEFAULT_WRONG_ANSWER_ITEM, assignment: null }];
      const summaryAssignment = pickSummaryAssignmentFromProblems(nextProblems, null);
      return {
        ...base,
        problems: nextProblems,
        assignment: summaryAssignment
      };
    });
    setWrongAnswerTargetProblemIndex((prev) => Math.max(0, Number(prev || 0) - (Number(prev || 0) > index ? 1 : 0)));
    setCollapsedWrongAnswerProblems((prev) => {
      const next = {};
      for (const [key, value] of Object.entries(prev || {})) {
        if (!value) continue;
        const numericKey = Number(key);
        if (!Number.isInteger(numericKey)) continue;
        if (numericKey < index) next[numericKey] = true;
        if (numericKey > index) next[numericKey - 1] = true;
      }
      return next;
    });
  }

  function collapseWrongAnswerProblem(index) {
    setCollapsedWrongAnswerProblems((prev) => ({ ...(prev || {}), [Number(index || 0)]: true }));
  }

  function expandWrongAnswerProblem(index) {
    setCollapsedWrongAnswerProblems((prev) => {
      const next = { ...(prev || {}) };
      delete next[Number(index || 0)];
      return next;
    });
  }

  function removeWrongAnswerImageLocal(problemIndex, targetImage, imageIndex = -1) {
    setWrongAnswerDistributionDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      const list = Array.isArray(base.problems) ? [...base.problems] : [];
      if (!list[problemIndex]) return base;

      const current = normalizeWrongAnswerItem(list[problemIndex]);
      const targetId = String(targetImage?.id || '').trim();
      const targetUrl = String(targetImage?.url || '').trim();

      const nextImages = (Array.isArray(current.images) ? current.images : []).filter((img, idx) => {
        if (targetId) return String(img?.id || '').trim() !== targetId;
        if (targetUrl) return String(img?.url || '').trim() !== targetUrl;
        return idx !== imageIndex;
      });

      list[problemIndex] = {
        ...current,
        images: nextImages
      };
      return {
        ...base,
        problems: list,
        assignment: pickSummaryAssignmentFromProblems(list, null)
      };
    });
  }

  async function removeWrongAnswerImage(problemIndex, targetImage, imageIndex = -1) {
    const imageId = String(targetImage?.id || '').trim();
    const canServerDelete = Boolean(weekRecordId && weekId && studentId && imageId);
    if (!canServerDelete) {
      removeWrongAnswerImageLocal(problemIndex, targetImage, imageIndex);
      return;
    }

    try {
      const result = await api('/api/mentoring/wrong-answer/delete-image', {
        method: 'POST',
        body: {
          student_id: Number(studentId),
          week_id: Number(weekId),
          problem_index: Number(problemIndex),
          image_id: imageId
        }
      });
      if (result?.e_wrong_answer_distribution) {
        const latestWrongAnswer = normalizeWrongAnswerDraftWithSummary(result.e_wrong_answer_distribution);
        setWrongAnswerDistributionDraft((prev) =>
          mergeWrongAnswerDraftKeepingLocalInputs(prev, latestWrongAnswer)
        );
      } else {
        removeWrongAnswerImageLocal(problemIndex, targetImage, imageIndex);
      }
    } catch (e) {
      setError(e?.message || '문제 이미지 삭제에 실패했습니다.');
    }
  }

  function selectWrongAnswerProblem(index) {
    const safe = Math.max(0, Number(index || 0));
    setWrongAnswerTargetProblemIndex(safe);
    const base = normalizeWrongAnswerDraftWithSummary(wrongAnswerDistributionDraft);
    const item = Array.isArray(base.problems) ? base.problems[safe] : null;
    setForcedWrongAnswerAssignment(buildForcedAssignmentSeed(item));
  }

  function findWrongAnswerCandidates(problemIndex = wrongAnswerTargetProblemIndex) {
    const safe = Math.max(0, Number(problemIndex || 0));
    selectWrongAnswerProblem(safe);
    const candidates = buildOverlapCandidates(schedule, mentorInfo);
    setWrongAnswerCandidates(candidates);
    setWrongAnswerSearched(true);
    setWrongAnswerDistributionDraft((prev) => ({
      ...normalizeWrongAnswerDraftWithSummary(prev),
      searched_at: new Date().toISOString()
    }));
  }

  function toggleWrongAnswerSection() {
    setShowWrongAnswerSection((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('오답 배분 섹션이 활성화되었습니다.');
      }
      return next;
    });
  }

  function closeWrongAnswerUploadModal() {
    setWrongAnswerUploadModal({
      open: false,
      loading: false,
      error: '',
      uploadUrl: '',
      problemIndex: -1
    });
  }

  async function openWrongAnswerImageUpload(problemIndex) {
    if (!studentId || !weekId) return;
    setWrongAnswerUploadModal({
      open: true,
      loading: true,
      error: '',
      uploadUrl: '',
      problemIndex
    });
    try {
      const data = await api('/api/mentoring/wrong-answer/upload-link', {
        method: 'POST',
        body: {
          student_id: Number(studentId),
          week_id: Number(weekId),
          problem_index: Number(problemIndex)
        }
      });
      const uploadUrl = String(data?.upload_url || '').trim();
      if (!uploadUrl) throw new Error('업로드 링크를 만들지 못했습니다.');
      setWrongAnswerUploadModal({
        open: true,
        loading: false,
        error: '',
        uploadUrl,
        problemIndex
      });
    } catch (e) {
      setWrongAnswerUploadModal({
        open: true,
        loading: false,
        error: e?.message || '업로드 링크 생성에 실패했습니다.',
        uploadUrl: '',
        problemIndex
      });
    }
  }

  async function refreshWrongAnswerUploadedImages() {
    if (!studentId || !weekId) return;
    setBusy(true);
    try {
      const latest = await api(
        `/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(weekId)}`
      );
      const latestWrongAnswer = normalizeWrongAnswerDraftWithSummary(
        safeJson(latest?.week_record?.e_wrong_answer_distribution, {})
      );
      setWrongAnswerDistributionDraft((prev) =>
        mergeWrongAnswerDraftKeepingLocalInputs(prev, latestWrongAnswer)
      );
    } catch (e) {
      setError(e?.message || '업로드 반영 새로고침에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function buildWrongAnswerAssignmentFromCandidate(candidate, previousAssignment = null, patch = {}) {
    const previous = normalizeWrongAnswerAssignment(previousAssignment || null) || {};
    return normalizeWrongAnswerAssignment({
      mentor_id: String(candidate?.mentor_id || '').trim(),
      mentor_name: String(candidate?.mentor_name || '').trim(),
      mentor_role: String(candidate?.mentor_role || '').trim() || 'mentor',
      mentor_subjects: Array.isArray(candidate?.mentor_subjects) ? candidate.mentor_subjects : [],
      mentor_work_slots: Array.isArray(candidate?.mentor_work_slots)
        ? candidate.mentor_work_slots
            .map((slot) => ({
              day: String(slot?.day || ''),
              time: String(slot?.time || '')
            }))
            .filter((slot) => slot.day && slot.time)
        : [],
      overlap_count: Number(candidate?.overlaps?.length || 0),
      overlap_preview: (candidate?.overlaps || [])
        .slice(0, 4)
        .map((item) => `${DAY_LABELS[item.day] || item.day} ${item.student_time}`),
      session_day_label: String(patch.session_day_label ?? previous.session_day_label ?? '').trim(),
      session_month: String(patch.session_month ?? previous.session_month ?? '').trim(),
      session_day: String(patch.session_day ?? previous.session_day ?? '').trim(),
      session_start_time: String(
        patch.session_start_time ?? previous.session_start_time ?? previous.session_time ?? ''
      ).trim(),
      session_duration_minutes: Math.max(
        1,
        Math.min(
          240,
          Number(patch.session_duration_minutes ?? previous.session_duration_minutes ?? 20) || 20
        )
      ),
      assigned_at: new Date().toISOString(),
      assigned_by: user?.role || ''
    });
  }

  function assignWrongAnswerMentor(candidate, problemIndex = wrongAnswerTargetProblemIndex, assignmentPatch = {}) {
    if (!candidate) return;
    setWrongAnswerDistributionDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      const list = Array.isArray(base.problems) ? [...base.problems] : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
      const safeIndex = Math.max(0, Math.min(Number(problemIndex || 0), Math.max(0, list.length - 1)));
      const currentItem = normalizeWrongAnswerItem(list[safeIndex] || {});
      const previousAssignment = normalizeWrongAnswerAssignment(currentItem.assignment || base.assignment || null);
      const nextAssignment = buildWrongAnswerAssignmentFromCandidate(candidate, previousAssignment, assignmentPatch);
      list[safeIndex] = {
        ...currentItem,
        assignment: nextAssignment
      };

      const summaryAssignment = pickSummaryAssignmentFromProblems(list, null);
      return {
        ...base,
        problems: list,
        assignment: summaryAssignment
      };
    });
    setWrongAnswerSearched(false);
  }

  function updateWrongAnswerAssignment(problemIndex, patch) {
    setWrongAnswerDistributionDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      const list = Array.isArray(base.problems) ? [...base.problems] : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
      const safeIndex = Math.max(0, Math.min(Number(problemIndex || 0), Math.max(0, list.length - 1)));
      const currentItem = normalizeWrongAnswerItem(list[safeIndex] || {});
      const current = normalizeWrongAnswerAssignment(currentItem.assignment || base.assignment || null) || {};
      const nextAssignment = normalizeWrongAnswerAssignment({
        ...current,
        session_day_label: String(current.session_day_label || '').trim(),
        session_month: String(current.session_month || '').trim(),
        session_day: String(current.session_day || '').trim(),
        session_start_time: String(current.session_start_time || current.session_time || '').trim(),
        session_duration_minutes: Math.max(
          1,
          Math.min(240, Number(current.session_duration_minutes || 20) || 20)
        ),
        ...patch
      });
      list[safeIndex] = {
        ...currentItem,
        assignment: nextAssignment
      };
      const summaryAssignment = pickSummaryAssignmentFromProblems(list, null);
      return {
        ...base,
        problems: list,
        assignment: summaryAssignment
      };
    });
  }

  function applyForcedWrongAnswerAssignment(problemIndex = wrongAnswerTargetProblemIndex) {
    const mentorName = String(forcedWrongAnswerAssignment?.mentor_name || '').trim();
    if (!mentorName) {
      setError('강제 배정 멘토 이름을 입력해 주세요.');
      return;
    }
    const forcedCandidate = {
      mentor_id: mentorName,
      mentor_name: mentorName,
      mentor_role: String(forcedWrongAnswerAssignment?.mentor_role || 'mentor').trim() || 'mentor',
      mentor_subjects: [],
      mentor_work_slots: [],
      overlaps: []
    };
    assignWrongAnswerMentor(forcedCandidate, problemIndex, {
      session_day_label: String(forcedWrongAnswerAssignment?.session_day_label || '').trim(),
      session_month: String(forcedWrongAnswerAssignment?.session_month || '').trim(),
      session_day: String(forcedWrongAnswerAssignment?.session_day || '').trim(),
      session_start_time: String(forcedWrongAnswerAssignment?.session_start_time || '').trim(),
      session_duration_minutes: Math.max(
        1,
        Math.min(240, Number(forcedWrongAnswerAssignment?.session_duration_minutes || 20) || 20)
      )
    });
  }

  async function saveWrongAnswerDistribution() {
    if (!weekRecordId || !canEditA('e_wrong_answer_distribution')) return;
    setBusy(true);
    try {
      confirmOrThrow('오답 배분 기록을 저장할까요?');
      const payload = normalizeWrongAnswerDraftWithSummary(wrongAnswerDistributionDraft);
      await api(`/api/mentoring/week-record/${weekRecordId}`, {
        method: 'PUT',
        body: { e_wrong_answer_distribution: payload }
      });
      await loadAll();
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('오답 배분이 완료되었습니다.');
      }
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e?.message || '오답 배분 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function submitWrongAnswerProblem(index) {
    if (!weekRecordId || !canEditA('e_wrong_answer_distribution')) return;
    setBusy(true);
    setError('');
    try {
      const payload = normalizeWrongAnswerDraftWithSummary(wrongAnswerDistributionDraft);
      await api(`/api/mentoring/week-record/${weekRecordId}`, {
        method: 'PUT',
        body: { e_wrong_answer_distribution: payload }
      });
      collapseWrongAnswerProblem(index);
      setWrongAnswerSearched(false);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`오답 기록 ${Number(index) + 1}이(가) 제출되었습니다.`);
      }
    } catch (e) {
      setError(e?.message || '오답 기록 제출에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function doMentorSubmit() {
    setBusy(true);
    try {
      confirmOrThrow('클리닉 멘토 제출을 진행할까요?');
      await api('/api/mentoring/workflow/submit', {
        method: 'POST',
        body: { student_id: Number(studentId), week_id: Number(weekId) }
      });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doShare() {
    setBusy(true);
    try {
      confirmOrThrow('해당 회차 기록을 학부모와 공유할까요?');
      if (weekRecordId) {
        await api(`/api/mentoring/week-record/${weekRecordId}`, {
          method: 'PUT',
          body: { shared_with_parent: 1 }
        });
      } else {
        await api('/api/mentoring/workflow/share-with-parent', {
          method: 'POST',
          body: { student_id: Number(studentId), week_id: Number(weekId) }
        });
      }
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [leadReason, setLeadReason] = useState('');
  async function submitToDirector() {
    setBusy(true);
    try {
      confirmOrThrow('원장께 제출할까요?');
      await api('/api/mentoring/workflow/submit-to-director', {
        method: 'POST',
        body: { student_id: Number(studentId), week_id: Number(weekId), reason: leadReason }
      });
      setLeadReason('');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [directorNote, setDirectorNote] = useState('');
  async function sendToLead() {
    setBusy(true);
    try {
      confirmOrThrow('총괄멘토에게 전송할까요?');
      await api('/api/mentoring/workflow/send-to-lead', {
        method: 'POST',
        body: { student_id: Number(studentId), week_id: Number(weekId), note: directorNote }
      });
      setDirectorNote('');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const fieldOptions = useMemo(() => {
    return (perms || []).map((p) => ({ key: p.field_key, label: p.label || p.field_key }));
  }, [perms]);

  // 받는 ?�??구성:
  // - ?�버 recipients?�서 role==='mentor'???�외
  // - ?�??"?�습멘토(?�체기록)" = ?�재 로그???�용??id) ?�션 추�?(멘토 계정????
  const recipientOptions = useMemo(() => {
    const base = Array.isArray(recipients) ? recipients.filter((r) => r.role !== 'mentor') : [];
    const out = [...base];

    if (user?.id && user?.role === 'mentor') {
      out.unshift({
        id: user.id,
        role: 'mentor',
        display_name: '클리닉 멘토(전체기록)'
      });
    }
    return out;
  }, [recipients, user?.id, user?.role]);

  async function sendFeed(e) {
    e.preventDefault();
    if (!feedForm.to_user_id || !feedForm.title.trim() || !feedForm.body.trim()) return;

    setBusy(true);
    try {
      confirmOrThrow('피드를 전송할까요?');
      await api('/api/feeds', {
        method: 'POST',
        body: {
          to_user_id: Number(feedForm.to_user_id),
          student_id: Number(studentId),
          target_field: feedForm.target_field || null,
          title: feedForm.title.trim(),
          body: feedForm.body
        }
      });
      setFeedForm({ to_user_id: '', target_field: '', title: '', body: '' });
      await loadStudentFeeds();
    } catch (e2) {
      if (e2?.message !== '__CANCEL__') setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function addFeedComment(feedId, body) {
    if (!body.trim()) return;
    try {
      await api(`/api/feeds/${feedId}/comments`, { method: 'POST', body: { body } });
      await loadStudentFeeds();
    } catch (e) {
      setFeedsError(e?.message || '피드 댓글 등록에 실패했습니다.');
    }
  }

  async function deleteFeed(feedId) {
    try {
      confirmOrThrow('피드를 삭제할까요?');
      await api(`/api/feeds/${feedId}`, { method: 'DELETE' });
      await loadStudentFeeds();
    } catch (e) {
      if (e?.message === '__CANCEL__') return;
      setFeedsError(e?.message || '피드 삭제에 실패했습니다.');
    }
  }

  // 과목 기록
  const subjectRecords = rec?.subject_records || [];

  function updateSubjectDraft(subjectRecordId, patch) {
    const sid = String(subjectRecordId);
    setSubjectDrafts((prev) => {
      const cur = prev?.[sid] || {};
      return {
        ...(prev || {}),
        [sid]: { ...cur, ...patch }
      };
    });
  }

  async function autoSaveOneSubject(subjectRecordId) {
    const sid = String(subjectRecordId);
    if (!sid) return;
    const draft = subjectDrafts?.[sid];
    if (!draft) return;

    try {
      const body = {};
      for (const k of SUBJECT_FIELD_KEYS) body[k] = draft?.[k] ?? '';
      await api(`/api/mentoring/subject-record/${sid}`, { method: 'PUT', body });
    } catch (e) {
      // 저장 실패 시 draft 유지
      setError(e?.message || '과목 기록 저장에 실패했습니다.');
    }
  }

  async function saveAllSubjectsCore({ confirm = true } = {}) {
    if (!subjectRecords.length) return;
    const editableKeys = SUBJECT_FIELD_KEYS.filter((k) => canEdit(perms, user?.role, k));
    if (!editableKeys.length) return;
    if (confirm) confirmOrThrow('모든 과목 진도를 저장할까요?');

    for (const r of subjectRecords) {
      const sid = String(r.id);
      const draft = subjectDrafts?.[sid] || {};
      const body = {};
      for (const k of editableKeys) body[k] = draft?.[k] ?? '';
      await api(`/api/mentoring/subject-record/${sid}`, { method: 'PUT', body });
    }
  }

  async function saveAllSubjects() {
    setBusy(true);
    try {
      await saveAllSubjectsCore({ confirm: true });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!weekRecordId) {
      setError('회차를 먼저 선택해 주세요.');
      return;
    }

    setError('');
    setBusy(true);
    try {
      confirmOrThrow('전체 저장할까요?');
      const patch = {};
      if (!mentorMode && canEditA('b_daily_tasks')) patch.b_daily_tasks = dailyTasksLastWeekDraft;
      if (!mentorMode && useNewDailyTaskLayout) {
        if (canEditA('b_daily_tasks_this_week')) patch.b_daily_tasks_this_week = dailyTasksThisWeekDraft;
      } else {
        if (!mentorMode && canEditA('b_lead_daily_feedback')) patch.b_lead_daily_feedback = dailyFeedbackDraft;
      }
      if (!mentorMode && canEditA('c_lead_weekly_feedback')) patch.c_lead_weekly_feedback = leadWeeklyDraft;
      if (!mentorMode && canEditA('c_director_commentary')) patch.c_director_commentary = directorCommentDraft;
      if (showClinicSection && canEditA('d_clinic_records')) patch.d_clinic_records = clinicEntriesDraft;
      if (!mentorMode && canEditA('e_wrong_answer_distribution')) {
        patch.e_wrong_answer_distribution = normalizeWrongAnswerDraftWithSummary(wrongAnswerDistributionDraft);
      }

      if (Object.keys(patch).length) {
        await api(`/api/mentoring/week-record/${weekRecordId}`, {
          method: 'PUT',
          body: patch
        });
      }

      if (!mentorMode) {
        await saveAllSubjectsCore({ confirm: false });
      }

      if (profileRef.current?.saveProfile && user?.role !== 'parent' && user?.role !== 'mentor') {
        await profileRef.current.saveProfile({ confirm: false, manageBusy: false });
      }

      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e?.message || '전체 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }


  // ?�드 3??분해
  const groupedFeeds = useMemo(() => {
    const arr = Array.isArray(studentFeeds) ? [...studentFeeds] : [];
    arr.sort((a, b) => {
      const ra = ROLE_ORDER[a?.from_role] ?? 99;
      const rb = ROLE_ORDER[b?.from_role] ?? 99;
      if (ra !== rb) return ra - rb;
      const ta = new Date(a?.created_at || 0).getTime();
      const tb = new Date(b?.created_at || 0).getTime();
      return tb - ta;
    });

    const director = [];
    const lead = [];
    const admin = [];

    for (const f of arr) {
      if (f?.from_role === 'director') director.push(f);
      else if (f?.from_role === 'lead') lead.push(f);
      else admin.push(f); // admin + 기�?(mentor ??
    }
    return { director, lead, admin };
  }, [studentFeeds]);

  if (!rec) {
    return (
      <div className="relative">
        <PageBackground />
        <GoldCard className="p-5">
          <div className="text-sm text-slate-700">데이터를 불러오는 중...</div>
          {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
        </GoldCard>
      </div>
    );
  }

  return (
    <div className="relative">
      <PageBackground />

      <div className="space-y-6 pb-10">
        <GoldCard className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-brand-900">멘토링 기록</div>
              <div className="text-sm text-slate-800">
                {rec.student.name} · {rec.student.grade || ''}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select className="input w-44" value={weekId} onChange={(e) => changeWeek(e.target.value)}>
                {weeksDesc.map((w) => (
                  <option key={w.id} value={w.id}>
                    {fmtWeekLabel(w) || toRoundLabel(w.label)}
                  </option>
                ))}
              </select>
              <button className="btn-ghost" type="button" onClick={openPrintPage}>
                인쇄
              </button>
              <button className="btn-ghost" onClick={loadAll}>
                새로고침
              </button>
              <button className="btn-primary" onClick={saveAll} disabled={busy}>
                전체 저장
              </button>
              {user?.role !== 'mentor' && canViewA('e_wrong_answer_distribution') ? (
                <button
                  className="btn text-white border border-blue-700 bg-gradient-to-b from-blue-500 to-blue-600 shadow-sm hover:from-blue-600 hover:to-blue-700"
                  type="button"
                  onClick={toggleWrongAnswerSection}
                >
                  {showWrongAnswerSection ? '오답 배분 닫기' : '오답 배분하기'}
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-2 text-xs text-rose-600">
            *정보 입력 후 반드시 전체 저장 버튼을 눌러주세요.
          </div>
          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </GoldCard>

        {/* (2) 학생 정보 분리(가로형) + (성적/내신은 아래 카드) */}
        <StudentProfileSection
          ref={profileRef}
          studentId={studentId}
          profileJson={rec?.student?.profile_json}
          userRole={user?.role}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
        />

        {/* 캘린더 */}
        <GoldCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-brand-900">{rec.student.name} 주간 캘린더</div>
              <div className="text-xs text-slate-700">
                {schedule?.week_range_text ? schedule.week_range_text : '주간 일정 · 가로형'}
              </div>
            </div>
            <button className="btn-ghost" onClick={() => setShowCalendar((v) => !v)}>
              {showCalendar ? '닫기' : '열기'}
            </button>
          </div>

          {showCalendar ? <WeeklyCalendar schedule={schedule} weekStart={scheduleWeekStart} /> : null}
        </GoldCard>

        {user?.role !== 'mentor' && canViewA('e_wrong_answer_distribution') && showWrongAnswerSection ? (
          <GoldCard className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-brand-900">오답 배분하기</div>
                <div className="text-xs text-slate-700">
                  학생이 어려워하는 문제를 기록하고, 학생 일정과 겹치는 멘토에게 배정합니다.
                </div>
              </div>
              {canEditA('e_wrong_answer_distribution') && !parentMode ? (
                <button className="btn-primary" type="button" disabled={busy} onClick={saveWrongAnswerDistribution}>
                  저장
                </button>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {(Array.isArray(wrongAnswerDistributionDraft?.problems) ? wrongAnswerDistributionDraft.problems : []).map((item, idx) => {
                const problemAssignment = normalizeWrongAnswerAssignment(
                  item?.assignment || (idx === 0 ? wrongAnswerDistributionDraft?.assignment : null)
                );
                const problemDateInputValue = buildDateInputValue(
                  problemAssignment?.session_month,
                  problemAssignment?.session_day,
                  weekBaseYear
                );
                const problemSessionStartTime = String(problemAssignment?.session_start_time || '').trim();
                const problemSessionRangeText = makeSessionRangeText(
                  problemSessionStartTime,
                  problemAssignment?.session_duration_minutes
                );
                const forcedDateInputValue = buildDateInputValue(
                  forcedWrongAnswerAssignment?.session_month,
                  forcedWrongAnswerAssignment?.session_day,
                  weekBaseYear
                );
                const tone = wrongAnswerToneByIndex(idx);
                const isTargetProblem = Number(wrongAnswerTargetProblemIndex || 0) === idx;
                const isCollapsed = Boolean(collapsedWrongAnswerProblems?.[idx]);
                const showMentorPickerForProblem = wrongAnswerSearched && isTargetProblem;
                return (
                <div
                  key={idx}
                  className={[
                    'rounded-2xl border p-3',
                    tone.card,
                    isTargetProblem ? `ring-1 ${tone.ring}` : ''
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">오답 기록 {idx + 1}</div>
                    {canEditA('e_wrong_answer_distribution') && !parentMode ? (
                      <div className="flex items-center gap-2">
                        <button
                          className={[
                            tone.assignButton,
                            isTargetProblem ? `ring-2 ring-offset-1 ${tone.ring}` : ''
                          ].join(' ')}
                          type="button"
                          onClick={() => findWrongAnswerCandidates(idx)}
                        >
                          멘토 배정하기
                        </button>
                        <button
                          className="btn border border-blue-700 bg-blue-600 text-white hover:border-blue-800 hover:bg-blue-700"
                          type="button"
                          disabled={busy}
                          onClick={() => submitWrongAnswerProblem(idx)}
                        >
                          완료 및 제출
                        </button>
                        {isCollapsed ? (
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => expandWrongAnswerProblem(idx)}
                          >
                            펼쳐보기
                          </button>
                        ) : null}
                        <button
                          className="btn-ghost border-blue-200 text-blue-700 hover:border-blue-300 hover:text-blue-800"
                          type="button"
                          onClick={() => openWrongAnswerImageUpload(idx)}
                        >
                          문제 이미지 업로드하기
                        </button>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => removeWrongAnswerProblem(idx)}
                          disabled={(wrongAnswerDistributionDraft?.problems || []).length <= 1}
                        >
                          삭제
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {isCollapsed ? (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                      <div className="text-xs text-slate-700">
                        {String(item.subject || '').trim() || '-'} · {String(item.problem_name || '').trim() || '문제명 미입력'} · {String(item.problem_type || '').trim() || '-'}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        멘토: {problemAssignment?.mentor_name || '미배정'} / 일정: {problemAssignment?.session_month || '-'}월 {problemAssignment?.session_day || '-'}일 {problemAssignment?.session_start_time || '--:--'} / 진행 {problemAssignment?.session_duration_minutes || 20}분
                      </div>
                    </div>
                  ) : null}
                  {!isCollapsed ? (
                  <>
                  <div className="mt-3 grid grid-cols-12 gap-3">
                    <div className="col-span-12 md:col-span-3">
                      <div className="text-xs text-slate-800">과목</div>
                      <input
                        className="input mt-1"
                        value={item.subject || ''}
                        onChange={(e) => updateWrongAnswerProblem(idx, { subject: e.target.value })}
                        disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <div className="text-xs text-slate-800">교재명</div>
                      <input
                        className="input mt-1"
                        value={item.material || ''}
                        onChange={(e) => updateWrongAnswerProblem(idx, { material: e.target.value })}
                        disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <div className="text-xs text-slate-800">문제명</div>
                      <input
                        className="input mt-1"
                        value={item.problem_name || ''}
                        onChange={(e) => updateWrongAnswerProblem(idx, { problem_name: e.target.value })}
                        disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      <div className="text-xs text-slate-800">유형</div>
                      <input
                        className="input mt-1"
                        value={item.problem_type || ''}
                        onChange={(e) => updateWrongAnswerProblem(idx, { problem_type: e.target.value })}
                        disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                      />
                    </div>
                    <div className="col-span-12 md:col-span-6">
                      <div className="h-full min-h-[110px] rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex flex-col">
                        <div className="text-xs font-semibold text-slate-800">전달사항</div>
                        <textarea
                          className="textarea mt-2 min-h-[68px]"
                          value={item.note || ''}
                          onChange={(e) => updateWrongAnswerProblem(idx, { note: e.target.value })}
                          disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                        />
                      </div>
                    </div>
                    <div className="col-span-12 md:col-span-6">
                      <div className="h-full min-h-[110px] rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex flex-col">
                        <div className="text-xs font-semibold text-slate-800">배정된 멘토</div>
                        {problemAssignment?.mentor_name ? (
                          <>
                            <div className="mt-1 text-sm font-semibold text-slate-900">
                              {problemAssignment.mentor_name}
                            </div>
                            <div className="text-xs text-slate-700">
                              {wrongAnswerRoleLabel(problemAssignment.mentor_role)}
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              {(problemAssignment.mentor_work_slots || []).length
                                ? problemAssignment.mentor_work_slots
                                    .map((slot) => `${DAY_LABELS[slot.day] || slot.day} ${slot.time}`)
                                    .join(' / ')
                                : '근무 시간 정보 없음'}
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 text-xs text-slate-600">멘토를 먼저 배정해 주세요.</div>
                        )}
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <div className="text-[11px] text-slate-600">배정 날짜</div>
                            <input
                              className="input mt-1 h-9"
                              type="date"
                              value={problemDateInputValue}
                              onChange={(e) => {
                                const nextDate = String(e.target.value || '').trim();
                                if (!nextDate) {
                                  updateWrongAnswerAssignment(idx, {
                                    session_month: '',
                                    session_day: '',
                                    session_day_label: ''
                                  });
                                  return;
                                }
                                const parsed = parseDateInputValue(nextDate);
                                if (!parsed) return;
                                updateWrongAnswerAssignment(idx, {
                                  session_month: String(parsed.month),
                                  session_day: String(parsed.day),
                                  session_day_label: parsed.dayLabel || ''
                                });
                              }}
                              disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                            />
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-600">시작 시각(선택)</div>
                            <div className="mt-1 space-y-1.5">
                              <input
                                className="input h-9 w-full"
                                type="time"
                                value={problemAssignment?.session_start_time || ''}
                                onChange={(e) =>
                                  updateWrongAnswerAssignment(idx, {
                                    session_start_time: String(e.target.value || '').trim()
                                  })
                                }
                                disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                              />
                              <div className="flex justify-end">
                                <button
                                  className="btn-ghost h-8 px-2 text-[11px]"
                                  type="button"
                                  onClick={() =>
                                    updateWrongAnswerAssignment(idx, {
                                      session_start_time: ''
                                    })
                                  }
                                  disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                                >
                                  미선택
                                </button>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-600">요일(수동)</div>
                            <div className="mt-1 space-y-1.5">
                              <select
                                className="input h-9 w-full"
                                value={problemAssignment?.session_day_label || ''}
                                onChange={(e) =>
                                  updateWrongAnswerAssignment(idx, {
                                    session_day_label: String(e.target.value || '').trim()
                                  })
                                }
                                disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                              >
                                <option value="">선택</option>
                                {KO_WEEK_DAYS.map((day) => (
                                  <option key={`wrong-answer-day-${idx}-${day}`} value={day}>{day}</option>
                                ))}
                              </select>
                              <div className="flex justify-end">
                                <button
                                  className="btn-ghost h-8 px-2 text-[11px]"
                                  type="button"
                                  onClick={() =>
                                    updateWrongAnswerAssignment(idx, {
                                      session_day_label: ''
                                    })
                                  }
                                  disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                                >
                                  미선택
                                </button>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-600">진행 시간(분)</div>
                            <input
                              className="input mt-1 h-9"
                              type="number"
                              min={1}
                              max={240}
                              step={1}
                              value={problemAssignment?.session_duration_minutes || 20}
                              onChange={(e) =>
                                updateWrongAnswerAssignment(idx, {
                                  session_duration_minutes: Math.max(
                                    1,
                                    Math.min(240, Number(e.target.value || 20) || 20)
                                  )
                                })
                              }
                              disabled={!canEditA('e_wrong_answer_distribution') || parentMode}
                            />
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          자동 반영: {problemAssignment?.session_day_label || '-'}요일 · {problemAssignment?.session_month || '-'}월 {problemAssignment?.session_day || '-'}일 · {problemSessionStartTime || '--:--'}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          시작 시각 입력은 필수가 아닙니다. 날짜만 배정해도 해당 회차에 반영됩니다.
                        </div>
                        <div className={`mt-2 text-[11px] ${problemSessionRangeText ? 'text-slate-600' : 'text-slate-500'}`}>
                          등록된 시작 시각: {problemSessionStartTime || '--:--'}
                          {problemSessionRangeText ? ` · 범위: ${problemSessionRangeText}` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                  {Array.isArray(item.images) && item.images.length ? (
                    <div className="mt-3">
                      <div className="text-xs text-slate-700">업로드된 문제 이미지 ({item.images.length}장)</div>
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                        {item.images.map((img, imageIdx) => (
                          <div
                            key={img.id || `${img.url}-${imageIdx}`}
                            className="relative block shrink-0 rounded-lg border border-slate-200 bg-white p-1"
                            title={img.filename || '문제 이미지'}
                          >
                            <a href={wrongAnswerImageUrl(img.url)} target="_blank" rel="noreferrer">
                              <img
                                src={wrongAnswerImageUrl(img.url)}
                                alt={img.filename || '문제 이미지'}
                                className="h-20 w-20 rounded-md object-cover"
                                loading="lazy"
                              />
                            </a>
                            {canEditA('e_wrong_answer_distribution') && !parentMode ? (
                              <button
                                type="button"
                                className="absolute right-1 top-1 rounded-md border border-rose-200 bg-white/95 px-1.5 py-0.5 text-[10px] text-rose-700 shadow-sm hover:bg-rose-50"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const ok = window.confirm('이 문제 이미지를 삭제할까요?');
                                  if (!ok) return;
                                  void removeWrongAnswerImage(idx, img, imageIdx);
                                }}
                              >
                                삭제
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {showMentorPickerForProblem ? (
                    <div className="mt-4">
                      <div className="mb-2 text-xs text-slate-600">
                        학생 일정과 10분 이상 겹치는 멘토를 최대한 많이 표시합니다. (대상: 오답 기록 {idx + 1})
                      </div>
                      {wrongAnswerCandidates.length ? (
                        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/70">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2 text-left">멘토</th>
                                <th className="px-3 py-2 text-left">겹치는 일정</th>
                                <th className="px-3 py-2 text-left">근무 요일/시간 · 선택과목</th>
                                <th className="px-3 py-2 text-right">배정</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wrongAnswerCandidates.map((candidate, candidateIndex) => {
                                const selectedMentorId = String(problemAssignment?.mentor_id || '');
                                const isSelected = selectedMentorId && selectedMentorId === String(candidate.mentor_id || '');
                                return (
                                  <tr
                                    key={`${candidate.mentor_id || candidate.mentor_name}-${candidateIndex}`}
                                    className={`border-t border-slate-200 ${wrongAnswerRoleRowTone(candidate.mentor_role)}`}
                                  >
                                    <td className="px-3 py-2">
                                      <div className="font-medium text-slate-900">{candidate.mentor_name}</div>
                                      <div className="text-xs text-slate-600">{wrongAnswerRoleLabel(candidate.mentor_role)}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="text-xs text-slate-700">총 {candidate.overlaps.length}개 (10분 이상)</div>
                                      <div className="text-xs text-slate-500">
                                        {candidate.overlaps.slice(0, 3).map((overlapItem, overlapIndex) => (
                                          <span key={`${overlapItem.day}-${overlapItem.student_time}-${overlapIndex}`}>
                                            {overlapIndex > 0 ? ' / ' : ''}
                                            {(DAY_LABELS[overlapItem.day] || overlapItem.day)} {overlapItem.student_time}
                                            {overlapItem.overlap_minutes ? ` (${overlapItem.overlap_minutes}분)` : ''}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-slate-700">
                                      <div className="text-xs text-slate-500">이름</div>
                                      <div className="text-sm text-slate-900">{candidate.mentor_name}</div>
                                      <div className="mt-1 text-xs text-slate-500">근무</div>
                                      <div className="text-xs text-slate-700">
                                        {(candidate.mentor_work_slots || []).length
                                          ? candidate.mentor_work_slots
                                              .map((slot) => `${DAY_LABELS[slot.day] || slot.day} ${slot.time}`)
                                              .join(' / ')
                                          : '-'}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">선택과목</div>
                                      <div className="text-xs text-slate-700">
                                        {(candidate.mentor_subjects || []).length
                                          ? candidate.mentor_subjects.join(', ')
                                          : '-'}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {canEditA('e_wrong_answer_distribution') && !parentMode ? (
                                        <button
                                          className={isSelected ? tone.assignButton : tone.assignButtonSoft}
                                          type="button"
                                          onClick={() => assignWrongAnswerMentor(candidate, idx)}
                                        >
                                          {isSelected ? '배정됨' : '배정'}
                                        </button>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-700">
                          학생 일정과 10분 이상 겹치는 멘토가 없습니다. 멘토 정보 파일 또는 학생 일정 분류를 확인해 주세요.
                        </div>
                      )}

                      {canEditA('e_wrong_answer_distribution') && !parentMode ? (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                          <div className="text-sm font-semibold text-amber-900">리스트 외 멘토 강제 배정</div>
                          <div className="mt-1 text-xs text-amber-800">
                            후보 리스트에 없어도 멘토 이름을 직접 입력해 오답 기록 {idx + 1}에 배정할 수 있습니다.
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                            <div className="md:col-span-2">
                              <div className="text-[11px] text-amber-900">멘토 이름</div>
                              <input
                                className="input mt-1 h-9"
                                value={forcedWrongAnswerAssignment.mentor_name}
                                onChange={(e) => setForcedWrongAnswerAssignment((prev) => ({ ...prev, mentor_name: e.target.value }))}
                                placeholder="예: 홍길동M"
                              />
                            </div>
                            <div>
                              <div className="text-[11px] text-amber-900">역할</div>
                              <select
                                className="input mt-1 h-9"
                                value={forcedWrongAnswerAssignment.mentor_role}
                                onChange={(e) => setForcedWrongAnswerAssignment((prev) => ({ ...prev, mentor_role: e.target.value }))}
                              >
                                <option value="mentor">클리닉 멘토</option>
                                <option value="lead">총괄멘토</option>
                                <option value="director">원장</option>
                                <option value="admin">관리자</option>
                              </select>
                            </div>
                            <div>
                              <div className="text-[11px] text-amber-900">진행 시간(분)</div>
                              <input
                                className="input mt-1 h-9"
                                type="number"
                                min={1}
                                max={240}
                                step={1}
                                value={forcedWrongAnswerAssignment.session_duration_minutes}
                                onChange={(e) => setForcedWrongAnswerAssignment((prev) => ({
                                  ...prev,
                                  session_duration_minutes: Math.max(1, Math.min(240, Number(e.target.value || 20) || 20))
                                }))}
                              />
                            </div>
                            <div>
                              <div className="text-[11px] text-amber-900">배정 날짜</div>
                              <input
                                className="input mt-1 h-9"
                                type="date"
                                value={forcedDateInputValue}
                                onChange={(e) => {
                                  const nextDate = String(e.target.value || '').trim();
                                  if (!nextDate) {
                                    setForcedWrongAnswerAssignment((prev) => ({
                                      ...prev,
                                      session_month: '',
                                      session_day: '',
                                      session_day_label: ''
                                    }));
                                    return;
                                  }
                                  const parsed = parseDateInputValue(nextDate);
                                  if (!parsed) return;
                                  setForcedWrongAnswerAssignment((prev) => ({
                                    ...prev,
                                    session_month: String(parsed.month),
                                    session_day: String(parsed.day),
                                    session_day_label: parsed.dayLabel || ''
                                  }));
                                }}
                              />
                            </div>
                            <div>
                              <div className="text-[11px] text-amber-900">시작 시각(선택)</div>
                              <div className="mt-1 space-y-1.5">
                                <input
                                  className="input h-9 w-full"
                                  type="time"
                                  value={forcedWrongAnswerAssignment.session_start_time || ''}
                                  onChange={(e) => setForcedWrongAnswerAssignment((prev) => ({
                                    ...prev,
                                    session_start_time: String(e.target.value || '').trim()
                                  }))}
                                />
                                <div className="flex justify-end">
                                  <button
                                    className="btn-ghost h-8 px-2 text-[11px]"
                                    type="button"
                                    onClick={() => setForcedWrongAnswerAssignment((prev) => ({
                                      ...prev,
                                      session_start_time: ''
                                    }))}
                                  >
                                    미선택
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-amber-900">요일(수동)</div>
                              <div className="mt-1 space-y-1.5">
                                <select
                                  className="input h-9 w-full"
                                  value={forcedWrongAnswerAssignment.session_day_label || ''}
                                  onChange={(e) => setForcedWrongAnswerAssignment((prev) => ({
                                    ...prev,
                                    session_day_label: String(e.target.value || '').trim()
                                  }))}
                                >
                                  <option value="">선택</option>
                                  {KO_WEEK_DAYS.map((day) => (
                                    <option key={`forced-day-${idx}-${day}`} value={day}>{day}</option>
                                  ))}
                                </select>
                                <div className="flex justify-end">
                                  <button
                                    className="btn-ghost h-8 px-2 text-[11px]"
                                    type="button"
                                    onClick={() => setForcedWrongAnswerAssignment((prev) => ({
                                      ...prev,
                                      session_day_label: ''
                                    }))}
                                  >
                                    미선택
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-amber-900">
                            자동 반영: {forcedWrongAnswerAssignment.session_day_label || '-'}요일 · {forcedWrongAnswerAssignment.session_month || '-'}월 {forcedWrongAnswerAssignment.session_day || '-'}일 · {forcedWrongAnswerAssignment.session_start_time || '--:--'}
                          </div>
                          <div className="mt-1 text-[11px] text-amber-900">
                            시작 시각 입력 없이 날짜/소요 시간만으로 강제 배정할 수 있습니다.
                          </div>
                          <div className="mt-2 flex justify-end">
                            <button className="btn-primary" type="button" onClick={() => applyForcedWrongAnswerAssignment(idx)}>
                              강제 배정 적용
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
                  ) : null}
                </div>
              );
              })}

              {canEditA('e_wrong_answer_distribution') && !parentMode ? (
                <button className="btn-ghost text-brand-800" type="button" onClick={addWrongAnswerProblem}>
                  + 오답 기록 추가
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="text-xs text-slate-600">
                업로드된 멘토 정보 기준 · 현재 멘토 수 {mentorInfo?.mentors?.length || 0}명
              </div>
            </div>

          </GoldCard>
        ) : null}

        {showClinicSection ? (
          <GoldCard className="p-5">
            <ClinicSectionCard
              value={clinicEntriesDraft}
              visible={canViewA('d_clinic_records')}
              editable={canEditA('d_clinic_records')}
              onSave={(entries) => saveWeekRecord({ d_clinic_records: entries })}
              onAutoSave={(entries) => autoSaveWeekRecord({ d_clinic_records: entries })}
              onChangeValue={setClinicEntriesDraft}
              busy={busy}
              perms={perms}
              currentRole={user?.role}
              parentMode={parentMode}
            />
          </GoldCard>
        ) : null}
        {canViewLegacyRecords ? (
          <GoldCard className="p-4">
            <button className="btn-primary" type="button" onClick={() => setShowLegacyRecordsModal(true)}>
              이전 멘토링 기록 확인하기
            </button>
          </GoldCard>
        ) : null}

        {/* (3) 피드 모음: 작성 + 목록 */}
        <GoldCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-900">학생 피드 모음</div>
              <div className="text-xs text-slate-700">원장 / 총괄멘토 / 관리자(기록 포함) 분리</div>
            </div>
            <button className="btn-ghost" onClick={loadStudentFeeds}>
              새로고침
            </button>
          </div>

          {feedsError ? <div className="mt-3 text-sm text-red-600">{feedsError}</div> : null}

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <FeedsColumn
              title="원장 피드"
              feeds={groupedFeeds.director}
              currentUser={user}
              onComment={addFeedComment}
              onDelete={deleteFeed}
            />
            <FeedsColumn
              title="총괄멘토 피드"
              feeds={groupedFeeds.lead}
              currentUser={user}
              onComment={addFeedComment}
              onDelete={deleteFeed}
            />
            <FeedsColumn
              title="관리자 피드"
              feeds={groupedFeeds.admin}
              currentUser={user}
              onComment={addFeedComment}
              onDelete={deleteFeed}
            />
          </div>
        </GoldCard>

        {!mentorMode ? (
          <>
        {/* 학습 커리큘럼 */}
        <GoldCard className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-900">학습 커리큘럼</div>
              <div className="text-xs text-slate-700">
                기본: 이전 회차 자동 불러오기
                {curriculumSourceWeek ? ` · 현재 적용 기준: ${toRoundLabel(curriculumSourceWeek.label)}` : ''}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <select
                className="input w-60"
                value={curriculumSourceSelection}
                onChange={(e) => setCurriculumSourceSelection(e.target.value)}
                disabled={parentMode || busy || !curriculumSourceOptions.length}
              >
                <option value="auto">자동(이전 회차)</option>
                {curriculumSourceOptions.map((w) => (
                  <option key={w.id} value={String(w.id)}>
                    {toRoundLabel(w.label)}
                  </option>
                ))}
              </select>
              <button
                className="btn-ghost"
                type="button"
                onClick={applyCurriculumSourceSelection}
                disabled={parentMode || busy || !curriculumSourceOptions.length}
              >
                선택 회차 불러오기
              </button>
              <input
                className="input w-64"
                placeholder="새 과목명"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                disabled={parentMode}
              />
              <button className="btn-primary" onClick={addSubject} disabled={busy || parentMode || !newSubject.trim()}>
                과목 추가
              </button>
            </div>
          </div>

          <div className="mt-4">
            <CurriculumStrip
              subjects={subjectRecords}
              perms={perms}
              role={user?.role}
              busy={busy}
              parentMode={parentMode}
              drafts={subjectDrafts}
              onChangeDraft={updateSubjectDraft}
              onAutoSave={autoSaveOneSubject}
            />
          </div>
        </GoldCard>

        {/* 수강 진도 */}
        <GoldCard className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-900">수강 진도 (과목 별)</div>
              <div className="text-xs text-slate-700">과목 추가 · 가로 스크롤</div>
            </div>
            <button
              className="btn-primary"
              disabled={busy || parentMode || !subjectRecords.length}
              type="button"
              onClick={saveAllSubjects}
            >
              저장
            </button>
          </div>

          <div className="mt-4 space-y-6">
            {subjectRecords.map((r, idx) => (
              <SubjectWideEditor
                key={r.id}
                record={r}
                toneClass={SUBJECT_TONES[idx % SUBJECT_TONES.length]}
                innerToneClass={SUBJECT_INNER_TONES[idx % SUBJECT_INNER_TONES.length]}
                perms={perms}
                role={user?.role}
                busy={busy}
                parentMode={parentMode}
                draft={subjectDrafts?.[String(r.id)] || {}}
                onChangeDraft={(patch) => updateSubjectDraft(r.id, patch)}
                onAutoSave={() => autoSaveOneSubject(r.id)}
                onDelete={() => deleteSubject(r.subject_id || r.id, r.subject_name)}
              />
            ))}
            {!subjectRecords.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm text-slate-700 shadow-sm">
                과목 추가
              </div>
            ) : null}
          </div>
        </GoldCard>

        {/* 주간 과제/피드백 */}
        <GoldCard className="p-5">
          <div className="text-sm font-semibold text-brand-900">주간 과제/피드백</div>
          <div className="mt-1 text-xs text-slate-700">
            {useNewDailyTaskLayout
              ? '지난주/이번주 일일 학습 과제 및 주간 총평, 원장 코멘터리'
              : '일일 학습 과제 및 요일별 총괄멘토 피드백, 주간 총평, 원장 코멘터리'}
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DailyTasksCard
              title={useNewDailyTaskLayout ? '일일 학습 과제(지난주)' : '일일 학습 과제'}
              fieldKey="b_daily_tasks"
              value={dailyTasksLastWeekDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('b_daily_tasks')}
              editable={canEditA('b_daily_tasks')}
              onSave={(v) => saveWeekRecord({ b_daily_tasks: v })}
              onAutoSave={(v) => autoSaveWeekRecord({ b_daily_tasks: v })}
              onChangeValue={setDailyTasksLastWeekDraft}
              busy={busy}
              textareaMinHClass="min-h-[48px]"
              parentMode={parentMode}
            />
            {useNewDailyTaskLayout ? (
              <DailyTasksCard
                title="일일 학습 과제(이번주)"
                fieldKey="b_daily_tasks_this_week"
                value={dailyTasksThisWeekDraft}
                perms={perms}
                currentRole={user?.role}
                visible={canViewA('b_daily_tasks_this_week')}
                editable={canEditA('b_daily_tasks_this_week')}
                onSave={(v) => saveWeekRecord({ b_daily_tasks_this_week: v })}
                onAutoSave={(v) => autoSaveWeekRecord({ b_daily_tasks_this_week: v })}
                onChangeValue={setDailyTasksThisWeekDraft}
                busy={busy}
                textareaMinHClass="min-h-[48px]"
                parentMode={parentMode}
              />
            ) : (
              <DailyTasksCard
                title="요일 별 총괄멘토 피드백"
                fieldKey="b_lead_daily_feedback"
                value={dailyFeedbackDraft}
                perms={perms}
                currentRole={user?.role}
                visible={canViewA('b_lead_daily_feedback')}
                editable={canEditA('b_lead_daily_feedback')}
                onSave={(v) => saveWeekRecord({ b_lead_daily_feedback: v })}
                onAutoSave={(v) => autoSaveWeekRecord({ b_lead_daily_feedback: v })}
                onChangeValue={setDailyFeedbackDraft}
                busy={busy}
                textareaMinHClass="min-h-[48px]"
                parentMode={parentMode}
              />
            )}
          </div>

          <div className="mt-6 space-y-6">
            <TextFieldCard
              title="주간 총괄멘토 피드백"
              fieldKey="c_lead_weekly_feedback"
              value={leadWeeklyDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('c_lead_weekly_feedback')}
              editable={canEditA('c_lead_weekly_feedback')}
              onSave={(txt) => saveWeekRecord({ c_lead_weekly_feedback: txt })}
              onChangeValue={setLeadWeeklyDraft}
              busy={busy}
              textareaMinHClass="min-h-[50px]"
              parentMode={parentMode}
            />
            <TextFieldCard
              title="원장 코멘터리"
              fieldKey="c_director_commentary"
              value={directorCommentDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('c_director_commentary')}
              editable={canEditA('c_director_commentary')}
              onSave={(txt) => saveWeekRecord({ c_director_commentary: txt })}
              onChangeValue={setDirectorCommentDraft}
              busy={busy}
              textareaMinHClass="min-h-[50px]"
              parentMode={parentMode}
            />
          </div>
        </GoldCard>
          </>
        ) : null}

        {/* 피드백 공유 */}
        <GoldCard className="p-5">
          <div className="text-sm font-semibold text-brand-900">피드백 공유</div>
            <div className="mt-2 text-xs text-slate-700">클리닉 멘토링 및 총괄멘토링 작성 → 원장/관리자 검토 → 학부모 공유</div>

          <div className="mt-4 flex flex-col gap-3">
            {user?.role === 'mentor' ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-slate-900">클리닉 멘토링 제출</div>
                  <div className="text-xs text-slate-700">총괄/원장에게 완료 피드 전송</div>
                </div>
                <button className="btn-primary" disabled={busy} onClick={doMentorSubmit}>
                  제출
                </button>
              </div>
            ) : null}

            {user?.role === 'lead' ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">원장에게 제출</div>
                    <div className="text-xs text-slate-700">수정/보완할 부분이 있을 경우에만 원장에게 제출</div>
                  </div>
                  <button className="btn-primary" disabled={busy} onClick={submitToDirector}>
                    제출
                  </button>
                </div>
                <textarea
                  className="textarea mt-3 min-h-[70px]"
            placeholder="댓글 입력"
                  value={leadReason}
                  onChange={(e) => setLeadReason(e.target.value)}
                />
              </div>
            ) : null}

            {user?.role === 'director' ? (
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">총괄멘토에게 전송</div>
                    <div className="text-xs text-slate-700">수정 사항/코멘트 전달</div>
                  </div>
                  <button className="btn-primary" disabled={busy} onClick={sendToLead}>
                    전송
                  </button>
                </div>
                <textarea
                  className="textarea mt-3 min-h-[70px]"
            placeholder="댓글 입력"
                  value={directorNote}
                  onChange={(e) => setDirectorNote(e.target.value)}
                />
              </div>
            ) : null}

            {(user?.role === 'lead' || user?.role === 'director' || user?.role === 'admin') ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-slate-900">학부모 공유</div>
                  <div className="text-xs text-slate-700">해당 회차 기록을 학부모가 열람 가능하도록 전환</div>
                </div>
                <button className="btn-primary" disabled={busy} onClick={doShare}>
                  공유
                </button>
              </div>
            ) : null}
          </div>
        </GoldCard>

        {/* 학생 관리 피드백 쓰기 */}
        {user?.role !== 'parent' ? (
          <GoldCard className="p-5">
            <div className="text-sm font-semibold text-brand-900">학생 관리 피드백 쓰기</div>
            <div className="mt-1 text-xs text-slate-700">받는 사람을 선택하고 피드, 제목(필수), 내용을 작성해 전송하세요.</div>

            <form className="mt-3 grid grid-cols-12 gap-3" onSubmit={sendFeed}>
              <div className="col-span-12 md:col-span-3">
                <label className="text-xs text-slate-800">받는 사람</label>
                <select
                  className="input mt-1"
                  value={feedForm.to_user_id}
                  onChange={(e) => setFeedForm({ ...feedForm, to_user_id: e.target.value })}
                >
                  <option value="">선택</option>
                  {recipientOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.display_name} ({ROLE_KO[r.role] || r.role})
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-slate-600">클리닉 멘토(전체기록)는 본인에게 전송되지 않습니다.</div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <label className="text-xs text-slate-800">피드 유형</label>
                <select
                  className="input mt-1"
                  value={feedForm.target_field}
                  onChange={(e) => setFeedForm({ ...feedForm, target_field: e.target.value })}
                >
                  <option value="">(선택 없음)</option>
                  {fieldOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-12 md:col-span-6">
                <label className="text-xs text-slate-800">제목</label>
                <input
                  className="input mt-1"
                  value={feedForm.title}
                  onChange={(e) => setFeedForm({ ...feedForm, title: e.target.value })}
            placeholder="댓글 입력"
                />
                {!feedForm.title.trim() ? <div className="mt-1 text-[11px] text-red-600">제목은 필수입니다.</div> : null}
              </div>

              <div className="col-span-12">
                <label className="text-xs text-slate-800">내용</label>
                <textarea
                  className="textarea mt-1 min-h-[44px]"
                  value={feedForm.body}
                  onChange={(e) => setFeedForm({ ...feedForm, body: e.target.value })}
                />
              </div>

              <div className="col-span-12 flex justify-end">
                <button className="btn-primary" disabled={busy || !feedForm.to_user_id || !feedForm.title.trim() || !feedForm.body.trim()}>
                  전송
                </button>
              </div>
            </form>
          </GoldCard>
        ) : null}

      </div>

      {showEntryNotice ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
          <div className="card w-full max-w-xl border-2 border-rose-200 bg-white p-6">
            <div className="text-base font-semibold text-brand-900">안내</div>
            <div className="mt-3 text-sm leading-7 text-slate-800">
              기록 후 데이터가 유실되지 않기 위해 꼭{' '}
              <span className="font-bold text-red-600">전체 저장 버튼</span>과{' '}
              <span className="font-bold text-red-600">제출 버튼</span>을 눌러주세요!
            </div>
            <div className="mt-5 flex justify-end">
              <button className="btn-primary px-4" type="button" onClick={() => setShowEntryNotice(false)}>
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {wrongAnswerUploadModal.open ? (
        <WrongAnswerImageUploadModal
          loading={wrongAnswerUploadModal.loading}
          error={wrongAnswerUploadModal.error}
          uploadUrl={wrongAnswerUploadModal.uploadUrl}
          problemIndex={wrongAnswerUploadModal.problemIndex}
          onClose={closeWrongAnswerUploadModal}
          onRefresh={refreshWrongAnswerUploadedImages}
        />
      ) : null}

      {showLegacyRecordsModal && rec?.student?.id ? (
        <LegacyMentoringRecordsModal
          studentId={rec.student.id}
          studentName={rec.student.name}
          onClose={() => setShowLegacyRecordsModal(false)}
        />
      ) : null}
    </div>
  );
}

function WrongAnswerImageUploadModal({ loading, error, uploadUrl, problemIndex, onClose, onRefresh }) {
  const qrImageUrl = uploadUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(uploadUrl)}`
    : '';
  const [refreshing, setRefreshing] = useState(false);

  async function copyUploadUrl() {
    if (!uploadUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(uploadUrl);
        window.alert('링크를 복사했습니다.');
      }
    } catch {
      window.alert('링크 복사에 실패했습니다.');
    }
  }

  async function refreshUploadedImages() {
    if (typeof onRefresh !== 'function' || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4">
      <div className="card w-full max-w-xl border border-blue-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900">문제 이미지 업로드 QR</div>
            <div className="text-xs text-slate-600">오답 기록 {Number(problemIndex) + 1}에 이미지가 저장됩니다.</div>
          </div>
          <button className="btn-ghost" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          {loading ? (
            <div className="text-sm text-slate-700">QR 링크를 생성하는 중입니다...</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : uploadUrl ? (
            <div className="space-y-3">
              <div className="mx-auto w-fit rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                <img src={qrImageUrl} alt="문제 이미지 업로드 QR" className="h-72 w-72" />
              </div>
              <div className="text-xs leading-5 text-slate-700">
                1) 휴대폰으로 QR을 스캔합니다.
                <br />
                2) 열린 페이지에서 새 촬영/앨범 선택 후 여러 장 전송합니다.
                <br />
                3) 업로드 뒤 이 화면에서 새로고침을 누르면 목록에 반영됩니다.
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 break-all">
                {uploadUrl}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" type="button" onClick={copyUploadUrl}>
                  링크 복사
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  disabled={loading || refreshing}
                  onClick={() => void refreshUploadedImages()}
                >
                  {refreshing ? '반영 중...' : '업로드 반영 새로고침'}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-700">업로드 링크를 불러오지 못했습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* 캘린더 센터/외부/미등원 색상 구분 */
function classifySchedule(it) {
  const type = String(it?.type || '').trim();
  const title = String(it?.title || '').trim();

  const isAbsence = type.includes('미등원') || title.includes('미등원') || type.includes('결석') || title.includes('결석');
  const isCenter = type.includes('센터') || title.includes('센터');
  const isExternal = type.includes('외부') || title.includes('외부');

  if (isAbsence) return 'absence';
  if (isCenter) return 'center';
  if (isExternal) return 'external';
  return 'other';
}

function scheduleTone(kind) {
  if (kind === 'center') return 'border-emerald-200 bg-emerald-50';
  if (kind === 'external') return 'border-sky-200 bg-sky-50';
  if (kind === 'absence') return 'border-rose-200 bg-rose-50';
  return 'border-slate-200 bg-white';
}

function WeeklyCalendar({ schedule, weekStart }) {
  const start = parseDateOnly(weekStart);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-800">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5">
          센터
        </span>
        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5">
          센터 외
        </span>
        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5">
          결석/미등원
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[980px] grid grid-cols-7 gap-3">
          {DAYS.map((d, idx) => {
            const dateLabel = start
              ? (() => {
                  const day = new Date(start);
                  day.setDate(day.getDate() + idx);
                  return `${DAY_LABELS[d]} (${fmtMD(day)})`;
                })()
              : `${DAY_LABELS[d]} (${d})`;
            return (
            <div key={d} className="rounded-2xl border border-slate-200 bg-white/70 p-3 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">
                {dateLabel}
              </div>

              <div className="mt-2 space-y-2">
                {(Array.isArray(schedule?.[d]) ? schedule[d] : []).length ? (
                  (Array.isArray(schedule?.[d]) ? schedule[d] : []).map((it, idx) => {
                    const kind = classifySchedule(it);
                    return (
                      <div key={idx} className={['rounded-xl border px-3 py-2 shadow-sm', scheduleTone(kind)].join(' ')}>
                        <div className="text-xs text-slate-700 whitespace-nowrap">{it.time || ''}</div>
                        <div className="text-sm text-slate-900 whitespace-pre-wrap">{it.title || ''}</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm text-slate-700">일정 없음</div>
                )}
              </div>
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}

function LegacyMentoringRecordsModal({ studentId, studentName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [images, setImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const r = await api(`/api/students/${encodeURIComponent(studentId)}/legacy-images`);
        if (!mounted) return;
        setImages(Array.isArray(r?.images) ? r.images : []);
      } catch (e) {
        if (!mounted) return;
        setImages([]);
        setError(e?.message || '이전 기록 이미지를 불러오지 못했습니다.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [studentId]);

  useEffect(() => {
    if (selectedIndex < 0) return undefined;

    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedIndex(-1);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIndex]);

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-6xl bg-white p-5 max-h-[92vh] overflow-hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-brand-900">{studentName || ''} 이전 멘토링 기록</div>
            <div className="text-xs text-slate-600">원장 업로드 이미지 원본 확인</div>
          </div>
          <button className="btn-ghost" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="mt-4 max-h-[calc(92vh-110px)] overflow-y-auto pr-1">
          {loading ? (
            <div className="text-sm text-slate-600">이미지를 불러오는 중입니다.</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : images.length ? (
            <div className="space-y-4">
              {images.map((img, idx) => (
                <div key={img.id} className="rounded-2xl border border-slate-200 bg-slate-50/40 p-3">
                  <button
                    type="button"
                    className="block w-full text-left"
                    aria-label="이미지 전체화면 보기"
                    onClick={() => setSelectedIndex(idx)}
                  >
                    <img
                      src={`data:${img.mime_type};base64,${img.data_base64}`}
                      alt="legacy mentoring record"
                      className="mx-auto w-full rounded-xl border border-slate-200 bg-white object-contain max-h-[78vh] cursor-zoom-in"
                    />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">등록된 이전 멘토링 기록 이미지가 없습니다.</div>
          )}
        </div>
      </div>

      {selectedImage ? (
        <div className="fixed inset-0 z-[60] bg-black/85 p-4 sm:p-6" onClick={() => setSelectedIndex(-1)}>
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end">
              <button className="btn-primary" type="button" onClick={() => setSelectedIndex(-1)}>
                닫기
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-auto">
              <img
                src={`data:${selectedImage.mime_type};base64,${selectedImage.data_base64}`}
                alt="legacy mentoring record full view"
                className="mx-auto max-h-full w-auto max-w-full rounded-xl border border-white/30 bg-white/10 object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* 피드 3컬럼 + 피드 작성 + 댓글 */
function FeedsColumn({ title, feeds, currentUser, onComment, onDelete }) {
  const list = Array.isArray(feeds) ? feeds : [];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-700">{list.length}건</div>
      </div>

      <div className="mt-3 space-y-3 max-h-[560px] overflow-auto pr-1">
        {list.length ? (
          list.map((f) => (
            <FeedCard
              key={f.id}
              feed={f}
              currentUser={currentUser}
              onComment={onComment}
              onDelete={onDelete}
            />
          ))
        ) : (
          <div className="text-sm text-slate-700">피드가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function FeedCard({ feed, currentUser, onComment, onDelete }) {
  const fromName = feed?.from_name || '작성자';
  const fromRole = feed?.from_role || '';
  const createdLabel = fmtKoreanDateTime(feed?.created_at);
  const title = feed?.title || '';
  const targetField = feed?.target_field || '';
  const comments = Array.isArray(feed?.comments) ? feed.comments : [];

  const [comment, setComment] = useState('');
  const canDelete = ['director', 'admin'].includes(currentUser?.role);

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-slate-800">
            {ROLE_KO[fromRole] || fromRole} · {fromName}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600">{createdLabel}</div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {targetField ? (
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
              {targetField}
            </div>
          ) : null}

          {canDelete ? (
            <button className="btn-ghost text-red-700" type="button" onClick={() => onDelete?.(feed.id)}>
              삭제
            </button>
          ) : null}
        </div>
      </div>

      {title ? <div className="mt-2 text-sm font-semibold text-slate-900 whitespace-pre-wrap">{title}</div> : null}
      <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{feed?.body || ''}</div>

      <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="text-[11px] text-slate-700">댓글</div>

        <div className="mt-2 space-y-2">
          {comments.length ? (
            comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-800">
                    {c.from_name} ({ROLE_KO[c.from_role] || c.from_role})
                  </div>
                  <div className="text-[11px] text-slate-600">{fmtKoreanDateTime(c.created_at)}</div>
                </div>
                <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{c.body || ''}</div>
              </div>
            ))
          ) : (
            <div className="text-sm text-slate-700">댓글이 없습니다.</div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1 min-w-0"
            placeholder="댓글 입력"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            className="btn-primary whitespace-nowrap px-4 min-w-[64px]"
            type="button"
            disabled={!comment.trim()}
            onClick={() => {
              onComment?.(feed.id, comment);
              setComment('');
            }}
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

/* 학습 커리큘럼(과목별: 3열 x 2행 가시 그리드) */
function CurriculumStrip({ subjects, perms, role, parentMode, busy, drafts, onChangeDraft, onAutoSave }) {
  const fieldKey = 'a_curriculum';
  const perm = getPerm(perms, fieldKey);
  const editRoles = perm.roles_edit || [];
  const editable = canEdit(perms, role, fieldKey) && !parentMode;
  const visible = parentMode ? canView(perms, role, fieldKey) : true;
  const tone = toneByRoles(editRoles);
  const list = Array.isArray(subjects) ? subjects : [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700 shadow-sm">
        권한 설정에 의해 숨김
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-700">
        3 x 2 그리드 보기 · 전체 {list.length}과목
      </div>
      <div className="max-h-[760px] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((r, idx) => {
          const sid = String(r.id);
          const val = drafts?.[sid]?.[fieldKey] ?? '';
          const subjectTone = SUBJECT_TONES[idx % SUBJECT_TONES.length];

          return (
            <div key={r.id} className="h-full min-h-[300px]">
              <div className={['rounded-2xl border p-4 shadow-sm h-full flex flex-col', subjectTone].join(' ')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-slate-900 break-words">{r.subject_name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(editRoles || []).map((rKey) => (
                        <RoleTag key={rKey} role={rKey} active={rKey === role} />
                      ))}
                    </div>
                  </div>
                  <div className={['shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[11px]', tone.badge].join(' ')}>
                    {editable ? '편집' : '읽기'}
                  </div>
                </div>

                <textarea
                  className="textarea mt-3 min-h-[220px] flex-1 whitespace-pre-wrap break-words"
                  value={val}
                  onChange={(e) => onChangeDraft?.(r.id, { [fieldKey]: e.target.value })}
                  onBlur={() => {
                    if (editable) onAutoSave?.(r.id);
                  }}
                  disabled={!editable || busy}
                />

                {!editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

/* 과목별 편집: 가로 정렬 레이아웃 */
function SubjectWideEditor({ record, perms, role, busy, parentMode, draft, onChangeDraft, onAutoSave, onDelete, toneClass = '', innerToneClass = '' }) {
  const canEditField = (k) => canEdit(perms, role, k);
  const canViewField = (k) => (parentMode ? canView(perms, role, k) : true);
  const [localDraft, setLocalDraft] = useState(() => draft || {});
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setLocalDraft(draft || {});
    if (record?.id) dirtyRef.current = false;
  }, [draft, record?.id]);

  function editRolesOf(k) {
    const p = getPerm(perms, k);
    return p.roles_edit || [];
  }

  function buildField(k, label, type) {
    if (!canViewField(k)) return null;
    const editRoles = editRolesOf(k);
    return {
      k,
      label,
      type,
      editable: canEditField(k) && !parentMode,
      editRoles,
      tone: toneByRoles(editRoles),
      val: localDraft?.[k] ?? ''
    };
  }

  const lastHw = buildField('a_last_hw', '지난주 과제', 'text');
  const exec = null;
  const thisHw = buildField('a_this_hw', '이번주 과제', 'text');
  const comment = buildField('a_comment', '과목 별 코멘트', 'text');

  const percentOptions = useMemo(() => {
    const arr = [''].concat(Array.from({ length: 21 }, (_, i) => `${i * 5}%`));
    return arr;
  }, []);

  const TASK_TEXTAREA_MIN_HEIGHT = 250;
  const COMMENT_TEXTAREA_MIN_HEIGHT = 120;

  function updateLocalField(key, value) {
    dirtyRef.current = true;
    setLocalDraft((prev) => ({ ...(prev || {}), [key]: value }));
    onChangeDraft({ [key]: value });
  }

  function handleAutoSave() {
    dirtyRef.current = false;
    onAutoSave?.();
  }

  function FieldHeader({ field }) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-slate-800">{field.label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(field.editRoles || []).map((r) => (
              <RoleTag key={r} role={r} active={r === role} />
            ))}
          </div>
        </div>
        <div className={['shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[11px]', field.tone.badge].join(' ')}>
          {field.editable ? '편집' : '읽기'}
        </div>
      </div>
    );
  }

  function PercentFieldBody({ field, minHeight, onAutoSave }) {
    return (
      <div className="mt-3 flex items-start" style={{ minHeight }}>
        <select
          className="input w-full"
          value={field.val}
          onChange={(e) => updateLocalField(field.k, e.target.value)}
          onBlur={() => {
            if (field.editable) onAutoSave?.();
          }}
          disabled={!field.editable}
        >
          {percentOptions.map((v) => (
            <option key={v || '__empty__'} value={v}>
              {v || '선택'}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={['rounded-2xl border p-4 shadow-sm', toneClass || 'border-slate-200 bg-white/70'].join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-brand-900">{record.subject_name}</div>
        <button className="btn-ghost text-red-700" type="button" disabled={busy} onClick={onDelete}>
              과목 삭제
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {lastHw ? (
          <div className={['rounded-2xl border p-4 shadow-sm', innerToneClass || 'border-slate-200/70 bg-slate-50/60'].join(' ')}>
            <div className="rounded-xl border border-white/60 bg-white/55 px-2 py-0">
              <FieldHeader field={lastHw} />
              <LastHwTasksEditor
                value={lastHw.val}
                editable={lastHw.editable}
                percentOptions={percentOptions}
                onChangeValue={(val) => updateLocalField(lastHw.k, val)}
                onBlur={() => {
                  if (lastHw.editable) handleAutoSave();
                }}
              />
              {!lastHw.editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
            </div>
          </div>
        ) : null}

        {thisHw ? (
          <div className={['rounded-2xl border p-4 shadow-sm', innerToneClass || 'border-slate-200/70 bg-slate-50/60'].join(' ')}>
            <div className="rounded-xl border border-white/60 bg-white/55 px-2 py-0">
              <FieldHeader field={thisHw} />
              <LastHwTasksEditor
                value={thisHw.val}
                editable={thisHw.editable}
                percentOptions={percentOptions}
                showProgress={false}
                onChangeValue={(val) => updateLocalField(thisHw.k, val)}
                onBlur={() => {
                  if (thisHw.editable) handleAutoSave();
                }}
              />
              {!thisHw.editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
            </div>
          </div>
        ) : null}

        {comment ? (
          <div className={['rounded-2xl border p-4 shadow-sm', innerToneClass || 'border-slate-200/70 bg-slate-50/60'].join(' ')}>
            <FieldHeader field={comment} />
            <AutoGrowTextarea
              value={comment.val}
              minHeight={COMMENT_TEXTAREA_MIN_HEIGHT}
              disabled={!comment.editable}
              onBlur={() => {
                if (comment.editable) handleAutoSave();
              }}
              onValueChange={(val) => updateLocalField(comment.k, val)}
            />
            {!comment.editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* 일일 카드 */
function DailyTasksCard({
  title,
  fieldKey,
  value,
  visible,
  editable,
  onSave,
  onAutoSave,
  onChangeValue,
  busy,
  textareaMinHClass,
  perms,
  currentRole,
  parentMode
}) {
  const [local, setLocal] = useState(value || {});
  const lastSavedRef = useRef('');
  const timerRef = useRef(null);
  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setLocal(value || {});
    lastSavedRef.current = JSON.stringify(value || {});
  }, [value]);

  useEffect(() => {
    if (!editable || parentMode) return;
    const serialized = JSON.stringify(local || {});
    if (serialized === lastSavedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSavedRef.current = serialized;
      onAutoSave?.(local);
    }, 800);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [local, editable, parentMode, onAutoSave]);

  const p = getPerm(perms, fieldKey);
  const editRoles = p.roles_edit || [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-900">{title}</div>
        <div className="mt-2 text-sm text-slate-700">권한 설정에 의해 숨김</div>
      </div>
    );
  }

  return (
    <FieldShell
      title={title}
      subtitle="요일별 텍스트 입력"
      editRoles={editRoles}
      currentRole={currentRole}
      right={
        <button className="btn-primary" disabled={busy || !editable || parentMode} onClick={() => onSave(local)}>
          저장
        </button>
      }
    >
      <div className="space-y-2">
        {DAYS.map((d) => (
          <div key={d} className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-2 text-xs text-slate-800 pt-2">
              {d} <span className="text-slate-600">({DAY_LABELS[d]})</span>
            </div>
            <textarea
              className={['textarea col-span-10', textareaMinHClass || 'min-h-[48px]'].join(' ')}
              value={local?.[d] || ''}
              onChange={(e) => {
                const next = { ...local, [d]: e.target.value };
                setLocal(next);
                skipSyncRef.current = true;
                onChangeValue?.(next);
              }}
              disabled={!editable || parentMode}
            />
          </div>
        ))}
      </div>
      {!editable || parentMode ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
    </FieldShell>
  );
}

/* 텍스트 카드 */
function TextFieldCard({ title, fieldKey, value, visible, editable, onSave, onChangeValue, busy, textareaMinHClass, perms, currentRole, parentMode }) {
  const [txt, setTxt] = useState(value || '');
  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setTxt(value || '');
  }, [value]);

  const p = getPerm(perms, fieldKey);
  const editRoles = p.roles_edit || [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-900">{title}</div>
        <div className="mt-2 text-sm text-slate-700">권한 설정에 의해 숨김</div>
      </div>
    );
  }

  return (
    <FieldShell
      title={title}
      subtitle={p?.label && p.label !== fieldKey ? `필드: ${p.label}` : `필드: ${fieldKey}`}
      editRoles={editRoles}
      currentRole={currentRole}
      right={
        <button className="btn-primary" disabled={busy || !editable || parentMode} onClick={() => onSave(txt)}>
          저장
        </button>
      }
    >
      <textarea
        className={['textarea', textareaMinHClass || 'min-h-[70px]'].join(' ')}
        value={txt || ''}
        onChange={(e) => {
          const next = e.target.value;
          setTxt(next);
          skipSyncRef.current = true;
          onChangeValue?.(next);
        }}
        disabled={!editable || parentMode}
      />
      {!editable || parentMode ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
    </FieldShell>
  );
}

function ClinicSectionCard({ value, visible, editable, onSave, onAutoSave, onChangeValue, busy, perms, currentRole, parentMode }) {
  function ensureAtLeastOneEntry(input) {
    const parsed = parseClinicEntries(input);
    return parsed.length ? parsed : [{ ...DEFAULT_CLINIC_ENTRY }];
  }

  const [entries, setEntries] = useState(() => ensureAtLeastOneEntry(value));
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setEntries(ensureAtLeastOneEntry(value));
  }, [value]);

  const p = getPerm(perms, 'd_clinic_records');
  const editRoles = p.roles_edit || [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-900">클리닉 섹션</div>
        <div className="mt-2 text-sm text-slate-700">권한 설정에 의해 숨김</div>
      </div>
    );
  }

  function commit(next, { autoSave = false } = {}) {
    const normalizedNext = Array.isArray(next) && next.length ? next : [{ ...DEFAULT_CLINIC_ENTRY }];
    setEntries(normalizedNext);
    skipSyncRef.current = true;
    onChangeValue?.(normalizedNext);
    if (autoSave && editable && !parentMode) onAutoSave?.(normalizedNext);
  }

  function updateEntry(idx, patch, autoSave = false) {
    const next = entries.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry));
    commit(next, { autoSave });
  }

  function addEntry() {
    const next = [...entries, { ...DEFAULT_CLINIC_ENTRY }];
    commit(next);
  }

  function removeEntry(idx) {
    const next = entries.filter((_, i) => i !== idx);
    commit(next, { autoSave: true });
  }

  const placeholderSummary =
    '일단 문제 해설해주고 학생이 빈칸유형을 어떻게 접근해야 하는지 몰라서 빈칸 앞뒤의 관계를 분석해서 해결할 수 있도록 멘토링함';

  return (
    <FieldShell
      title="클리닉 섹션"
      subtitle="클리닉 멘토가 학생 질문 문제를 해설한 내용을 기록합니다."
      editRoles={editRoles}
      currentRole={currentRole}
      right={
        <button className="btn-primary" disabled={busy || !editable || parentMode} onClick={() => onSave(entries)}>
          저장
        </button>
      }
    >
      <div className="space-y-4">
        {entries.map((entry, idx) => (
            <div key={idx} className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">클리닉 기록 {idx + 1}</div>
                {editable && !parentMode ? (
                  <button className="btn-ghost text-red-700" type="button" onClick={() => removeEntry(idx)}>
                    삭제
                  </button>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-12 gap-3">
                <div className="col-span-12 md:col-span-6">
                  <div className="text-xs text-slate-800">클리닉 진행 멘토</div>
                  <input
                    className="input mt-1"
                    value={entry.mentor_name || ''}
                    onChange={(e) => updateEntry(idx, { mentor_name: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                </div>
                <div className="col-span-12 md:col-span-6">
                  <div className="text-xs text-slate-800">해결 일자</div>
                  <input
                    type="date"
                    className="input mt-1"
                    value={entry.solved_date || ''}
                    onChange={(e) => updateEntry(idx, { solved_date: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                </div>

                <div className="col-span-12 md:col-span-3">
                  <div className="text-xs text-slate-800">과목</div>
                  <input
                    className="input mt-1"
                    value={entry.subject || ''}
                    onChange={(e) => updateEntry(idx, { subject: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">예시: 영어</div>
                </div>
                <div className="col-span-12 md:col-span-3">
                  <div className="text-xs text-slate-800">교재명</div>
                  <input
                    className="input mt-1"
                    value={entry.material || ''}
                    onChange={(e) => updateEntry(idx, { material: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">예시: 수능특강 문제편</div>
                </div>
                <div className="col-span-12 md:col-span-3">
                  <div className="text-xs text-slate-800">문제명</div>
                  <input
                    className="input mt-1"
                    value={entry.problem_name || ''}
                    onChange={(e) => updateEntry(idx, { problem_name: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">예시: 89페이지 3번</div>
                </div>
                <div className="col-span-12 md:col-span-3">
                  <div className="text-xs text-slate-800">유형 기록</div>
                  <input
                    className="input mt-1"
                    value={entry.problem_type || ''}
                    onChange={(e) => updateEntry(idx, { problem_type: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">예시: 빈칸추론</div>
                </div>

                <div className="col-span-12">
                  <div className="text-xs text-slate-800">해결요약 피드백</div>
                  <textarea
                    className="textarea mt-1 min-h-[88px]"
                    value={entry.summary || ''}
                    placeholder={placeholderSummary}
                    onChange={(e) => updateEntry(idx, { summary: e.target.value })}
                    onBlur={() => updateEntry(idx, {}, true)}
                    disabled={!editable || parentMode}
                  />
                </div>
              </div>
            </div>
          ))}

        {editable && !parentMode ? (
          <button className="btn-ghost text-brand-800" type="button" onClick={addEntry}>
            + 클리닉 기록 추가
          </button>
        ) : null}
        {!editable || parentMode ? <div className="text-xs text-slate-700">읽기 전용</div> : null}
      </div>
    </FieldShell>
  );
}

/* (2) 학생 정보 분리 + 성적/내신 카드 */
const StudentProfileSection = forwardRef(function StudentProfileSection({ studentId, profileJson, userRole, busy, setBusy, setError }, ref) {
  const isReadOnly = userRole === 'parent' || userRole === 'mentor';

  const defaultProfile = useMemo(
    () => ({
      mock_scores: [{ exam: '6.9', kor: '', math: '', eng: '', soc: '', sci: '' }],
      school_grades: { '1': { '1': '', '2': '' }, '2': { '1': '', '2': '' }, '3': { '1': '', '2': '' } },
      student_info: {
        goal_univ: '',
        goal_major: '',
        school_name: '',
        school_grade: '',
        mentor_name: '',
        lead_name: ''
      }
    }),
    []
  );

  const [profile, setProfile] = useState(() => safeJson(profileJson, defaultProfile));
  useEffect(() => setProfile(safeJson(profileJson, defaultProfile)), [profileJson, defaultProfile]);

  const gradeAverage = useMemo(() => {
    const vals = [];
    const grades = profile?.school_grades || {};
    for (const y of ['1', '2', '3']) {
      for (const s of ['1', '2']) {
        const raw = grades?.[y]?.[s];
        if (raw == null || String(raw).trim() === '') continue;
        const num = Number(raw);
        if (!Number.isNaN(num)) vals.push(num);
      }
    }
    if (!vals.length) return '';
    const avg = vals.reduce((acc, v) => acc + v, 0) / vals.length;
    return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
  }, [profile?.school_grades]);

  function updateMockRow(idx, patch) {
    const next = { ...profile };
    next.mock_scores = Array.isArray(next.mock_scores) ? [...next.mock_scores] : [];
    next.mock_scores[idx] = { ...(next.mock_scores[idx] || {}), ...patch };
    setProfile(next);
  }

  function addMockRow() {
    const next = { ...profile };
    next.mock_scores = Array.isArray(next.mock_scores) ? [...next.mock_scores] : [];
    next.mock_scores.push({ exam: '', kor: '', math: '', eng: '', soc: '', sci: '' });
    setProfile(next);
  }

  function updateSchoolGrade(year, sem, val) {
    const next = { ...profile };
    const base = next.school_grades ? { ...next.school_grades } : {};
    const yearRow = base[year] ? { ...base[year] } : {};
    yearRow[sem] = val;
    base[year] = yearRow;
    next.school_grades = base;
    setProfile(next);
  }

  function updateInfo(patch) {
    const next = { ...profile };
    next.student_info = next.student_info || {};
    next.student_info = { ...next.student_info, ...patch };
    setProfile(next);
  }

  async function saveProfile({ confirm = true, manageBusy = true } = {}) {
    if (manageBusy) setBusy(true);
    try {
      if (confirm) confirmOrThrow('학생 프로필(학생정보/성적) 저장할까요?');
      await api(`/api/students/${encodeURIComponent(studentId)}/profile`, {
        method: 'PUT',
        body: { profile_json: JSON.stringify(profile) }
      });
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message || '학생 프로필 저장 실패');
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  useImperativeHandle(ref, () => ({ saveProfile }));

  return (
    <div className="space-y-6">
      {/* 학생 정보: 분리된 가로형 */}
      <GoldCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-brand-900">학생 정보</div>
            <div className="text-xs text-slate-700">학생 단위 정보(회차와 무관)</div>
          </div>
          <button className="btn-primary" disabled={busy || isReadOnly} onClick={saveProfile}>
            저장
          </button>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">목표 대학</div>
            <input className="input mt-1" value={profile?.student_info?.goal_univ || ''} onChange={(e) => updateInfo({ goal_univ: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">목표 학과</div>
            <input className="input mt-1" value={profile?.student_info?.goal_major || ''} onChange={(e) => updateInfo({ goal_major: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">학교</div>
            <input className="input mt-1" value={profile?.student_info?.school_name || ''} onChange={(e) => updateInfo({ school_name: e.target.value })} disabled={isReadOnly} />
          </div>

          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">클리닉 멘토</div>
            <input className="input mt-1" value={profile?.student_info?.mentor_name || ''} onChange={(e) => updateInfo({ mentor_name: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">총괄멘토</div>
            <input className="input mt-1" value={profile?.student_info?.lead_name || ''} onChange={(e) => updateInfo({ lead_name: e.target.value })} disabled={isReadOnly} />
          </div>

          {isReadOnly ? <div className="col-span-12 text-xs text-slate-700">읽기 전용</div> : null}
        </div>
      </GoldCard>

      {/* 성적/내신 */}
      <GoldCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-brand-900">성적/내신</div>
            <div className="text-xs text-slate-700">학생 단위 정보(회차와 무관)</div>
          </div>
          <button className="btn-primary" disabled={busy || isReadOnly} onClick={saveProfile}>
            저장
          </button>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-7 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">수능/모의고사</div>
              <button className="btn-ghost" type="button" onClick={addMockRow} disabled={isReadOnly}>
                행 추가
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-700">
                    <th className="py-2 w-20">시행월</th>
                    <th className="w-24">국어</th>
                    <th className="w-24">수학</th>
                    <th className="w-24">영어</th>
                    <th className="w-24">탐구1</th>
                    <th className="w-24">탐구2</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(profile.mock_scores) ? profile.mock_scores : []).map((r, idx) => (
                    <tr key={idx} className="border-t border-slate-200">
                      <td className="py-2">
                        <input className="input" value={r.exam || ''} onChange={(e) => updateMockRow(idx, { exam: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.kor || ''} onChange={(e) => updateMockRow(idx, { kor: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.math || ''} onChange={(e) => updateMockRow(idx, { math: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.eng || ''} onChange={(e) => updateMockRow(idx, { eng: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.soc || ''} onChange={(e) => updateMockRow(idx, { soc: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.sci || ''} onChange={(e) => updateMockRow(idx, { sci: e.target.value })} disabled={isReadOnly} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isReadOnly ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
          </div>

          <div className="col-span-12 lg:col-span-5 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">내신 성적</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-700">
                    <th className="py-2 w-20">시행월</th>
                    <th className="w-24">1학기</th>
                    <th className="w-24">2학기</th>
                  </tr>
                </thead>
                <tbody>
                  {['1', '2', '3'].map((y) => (
                    <tr key={y} className="border-t border-slate-200">
                      <td className="py-2">{y}학년</td>
                      <td>
                        <input className="input" value={profile?.school_grades?.[y]?.['1'] || ''} onChange={(e) => updateSchoolGrade(y, '1', e.target.value)} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={profile?.school_grades?.[y]?.['2'] || ''} onChange={(e) => updateSchoolGrade(y, '2', e.target.value)} disabled={isReadOnly} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50/70">
                    <td className="py-2 font-semibold text-slate-800">평균</td>
                    <td colSpan={2}>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                        {gradeAverage || '-'}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {isReadOnly ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
          </div>
        </div>
      </GoldCard>
    </div>
  );
});
