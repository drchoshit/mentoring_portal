import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE, api } from '../api.js';

const DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일', '-'];
const DAY_OPTIONS = ['월', '화', '수', '목', '금', '토', '일'];
const JS_DAY_TO_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KST_TIME_ZONE = 'Asia/Seoul';

const ROLE_LABEL = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '클리닉 멘토',
  admin: '관리자',
  parent: '학부모'
};

function safeJson(value, fallback) {
  try {
    if (value == null || value === '') return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toRoundLabel(label) {
  return String(label || '').replace(/주차/g, '회차');
}

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
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

function fmtMD(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function fmtWeekLabel(week) {
  if (!week) return '';
  const label = toRoundLabel(week.label);
  const start = parseDateOnly(week.start_date);
  const end = parseDateOnly(week.end_date);
  if (start && end) return `${label} (${fmtMD(start)} ~ ${fmtMD(end)})`;
  return label || '';
}

function fmtDateTime(value) {
  if (!value) return '-';
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16);
  return date.toLocaleString('ko-KR', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function daySortValue(day) {
  const idx = DAY_ORDER.indexOf(String(day || '').trim());
  return idx < 0 ? 999 : idx;
}

function parseTimeToMinutes(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function toPadded2(value) {
  return String(value).padStart(2, '0');
}

function normalizeNumberText(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildDateTimeInputValue(month, day, time) {
  const m = Number(month);
  const d = Number(day);
  const t = String(time || '').trim();
  if (!Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  if (!/^\d{1,2}:\d{2}$/.test(t)) return '';
  const currentYear = new Date().getFullYear();
  return `${currentYear}-${toPadded2(m)}-${toPadded2(d)}T${t}`;
}

function parseDateTimeInput(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(year, month - 1, day);
  if (
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
    time: `${toPadded2(hour)}:${toPadded2(minute)}`,
    dayLabel: JS_DAY_TO_KO[date.getDay()] || ''
  };
}

function scheduleSortValue(item) {
  const month = Number(item?.session_month || 0);
  const day = Number(item?.session_day || 0);
  const hasDate = Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31;
  const startMinutes = parseTimeToMinutes(item?.session_start_time);
  const startValue = startMinutes == null ? 9999 : startMinutes;

  if (hasDate) {
    return month * 100000 + day * 1000 + startValue;
  }
  return 9000000 + daySortValue(item?.day_label) * 1000 + startValue;
}

function scheduleLabel(item) {
  const dayText = item?.day_label && item.day_label !== '-' ? `${item.day_label}요일` : '요일 미정';
  const dateText = item?.session_date_label && item.session_date_label !== '-' ? item.session_date_label : '';
  const rangeText = item?.session_range_text && item.session_range_text !== '-' ? item.session_range_text : '시간 미정';
  return [dayText, dateText, rangeText].filter(Boolean).join(' · ');
}

function formatProblemLine(problem) {
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

function normalizeProblemImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim();
  if (!url) return null;
  return {
    id: String(raw.id || '').trim(),
    url,
    filename: String(raw.filename || '').trim()
  };
}

function resolveProblemImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;

  const base = String(API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return raw;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}

function normalizeMentorNameKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function resolveScheduleWeekBaseYear(week) {
  const start = parseDateOnly(week?.start_date);
  if (start) return start.getFullYear();
  const end = parseDateOnly(week?.end_date);
  if (end) return end.getFullYear();
  return new Date().getFullYear();
}

function parseKstScheduledDate(item, week = null) {
  const month = Number(item?.session_month || 0);
  const day = Number(item?.session_day || 0);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const weekYear = resolveScheduleWeekBaseYear(week || null);
  const candidateYears = [weekYear, weekYear - 1, weekYear + 1, new Date().getFullYear()]
    .filter((year, idx, arr) => Number.isInteger(year) && arr.indexOf(year) === idx);

  const startMinutes = parseTimeToMinutes(item?.session_start_time);
  const hour = startMinutes == null ? 23 : Math.floor(startMinutes / 60);
  const minute = startMinutes == null ? 59 : (startMinutes % 60);

  for (const year of candidateYears) {
    const probe = new Date(year, month - 1, day);
    if (
      Number.isNaN(probe.getTime()) ||
      probe.getFullYear() !== year ||
      probe.getMonth() !== month - 1 ||
      probe.getDate() !== day
    ) {
      continue;
    }

    const kstDate = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0));
    if (!week) return kstDate;

    const weekStart = parseDateOnly(week?.start_date);
    const weekEnd = parseDateOnly(week?.end_date);
    if (!weekStart || !weekEnd) return kstDate;

    const weekStartOnly = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    const weekEndOnly = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
    const candidateOnly = new Date(year, month - 1, day);
    if (candidateOnly >= weekStartOnly && candidateOnly <= weekEndOnly) return kstDate;
  }

  const fallbackYear = candidateYears[0];
  if (!fallbackYear) return null;
  const fallback = new Date(fallbackYear, month - 1, day);
  if (
    Number.isNaN(fallback.getTime()) ||
    fallback.getFullYear() !== fallbackYear ||
    fallback.getMonth() !== month - 1 ||
    fallback.getDate() !== day
  ) {
    return null;
  }
  return new Date(Date.UTC(fallbackYear, month - 1, day, hour - 9, minute, 0));
}

function isAssignmentOverdue(item, week = null) {
  const status = normalizeCompletionStatus(item?.completion_status);
  if (status === 'done') return false;
  const scheduledAt = parseKstScheduledDate(item, week);
  if (!scheduledAt) return false;
  return Date.now() > scheduledAt.getTime();
}

function assignmentRecentSortValue(item, week = null) {
  const assignedAt = new Date(String(item?.assigned_at || '').trim());
  if (!Number.isNaN(assignedAt.getTime())) return assignedAt.getTime();
  const scheduledAt = parseKstScheduledDate(item, week);
  if (scheduledAt && !Number.isNaN(scheduledAt.getTime())) return scheduledAt.getTime();
  return 0;
}

function assignmentRowKey(item) {
  return `${item?.week_record_id || ''}-${item?.student_id || ''}-${item?.problem_index ?? ''}`;
}

function normalizeCompletionStatus(value) {
  const raw = String(value || '').trim();
  if (raw === 'done') return 'done';
  if (raw === 'incomplete') return 'incomplete';
  return 'pending';
}

function completionStatusTone(status) {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'incomplete') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function completionStatusLabel(status) {
  if (status === 'done') return '완료';
  if (status === 'incomplete') return '미완료';
  return '진행중';
}

const CALENDAR_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CALENDAR_DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
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
const MIN_MENTOR_OVERLAP_MINUTES = 10;
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

function resolveWeekBaseYear(week) {
  const start = parseDateOnly(week?.start_date);
  if (start) return start.getFullYear();
  const end = parseDateOnly(week?.end_date);
  if (end) return end.getFullYear();
  return new Date().getFullYear();
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

function normalizeDayKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (CALENDAR_DAYS.includes(raw)) return raw;
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
  for (const day of CALENDAR_DAYS) out[day] = [];
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

function classifySchedule(item) {
  const type = String(item?.type || '').trim();
  const title = String(item?.title || '').trim();
  const isAbsence = type.includes('미등원') || title.includes('미등원') || type.includes('결석') || title.includes('결석');
  const isCenter = type.includes('센터') || title.includes('센터');
  const isExternal = type.includes('외부') || title.includes('외부');
  if (isAbsence) return 'absence';
  if (isCenter) return 'center';
  if (isExternal) return 'external';
  return 'other';
}

function parseTimeRange(value) {
  const text = String(value || '').trim().replace(/\s+/g, '');
  if (!text) return null;
  const match = text.match(/(\d{1,2}:\d{2})[-~](\d{1,2}:\d{2})/);
  if (!match) return null;
  const start = parseTimeToMinutes(match[1]);
  const end = parseTimeToMinutes(match[2]);
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
    for (const day of CALENDAR_DAYS) {
      const studentItems = Array.isArray(studentSchedule?.[day]) ? studentSchedule[day] : [];
      const mentorItems = Array.isArray(mentor?.schedule?.[day]) ? mentor.schedule[day] : [];
      if (!studentItems.length || !mentorItems.length) continue;

      for (const studentItem of studentItems) {
        const scheduleType = classifySchedule(studentItem);
        if (scheduleType === 'external' || scheduleType === 'absence') continue;
        const studentRange = parseTimeRange(studentItem?.time);
        if (!studentRange) continue;
        for (const mentorItem of mentorItems) {
          const mentorRange = parseTimeRange(mentorItem?.time);
          if (!mentorRange) continue;
          const overlapMinutes = getOverlapMinutes(studentRange, mentorRange);
          if (overlapMinutes >= MIN_MENTOR_OVERLAP_MINUTES) {
            overlaps.push({
              day,
              student_time: String(studentItem?.time || ''),
              mentor_time: String(mentorItem?.time || ''),
              student_title: String(studentItem?.title || ''),
              mentor_title: String(mentorItem?.title || ''),
              overlap_minutes: overlapMinutes
            });
          }
        }
      }
    }
    if (!overlaps.length) continue;

    const mentorWorkSlots = CALENDAR_DAYS
      .flatMap((day) =>
        (Array.isArray(mentor?.schedule?.[day]) ? mentor.schedule[day] : []).map((slot) => ({
          day,
          time: String(slot?.time || '').trim()
        }))
      )
      .filter((slot) => slot.time);

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

function wrongAnswerRoleLabel(role) {
  if (role === 'mentor') return '클리닉 멘토';
  return ROLE_LABEL[role] || role || '멘토';
}

function wrongAnswerRoleRowTone(role) {
  if (role === 'mentor') return 'bg-emerald-50/70';
  if (role === 'lead') return 'bg-sky-50/70';
  return 'bg-white/70';
}

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
      ? raw.overlap_preview.map((v) => String(v || '').trim()).filter(Boolean)
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

function isMeaningfulWrongAnswerProblem(item) {
  const normalized = normalizeWrongAnswerItem(item || {});
  if (String(normalized.deleted_at || '').trim()) return false;
  const assignment = normalizeWrongAnswerAssignment(normalized.assignment || null);
  const hasCoreText = [
    normalized.subject,
    normalized.material,
    normalized.problem_name,
    normalized.problem_type,
    normalized.note
  ].some((value) => String(value || '').trim());
  const hasStatusText = [
    normalized.completion_feedback,
    normalized.incomplete_reason
  ].some((value) => String(value || '').trim());
  const hasImages = Array.isArray(normalized.images) && normalized.images.length > 0;
  const hasAssignment = Boolean(
    String(assignment?.mentor_id || '').trim() ||
    String(assignment?.mentor_name || '').trim() ||
    String(assignment?.session_month || '').trim() ||
    String(assignment?.session_day || '').trim() ||
    String(assignment?.session_start_time || '').trim() ||
    String(assignment?.session_day_label || '').trim()
  );
  return hasCoreText || hasStatusText || hasImages || hasAssignment;
}

function makeWrongAnswerProblemSignature(item) {
  const normalized = normalizeWrongAnswerItem(item || {});
  const assignment = normalizeWrongAnswerAssignment(normalized.assignment || null) || {};
  const imageKeys = (Array.isArray(normalized.images) ? normalized.images : [])
    .map((img) => {
      const id = String(img?.id || '').trim();
      const url = String(img?.url || '').trim();
      const filename = String(img?.filename || '').trim();
      return [id, url, filename].join('|');
    })
    .filter(Boolean)
    .sort();

  return JSON.stringify({
    subject: String(normalized.subject || '').trim(),
    material: String(normalized.material || '').trim(),
    problem_name: String(normalized.problem_name || '').trim(),
    problem_type: String(normalized.problem_type || '').trim(),
    note: String(normalized.note || '').trim(),
    completion_status: String(normalized.completion_status || '').trim(),
    completion_feedback: String(normalized.completion_feedback || '').trim(),
    incomplete_reason: String(normalized.incomplete_reason || '').trim(),
    deleted_at: String(normalized.deleted_at || '').trim(),
    mentor_id: String(assignment.mentor_id || '').trim(),
    mentor_name: String(assignment.mentor_name || '').trim(),
    mentor_role: String(assignment.mentor_role || '').trim(),
    session_day_label: String(assignment.session_day_label || '').trim(),
    session_month: String(assignment.session_month || '').trim(),
    session_day: String(assignment.session_day || '').trim(),
    session_start_time: String(assignment.session_start_time || '').trim(),
    session_duration_minutes: Number(assignment.session_duration_minutes || 0) || 0,
    images: imageKeys
  });
}

function composeQuickWrongAnswerPayload(localDraft, persistedDraft, mode = 'full') {
  const local = normalizeWrongAnswerDraftWithSummary(localDraft);
  if (mode !== 'append') return local;

  const persisted = normalizeWrongAnswerDraftWithSummary(persistedDraft);
  const persistedProblems = (Array.isArray(persisted.problems) ? persisted.problems : [])
    .map((problem) => normalizeWrongAnswerItem(problem));
  const localNewProblems = (Array.isArray(local.problems) ? local.problems : [])
    .map((problem) => normalizeWrongAnswerItem(problem))
    .filter((problem) => isMeaningfulWrongAnswerProblem(problem));
  const persistedSignatures = new Set(
    persistedProblems.map((problem) => makeWrongAnswerProblemSignature(problem))
  );
  const dedupedLocalNewProblems = localNewProblems.filter((problem) => {
    const signature = makeWrongAnswerProblemSignature(problem);
    if (persistedSignatures.has(signature)) return false;
    persistedSignatures.add(signature);
    return true;
  });
  const mergedProblems = [...persistedProblems, ...dedupedLocalNewProblems];
  const nextProblems = mergedProblems.length ? mergedProblems : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];

  return normalizeWrongAnswerDraftWithSummary({
    ...persisted,
    searched_at: String(local.searched_at || persisted.searched_at || '').trim(),
    problems: nextProblems,
    assignment: pickSummaryAssignmentFromProblems(
      nextProblems,
      persisted.assignment || local.assignment || null
    )
  });
}

function makeSessionRangeText(startTime, durationMinutes) {
  const start = parseTimeToMinutes(startTime);
  const duration = Math.max(1, Math.min(240, Number(durationMinutes || 20) || 20));
  if (start == null) return '';
  const end = start + duration;
  const startText = `${toPadded2(Math.floor(start / 60))}:${toPadded2(start % 60)}`;
  const endText = `${toPadded2(Math.floor(end / 60))}:${toPadded2(end % 60)}`;
  return `${startText} ~ ${endText} (${duration}분)`;
}

function buildWrongAnswerAssignmentFromCandidate(candidate, previousAssignment = null, patch = {}, assignedBy = '') {
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
      .map((item) => `${CALENDAR_DAY_LABELS[item.day] || item.day} ${item.student_time}`),
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
    assigned_by: assignedBy
  });
}

function WrongAnswerImageUploadModal({ loading, error, uploadUrl, problemIndex, onClose, onRefresh }) {
  const qrImageUrl = uploadUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(uploadUrl)}`
    : '';
  const [refreshing, setRefreshing] = useState(false);
  const [pcUploading, setPcUploading] = useState(false);
  const fileInputRef = useRef(null);

  function extractUploadToken(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return String(parsed.searchParams.get('token') || '').trim();
    } catch {
      const match = raw.match(/[?&]token=([^&]+)/);
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    }
  }

  function resolveUploadSubmitUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return `${String(API_BASE || '').trim().replace(/\/+$/, '')}/api/problem-upload/mobile/submit`;
    try {
      const parsed = new URL(raw);
      parsed.pathname = parsed.pathname.replace(/\/mobile\/?$/, '/mobile/submit');
      parsed.search = '';
      return parsed.toString();
    } catch {
      const base = String(API_BASE || '').trim().replace(/\/+$/, '');
      return base ? `${base}/api/problem-upload/mobile/submit` : '/api/problem-upload/mobile/submit';
    }
  }

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

  async function uploadPcImages(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length || pcUploading) return;

    const token = extractUploadToken(uploadUrl);
    if (!token) {
      window.alert('업로드 토큰을 찾지 못했습니다. 링크를 다시 생성해 주세요.');
      if (event?.target) event.target.value = '';
      return;
    }

    const submitUrl = resolveUploadSubmitUrl(uploadUrl);
    const formData = new FormData();
    formData.append('token', token);
    for (const file of files) {
      formData.append('images', file, String(file?.name || 'upload.jpg'));
    }

    setPcUploading(true);
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        body: formData
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await refreshUploadedImages();
      window.alert(`PC 이미지 업로드 완료: ${Number(data?.uploaded_count || files.length)}장`);
    } catch (e) {
      window.alert(e?.message || 'PC 이미지 업로드에 실패했습니다.');
    } finally {
      setPcUploading(false);
      if (event?.target) event.target.value = '';
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
                <button
                  className="btn-ghost"
                  type="button"
                  disabled={loading || refreshing || pcUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {pcUploading ? 'PC 업로드 중...' : 'PC에서 이미지 갖고 오기'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => void uploadPcImages(event)}
                />
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

export default function AssignmentStatus() {
  const [sp, setSp] = useSearchParams();
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(sp.get('week') || '');
  const [rows, setRows] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [stateSavingKey, setStateSavingKey] = useState('');
  const [doneEditKey, setDoneEditKey] = useState('');
  const [completionFeedbackDraft, setCompletionFeedbackDraft] = useState('');
  const [incompleteEditKey, setIncompleteEditKey] = useState('');
  const [incompleteReasonDraft, setIncompleteReasonDraft] = useState('');
  const [briefingMentor, setBriefingMentor] = useState('');
  const [briefingPhone, setBriefingPhone] = useState('');
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [briefingError, setBriefingError] = useState('');
  const [briefingResult, setBriefingResult] = useState(null);
  const [briefingCopyStatus, setBriefingCopyStatus] = useState('');
  const [briefingSmsBusy, setBriefingSmsBusy] = useState(false);
  const [briefingSmsStatus, setBriefingSmsStatus] = useState('');
  const [briefingSmsError, setBriefingSmsError] = useState('');
  const [editForm, setEditForm] = useState({
    mentor_name: '',
    mentor_role: 'mentor',
    session_day_label: '',
    session_month: '',
    session_day: '',
    session_start_time: '',
    session_datetime: '',
    session_duration_minutes: 20
  });
  const [students, setStudents] = useState([]);
  const [quickStudentId, setQuickStudentId] = useState('');
  const [quickStudentSearch, setQuickStudentSearch] = useState('');
  const [quickWeekRecordId, setQuickWeekRecordId] = useState('');
  const [quickWeekBaseYear, setQuickWeekBaseYear] = useState(new Date().getFullYear());
  const [quickSchedule, setQuickSchedule] = useState({});
  const [quickMentorInfo, setQuickMentorInfo] = useState({ mentors: [] });
  const [quickWrongAnswerPersistedDraft, setQuickWrongAnswerPersistedDraft] = useState(
    normalizeWrongAnswerDraftWithSummary({})
  );
  const [quickWrongAnswerDraft, setQuickWrongAnswerDraft] = useState(
    normalizeWrongAnswerDraftWithSummary({})
  );
  const [quickWrongAnswerDraftMode, setQuickWrongAnswerDraftMode] = useState('full');
  const [quickWrongAnswerCandidates, setQuickWrongAnswerCandidates] = useState([]);
  const [quickWrongAnswerSearched, setQuickWrongAnswerSearched] = useState(false);
  const [quickWrongAnswerTargetProblemIndex, setQuickWrongAnswerTargetProblemIndex] = useState(0);
  const [quickCollapsedWrongAnswerProblems, setQuickCollapsedWrongAnswerProblems] = useState({});
  const [quickWrongAnswerLoading, setQuickWrongAnswerLoading] = useState(false);
  const [quickWrongAnswerSaving, setQuickWrongAnswerSaving] = useState(false);
  const [quickWrongAnswerError, setQuickWrongAnswerError] = useState('');
  const [directorSummaryCollapsed, setDirectorSummaryCollapsed] = useState(false);
  const [quickWrongAnswerUploadModal, setQuickWrongAnswerUploadModal] = useState({
    open: false,
    loading: false,
    error: '',
    uploadUrl: '',
    problemIndex: -1
  });
  const isDirector = viewer?.role === 'director';
  const canEditAssignment = ['director', 'lead'].includes(String(viewer?.role || '').trim());
  const canUpdateState = Boolean(viewer?.role && viewer.role !== 'parent');
  const canIssueBriefing = ['director', 'lead', 'admin'].includes(String(viewer?.role || '').trim());
  const canUseQuickWrongAnswer = ['director', 'lead'].includes(String(viewer?.role || '').trim());

  function setQueryParams(patch) {
    const cur = Object.fromEntries([...sp.entries()]);
    const next = { ...cur, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] == null || next[k] === '') delete next[k];
    });
    setSp(next, { replace: true });
  }

  async function loadStudents() {
    try {
      const data = await api('/api/students');
      setStudents(Array.isArray(data?.students) ? data.students : []);
    } catch (e) {
      setQuickWrongAnswerError(e?.message || '학생 목록을 불러오지 못했습니다.');
      setStudents([]);
    }
  }

  async function loadStatus(targetWeekId) {
    if (!targetWeekId) return;
    setBusy(true);
    setError('');
    setBriefingError('');
    try {
      const data = await api(`/api/mentoring/assignment-status?weekId=${encodeURIComponent(targetWeekId)}`);
      setRows(Array.isArray(data?.assignments) ? data.assignments : []);
      setViewer(data?.viewer || null);
      setEditingKey('');
      setSavingKey('');
      setStateSavingKey('');
      setDoneEditKey('');
      setCompletionFeedbackDraft('');
      setIncompleteEditKey('');
      setIncompleteReasonDraft('');
    } catch (e) {
      setError(e?.message || '질답 배정현황을 불러오지 못했습니다.');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  async function loadAll() {
    setError('');
    try {
      const w = await api('/api/weeks');
      const weekList = Array.isArray(w?.weeks) ? w.weeks : [];
      const orderedWeeks = [...weekList].sort(
        (a, b) => Number(a?.id || 0) - Number(b?.id || 0)
      );
      setWeeks(orderedWeeks);

      const hasWeek = weekId && orderedWeeks.some((x) => String(x.id) === String(weekId));
      const effectiveWeekId = hasWeek
        ? String(weekId)
        : (orderedWeeks[orderedWeeks.length - 1]?.id ? String(orderedWeeks[orderedWeeks.length - 1].id) : '');

      if (!hasWeek && effectiveWeekId) {
        setWeekId(effectiveWeekId);
        setQueryParams({ week: effectiveWeekId });
      }
      await loadStatus(effectiveWeekId);
    } catch (e) {
      setError(e?.message || '회차 정보를 불러오지 못했습니다.');
      setRows([]);
    }
  }

  useEffect(() => {
    void loadAll();
    void loadStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginEdit(item) {
    if (!item) return;
    closeDoneEditor();
    setIncompleteEditKey('');
    setIncompleteReasonDraft('');
    setEditingKey(assignmentRowKey(item));
    const sessionMonth = String(item.session_month || '').trim();
    const sessionDay = String(item.session_day || '').trim();
    const sessionStartTime = String(item.session_start_time || '').trim();
    setEditForm({
      mentor_name: String(item.mentor_name || '').trim(),
      mentor_role: String(item.mentor_role || 'mentor').trim() || 'mentor',
      session_day_label: String(item.session_day_label || item.day_label || '').trim(),
      session_month: sessionMonth,
      session_day: sessionDay,
      session_start_time: sessionStartTime,
      session_datetime: buildDateTimeInputValue(sessionMonth, sessionDay, sessionStartTime),
      session_duration_minutes: Math.max(5, Math.min(240, Number(item.session_duration_minutes || 20) || 20))
    });
  }

  function cancelEdit() {
    setEditingKey('');
    setSavingKey('');
  }

  async function saveEdit(item) {
    const rowKey = assignmentRowKey(item);
    if (!item?.week_record_id || !rowKey) return;
    setSavingKey(rowKey);
    setError('');
    try {
      await api(`/api/mentoring/assignment-status/${encodeURIComponent(String(item.week_record_id))}`, {
        method: 'PUT',
        body: {
          problem_index: Number(item.problem_index || 0),
          mentor_name: String(editForm.mentor_name || '').trim(),
          mentor_role: String(editForm.mentor_role || '').trim() || 'mentor',
          session_day_label: String(editForm.session_day_label || '').trim(),
          session_month: String(editForm.session_month || '').replace(/\D/g, '').slice(0, 2),
          session_day: String(editForm.session_day || '').replace(/\D/g, '').slice(0, 2),
          session_start_time: String(editForm.session_start_time || '').trim(),
          session_duration_minutes: Math.max(
            5,
            Math.min(240, Number(editForm.session_duration_minutes || 20) || 20)
          )
        }
      });
      await loadStatus(weekId);
      setEditingKey('');
    } catch (e) {
      setError(e?.message || '배정 수정에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  function openIncompleteEditor(item) {
    const rowKey = assignmentRowKey(item);
    if (!rowKey) return;
    closeDoneEditor();
    setEditingKey('');
    setIncompleteEditKey(rowKey);
    setIncompleteReasonDraft(String(item?.incomplete_reason || ''));
  }

  function openDoneEditor(item) {
    const rowKey = assignmentRowKey(item);
    if (!rowKey) return;
    setEditingKey('');
    setIncompleteEditKey('');
    setIncompleteReasonDraft('');
    setDoneEditKey(rowKey);
    setCompletionFeedbackDraft(String(item?.completion_feedback || ''));
  }

  function closeDoneEditor() {
    setDoneEditKey('');
    setCompletionFeedbackDraft('');
  }

  function closeIncompleteEditor() {
    setIncompleteEditKey('');
    setIncompleteReasonDraft('');
  }

  function updateQuickWrongAnswerProblem(index, patch) {
    setQuickWrongAnswerDraft((prev) => {
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

  function addQuickWrongAnswerProblem() {
    setQuickWrongAnswerDraft((prev) => {
      const hasExplicitEmptyProblems =
        prev &&
        typeof prev === 'object' &&
        Array.isArray(prev.problems) &&
        prev.problems.length === 0;
      const base = hasExplicitEmptyProblems
        ? { problems: [], assignment: null, searched_at: String(prev?.searched_at || '').trim() }
        : normalizeWrongAnswerDraftWithSummary(prev);
      return {
        ...base,
        problems: [...(base.problems || []), { ...DEFAULT_WRONG_ANSWER_ITEM, assignment: null }]
      };
    });
  }

  function removeQuickWrongAnswerProblem(index) {
    setQuickWrongAnswerDraft((prev) => {
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
    setQuickWrongAnswerTargetProblemIndex((prev) => Math.max(0, Number(prev || 0) - (Number(prev || 0) > index ? 1 : 0)));
    setQuickCollapsedWrongAnswerProblems((prev) => {
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

  function collapseQuickWrongAnswerProblem(index) {
    setQuickCollapsedWrongAnswerProblems((prev) => ({ ...(prev || {}), [Number(index || 0)]: true }));
  }

  function expandQuickWrongAnswerProblem(index) {
    setQuickCollapsedWrongAnswerProblems((prev) => {
      const next = { ...(prev || {}) };
      delete next[Number(index || 0)];
      return next;
    });
  }

  function selectQuickWrongAnswerProblem(index) {
    const safe = Math.max(0, Number(index || 0));
    setQuickWrongAnswerTargetProblemIndex(safe);
  }

  function findQuickWrongAnswerCandidates(problemIndex = quickWrongAnswerTargetProblemIndex) {
    const safe = Math.max(0, Number(problemIndex || 0));
    selectQuickWrongAnswerProblem(safe);
    const candidates = buildOverlapCandidates(quickSchedule, quickMentorInfo);
    setQuickWrongAnswerCandidates(candidates);
    setQuickWrongAnswerSearched(true);
    setQuickWrongAnswerDraft((prev) => ({
      ...normalizeWrongAnswerDraftWithSummary(prev),
      searched_at: new Date().toISOString()
    }));
  }

  function assignQuickWrongAnswerMentor(candidate, problemIndex = quickWrongAnswerTargetProblemIndex, assignmentPatch = {}) {
    if (!candidate) return;
    setQuickWrongAnswerDraft((prev) => {
      const base = normalizeWrongAnswerDraftWithSummary(prev);
      const list = Array.isArray(base.problems) ? [...base.problems] : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
      const safeIndex = Math.max(0, Math.min(Number(problemIndex || 0), Math.max(0, list.length - 1)));
      const currentItem = normalizeWrongAnswerItem(list[safeIndex] || {});
      const previousAssignment = normalizeWrongAnswerAssignment(currentItem.assignment || base.assignment || null);
      const nextAssignment = buildWrongAnswerAssignmentFromCandidate(
        candidate,
        previousAssignment,
        assignmentPatch,
        String(viewer?.role || '')
      );
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
    setQuickWrongAnswerSearched(false);
  }

  function updateQuickWrongAnswerAssignment(problemIndex, patch) {
    setQuickWrongAnswerDraft((prev) => {
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

  function closeQuickWrongAnswerUploadModal() {
    setQuickWrongAnswerUploadModal({
      open: false,
      loading: false,
      error: '',
      uploadUrl: '',
      problemIndex: -1
    });
  }

  async function loadQuickWrongAnswerRecord(
    targetStudentId = quickStudentId,
    targetWeekId = weekId,
    { preserveLocalInputs = false } = {}
  ) {
    const studentIdNumber = Number(targetStudentId || 0);
    const weekIdValue = String(targetWeekId || '').trim();
    if (!studentIdNumber || !weekIdValue) return;

    setQuickWrongAnswerLoading(true);
    setQuickWrongAnswerError('');
    try {
      const data = await api(
        `/api/mentoring/record?studentId=${encodeURIComponent(String(studentIdNumber))}&weekId=${encodeURIComponent(weekIdValue)}`
      );
      const draft = normalizeWrongAnswerDraftWithSummary(
        safeJson(data?.week_record?.e_wrong_answer_distribution, {})
      );
      const problems = Array.isArray(draft?.problems) ? draft.problems : [];
      const safeIdx = Math.max(0, Math.min(Number(quickWrongAnswerTargetProblemIndex || 0), Math.max(0, problems.length - 1)));

      setQuickWeekRecordId(String(data?.week_record?.id || ''));
      setQuickWeekBaseYear(resolveWeekBaseYear(data?.week));
      setQuickSchedule(safeJson(data?.student?.schedule_json, {}));
      setQuickMentorInfo(normalizeMentorInfo(data?.mentor_info));
      setQuickWrongAnswerPersistedDraft(draft);
      if (preserveLocalInputs) {
        const merged = mergeWrongAnswerDraftKeepingLocalInputs(quickWrongAnswerDraft, draft);
        const mergedProblems = Array.isArray(merged?.problems) ? merged.problems : [];
        const mergedSafeIdx = Math.max(
          0,
          Math.min(Number(quickWrongAnswerTargetProblemIndex || 0), Math.max(0, mergedProblems.length - 1))
        );
        setQuickWrongAnswerDraft(merged);
        setQuickWrongAnswerTargetProblemIndex(mergedSafeIdx);
      } else {
        setQuickWrongAnswerDraft(draft);
        setQuickWrongAnswerDraftMode('full');
        setQuickWrongAnswerCandidates([]);
        setQuickWrongAnswerSearched(false);
        setQuickWrongAnswerTargetProblemIndex(safeIdx);
        setQuickCollapsedWrongAnswerProblems({});
      }
    } catch (e) {
      setQuickWrongAnswerError(e?.message || '오답 배분 기록을 불러오지 못했습니다.');
      const emptyDraft = normalizeWrongAnswerDraftWithSummary({});
      setQuickWrongAnswerPersistedDraft(emptyDraft);
      setQuickWrongAnswerDraft(emptyDraft);
      setQuickWrongAnswerDraftMode('full');
      setQuickWeekRecordId('');
      setQuickSchedule({});
      setQuickMentorInfo({ mentors: [] });
      setQuickWrongAnswerCandidates([]);
      setQuickWrongAnswerSearched(false);
      setQuickWrongAnswerTargetProblemIndex(0);
      setQuickCollapsedWrongAnswerProblems({});
    } finally {
      setQuickWrongAnswerLoading(false);
    }
  }

  async function refreshQuickWrongAnswerUploadedImages() {
    if (!quickStudentId || !weekId) return;
    await loadQuickWrongAnswerRecord(quickStudentId, weekId, { preserveLocalInputs: true });
  }

  async function openQuickWrongAnswerImageUpload(problemIndex) {
    const studentIdNumber = Number(quickStudentId || 0);
    if (!studentIdNumber || !weekId) return;
    setQuickWrongAnswerUploadModal({
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
          student_id: studentIdNumber,
          week_id: Number(weekId),
          problem_index: Number(problemIndex)
        }
      });
      const uploadUrl = String(data?.upload_url || '').trim();
      if (!uploadUrl) throw new Error('업로드 링크를 만들지 못했습니다.');
      setQuickWrongAnswerUploadModal({
        open: true,
        loading: false,
        error: '',
        uploadUrl,
        problemIndex
      });
    } catch (e) {
      setQuickWrongAnswerUploadModal({
        open: true,
        loading: false,
        error: e?.message || '업로드 링크 생성에 실패했습니다.',
        uploadUrl: '',
        problemIndex
      });
    }
  }

  function removeQuickWrongAnswerImageLocal(problemIndex, targetImage, imageIndex = -1) {
    setQuickWrongAnswerDraft((prev) => {
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

  async function removeQuickWrongAnswerImage(problemIndex, targetImage, imageIndex = -1) {
    const imageId = String(targetImage?.id || '').trim();
    const studentIdNumber = Number(quickStudentId || 0);
    const weekNumber = Number(weekId || 0);
    const canServerDelete = Boolean(quickWeekRecordId && weekNumber && studentIdNumber && imageId);
    if (!canServerDelete) {
      removeQuickWrongAnswerImageLocal(problemIndex, targetImage, imageIndex);
      return;
    }

    try {
      const result = await api('/api/mentoring/wrong-answer/delete-image', {
        method: 'POST',
        body: {
          student_id: studentIdNumber,
          week_id: weekNumber,
          problem_index: Number(problemIndex),
          image_id: imageId
        }
      });
      if (result?.e_wrong_answer_distribution) {
        const latestWrongAnswer = normalizeWrongAnswerDraftWithSummary(result.e_wrong_answer_distribution);
        setQuickWrongAnswerDraft((prev) =>
          mergeWrongAnswerDraftKeepingLocalInputs(prev, latestWrongAnswer)
        );
      } else {
        removeQuickWrongAnswerImageLocal(problemIndex, targetImage, imageIndex);
      }
    } catch (e) {
      setQuickWrongAnswerError(e?.message || '문제 이미지 삭제에 실패했습니다.');
    }
  }

  async function saveQuickWrongAnswerDistribution() {
    if (!quickWeekRecordId || !canUseQuickWrongAnswer) return;
    setQuickWrongAnswerSaving(true);
    setQuickWrongAnswerError('');
    try {
      const payload = composeQuickWrongAnswerPayload(
        quickWrongAnswerDraft,
        quickWrongAnswerPersistedDraft,
        quickWrongAnswerDraftMode
      );
      await api(`/api/mentoring/week-record/${encodeURIComponent(quickWeekRecordId)}`, {
        method: 'PUT',
        body: { e_wrong_answer_distribution: payload }
      });
      setQuickWrongAnswerPersistedDraft(payload);
      await loadStatus(weekId);
      window.alert('오답 배분이 저장되었습니다.');
    } catch (e) {
      setQuickWrongAnswerError(e?.message || '오답 배분 저장에 실패했습니다.');
    } finally {
      setQuickWrongAnswerSaving(false);
    }
  }

  async function submitQuickWrongAnswerProblem(index) {
    if (!quickWeekRecordId || !canUseQuickWrongAnswer) return;
    if (quickWrongAnswerDraftMode === 'append') {
      const localProblems = (Array.isArray(quickWrongAnswerDraft?.problems) ? quickWrongAnswerDraft.problems : [])
        .map((problem) => normalizeWrongAnswerItem(problem))
        .filter((problem) => isMeaningfulWrongAnswerProblem(problem));
      if (!localProblems.length) {
        setQuickWrongAnswerError('제출할 오답 기록을 먼저 입력해 주세요.');
        return;
      }
    }
    setQuickWrongAnswerSaving(true);
    setQuickWrongAnswerError('');
    try {
      const payload = composeQuickWrongAnswerPayload(
        quickWrongAnswerDraft,
        quickWrongAnswerPersistedDraft,
        quickWrongAnswerDraftMode
      );
      await api(`/api/mentoring/week-record/${encodeURIComponent(quickWeekRecordId)}`, {
        method: 'PUT',
        body: { e_wrong_answer_distribution: payload }
      });
      setQuickWrongAnswerPersistedDraft(payload);
      setQuickWrongAnswerDraft({ problems: [], assignment: null, searched_at: '' });
      setQuickWrongAnswerDraftMode('append');
      setQuickWrongAnswerTargetProblemIndex(0);
      setQuickCollapsedWrongAnswerProblems({});
      setQuickWrongAnswerCandidates([]);
      setQuickWrongAnswerSearched(false);
      await loadStatus(weekId);
      window.alert(`오답 기록 ${Number(index) + 1}이(가) 제출되었습니다.`);
    } catch (e) {
      setQuickWrongAnswerError(e?.message || '오답 기록 제출에 실패했습니다.');
    } finally {
      setQuickWrongAnswerSaving(false);
    }
  }

  async function updateProblemState(item, payload) {
    const rowKey = assignmentRowKey(item);
    if (!item?.week_record_id || !rowKey) return false;
    setStateSavingKey(rowKey);
    setError('');
    try {
      await api(`/api/mentoring/assignment-status/${encodeURIComponent(String(item.week_record_id))}/problem-state`, {
        method: 'PUT',
        body: {
          problem_index: Number(item.problem_index || 0),
          ...payload
        }
      });
      await loadStatus(weekId);
      return true;
    } catch (e) {
      setError(e?.message || '상태 저장에 실패했습니다.');
      return false;
    } finally {
      setStateSavingKey('');
    }
  }

  function markProblemDone(item) {
    openDoneEditor(item);
  }

  async function saveProblemDone(item) {
    const feedback = String(completionFeedbackDraft || '');
    closeIncompleteEditor();
    const ok = await updateProblemState(item, {
      completion_status: 'done',
      incomplete_reason: '',
      completion_feedback: feedback
    });
    if (ok) closeDoneEditor();
  }

  async function saveProblemIncomplete(item) {
    const reason = String(incompleteReasonDraft || '').trim();
    if (!reason) {
      setError('미완료 사유를 입력해 주세요.');
      return;
    }
    const ok = await updateProblemState(item, {
      completion_status: 'incomplete',
      incomplete_reason: reason
    });
    if (ok) closeIncompleteEditor();
  }

  async function deleteProblemItem(item) {
    const ok = window.confirm('이 배정 항목을 삭제할까요? 데이터와 이미지는 즉시 물리 삭제되지 않습니다.');
    if (!ok) return;
    closeDoneEditor();
    closeIncompleteEditor();
    await updateProblemState(item, { action: 'delete' });
  }

  const mentorWindowMode = String(sp.get('mentorView') || '').trim() === '1';
  const mentorFilterName = String(sp.get('mentor') || '').trim();
  const selectedWeek = useMemo(
    () => (weeks || []).find((w) => String(w.id) === String(weekId)) || null,
    [weeks, weekId]
  );
  const weeksDesc = useMemo(
    () => [...(weeks || [])].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0)),
    [weeks]
  );
  const sortedRows = useMemo(() => {
    const list = [...(Array.isArray(rows) ? rows : [])];
    list.sort((a, b) => {
      const recentDiff = assignmentRecentSortValue(b, selectedWeek) - assignmentRecentSortValue(a, selectedWeek);
      if (recentDiff !== 0) return recentDiff;

      const scheduleDiff = scheduleSortValue(b) - scheduleSortValue(a);
      if (scheduleDiff !== 0) return scheduleDiff;

      const studentCmp = String(a.student_name || '').localeCompare(String(b.student_name || ''));
      if (studentCmp !== 0) return studentCmp;
      return String(a.external_id || '').localeCompare(String(b.external_id || ''));
    });
    return list;
  }, [rows, selectedWeek]);
  const visibleRows = useMemo(() => {
    if (!mentorFilterName) return sortedRows;
    const targetKey = normalizeMentorNameKey(mentorFilterName);
    return sortedRows.filter((row) => normalizeMentorNameKey(row?.mentor_name) === targetKey);
  }, [sortedRows, mentorFilterName]);
  const mentorOptions = useMemo(() => {
    const byMentor = new Map();
    for (const row of sortedRows) {
      const mentorName = String(row?.mentor_name || '').trim();
      if (!mentorName || byMentor.has(mentorName)) continue;
      byMentor.set(mentorName, {
        mentor_name: mentorName,
        mentor_role: String(row?.mentor_role || '').trim() || 'mentor'
      });
    }
    return Array.from(byMentor.values());
  }, [sortedRows]);
  const grouped = useMemo(
    () =>
      visibleRows.map((row) => ({
        mentor_name: String(row?.mentor_name || '').trim() || '미배정',
        mentor_role: String(row?.mentor_role || '').trim() || 'mentor',
        items: [row]
      })),
    [visibleRows]
  );
  const weekLabel = selectedWeek ? fmtWeekLabel(selectedWeek) : '';
  const selectedQuickStudent = useMemo(
    () => (students || []).find((student) => String(student?.id || '') === String(quickStudentId)) || null,
    [students, quickStudentId]
  );
  const filteredQuickStudents = useMemo(() => {
    const list = Array.isArray(students) ? students : [];
    const query = String(quickStudentSearch || '').trim().toLowerCase();
    if (!query) return list;

    const filtered = list.filter((student) => {
      const name = String(student?.name || '').toLowerCase();
      const externalId = String(student?.external_id || '').toLowerCase();
      return name.includes(query) || externalId.includes(query);
    });
    if (filtered.length) return filtered;

    const selected = list.find((student) => String(student?.id || '') === String(quickStudentId));
    return selected ? [selected] : [];
  }, [students, quickStudentSearch, quickStudentId]);
  const summaryDayColumns = useMemo(() => DAY_ORDER.filter((day) => day !== '-'), []);
  const mentorDaySummaryRows = useMemo(() => {
    const byMentor = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const mentorName = String(row?.mentor_name || '').trim() || '미배정';
      const mentorRole = String(row?.mentor_role || '').trim() || 'mentor';
      const dayLabelRaw = String(row?.day_label || row?.session_day_label || '').trim();
      const dayLabel = summaryDayColumns.includes(dayLabelRaw) ? dayLabelRaw : '-';

      if (!byMentor.has(mentorName)) {
        const counts = {};
        for (const day of summaryDayColumns) counts[day] = 0;
        counts['-'] = 0;
        byMentor.set(mentorName, {
          mentor_name: mentorName,
          mentor_role: mentorRole,
          counts,
          total: 0
        });
      }
      const target = byMentor.get(mentorName);
      target.counts[dayLabel] = Number(target.counts[dayLabel] || 0) + 1;
      target.total += 1;
    }

    return Array.from(byMentor.values()).sort((a, b) =>
      String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''))
    );
  }, [rows, summaryDayColumns]);

  useEffect(() => {
    if (!mentorOptions.length) {
      if (briefingMentor) setBriefingMentor('');
      return;
    }
    const hasCurrent = mentorOptions.some((row) => row.mentor_name === briefingMentor);
    if (!hasCurrent) setBriefingMentor(mentorOptions[0].mentor_name);
  }, [mentorOptions, briefingMentor]);

  useEffect(() => {
    setBriefingResult(null);
    setBriefingCopyStatus('');
    setBriefingError('');
    setBriefingSmsBusy(false);
    setBriefingSmsStatus('');
    setBriefingSmsError('');
  }, [weekId]);

  useEffect(() => {
    if (!students.length) {
      if (quickStudentId) setQuickStudentId('');
      return;
    }
    const hasCurrent = students.some((student) => String(student?.id || '') === String(quickStudentId));
    if (hasCurrent) return;

    const firstFromRows = rows.find((row) => row?.student_id)?.student_id;
    if (firstFromRows && students.some((student) => Number(student?.id || 0) === Number(firstFromRows))) {
      setQuickStudentId(String(firstFromRows));
      return;
    }
    setQuickStudentId(String(students[0].id));
  }, [students, rows, quickStudentId]);

  useEffect(() => {
    if (!canUseQuickWrongAnswer || !weekId || !quickStudentId) {
      setQuickWrongAnswerError('');
      return;
    }
    void loadQuickWrongAnswerRecord(quickStudentId, weekId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseQuickWrongAnswer, weekId, quickStudentId]);

  async function issueMentorBriefing() {
    const mentorName = String(briefingMentor || '').trim();
    if (!weekId || !mentorName) return;

    const selected = mentorOptions.find((row) => row.mentor_name === mentorName);
    setBriefingBusy(true);
    setBriefingError('');
    setBriefingCopyStatus('');
    setBriefingSmsStatus('');
    setBriefingSmsError('');
    try {
      const result = await api('/api/mentor-briefings/issue', {
        method: 'POST',
        body: {
          week_id: Number(weekId || 0),
          mentor_name: mentorName,
          mentor_role: selected?.mentor_role || 'mentor',
          mentor_phone: String(briefingPhone || '').trim()
        }
      });
      setBriefingResult(result || null);
    } catch (e) {
      setBriefingResult(null);
      setBriefingError(e?.message || '사전 전송 링크 생성에 실패했습니다.');
    } finally {
      setBriefingBusy(false);
    }
  }

  async function copyBriefingLink() {
    const link = String(briefingResult?.share_url || '').trim();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setBriefingCopyStatus('링크를 복사했습니다.');
    } catch {
      setBriefingCopyStatus('복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.');
    }
  }

  async function sendBriefingSms() {
    const tokenId = String(briefingResult?.token_id || '').trim();
    const toPhone = String(briefingPhone || '').trim();
    if (!tokenId) {
      setBriefingSmsError('먼저 링크를 생성해 주세요.');
      return;
    }
    if (!toPhone) {
      setBriefingSmsError('수신 번호를 입력해 주세요.');
      return;
    }

    setBriefingSmsBusy(true);
    setBriefingSmsStatus('');
    setBriefingSmsError('');
    try {
      const result = await api('/api/mentor-briefings/send-sms', {
        method: 'POST',
        body: {
          token_id: tokenId,
          to_phone: toPhone
        }
      });
      if (result?.to_phone) setBriefingPhone(String(result.to_phone));
      setBriefingSmsStatus(`문자 전송 완료 (${result?.to_phone_masked || toPhone})`);
    } catch (e) {
      setBriefingSmsError(e?.message || '문자 전송에 실패했습니다.');
    } finally {
      setBriefingSmsBusy(false);
    }
  }

  function openMentorQuestionWindow(mentorName) {
    const name = String(mentorName || '').trim();
    const currentWeekId = String(weekId || '').trim();
    if (!name || !currentWeekId || typeof window === 'undefined') return;

    const url = new URL(`${window.location.origin}${window.location.pathname}`);
    url.searchParams.set('week', currentWeekId);
    url.searchParams.set('mentor', name);
    url.searchParams.set('mentorView', '1');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-6">
      {!mentorWindowMode && canUseQuickWrongAnswer ? (
        <div className="card p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold text-brand-900">오답 배분하기</div>
              <div className="text-xs text-slate-700">
                질답 배정현황 상단에서 바로 오답 문제를 배정하고 수정할 수 있습니다.
              </div>
              {selectedQuickStudent ? (
                <div className="mt-1 text-xs text-slate-600">
                  선택 학생: {selectedQuickStudent.external_id ? `${selectedQuickStudent.external_id} · ` : ''}
                  {selectedQuickStudent.name || '-'}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input h-9 w-56"
                value={quickStudentId}
                onChange={(e) => setQuickStudentId(String(e.target.value || ''))}
              >
                {filteredQuickStudents.length ? (
                  filteredQuickStudents.map((student) => (
                    <option key={`quick-student-${student.id}`} value={student.id}>
                      {student.external_id ? `${student.external_id} · ` : ''}
                      {student.name || `학생 ${student.id}`}
                    </option>
                  ))
                ) : (
                  <option value="">{students.length ? '검색 결과 없음' : '학생 없음'}</option>
                )}
              </select>
              <button
                className="btn-ghost h-9 px-3 text-sm"
                type="button"
                onClick={() => void loadStudents()}
                disabled={quickWrongAnswerLoading || quickWrongAnswerSaving}
              >
                학생 새로고침
              </button>
              <button
                className="btn-ghost h-9 px-3 text-sm"
                type="button"
                onClick={() => void loadQuickWrongAnswerRecord(quickStudentId, weekId)}
                disabled={!quickStudentId || !weekId || quickWrongAnswerLoading || quickWrongAnswerSaving}
              >
                배분 새로고침
              </button>
              <button
                className="btn-primary h-9 px-3 text-sm"
                type="button"
                onClick={() => void saveQuickWrongAnswerDistribution()}
                disabled={!quickWeekRecordId || quickWrongAnswerLoading || quickWrongAnswerSaving}
              >
                {quickWrongAnswerSaving ? '저장 중...' : '저장'}
              </button>
              <input
                className="input h-9 w-48"
                value={quickStudentSearch}
                onChange={(e) => setQuickStudentSearch(String(e.target.value || ''))}
                placeholder="학생 이름 검색"
              />
            </div>
          </div>

          {quickWrongAnswerError ? <div className="mt-2 text-sm text-red-600">{quickWrongAnswerError}</div> : null}

          {!quickStudentId ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-600">
              학생을 선택해 주세요.
            </div>
          ) : quickWrongAnswerLoading ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-600">
              오답 배분 정보를 불러오는 중...
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {(Array.isArray(quickWrongAnswerDraft?.problems) ? quickWrongAnswerDraft.problems : []).map((item, idx) => {
                const problemAssignment = normalizeWrongAnswerAssignment(
                  item?.assignment || (idx === 0 ? quickWrongAnswerDraft?.assignment : null)
                );
                const problemDateInputValue = buildDateInputValue(
                  problemAssignment?.session_month,
                  problemAssignment?.session_day,
                  quickWeekBaseYear
                );
                const problemSessionStartTime = String(problemAssignment?.session_start_time || '').trim();
                const problemSessionRangeText = makeSessionRangeText(
                  problemSessionStartTime,
                  problemAssignment?.session_duration_minutes
                );
                const tone = wrongAnswerToneByIndex(idx);
                const isTargetProblem = Number(quickWrongAnswerTargetProblemIndex || 0) === idx;
                const isCollapsed = Boolean(quickCollapsedWrongAnswerProblems?.[idx]);
                const showMentorPickerForProblem = quickWrongAnswerSearched && isTargetProblem;
                return (
                  <div
                    key={`quick-problem-${idx}`}
                    className={[
                      'rounded-2xl border p-3',
                      tone.card,
                      isTargetProblem ? `ring-1 ${tone.ring}` : ''
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">오답 기록 {idx + 1}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={[
                            tone.assignButton,
                            isTargetProblem ? `ring-2 ring-offset-1 ${tone.ring}` : ''
                          ].join(' ')}
                          type="button"
                          onClick={() => findQuickWrongAnswerCandidates(idx)}
                          disabled={quickWrongAnswerSaving}
                        >
                          멘토 배정하기
                        </button>
                        <button
                          className="btn border border-blue-700 bg-blue-600 text-white hover:border-blue-800 hover:bg-blue-700"
                          type="button"
                          disabled={quickWrongAnswerSaving}
                          onClick={() => void submitQuickWrongAnswerProblem(idx)}
                        >
                          완료 및 제출
                        </button>
                        {isCollapsed ? (
                          <button className="btn-ghost" type="button" onClick={() => expandQuickWrongAnswerProblem(idx)}>
                            펼쳐보기
                          </button>
                        ) : null}
                        <button
                          className="btn-ghost border-blue-200 text-blue-700 hover:border-blue-300 hover:text-blue-800"
                          type="button"
                          disabled={quickWrongAnswerSaving}
                          onClick={() => void openQuickWrongAnswerImageUpload(idx)}
                        >
                          문제 이미지 업로드하기
                        </button>
                        <button
                          className="btn-ghost"
                          type="button"
                          disabled={(quickWrongAnswerDraft?.problems || []).length <= 1 || quickWrongAnswerSaving}
                          onClick={() => removeQuickWrongAnswerProblem(idx)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                    {isCollapsed ? (
                      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-700">
                        {String(item.subject || '').trim() || '-'} · {String(item.problem_name || '').trim() || '문제명 미입력'} · {String(item.problem_type || '').trim() || '-'}
                      </div>
                    ) : null}

                    {!isCollapsed ? (
                      <div className="mt-3 grid grid-cols-12 gap-3">
                        <div className="col-span-12 md:col-span-3">
                          <div className="text-xs text-slate-800">과목</div>
                          <input
                            className="input mt-1"
                            value={item.subject || ''}
                            onChange={(e) => updateQuickWrongAnswerProblem(idx, { subject: e.target.value })}
                            disabled={quickWrongAnswerSaving}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-3">
                          <div className="text-xs text-slate-800">교재명</div>
                          <input
                            className="input mt-1"
                            value={item.material || ''}
                            onChange={(e) => updateQuickWrongAnswerProblem(idx, { material: e.target.value })}
                            disabled={quickWrongAnswerSaving}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-3">
                          <div className="text-xs text-slate-800">문제명</div>
                          <input
                            className="input mt-1"
                            value={item.problem_name || ''}
                            onChange={(e) => updateQuickWrongAnswerProblem(idx, { problem_name: e.target.value })}
                            disabled={quickWrongAnswerSaving}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-3">
                          <div className="text-xs text-slate-800">유형</div>
                          <input
                            className="input mt-1"
                            value={item.problem_type || ''}
                            onChange={(e) => updateQuickWrongAnswerProblem(idx, { problem_type: e.target.value })}
                            disabled={quickWrongAnswerSaving}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-6">
                          <div className="text-xs text-slate-800">전달사항</div>
                          <textarea
                            className="textarea mt-1 min-h-[68px]"
                            value={item.note || ''}
                            onChange={(e) => updateQuickWrongAnswerProblem(idx, { note: e.target.value })}
                            disabled={quickWrongAnswerSaving}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-6">
                          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <div className="text-xs font-semibold text-slate-800">배정 정보</div>
                            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                              <div>
                                <div className="text-[11px] text-slate-600">멘토 이름</div>
                                <input
                                  className="input mt-1 h-9"
                                  value={problemAssignment?.mentor_name || ''}
                                  onChange={(e) =>
                                    updateQuickWrongAnswerAssignment(idx, {
                                      mentor_name: String(e.target.value || '').trim(),
                                      mentor_id: String(e.target.value || '').trim()
                                    })
                                  }
                                  disabled={quickWrongAnswerSaving}
                                />
                              </div>
                              <div>
                                <div className="text-[11px] text-slate-600">멘토 역할</div>
                                <select
                                  className="input mt-1 h-9"
                                  value={problemAssignment?.mentor_role || 'mentor'}
                                  onChange={(e) =>
                                    updateQuickWrongAnswerAssignment(idx, {
                                      mentor_role: String(e.target.value || '').trim() || 'mentor'
                                    })
                                  }
                                  disabled={quickWrongAnswerSaving}
                                >
                                  <option value="mentor">클리닉 멘토</option>
                                  <option value="lead">총괄멘토</option>
                                  <option value="director">원장</option>
                                  <option value="admin">관리자</option>
                                </select>
                              </div>
                            </div>
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
                                      updateQuickWrongAnswerAssignment(idx, {
                                        session_month: '',
                                        session_day: '',
                                        session_day_label: ''
                                      });
                                      return;
                                    }
                                    const parsed = parseDateInputValue(nextDate);
                                    if (!parsed) return;
                                    updateQuickWrongAnswerAssignment(idx, {
                                      session_month: String(parsed.month),
                                      session_day: String(parsed.day),
                                      session_day_label: parsed.dayLabel || ''
                                    });
                                  }}
                                  disabled={quickWrongAnswerSaving}
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
                                      updateQuickWrongAnswerAssignment(idx, {
                                        session_start_time: String(e.target.value || '').trim()
                                      })
                                    }
                                    disabled={quickWrongAnswerSaving}
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      className="btn-ghost h-8 px-2 text-[11px]"
                                      type="button"
                                      onClick={() =>
                                        updateQuickWrongAnswerAssignment(idx, {
                                          session_start_time: ''
                                        })
                                      }
                                      disabled={quickWrongAnswerSaving}
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
                                      updateQuickWrongAnswerAssignment(idx, {
                                        session_day_label: String(e.target.value || '').trim()
                                      })
                                    }
                                    disabled={quickWrongAnswerSaving}
                                  >
                                    <option value="">선택</option>
                                    {DAY_OPTIONS.map((day) => (
                                      <option key={`quick-day-${idx}-${day}`} value={day}>{day}</option>
                                    ))}
                                  </select>
                                  <div className="flex justify-end">
                                    <button
                                      className="btn-ghost h-8 px-2 text-[11px]"
                                      type="button"
                                      onClick={() =>
                                        updateQuickWrongAnswerAssignment(idx, {
                                          session_day_label: ''
                                        })
                                      }
                                      disabled={quickWrongAnswerSaving}
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
                                    updateQuickWrongAnswerAssignment(idx, {
                                      session_duration_minutes: Math.max(
                                        1,
                                        Math.min(240, Number(e.target.value || 20) || 20)
                                      )
                                    })
                                  }
                                  disabled={quickWrongAnswerSaving}
                                />
                              </div>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-600">
                              자동 반영: {problemAssignment?.session_day_label || '-'}요일 · {problemAssignment?.session_month || '-'}월 {problemAssignment?.session_day || '-'}일 · {problemSessionStartTime || '--:--'}
                            </div>
                            <div className={`mt-1 text-[11px] ${problemSessionRangeText ? 'text-slate-600' : 'text-slate-500'}`}>
                              등록된 시작 시각: {problemSessionStartTime || '--:--'}
                              {problemSessionRangeText ? ` · 범위: ${problemSessionRangeText}` : ''}
                            </div>
                          </div>
                        </div>
                        {showMentorPickerForProblem ? (
                          <div className="col-span-12 rounded-xl border border-slate-200 bg-white/70 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-slate-800">멘토 후보</div>
                              {quickWrongAnswerCandidates.length ? (
                                <div className="text-[11px] text-slate-600">
                                  겹치는 일정 기준 상위 {quickWrongAnswerCandidates.length}명
                                </div>
                              ) : (
                                <div className="text-[11px] text-slate-500">겹치는 멘토가 없습니다.</div>
                              )}
                            </div>
                            {quickWrongAnswerCandidates.length ? (
                              <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-50 text-slate-600">
                                    <tr>
                                      <th className="px-2 py-1.5 text-left">멘토</th>
                                      <th className="px-2 py-1.5 text-left">일정 겹침</th>
                                      <th className="px-2 py-1.5 text-right">선택</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {quickWrongAnswerCandidates.map((candidate, candidateIndex) => (
                                      <tr
                                        key={`${candidate.mentor_name}-${candidateIndex}`}
                                        className={`border-t border-slate-200 ${wrongAnswerRoleRowTone(candidate.mentor_role)}`}
                                      >
                                        <td className="px-2 py-2 align-top">
                                          <div className="font-semibold text-slate-900">{candidate.mentor_name}</div>
                                          <div className="text-[11px] text-slate-600">{wrongAnswerRoleLabel(candidate.mentor_role)}</div>
                                        </td>
                                        <td className="px-2 py-2 align-top text-slate-700">
                                          {(candidate.overlaps || []).slice(0, 3).map((ov, ovIdx) => (
                                            <div key={`${candidate.mentor_name}-ov-${ovIdx}`}>
                                              {CALENDAR_DAY_LABELS[ov.day] || ov.day} {ov.student_time} ({ov.overlap_minutes}분)
                                            </div>
                                          ))}
                                        </td>
                                        <td className="px-2 py-2 align-top text-right">
                                          <button
                                            className={tone.assignButtonSoft}
                                            type="button"
                                            onClick={() => assignQuickWrongAnswerMentor(candidate, idx)}
                                            disabled={quickWrongAnswerSaving}
                                          >
                                            배정
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {Array.isArray(item.images) && item.images.length ? (
                          <div className="col-span-12">
                            <div className="text-xs text-slate-700">업로드된 문제 이미지 ({item.images.length}장)</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.images.map((img, imageIdx) => {
                                const src = resolveProblemImageUrl(img.url);
                                if (!src) return null;
                                return (
                                  <div
                                    key={img.id || `${img.url}-${imageIdx}`}
                                    className="relative rounded-md border border-slate-200 bg-white p-0.5"
                                  >
                                    <a href={src} target="_blank" rel="noreferrer">
                                      <img
                                        src={src}
                                        alt={img.filename || '문제 이미지'}
                                        className="h-16 w-16 rounded object-cover"
                                        loading="lazy"
                                      />
                                    </a>
                                    <button
                                      type="button"
                                      className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-200 bg-white text-[11px] font-semibold text-rose-600 shadow-sm hover:border-rose-300 hover:text-rose-700"
                                      onClick={() => void removeQuickWrongAnswerImage(idx, img, imageIdx)}
                                      disabled={quickWrongAnswerSaving}
                                      title="이미지 삭제"
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

              <button
                className="btn-ghost text-brand-800"
                type="button"
                onClick={addQuickWrongAnswerProblem}
                disabled={quickWrongAnswerSaving}
              >
                + 오답 기록 추가
              </button>
              {(Array.isArray(quickWrongAnswerDraft?.problems) ? quickWrongAnswerDraft.problems : []).length ? (
                <div className="text-xs text-slate-600">
                  업로드된 멘토 정보 기준 · 현재 멘토 수 {quickMentorInfo?.mentors?.length || 0}명
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="card p-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-800">질답 배정현황</div>
            <div className="text-sm text-slate-600">
              질문 단위 목록을 최신 등록순으로 확인합니다.
            </div>
            {mentorWindowMode && mentorFilterName ? (
              <div className="mt-1 text-xs text-brand-700">
                멘토 모아보기: <span className="font-semibold">{mentorFilterName}</span>
              </div>
            ) : null}
            {viewer?.display_name ? (
              <div className="mt-1 text-xs text-slate-500">
                현재 사용자: {viewer.display_name} ({ROLE_LABEL[viewer.role] || viewer.role})
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="input w-44"
              value={weekId}
              onChange={(e) => {
                const next = String(e.target.value || '');
                setWeekId(next);
                setQueryParams({ week: next });
                void loadStatus(next);
              }}
            >
              {weeksDesc.map((w) => (
                <option key={w.id} value={w.id}>
                  {fmtWeekLabel(w)}
                </option>
              ))}
            </select>
            <button className="btn-ghost" type="button" onClick={() => loadStatus(weekId)} disabled={busy || !weekId}>
              새로고침
            </button>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {weekLabel ? `기준 회차: ${weekLabel}` : '회차를 선택해 주세요.'}
        </div>
        {mentorWindowMode ? (
          <div className="mt-1 text-xs text-slate-500">
            새 창 모아보기 모드입니다. 이 창에서는 선택된 멘토 질문만 표시됩니다.
          </div>
        ) : null}
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
        {!mentorWindowMode && mentorOptions.length ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="text-sm font-semibold text-slate-800">멘토 별 질문 모아보기</div>
            <div className="mt-1 text-xs text-slate-600">
              멘토 이름을 누르면 해당 멘토에게 배정된 질문만 새 창에서 최신순으로 확인할 수 있습니다.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {mentorOptions.map((opt) => (
                <button
                  key={`mentor-window-${opt.mentor_name}`}
                  type="button"
                  className="btn-ghost h-8 px-2.5 text-xs"
                  onClick={() => openMentorQuestionWindow(opt.mentor_name)}
                >
                  {opt.mentor_name} ({ROLE_LABEL[opt.mentor_role] || opt.mentor_role})
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!mentorWindowMode && isDirector && mentorDaySummaryRows.length ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-800">멘토별 요일 배정 질문 수</div>
              <button
                className="btn-ghost h-8 px-2 text-xs"
                type="button"
                onClick={() => setDirectorSummaryCollapsed((prev) => !prev)}
              >
                {directorSummaryCollapsed ? '펼치기' : '최소화'}
              </button>
            </div>
            {!directorSummaryCollapsed ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-2 text-left border-b border-slate-200">멘토</th>
                      {summaryDayColumns.map((day) => (
                        <th key={`summary-day-head-${day}`} className="px-2 py-2 text-center border-b border-slate-200">
                          {day}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-center border-b border-slate-200">미지정</th>
                      <th className="px-2 py-2 text-center border-b border-slate-200">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mentorDaySummaryRows.map((row) => (
                      <tr key={`summary-row-${row.mentor_name}`} className="border-t border-slate-100">
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-900">{row.mentor_name}</div>
                          <div className="text-[11px] text-slate-500">{ROLE_LABEL[row.mentor_role] || row.mentor_role}</div>
                        </td>
                        {summaryDayColumns.map((day) => (
                          <td key={`summary-count-${row.mentor_name}-${day}`} className="px-2 py-2 text-center text-slate-800">
                            {Number(row?.counts?.[day] || 0)}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center text-slate-700">
                          {Number(row?.counts?.['-'] || 0)}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-semibold text-brand-800">
                            {Number(row?.total || 0)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-500">요약 표가 최소화되었습니다.</div>
            )}
          </div>
        ) : null}
        {!mentorWindowMode && canIssueBriefing ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="text-sm font-semibold text-slate-800">멘토 사전 전송 링크 (48시간)</div>
            <div className="mt-1 text-xs text-slate-600">
              멘토를 선택해 링크를 생성하고 이 화면에서 바로 문자 전송할 수 있습니다.
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_auto]">
              <select
                className="input h-9"
                value={briefingMentor}
                onChange={(e) => setBriefingMentor(String(e.target.value || ''))}
              >
                {mentorOptions.length ? (
                  mentorOptions.map((opt) => (
                    <option key={`briefing-mentor-${opt.mentor_name}`} value={opt.mentor_name}>
                      {opt.mentor_name} ({ROLE_LABEL[opt.mentor_role] || opt.mentor_role})
                    </option>
                  ))
                ) : (
                  <option value="">멘토 없음</option>
                )}
              </select>
              <input
                className="input h-9"
                value={briefingPhone}
                onChange={(e) => setBriefingPhone(e.target.value)}
                placeholder="수신 번호 (예: 01012345678)"
                maxLength={30}
              />
              <button
                type="button"
                className="btn-primary h-9 px-3 text-sm"
                disabled={briefingBusy || !weekId || !briefingMentor}
                onClick={() => void issueMentorBriefing()}
              >
                {briefingBusy ? '생성 중...' : '링크 생성'}
              </button>
            </div>
            {briefingError ? (
              <div className="mt-2 text-xs text-red-600">{briefingError}</div>
            ) : null}
            {briefingResult ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="text-xs text-slate-700">
                  대상 멘토: <span className="font-semibold">{briefingResult.mentor_name || '-'}</span>
                  {' · '}만료: {fmtDateTime(briefingResult.expires_at)}
                </div>
                <div className="mt-1 text-[11px] text-slate-600">
                  발신번호: {briefingResult.sender_phone || '01055132733'}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-emerald-800">
                    PIN: {briefingResult.pin_code || '------'}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost h-8 px-2.5 text-xs"
                    onClick={() => void copyBriefingLink()}
                  >
                    링크 복사
                  </button>
                  {briefingResult.share_url ? (
                    <a
                      className="btn-ghost h-8 px-2.5 text-xs"
                      href={String(briefingResult.share_url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      링크 열기
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary h-8 px-2.5 text-xs"
                    disabled={briefingSmsBusy || !briefingResult?.token_id || !String(briefingPhone || '').trim()}
                    onClick={() => void sendBriefingSms()}
                  >
                    {briefingSmsBusy ? '문자 전송 중...' : '문자 전송'}
                  </button>
                </div>
                {briefingCopyStatus ? (
                  <div className="mt-1 text-xs text-slate-600">{briefingCopyStatus}</div>
                ) : null}
                {briefingSmsStatus ? (
                  <div className="mt-1 text-xs text-emerald-700">{briefingSmsStatus}</div>
                ) : null}
                {briefingSmsError ? (
                  <div className="mt-1 text-xs text-rose-700">{briefingSmsError}</div>
                ) : null}
                {briefingResult.share_url ? (
                  <div className="mt-2 break-all rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                    {String(briefingResult.share_url)}
                  </div>
                ) : null}
                {briefingResult.qr_url ? (
                  <div className="mt-2">
                    <img
                      src={String(briefingResult.qr_url)}
                      alt="멘토 사전 전송 QR"
                      className="h-40 w-40 rounded-md border border-slate-200 bg-white p-1"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {busy ? (
        <div className="card p-5 text-sm text-slate-600">불러오는 중...</div>
      ) : grouped.length ? (
        grouped.map((mentorGroup, groupIndex) => (
          <div key={`${mentorGroup.mentor_name}-${groupIndex}`} className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-base font-semibold text-slate-900">{mentorGroup.mentor_name}</div>
                <div className="text-xs text-slate-500 mt-0.5">총 {mentorGroup.items.length}건</div>
              </div>
              <span
                className={[
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs',
                  mentorGroup.mentor_role === 'mentor'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : mentorGroup.mentor_role === 'lead'
                      ? 'border-sky-200 bg-sky-50 text-sky-800'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                ].join(' ')}
              >
                {ROLE_LABEL[mentorGroup.mentor_role] || mentorGroup.mentor_role}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {mentorGroup.items.map((item) => {
                const problems = Array.isArray(item.problem_items) ? item.problem_items : [];
                const rowKey = assignmentRowKey(item);
                const isEditing = canEditAssignment && editingKey === rowKey;
                const isDoneEditing = doneEditKey === rowKey;
                const isIncompleteEditing = incompleteEditKey === rowKey;
                const isStateSaving = stateSavingKey === rowKey;
                const status = normalizeCompletionStatus(item?.completion_status);
                const completionFeedback = String(item?.completion_feedback || '').trim();
                const isOverdue = isAssignmentOverdue(item, selectedWeek);
                const problemOrder = Math.max(
                  1,
                  Number(item.problem_order || (Number(item.problem_index || 0) + 1) || 1)
                );
                return (
                  <div
                    key={rowKey}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {item.external_id ? `${item.external_id} · ` : ''}
                          {item.student_name || '-'} · 오답 기록 {problemOrder}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">예정: {scheduleLabel(item)}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className={['inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]', completionStatusTone(status)].join(' ')}>
                          {completionStatusLabel(status)}
                        </span>
                        {isOverdue ? (
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                            배정일 지남
                          </span>
                        ) : null}
                        <div className="text-[11px] text-slate-500">배정일시: {fmtDateTime(item.assigned_at)}</div>
                        {canUpdateState ? (
                          <>
                            <button
                              type="button"
                              className={status === 'done' || isDoneEditing ? 'btn-primary h-8 px-2.5 text-xs' : 'btn-ghost h-8 px-2.5 text-xs'}
                              disabled={isStateSaving || savingKey === rowKey}
                              onClick={() => void markProblemDone(item)}
                            >
                              완료
                            </button>
                            <button
                              type="button"
                              className={status === 'incomplete' || isIncompleteEditing ? 'btn border border-amber-700 bg-amber-600 text-white h-8 px-2.5 text-xs hover:bg-amber-700' : 'btn-ghost h-8 px-2.5 text-xs'}
                              disabled={isStateSaving || savingKey === rowKey}
                              onClick={() => openIncompleteEditor(item)}
                            >
                              미완료
                            </button>
                          </>
                        ) : null}
                        {isDirector ? (
                          <button
                            type="button"
                            className="btn-ghost h-8 px-2.5 text-xs text-rose-700 border-rose-200 hover:border-rose-300 hover:text-rose-800"
                            disabled={isStateSaving || savingKey === rowKey}
                            onClick={() => void deleteProblemItem(item)}
                          >
                            삭제
                          </button>
                        ) : null}
                        {canEditAssignment ? (
                          isEditing ? (
                            <>
                              <button
                                type="button"
                                className="btn-primary h-8 px-2.5 text-xs"
                                disabled={savingKey === rowKey}
                                onClick={() => void saveEdit(item)}
                              >
                                {savingKey === rowKey ? '저장 중...' : '저장'}
                              </button>
                              <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={cancelEdit}>
                                취소
                              </button>
                            </>
                          ) : (
                            <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={() => beginEdit(item)}>
                              수정
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 md:grid-cols-6">
                        <div className="md:col-span-2">
                          <div className="text-[11px] text-slate-500">멘토 이름</div>
                          <input
                            className="input mt-1 h-8"
                            value={editForm.mentor_name}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, mentor_name: e.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-[11px] text-slate-500">일정 (날짜/시간)</div>
                          <input
                            className="input mt-1 h-8"
                            type="datetime-local"
                            value={editForm.session_datetime || ''}
                            onChange={(e) => {
                              const nextDateTime = String(e.target.value || '');
                              if (!nextDateTime) {
                                setEditForm((prev) => ({
                                  ...prev,
                                  session_datetime: '',
                                  session_month: '',
                                  session_day: '',
                                  session_start_time: '',
                                  session_day_label: ''
                                }));
                                return;
                              }
                              const parsed = parseDateTimeInput(nextDateTime);
                              if (!parsed) {
                                setEditForm((prev) => ({
                                  ...prev,
                                  session_datetime: nextDateTime
                                }));
                                return;
                              }
                              setEditForm((prev) => ({
                                ...prev,
                                session_datetime: nextDateTime,
                                session_month: String(parsed.month),
                                session_day: String(parsed.day),
                                session_day_label: parsed.dayLabel,
                                session_start_time: parsed.time
                              }));
                            }}
                          />
                          <div className="mt-1 text-[11px] text-slate-500">
                            자동 반영: {editForm.session_day_label || '-'}요일 ·{' '}
                            {editForm.session_month || '-'}월 {editForm.session_day || '-'}일 ·{' '}
                            {editForm.session_start_time || '--:--'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">요일 (수동)</div>
                          <div className="mt-1 space-y-1.5">
                            <select
                              className="input h-8 w-full"
                              value={editForm.session_day_label}
                              onChange={(e) => setEditForm((prev) => ({ ...prev, session_day_label: e.target.value }))}
                            >
                              <option value="">선택</option>
                              {DAY_OPTIONS.map((day) => (
                                <option key={`edit-day-${rowKey}-${day}`} value={day}>{day}</option>
                              ))}
                            </select>
                            <div className="flex justify-end">
                              <button
                                className="btn-ghost h-7 px-2 text-[11px]"
                                type="button"
                                onClick={() => setEditForm((prev) => ({ ...prev, session_day_label: '' }))}
                              >
                                미선택
                              </button>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">진행 시간(분)</div>
                          <input
                            className="input mt-1 h-8"
                            type="number"
                            min={5}
                            max={240}
                            step={5}
                            value={editForm.session_duration_minutes}
                            onChange={(e) => setEditForm((prev) => ({
                              ...prev,
                              session_duration_minutes: Math.max(5, Math.min(240, Number(e.target.value || 20) || 20))
                            }))}
                          />
                        </div>
                      </div>
                    ) : null}

                    {isDoneEditing ? (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-emerald-800">완료 피드백</div>
                        <div className="mt-1 text-[11px] text-emerald-900">
                          학생의 이해도 및 완료 사유에 대해 간략히 기록해주세요.
                        </div>
                        <textarea
                          rows={3}
                          className="textarea mt-2 min-h-[72px]"
                          value={completionFeedbackDraft}
                          onChange={(e) => setCompletionFeedbackDraft(e.target.value)}
                          placeholder="예: 핵심 개념은 이해했고, 같은 유형 1문제는 스스로 해결 가능하다고 확인했습니다."
                          disabled={isStateSaving}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn-primary h-8 px-2.5 text-xs"
                            disabled={isStateSaving}
                            onClick={() => void saveProblemDone(item)}
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-8 px-2.5 text-xs"
                            disabled={isStateSaving}
                            onClick={closeDoneEditor}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : status === 'done' && completionFeedback ? (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                        <div className="text-[11px] font-semibold text-emerald-800">완료 피드백</div>
                        <div className="mt-1 whitespace-pre-wrap text-xs text-emerald-900">
                          {completionFeedback}
                        </div>
                      </div>
                    ) : isIncompleteEditing ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2">
                        <div className="text-[11px] text-amber-800">미완료 사유</div>
                        <textarea
                          rows={2}
                          className="textarea mt-1 min-h-[56px]"
                          value={incompleteReasonDraft}
                          onChange={(e) => setIncompleteReasonDraft(e.target.value)}
                          placeholder="예: 학생 결석으로 미진행, 문제 풀이 미제출 등"
                          disabled={isStateSaving}
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn border border-amber-700 bg-amber-600 text-white h-8 px-2.5 text-xs hover:bg-amber-700"
                            disabled={isStateSaving}
                            onClick={() => void saveProblemIncomplete(item)}
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            className="btn-ghost h-8 px-2.5 text-xs"
                            disabled={isStateSaving}
                            onClick={closeIncompleteEditor}
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : status === 'incomplete' && String(item?.incomplete_reason || '').trim() ? (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2">
                        <div className="text-[11px] text-amber-800">미완료 사유</div>
                        <div className="mt-1 whitespace-pre-wrap text-xs text-amber-900">
                          {String(item.incomplete_reason || '').trim()}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                      <div className="text-[11px] font-medium text-slate-500">해결 예정 문제</div>
                      {problems.length ? (
                        <div className="mt-1 space-y-1">
                          {problems.map((problem, idx) => {
                            const images = (Array.isArray(problem?.images) ? problem.images : [])
                              .map(normalizeProblemImage)
                              .filter(Boolean);

                            return (
                              <div key={`${item.week_record_id}-${item.student_id}-problem-${idx}`} className="text-xs text-slate-700">
                                <div>{idx + 1}. {formatProblemLine(problem)}</div>
                                {String(problem?.note || '').trim() ? (
                                  <div className="mt-1 rounded-md border border-sky-100 bg-sky-50/70 px-2 py-1.5">
                                    <div className="text-[11px] font-medium text-sky-800">전달사항</div>
                                    <div className="mt-0.5 whitespace-pre-wrap text-[11px] text-sky-900">
                                      {String(problem.note || '').trim()}
                                    </div>
                                  </div>
                                ) : null}
                                {images.length ? (
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {images.map((img, imageIdx) => {
                                      const src = resolveProblemImageUrl(img.url);
                                      if (!src) return null;
                                      return (
                                        <a
                                          key={img.id || `${img.url}-${imageIdx}`}
                                          href={src}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="block rounded-md border border-slate-200 bg-white p-0.5"
                                          title={img.filename || '문제 이미지'}
                                        >
                                          <img
                                            src={src}
                                            alt={img.filename || `문제 ${idx + 1} 이미지`}
                                            className="h-16 w-16 rounded object-cover"
                                            loading="lazy"
                                          />
                                        </a>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-slate-500">과목/문제 정보가 아직 입력되지 않았습니다.</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <div className="card p-5 text-sm text-slate-600">해당 회차에 배정된 학생이 없습니다.</div>
      )}
      {quickWrongAnswerUploadModal.open ? (
        <WrongAnswerImageUploadModal
          loading={quickWrongAnswerUploadModal.loading}
          error={quickWrongAnswerUploadModal.error}
          uploadUrl={quickWrongAnswerUploadModal.uploadUrl}
          problemIndex={quickWrongAnswerUploadModal.problemIndex}
          onClose={closeQuickWrongAnswerUploadModal}
          onRefresh={refreshQuickWrongAnswerUploadedImages}
        />
      ) : null}
    </div>
  );
}

