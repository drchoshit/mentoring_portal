import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAY_COLUMNS = ['월', '화', '수', '목', '금', '토', '일', ''];
const TIMELINE_DAYS = DAY_COLUMNS.slice(0, 6);
const DAY_ORDER = new Map(DAY_COLUMNS.map((day, idx) => [day, idx]));
const TIMELINE_SLOT_MINUTES = 20;

function dayLabelText(day) {
  return day ? `${day}요일` : '미지정';
}

function fmtDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function normalizeDayLabel(value) {
  const raw = String(value || '').trim();
  if (DAY_COLUMNS.includes(raw)) return raw;
  const englishDays = {
    Mon: '월', Monday: '월', Tue: '화', Tuesday: '화', Wed: '수', Wednesday: '수',
    Thu: '목', Thursday: '목', Fri: '금', Friday: '금', Sat: '토', Saturday: '토',
    Sun: '일', Sunday: '일'
  };
  if (englishDays[raw]) return englishDays[raw];
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
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return '';
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toRoundLabel(label) {
  return String(label || '').replace(/주차/g, '회차');
}

function buildMissingKey(studentId, mentorName, dayLabel) {
  return `${Number(studentId || 0)}|${String(mentorName || '').trim()}|${String(dayLabel || '').trim()}`;
}

function dayTone(day) {
  if (!day) return 'border-slate-300/80 bg-gradient-to-br from-slate-50 to-slate-100/80';
  if (day === '월') return 'border-sky-300/70 bg-gradient-to-br from-sky-50 to-cyan-50';
  if (day === '화') return 'border-teal-300/70 bg-gradient-to-br from-teal-50 to-emerald-50';
  if (day === '수') return 'border-emerald-300/70 bg-gradient-to-br from-emerald-50 to-lime-50';
  if (day === '목') return 'border-amber-300/75 bg-gradient-to-br from-amber-50 to-yellow-50';
  if (day === '금') return 'border-rose-300/70 bg-gradient-to-br from-rose-50 to-pink-50';
  if (day === '토') return 'border-violet-300/75 bg-gradient-to-br from-violet-50 to-purple-50';
  return 'border-indigo-300/75 bg-gradient-to-br from-indigo-50 to-blue-50';
}

function dayHeaderTone(day) {
  if (!day) return 'bg-slate-100 text-slate-700';
  if (day === '월') return 'bg-sky-100/80 text-sky-900';
  if (day === '화') return 'bg-teal-100/80 text-teal-900';
  if (day === '수') return 'bg-emerald-100/80 text-emerald-900';
  if (day === '목') return 'bg-amber-100/80 text-amber-900';
  if (day === '금') return 'bg-rose-100/80 text-rose-900';
  if (day === '토') return 'bg-violet-100/80 text-violet-900';
  return 'bg-indigo-100/80 text-indigo-900';
}

function dayCellTone(day) {
  if (!day) return 'bg-slate-50/70';
  if (day === '월') return 'bg-sky-50/45';
  if (day === '화') return 'bg-teal-50/45';
  if (day === '수') return 'bg-emerald-50/45';
  if (day === '목') return 'bg-amber-50/45';
  if (day === '금') return 'bg-rose-50/45';
  if (day === '토') return 'bg-violet-50/45';
  return 'bg-indigo-50/45';
}

function normText(value) {
  return String(value || '').trim().toLowerCase();
}

function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToTime(value) {
  const safe = ((Number(value || 0) % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function parseTimeRanges(value) {
  return String(value || '')
    .replace(/[∼〜～]/g, '~')
    .replace(/[–—−]/g, '-')
    .split(/[,/|\n]+/)
    .map((part) => part.trim().replace(/\s+/g, ''))
    .map((part) => {
      const separator = part.includes('~') ? '~' : part.includes('-') ? '-' : '';
      if (!separator) return null;
      const [startText, endText] = part.split(separator);
      const start = timeToMinutes(startText);
      let end = timeToMinutes(endText);
      if (start == null || end == null) return null;
      if (end < start) end += 1440;
      return end > start ? { start, end } : null;
    })
    .filter(Boolean);
}

function normalizeScheduleByDay(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const result = Object.fromEntries(TIMELINE_DAYS.map((day) => [day, []]));
  for (const [rawDay, rawEntries] of Object.entries(raw)) {
    const day = normalizeDayLabel(rawDay);
    if (!TIMELINE_DAYS.includes(day)) continue;
    result[day] = (Array.isArray(rawEntries) ? rawEntries : [rawEntries]).map((entry) => {
      if (typeof entry === 'string') return { time: entry, title: '', type: '' };
      const start = String(entry?.start || entry?.start_time || '').trim();
      const end = String(entry?.end || entry?.end_time || '').trim();
      return {
        time: String(entry?.time || entry?.time_range || entry?.workTime || (start && end ? `${start}~${end}` : '')).trim(),
        title: String(entry?.title || entry?.description || '').trim(),
        type: String(entry?.type || entry?.kind || '').trim()
      };
    }).filter((entry) => parseTimeRanges(entry.time).length);
  }
  return result;
}

function isCenterSchedule(entry) {
  const text = `${entry?.type || ''} ${entry?.title || ''}`;
  return text.includes('센터') && !text.includes('미등원') && !text.includes('결석');
}

function isWorkingSchedule(entry) {
  const text = `${entry?.type || ''} ${entry?.title || ''}`;
  return !text.includes('미등원') && !text.includes('결석');
}

function rangesLabel(ranges) {
  return (ranges || []).map((range) => `${minutesToTime(range.start)}~${minutesToTime(range.end)}`).join(', ');
}

function buildTimelineSlots(entries) {
  const slots = [];
  for (const entry of entries || []) {
    for (const range of parseTimeRanges(entry?.time)) {
      for (let start = range.start; start + TIMELINE_SLOT_MINUTES <= range.end; start += TIMELINE_SLOT_MINUTES) {
        slots.push({ start, end: start + TIMELINE_SLOT_MINUTES, student: null });
      }
    }
  }
  const unique = new Map(slots.map((slot) => [`${slot.start}-${slot.end}`, slot]));
  return Array.from(unique.values()).sort((a, b) => a.start - b.start);
}

function buildMentoringTimeline(boardRows, mentorDetails, studentSchedules, missingMap) {
  const mentorScheduleMap = new Map(
    (mentorDetails || []).map((mentor) => [String(mentor?.name || '').trim(), normalizeScheduleByDay(mentor?.schedule)])
  );
  const result = Object.fromEntries(TIMELINE_DAYS.map((day) => [day, []]));

  for (const day of TIMELINE_DAYS) {
    for (const row of boardRows || []) {
      const mentorName = String(row?.mentor_name || '').trim();
      if (!mentorName) continue;
      const mentorDaySchedule = (mentorScheduleMap.get(mentorName)?.[day] || []).filter(isWorkingSchedule);
      const entries = row?.by_day?.[day] || [];
      if (!mentorDaySchedule.length && !entries.length) continue;

      const slots = buildTimelineSlots(mentorDaySchedule);
      const requests = entries.map((entry) => {
        const studentSchedule = normalizeScheduleByDay(studentSchedules?.[String(entry.student_id)] || {});
        const attendance = (studentSchedule[day] || [])
          .filter(isCenterSchedule)
          .flatMap((item) => parseTimeRanges(item.time));
        const eligible = [];
        slots.forEach((slot, index) => {
          const overlap = attendance.reduce(
            (max, range) => Math.max(max, Math.min(range.end, slot.end) - Math.max(range.start, slot.start)),
            0
          );
          if (overlap >= TIMELINE_SLOT_MINUTES) eligible.push(index);
        });
        const forcedTime = timeToMinutes(entry?.target_time);
        const fixedIndex = forcedTime == null
          ? -1
          : slots.findIndex((slot, index) => slot.start <= forcedTime && forcedTime < slot.end && eligible.includes(index));
        return {
          ...entry,
          attendance,
          attendance_label: rangesLabel(attendance),
          eligible,
          fixed_index: fixedIndex,
          missing: !entry.forced && missingMap.has(buildMissingKey(entry.student_id, mentorName, day))
        };
      });

      const used = new Set();
      const unassigned = [];
      const ordered = [...requests].sort((a, b) => {
        if (a.missing !== b.missing) return a.missing ? 1 : -1;
        if ((a.fixed_index >= 0) !== (b.fixed_index >= 0)) return a.fixed_index >= 0 ? -1 : 1;
        if (a.eligible.length !== b.eligible.length) return a.eligible.length - b.eligible.length;
        return String(a.student_name || '').localeCompare(String(b.student_name || ''), 'ko');
      });
      for (const request of ordered) {
        if (request.missing) {
          unassigned.push(`${request.student_name || request.external_id || '학생'} (누락)`);
          continue;
        }
        const candidates = request.fixed_index >= 0
          ? [request.fixed_index, ...request.eligible.filter((index) => index !== request.fixed_index)]
          : request.eligible;
        const picked = candidates.find((index) => !used.has(index));
        if (picked == null) {
          unassigned.push(request.student_name || request.external_id || '학생');
          continue;
        }
        used.add(picked);
        slots[picked].student = request;
      }

      result[day].push({
        mentor_name: mentorName,
        slots,
        unassigned,
        assigned_count: slots.filter((slot) => slot.student).length,
        request_count: requests.length
      });
    }
    result[day].sort((a, b) => a.mentor_name.localeCompare(b.mentor_name, 'ko'));
  }
  return result;
}

function createEmptyBoardRow(mentorName) {
  return {
    mentor_name: mentorName,
    by_day: Object.fromEntries(DAY_COLUMNS.map((day) => [day, []]))
  };
}

export default function LeadAssignmentBoard() {
  const { user } = useAuth();
  const canEdit = ['director', 'admin'].includes(String(user?.role || '').trim());
  const [sp, setSp] = useSearchParams();

  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(String(sp.get('week') || ''));
  const [leadMentorRoster, setLeadMentorRoster] = useState([]);
  const [leadMentorDetails, setLeadMentorDetails] = useState([]);
  const [studentSchedules, setStudentSchedules] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [missingMarks, setMissingMarks] = useState([]);
  const [forcedAssignments, setForcedAssignments] = useState([]);
  const [formByMissingId, setFormByMissingId] = useState({});
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');

  const [viewMode, setViewMode] = useState('cards');
  const [focusMentor, setFocusMentor] = useState('all');
  const [mentorFilter, setMentorFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');

  function setQueryParams(patch) {
    const cur = Object.fromEntries([...sp.entries()]);
    const next = { ...cur, ...patch };
    Object.keys(next).forEach((key) => {
      if (next[key] == null || next[key] === '') delete next[key];
    });
    setSp(next, { replace: true });
  }

  async function loadBoard(targetWeekId) {
    if (!targetWeekId) {
      setLeadMentorRoster([]);
      setLeadMentorDetails([]);
      setStudentSchedules({});
      setAssignments([]);
      setMissingMarks([]);
      setForcedAssignments([]);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const board = await api(`/api/mentor-assignments/lead-board?weekId=${encodeURIComponent(targetWeekId)}`);
      setLeadMentorRoster(
        Array.isArray(board?.lead_mentors)
          ? board.lead_mentors.map((name) => String(name || '').trim()).filter(Boolean)
          : []
      );
      setLeadMentorDetails(Array.isArray(board?.lead_mentor_details) ? board.lead_mentor_details : []);
      setStudentSchedules(board?.student_schedules && typeof board.student_schedules === 'object' ? board.student_schedules : {});
      setAssignments(Array.isArray(board?.assignments) ? board.assignments : []);
      setMissingMarks(Array.isArray(board?.missing_marks) ? board.missing_marks : []);
      setForcedAssignments(Array.isArray(board?.forced_assignments) ? board.forced_assignments : []);
    } catch (e) {
      setError(e?.message || '총괄멘토 배정표를 불러오지 못했습니다.');
      setLeadMentorRoster([]);
      setLeadMentorDetails([]);
      setStudentSchedules({});
      setAssignments([]);
      setMissingMarks([]);
      setForcedAssignments([]);
    } finally {
      setBusy(false);
    }
  }

  async function loadAll() {
    setError('');
    try {
      const weekResult = await api('/api/weeks');
      const weekList = Array.isArray(weekResult?.weeks) ? weekResult.weeks : [];
      setWeeks(weekList);
      const hasCurrent = weekId && weekList.some((item) => String(item.id) === String(weekId));
      const effectiveWeekId = hasCurrent
        ? String(weekId)
        : (weekList[weekList.length - 1]?.id ? String(weekList[weekList.length - 1].id) : '');
      if (effectiveWeekId !== String(weekId || '')) setWeekId(effectiveWeekId);
      if (effectiveWeekId) setQueryParams({ week: effectiveWeekId });
      await loadBoard(effectiveWeekId);
    } catch (e) {
      setError(e?.message || '회차 정보를 불러오지 못했습니다.');
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedWeekObj = useMemo(
    () => (weeks || []).find((item) => String(item.id) === String(weekId)),
    [weeks, weekId]
  );
  const weekOptions = useMemo(() => [...(weeks || [])].reverse(), [weeks]);
  const leadMentorOrder = useMemo(
    () => new Map((leadMentorRoster || []).map((name, idx) => [name, idx])),
    [leadMentorRoster]
  );
  const leadMentorSet = useMemo(() => new Set(leadMentorRoster || []), [leadMentorRoster]);

  const studentMap = useMemo(() => {
    const map = new Map();
    for (const row of assignments || []) {
      const studentId = Number(row?.student_id || 0);
      if (!studentId) continue;
      map.set(studentId, {
        external_id: String(row?.external_id || '').trim(),
        name: String(row?.name || '').trim()
      });
    }
    return map;
  }, [assignments]);

  const missingMap = useMemo(() => {
    const map = new Map();
    for (const item of missingMarks || []) {
      map.set(buildMissingKey(item.student_id, item.mentor_name, item.day_label), item);
    }
    return map;
  }, [missingMarks]);

  const forcedByMissingId = useMemo(() => {
    const map = new Map();
    for (const item of forcedAssignments || []) {
      const missingId = String(item?.missing_id || '').trim();
      if (missingId) map.set(missingId, item);
    }
    return map;
  }, [forcedAssignments]);

  const boardRows = useMemo(() => {
    const rows = new Map();
    const ensureRow = (mentorName) => {
      const name = String(mentorName || '').trim();
      if (!name) return null;
      if (!rows.has(name)) rows.set(name, createEmptyBoardRow(name));
      return rows.get(name);
    };
    for (const mentorName of leadMentorRoster || []) ensureRow(mentorName);

    const unassignedLeadName = '미배정 총괄멘토';
    const unknownLeadName = '미지정 총괄멘토';
    for (const row of assignments || []) {
      const rawLead = String(row?.lead_mentor || '').trim();
      const legacyMentor = String(row?.mentor || '').trim();
      let mentorName = rawLead || (leadMentorSet.size ? '' : legacyMentor);
      if (!mentorName) mentorName = leadMentorSet.size ? unassignedLeadName : unknownLeadName;
      if (leadMentorSet.size && !leadMentorSet.has(mentorName)) mentorName = unassignedLeadName;

      const target = ensureRow(mentorName);
      if (!target) continue;
      const days = Array.isArray(row?.scheduledDays) && row.scheduledDays.length
        ? row.scheduledDays.map((d) => normalizeDayLabel(d)).filter((d) => DAY_COLUMNS.includes(d))
        : [''];
      for (const day of days.length ? days : ['']) {
        target.by_day[day].push({
          student_id: Number(row?.student_id || 0),
          external_id: String(row?.external_id || '').trim(),
          student_name: String(row?.name || '').trim(),
          mentor_name: mentorName,
          day_label: day,
          forced: false
        });
      }
    }

    for (const item of forcedAssignments || []) {
      const mentorName = String(item?.target_mentor_name || '').trim() || (leadMentorSet.size ? unassignedLeadName : unknownLeadName);
      const target = ensureRow(mentorName);
      if (!target) continue;
      const day = normalizeDayLabel(item?.target_day_label) || '';
      const studentId = Number(item?.student_id || 0);
      const baseStudent = studentMap.get(studentId) || {};
      target.by_day[day].push({
        student_id: studentId,
        external_id: String(item?.external_id || baseStudent.external_id || '').trim(),
        student_name: String(item?.student_name || baseStudent.name || '').trim(),
        mentor_name: mentorName,
        day_label: day,
        forced: true,
        target_time: String(item?.target_time || '').trim()
      });
    }

    return Array.from(rows.values())
      .map((row) => ({
        ...row,
        by_day: Object.fromEntries(
          DAY_COLUMNS.map((day) => [
            day,
            [...(row.by_day?.[day] || [])].sort((a, b) =>
              `${a.external_id || ''}${a.student_name || ''}`.localeCompare(`${b.external_id || ''}${b.student_name || ''}`)
            )
          ])
        )
      }))
      .sort((a, b) => {
        const aOrder = leadMentorOrder.has(a.mentor_name) ? Number(leadMentorOrder.get(a.mentor_name)) : Number.MAX_SAFE_INTEGER;
        const bOrder = leadMentorOrder.has(b.mentor_name) ? Number(leadMentorOrder.get(b.mentor_name)) : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        if (a.mentor_name === unassignedLeadName && b.mentor_name !== unassignedLeadName) return -1;
        if (b.mentor_name === unassignedLeadName && a.mentor_name !== unassignedLeadName) return 1;
        return String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''));
      });
  }, [leadMentorRoster, leadMentorSet, leadMentorOrder, assignments, forcedAssignments, studentMap]);

  const mentorNames = useMemo(() => {
    const set = new Set();
    for (const name of leadMentorRoster || []) {
      const value = String(name || '').trim();
      if (value) set.add(value);
    }
    for (const row of boardRows || []) {
      const value = String(row?.mentor_name || '').trim();
      if (value) set.add(value);
    }
    for (const item of forcedAssignments || []) {
      const value = String(item?.target_mentor_name || '').trim();
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => {
      const aOrder = leadMentorOrder.has(a) ? Number(leadMentorOrder.get(a)) : Number.MAX_SAFE_INTEGER;
      const bOrder = leadMentorOrder.has(b) ? Number(leadMentorOrder.get(b)) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a === '미배정 총괄멘토' && b !== '미배정 총괄멘토') return -1;
      if (b === '미배정 총괄멘토' && a !== '미배정 총괄멘토') return 1;
      return a.localeCompare(b);
    });
  }, [leadMentorRoster, boardRows, forcedAssignments, leadMentorOrder]);

  const mentorStats = useMemo(() => {
    const map = new Map();
    for (const row of boardRows) {
      let total = 0;
      let missing = 0;
      let forced = 0;
      const studentSet = new Set();
      for (const day of DAY_COLUMNS) {
        const entries = row.by_day?.[day] || [];
        total += entries.length;
        for (const entry of entries) {
          studentSet.add(`${entry.student_id || ''}|${entry.external_id || ''}|${entry.student_name || ''}`);
          if (entry.forced) forced += 1;
          else if (missingMap.has(buildMissingKey(entry.student_id, row.mentor_name, day))) missing += 1;
        }
      }
      map.set(row.mentor_name, { total, missing, forced, student_count: studentSet.size });
    }
    return map;
  }, [boardRows, missingMap]);

  const timelineByDay = useMemo(
    () => buildMentoringTimeline(boardRows, leadMentorDetails, studentSchedules, missingMap),
    [boardRows, leadMentorDetails, studentSchedules, missingMap]
  );

  const filteredRows = useMemo(() => {
    const mentorQ = normText(mentorFilter);
    const studentQ = normText(studentFilter);
    return boardRows.filter((row) => {
      if (mentorQ && !normText(row.mentor_name).includes(mentorQ)) return false;
      if (!studentQ) return true;
      const entries = DAY_COLUMNS.flatMap((day) => row.by_day?.[day] || []);
      return entries.some((entry) => normText(`${entry.external_id || ''} ${entry.student_name || ''}`).includes(studentQ));
    });
  }, [boardRows, mentorFilter, studentFilter]);

  const focusOptions = useMemo(() => filteredRows.map((row) => row.mentor_name), [filteredRows]);
  useEffect(() => {
    if (focusMentor !== 'all' && !focusOptions.includes(focusMentor)) setFocusMentor('all');
  }, [focusMentor, focusOptions]);

  const visibleRows = useMemo(() => {
    if (focusMentor === 'all') return filteredRows;
    return filteredRows.filter((row) => row.mentor_name === focusMentor);
  }, [filteredRows, focusMentor]);

  const dayTotals = useMemo(() => {
    const totals = Object.fromEntries(DAY_COLUMNS.map((day) => [day, 0]));
    for (const row of visibleRows) {
      for (const day of DAY_COLUMNS) totals[day] += (row.by_day?.[day] || []).length;
    }
    return totals;
  }, [visibleRows]);

  const sortedMissingMarks = useMemo(() => {
    return [...(missingMarks || [])].sort((a, b) => {
      const mentorCmp = String(a?.mentor_name || '').localeCompare(String(b?.mentor_name || ''));
      if (mentorCmp !== 0) return mentorCmp;
      const dayCmp = (DAY_ORDER.get(String(a?.day_label || '').trim()) ?? 99) - (DAY_ORDER.get(String(b?.day_label || '').trim()) ?? 99);
      if (dayCmp !== 0) return dayCmp;
      const aName = String(a?.student_name || studentMap.get(Number(a?.student_id || 0))?.name || '');
      const bName = String(b?.student_name || studentMap.get(Number(b?.student_id || 0))?.name || '');
      return aName.localeCompare(bName);
    });
  }, [missingMarks, studentMap]);

  async function toggleMissing(entry) {
    if (!canEdit || !weekId || !entry || entry.forced) return;
    const key = `missing-${entry.student_id}-${entry.mentor_name}-${entry.day_label}`;
    setSavingKey(key);
    setError('');
    try {
      await api('/api/mentor-assignments/lead-board/missing/toggle', {
        method: 'POST',
        body: {
          week_id: Number(weekId),
          student_id: Number(entry.student_id || 0),
          mentor_name: String(entry.mentor_name || '').trim(),
          day_label: String(entry.day_label || '').trim()
        }
      });
      await loadBoard(weekId);
    } catch (e) {
      setError(e?.message || '누락 처리에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  async function applyForceAssignment(missing) {
    if (!canEdit || !weekId || !missing?.id) return;
    const draft = formByMissingId[missing.id] || {};
    const targetMentorName = String(draft.target_mentor_name || '').trim();
    if (!targetMentorName) {
      setError('강제 배정할 총괄멘토를 선택해 주세요.');
      return;
    }
    const key = `force-${missing.id}`;
    setSavingKey(key);
    setError('');
    try {
      await api('/api/mentor-assignments/lead-board/force-assign', {
        method: 'POST',
        body: {
          week_id: Number(weekId),
          missing_id: String(missing.id),
          target_mentor_name: targetMentorName,
          target_day_label: normalizeDayLabel(draft.target_day_label),
          target_time: normalizeTimeText(draft.target_time)
        }
      });
      await loadBoard(weekId);
    } catch (e) {
      setError(e?.message || '강제 배정에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  async function removeForceAssignment(missing) {
    if (!canEdit || !weekId || !missing?.id) return;
    const key = `force-remove-${missing.id}`;
    setSavingKey(key);
    setError('');
    try {
      await api('/api/mentor-assignments/lead-board/force-assign/remove', {
        method: 'POST',
        body: {
          week_id: Number(weekId),
          missing_id: String(missing.id)
        }
      });
      await loadBoard(weekId);
    } catch (e) {
      setError(e?.message || '강제 배정 해제에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  function clearForceDraft(missingId) {
    setFormByMissingId((prev) => {
      const next = { ...prev };
      delete next[missingId];
      return next;
    });
  }

  async function cancelMissingMark(missing) {
    if (!canEdit || !weekId || !missing?.id) return;
    const studentId = Number(missing.student_id || 0);
    const mentorName = String(missing.mentor_name || '').trim();
    const dayLabel = String(missing.day_label || '').trim();
    if (!studentId || !mentorName) return;

    const key = `missing-cancel-${missing.id}`;
    setSavingKey(key);
    setError('');
    try {
      await api('/api/mentor-assignments/lead-board/missing/toggle', {
        method: 'POST',
        body: {
          week_id: Number(weekId),
          student_id: studentId,
          mentor_name: mentorName,
          day_label: dayLabel
        }
      });
      clearForceDraft(missing.id);
      await loadBoard(weekId);
    } catch (e) {
      setError(e?.message || '누락 취소에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  function renderStudentChip(row, day, entry, idx, compact = false) {
    const missingKey = buildMissingKey(entry.student_id, row.mentor_name, day);
    const isMissing = missingMap.has(missingKey);
    const rowSavingKey = `missing-${entry.student_id}-${row.mentor_name}-${day}`;
    const label = [entry.external_id, entry.student_name].filter(Boolean).join(' ') || `학생ID ${entry.student_id}`;
    return (
      <button
        key={`${row.mentor_name}-${day || 'none'}-${entry.student_id}-${idx}`}
        type="button"
        className={[
          'inline-flex items-center gap-1 rounded-full border transition',
          compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs',
          entry.forced
            ? 'border-violet-300 bg-violet-50 text-violet-800'
            : isMissing
              ? 'border-rose-300 bg-rose-50 text-rose-800'
              : 'border-slate-200 bg-white text-slate-700'
        ].join(' ')}
        disabled={!canEdit || entry.forced || Boolean(savingKey)}
        onClick={() => void toggleMissing(entry)}
        title={entry.forced ? '강제 배정 항목' : '클릭하여 누락 토글'}
      >
        <span>{label}</span>
        {entry.forced ? <span className="font-semibold">강제</span> : null}
        {!entry.forced && isMissing ? <span className="font-semibold">누락</span> : null}
        {!entry.forced && savingKey === rowSavingKey ? <span>...</span> : null}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold text-brand-800">총괄멘토 요일별 배정표</div>
            <div className="text-sm text-slate-600">총괄멘토별 학생 확인 후, 요일 보드에서 누락/강제 배정을 처리합니다.</div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="input select-input w-44"
              value={weekId}
              onChange={(e) => {
                const next = String(e.target.value || '');
                setWeekId(next);
                setQueryParams({ week: next });
                void loadBoard(next);
              }}
            >
              {weekOptions.map((week) => (
                <option key={`lead-board-week-${week.id}`} value={week.id}>{toRoundLabel(week.label)}</option>
              ))}
            </select>
            <button className="btn-refresh min-w-[88px] shrink-0" type="button" onClick={loadAll} disabled={busy}>새로고침</button>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {selectedWeekObj ? `기준 회차: ${toRoundLabel(selectedWeekObj.label)}` : '회차를 선택해 주세요.'}
        </div>
        {error ? <div className="mt-2 text-sm text-rose-600">{error}</div> : null}
      </div>

      <div className="card border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/70 to-emerald-50/35 p-5 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.55)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-brand-900">보드 보기 옵션</div>
            <div className="mt-1 text-xs text-slate-600">필터, 보기 전환, 포커스 기능으로 총괄멘토 배정을 빠르게 탐색합니다.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={[
                'inline-flex h-9 items-center justify-center rounded-full border px-4 text-xs font-semibold transition',
                viewMode === 'cards'
                  ? 'border-brand-800 bg-brand-800 text-white shadow-sm'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              ].join(' ')}
              onClick={() => setViewMode('cards')}
            >
              카드 보기
            </button>
            <button
              type="button"
              className={[
                'inline-flex h-9 items-center justify-center rounded-full border px-4 text-xs font-semibold transition',
                viewMode === 'table'
                  ? 'border-brand-800 bg-brand-800 text-white shadow-sm'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              ].join(' ')}
              onClick={() => setViewMode('table')}
            >
              표 보기
            </button>
            <select className="input select-input h-10 w-56 rounded-full border-slate-300 bg-white/95" value={focusMentor} onChange={(e) => setFocusMentor(String(e.target.value || 'all'))}>
              <option value="all">전체 총괄멘토</option>
              {focusOptions.map((mentorName) => (
                <option key={`focus-mentor-${mentorName}`} value={mentorName}>{mentorName}</option>
              ))}
            </select>
            <input className="input h-10 w-44 rounded-full border-slate-300 bg-white/95" value={mentorFilter} onChange={(e) => setMentorFilter(e.target.value)} placeholder="총괄멘토명 검색" />
            <input className="input h-10 w-56 rounded-full border-slate-300 bg-white/95" value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} placeholder="학생명/ID 검색" />
          </div>
        </div>
      </div>

      <section className="card overflow-hidden border border-blue-100 bg-gradient-to-br from-white via-blue-50/30 to-emerald-50/35 shadow-[0_22px_55px_-38px_rgba(37,99,235,0.5)]">
        <div className="border-b border-blue-100/80 bg-white/85 px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Mentoring timeline</div>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">요일별 멘토링 진행 현황표 <span className="text-base font-bold text-slate-500">(시간대 기준)</span></h2>
              <p className="mt-1 text-sm text-slate-600">메디위클리와 같은 20분 단위로 총괄멘토 출근 시간과 학생 센터 재원 시간을 맞춰 표시합니다.</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">배정 학생</span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-500">빈 슬롯</span>
              <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700">미배정</span>
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          {TIMELINE_DAYS.map((day) => {
            const mentors = timelineByDay[day] || [];
            const assignedTotal = mentors.reduce((sum, mentor) => sum + mentor.assigned_count, 0);
            const requestTotal = mentors.reduce((sum, mentor) => sum + mentor.request_count, 0);
            return (
              <article key={`timeline-${day}`} className={['overflow-hidden rounded-2xl border shadow-sm', dayTone(day)].join(' ')}>
                <div className="flex items-center justify-between border-b border-white/80 bg-white/70 px-4 py-3 backdrop-blur-sm">
                  <h3 className="text-base font-black text-slate-900">{day}요일</h3>
                  <span className="rounded-full border border-white bg-white/90 px-2.5 py-1 text-[11px] font-bold text-slate-600">{assignedTotal}/{requestTotal}명</span>
                </div>
                <div className="space-y-3 p-3.5">
                  {!mentors.length ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white/65 px-3 py-7 text-center text-sm text-slate-500">배정 없음</div>
                  ) : mentors.map((mentor) => (
                    <div key={`${day}-${mentor.mentor_name}`} className="rounded-xl border border-white/90 bg-white/90 p-3 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.65)]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-black text-slate-900">{mentor.mentor_name}</div>
                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">{mentor.assigned_count}/{mentor.request_count}명</span>
                      </div>
                      {mentor.slots.length ? (
                        <div className="mt-2 grid gap-1.5">
                          {mentor.slots.map((slot, slotIndex) => (
                            <div
                              key={`${day}-${mentor.mentor_name}-${slot.start}-${slotIndex}`}
                              className={[
                                'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2.5 py-2 text-xs',
                                slot.student ? 'border-blue-100 bg-blue-50/80 text-slate-800' : 'border-slate-100 bg-slate-50/80 text-slate-400'
                              ].join(' ')}
                            >
                              <span className={slot.student ? 'font-bold text-blue-700' : 'font-semibold'}>{minutesToTime(slot.start)}~{minutesToTime(slot.end)}</span>
                              <span>
                                {slot.student ? (
                                  <><b className="text-slate-900">{slot.student.student_name || slot.student.external_id || '학생'}</b>{slot.student.attendance_label ? <span className="ml-1 text-[11px] text-slate-500">({slot.student.attendance_label})</span> : null}</>
                                ) : '빈 슬롯'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">멘토 출근 시간이 등록되지 않아 시간 슬롯을 만들 수 없습니다.</div>
                      )}
                      {mentor.unassigned.length ? (
                        <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">미배정: {mentor.unassigned.join(', ')}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="card p-5">
        <div className="text-sm font-semibold text-brand-900">누락 학생 및 강제 배정</div>
        <div className="mt-1 text-xs text-slate-600">누락: 해당 요일에 총괄멘토가 멘토링을 진행하지 못한 상태</div>
        {!sortedMissingMarks.length ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-sm text-slate-600">누락으로 표시된 학생이 없습니다.</div>
        ) : (
          <div className="mt-3 space-y-3">
            {sortedMissingMarks.map((missing) => {
              const missingStudent = studentMap.get(Number(missing.student_id || 0)) || {};
              const forced = forcedByMissingId.get(String(missing.id || '').trim()) || null;
              const studentLabel = [missing.external_id || missingStudent.external_id || '', missing.student_name || missingStudent.name || ''].filter(Boolean).join(' ');
              const form = formByMissingId[missing.id] || {
                target_mentor_name: forced?.target_mentor_name || '',
                target_day_label: forced?.target_day_label || '',
                target_time: forced?.target_time || ''
              };
              return (
                <div key={`missing-row-${missing.id}`} className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
                  <div className="text-sm font-medium text-slate-900">{studentLabel || `학생ID ${missing.student_id}`}</div>
                  <div className="mt-1 text-xs text-slate-700">
                    누락 위치: {missing.mentor_name} · {dayLabelText(missing.day_label)} · 표시시각 {fmtDateTime(missing.marked_at)}
                  </div>
                  {forced ? (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-2 text-xs text-emerald-900">
                      강제 배정됨: {forced.target_mentor_name} · {dayLabelText(forced.target_day_label)} · {forced.target_time || '시간 미지정'}
                    </div>
                  ) : null}
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_140px_140px_auto]">
                    <select
                      className="input select-input"
                      value={form.target_mentor_name}
                      onChange={(e) => setFormByMissingId((prev) => ({ ...prev, [missing.id]: { ...form, target_mentor_name: e.target.value } }))}
                      disabled={!canEdit}
                    >
                      <option value="">총괄멘토 선택</option>
                      {mentorNames.map((name) => (
                        <option key={`force-mentor-${missing.id}-${name}`} value={name}>{name}</option>
                      ))}
                    </select>
                    <select
                      className="input select-input"
                      value={form.target_day_label}
                      onChange={(e) => setFormByMissingId((prev) => ({ ...prev, [missing.id]: { ...form, target_day_label: e.target.value } }))}
                      disabled={!canEdit}
                    >
                      <option value="">요일 미지정</option>
                      {DAY_COLUMNS.filter(Boolean).map((day) => (
                        <option key={`force-day-${missing.id}-${day}`} value={day}>{day}요일</option>
                      ))}
                    </select>
                    <input
                      className="input h-9"
                      value={form.target_time}
                      onChange={(e) => setFormByMissingId((prev) => ({ ...prev, [missing.id]: { ...form, target_time: e.target.value } }))}
                      placeholder="시간 미지정"
                      disabled={!canEdit}
                    />
                    <div className="flex items-center gap-2">
                      <button className="btn-primary h-9 px-3 text-xs" type="button" disabled={!canEdit || Boolean(savingKey)} onClick={() => void applyForceAssignment(missing)}>강제 배정</button>
                      <button className="btn-ghost h-9 px-3 text-xs" type="button" disabled={!canEdit || Boolean(savingKey)} onClick={() => void cancelMissingMark(missing)}>취소</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/65 to-slate-100/55 p-5 shadow-[0_20px_48px_-36px_rgba(15,23,42,0.6)]">
        <div className="text-sm font-semibold text-brand-900">총괄멘토 요일별 배정</div>
        <div className="mt-1 text-xs text-slate-600">학생 칩 클릭: 누락 토글 · 강제 배정 학생은 보라색 칩으로 강조</div>

        {busy ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">불러오는 중...</div>
        ) : !visibleRows.length ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">조건에 맞는 배정 데이터가 없습니다.</div>
        ) : viewMode === 'cards' ? (
          <div className="mt-4 space-y-5">
            {visibleRows.map((row) => {
              const stats = mentorStats.get(row.mentor_name) || { total: 0, missing: 0, forced: 0, student_count: 0 };
              return (
                <div
                  key={`board-card-${row.mentor_name}`}
                  className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white/95 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.65)]"
                >
                  <div className="border-b border-slate-100 bg-gradient-to-r from-white via-slate-50 to-emerald-50/55 px-4 py-3.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-base font-semibold tracking-tight text-slate-900">{row.mentor_name}</div>
                        <div className="text-xs text-slate-500">학생 {stats.student_count}명 · 배정 {stats.total}건</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {stats.missing ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-medium text-rose-700">누락 {stats.missing}</span>
                        ) : null}
                        {stats.forced ? (
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 font-medium text-violet-700">강제 {stats.forced}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                    {DAY_COLUMNS.map((day) => {
                      const entries = row.by_day?.[day] || [];
                      return (
                        <div
                          key={`board-card-day-${row.mentor_name}-${day || 'none'}`}
                          className={['relative overflow-hidden rounded-2xl border p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]', dayTone(day)].join(' ')}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold tracking-wide text-slate-700">{dayLabelText(day)}</div>
                            <span className="rounded-full border border-white/80 bg-white/75 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{entries.length}건</span>
                          </div>
                          {entries.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {entries.map((entry, idx) => renderStudentChip(row, day, entry, idx, true))}
                            </div>
                          ) : (
                            <div className="mt-2 text-[11px] text-slate-500">배정 없음</div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200/90 bg-white shadow-[0_16px_36px_-34px_rgba(15,23,42,0.5)]">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-100/80 text-slate-700 backdrop-blur">
                <tr>
                  <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-100/95 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">총괄멘토</th>
                  {DAY_COLUMNS.map((day) => (
                    <th key={`board-head-${day || 'none'}`} className={['border-b border-slate-200 px-3 py-3 text-left', dayHeaderTone(day)].join(' ')}>
                      <div className="text-xs font-semibold tracking-wide">{dayLabelText(day)}</div>
                      <div className="text-[11px] opacity-80">총 {dayTotals[day] || 0}건</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIdx) => (
                  <tr key={`board-row-${row.mentor_name}`} className={['transition-colors hover:bg-slate-50/70', rowIdx % 2 ? 'bg-white' : 'bg-slate-50/40'].join(' ')}>
                    <td className="sticky left-0 z-[1] border-t border-slate-100 bg-white px-4 py-3 align-top font-medium text-slate-900">{row.mentor_name}</td>
                    {DAY_COLUMNS.map((day) => {
                      const entries = row.by_day?.[day] || [];
                      return (
                        <td key={`board-cell-${row.mentor_name}-${day || 'none'}`} className={['border-t border-slate-100 px-3 py-2 align-top', dayCellTone(day)].join(' ')}>
                          {entries.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {entries.map((entry, idx) => renderStudentChip(row, day, entry, idx))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">배정 없음</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
