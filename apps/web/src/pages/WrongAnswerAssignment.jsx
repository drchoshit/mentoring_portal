import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE, api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAYS = [
  ['Mon', '월'], ['Tue', '화'], ['Wed', '수'], ['Thu', '목'],
  ['Fri', '금'], ['Sat', '토'], ['Sun', '일']
];

const EMPTY_PROBLEM = {
  subject: '', material: '', problem_name: '', problem_type: '', note: '', images: [], assignment: null
};

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

function parseTime(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseRange(value) {
  const match = String(value || '').replace(/\s+/g, '').match(/(\d{1,2}:\d{2})[-~](\d{1,2}:\d{2})/);
  if (!match) return null;
  const start = parseTime(match[1]);
  const end = parseTime(match[2]);
  return start != null && end != null && end > start ? { start, end } : null;
}

function formatMinutes(value) {
  const minutes = Math.max(0, Number(value || 0));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function overlapRange(a, b) {
  if (!a || !b) return null;
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end, minutes: end - start } : null;
}

function normalizeDay(value) {
  const raw = String(value || '').trim();
  const aliases = {
    Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun',
    월: 'Mon', 화: 'Tue', 수: 'Wed', 목: 'Thu', 금: 'Fri', 토: 'Sat', 일: 'Sun',
    월요일: 'Mon', 화요일: 'Tue', 수요일: 'Wed', 목요일: 'Thu', 금요일: 'Fri', 토요일: 'Sat', 일요일: 'Sun'
  };
  return aliases[raw] || aliases[raw.slice(0, 3)] || '';
}

function normalizeSchedule(value) {
  const raw = safeJson(value, {});
  const out = Object.fromEntries(DAYS.map(([day]) => [day, []]));
  for (const [key, entries] of Object.entries(raw || {})) {
    const day = normalizeDay(key);
    if (!day) continue;
    out[day] = (Array.isArray(entries) ? entries : [entries]).map((entry) => {
      if (typeof entry === 'string') return { time: entry, title: '', type: '' };
      const start = String(entry?.start || entry?.start_time || '').trim();
      const end = String(entry?.end || entry?.end_time || '').trim();
      return {
        time: String(entry?.time || entry?.time_range || (start && end ? `${start}~${end}` : '')).trim(),
        title: String(entry?.title || entry?.description || '').trim(),
        type: String(entry?.type || entry?.kind || '').trim()
      };
    }).filter((entry) => parseRange(entry.time));
  }
  return out;
}

function isStudentCenterSlot(slot) {
  const text = `${slot?.type || ''} ${slot?.title || ''}`;
  return text.includes('센터') && !text.includes('미등원') && !text.includes('결석');
}

function isMentorWorkSlot(slot) {
  const text = `${slot?.type || ''} ${slot?.title || ''}`;
  return !text.includes('미등원') && !text.includes('결석');
}

function dedupeSlotsByRange(slots) {
  const unique = new Map();
  for (const slot of slots || []) {
    const range = parseRange(slot?.time);
    if (!range) continue;
    const key = `${range.start}-${range.end}`;
    if (!unique.has(key)) unique.set(key, slot);
  }
  return Array.from(unique.values());
}

function weekDateMap(week) {
  const result = {};
  const match = String(week?.start_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return result;
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  DAYS.forEach(([day], index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    result[day] = {
      year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, date: date.getUTCDate(),
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
    };
  });
  return result;
}

function toRoundLabel(week) {
  const label = String(week?.label || '').replace(/주차/g, '회차');
  const dates = weekDateMap(week);
  return dates.Mon && dates.Sun ? `${label} (${dates.Mon.label} ~ ${dates.Sun.label})` : label;
}

function resolveImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(https?:|data:|blob:)/i.test(raw)) return raw;
  return `${String(API_BASE || '').replace(/\/+$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function normalizeDistribution(value) {
  const raw = safeJson(value, {});
  return {
    ...raw,
    problems: Array.isArray(raw?.problems) ? raw.problems : [],
    assignment: raw?.assignment || null,
    searched_at: String(raw?.searched_at || '').trim()
  };
}

function firstAvailableProblemIndex(problems) {
  const list = Array.isArray(problems) ? problems : [];
  const emptyIndex = list.findIndex((problem) => {
    if (!problem || typeof problem !== 'object') return true;
    if (problem.assignment || String(problem.submitted_at || '').trim()) return false;
    if (Array.isArray(problem.images) && problem.images.length) return false;
    return !['subject', 'material', 'problem_name', 'problem_type', 'note']
      .some((key) => String(problem?.[key] || '').trim());
  });
  return emptyIndex >= 0 ? emptyIndex : list.length;
}

function buildMentorCards(mentorInfo, studentSchedule, week) {
  const dateMap = weekDateMap(week);
  const student = normalizeSchedule(studentSchedule);
  const mentors = Array.isArray(mentorInfo?.mentors) ? mentorInfo.mentors : [];
  return mentors
    .filter((mentor) => String(mentor?.role || 'mentor') === 'mentor')
    .map((mentor) => {
      const schedule = normalizeSchedule(mentor?.schedule);
      const work = [];
      const overlaps = [];
      for (const [day, dayLabel] of DAYS) {
        const mentorSlots = dedupeSlotsByRange((schedule[day] || []).filter(isMentorWorkSlot));
        const studentSlots = dedupeSlotsByRange((student[day] || []).filter(isStudentCenterSlot));
        for (const mentorSlot of mentorSlots) {
          work.push({ day, dayLabel, date: dateMap[day], time: mentorSlot.time });
          for (const studentSlot of studentSlots) {
            const range = overlapRange(parseRange(mentorSlot.time), parseRange(studentSlot.time));
            if (range) {
              overlaps.push({
                day, dayLabel, date: dateMap[day], mentorTime: mentorSlot.time,
                studentTime: studentSlot.time, ...range
              });
            }
          }
        }
      }
      overlaps.sort((a, b) => b.minutes - a.minutes);
      const total = overlaps.reduce((sum, item) => sum + item.minutes, 0);
      return {
        id: String(mentor?.mentor_id || mentor?.id || mentor?.name || '').trim(),
        name: String(mentor?.name || mentor?.display_name || mentor?.mentor_id || '').trim(),
        note: String(mentor?.note || '').trim(),
        role: 'mentor', subjects: Array.isArray(mentor?.subjects) ? mentor.subjects : [],
        work, overlaps, total
      };
    })
    .filter((mentor) => mentor.name)
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'ko'));
}

function compatibilityTone(mentor) {
  if (mentor.total >= 60) return { label: '센터 시간과 잘 맞음', cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' };
  if (mentor.total > 0) return { label: '센터 시간과 일부 겹침', cls: 'border-amber-300 bg-amber-50 text-amber-800' };
  return { label: '겹치는 센터 시간 없음', cls: 'border-rose-200 bg-rose-50 text-rose-700' };
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
      const parsed = new URL(raw, window.location.origin);
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
      const parsed = new URL(raw, window.location.origin);
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
      await navigator.clipboard.writeText(uploadUrl);
      window.alert('링크를 복사했습니다.');
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

    const formData = new FormData();
    formData.append('token', token);
    for (const file of files) formData.append('images', file, String(file?.name || 'upload.jpg'));

    setPcUploading(true);
    try {
      const response = await fetch(resolveUploadSubmitUrl(uploadUrl), { method: 'POST', body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
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
            <div className="text-xs text-slate-600">질답 기록 {Number(problemIndex) + 1}에 이미지가 저장됩니다.</div>
          </div>
          <button className="btn-ghost" type="button" onClick={onClose}>닫기</button>
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
                1) 휴대폰으로 QR을 스캔합니다.<br />
                2) 열린 페이지에서 새 촬영/앨범 선택 후 여러 장 전송합니다.<br />
                3) 업로드 뒤 이 화면에서 새로고침을 누르면 목록에 반영됩니다.
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 break-all">{uploadUrl}</div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" type="button" onClick={copyUploadUrl}>링크 복사</button>
                <button className="btn-primary" type="button" disabled={refreshing} onClick={() => void refreshUploadedImages()}>
                  {refreshing ? '반영 중...' : '업로드 반영 새로고침'}
                </button>
                <button className="btn-ghost" type="button" disabled={refreshing || pcUploading} onClick={() => fileInputRef.current?.click()}>
                  {pcUploading ? 'PC 업로드 중...' : 'PC에서 이미지 갖고 오기'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void uploadPcImages(event)} />
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

export default function WrongAnswerAssignment({ fixedStudentId = '', fixedWeekId = '', embedded = false, onSubmitted = null }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [weeks, setWeeks] = useState([]);
  const [students, setStudents] = useState([]);
  const [weekId, setWeekId] = useState(String(fixedWeekId || searchParams.get('week') || ''));
  const [studentId, setStudentId] = useState(String(fixedStudentId || searchParams.get('student') || ''));
  const [weekRecordId, setWeekRecordId] = useState('');
  const [studentSchedule, setStudentSchedule] = useState({});
  const [mentorInfo, setMentorInfo] = useState({ mentors: [] });
  const [persisted, setPersisted] = useState(normalizeDistribution({}));
  const [targetIndex, setTargetIndex] = useState(0);
  const [draft, setDraft] = useState({ ...EMPTY_PROBLEM });
  const [selectedMentor, setSelectedMentor] = useState('');
  const [mentorPickerOpen, setMentorPickerOpen] = useState(false);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [imageUploadModal, setImageUploadModal] = useState({
    open: false,
    loading: false,
    error: '',
    uploadUrl: '',
    problemIndex: 0
  });
  const studentPickerRef = useRef(null);

  const selectedWeek = useMemo(() => weeks.find((week) => String(week.id) === String(weekId)) || null, [weeks, weekId]);
  const selectedStudent = useMemo(() => students.find((student) => String(student.id) === String(studentId)) || null, [students, studentId]);
  const filteredStudents = useMemo(() => {
    const query = String(studentQuery || '').toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
    if (!query) return students;
    return students.filter((student) => {
      const searchable = `${student?.external_id || ''} ${student?.name || ''}`
        .toLocaleLowerCase('ko-KR')
        .replace(/\s+/g, '');
      return searchable.includes(query);
    });
  }, [studentQuery, students]);
  const mentorCards = useMemo(
    () => buildMentorCards(mentorInfo, studentSchedule, selectedWeek),
    [mentorInfo, studentSchedule, selectedWeek]
  );

  function resetDraft(nextIndex = targetIndex) {
    setDraft({ ...EMPTY_PROBLEM, images: [] });
    setSelectedMentor('');
    setMentorPickerOpen(false);
    setTargetIndex(nextIndex);
  }

  async function loadBase() {
    setError('');
    try {
      const [weekResult, studentResult] = await Promise.all([api('/api/weeks'), api('/api/students')]);
      const weekList = Array.isArray(weekResult?.weeks) ? weekResult.weeks : [];
      const studentList = Array.isArray(studentResult?.students) ? studentResult.students : [];
      setWeeks(weekList);
      setStudents(studentList);
      const requestedWeekId = String(fixedWeekId || weekId || '');
      const requestedStudentId = String(fixedStudentId || studentId || '');
      const nextWeek = weekList.some((week) => String(week.id) === requestedWeekId)
        ? requestedWeekId : String(weekList[weekList.length - 1]?.id || '');
      const nextStudent = studentList.some((student) => String(student.id) === requestedStudentId)
        ? requestedStudentId : String(studentList[0]?.id || '');
      setWeekId(nextWeek);
      setStudentId(nextStudent);
      if (!embedded) setSearchParams({ week: nextWeek, student: nextStudent }, { replace: true });
    } catch (e) {
      setError(e?.message || '학생과 회차 정보를 불러오지 못했습니다.');
    }
  }

  async function loadLogs(targetWeekId = weekId) {
    if (!targetWeekId) return;
    try {
      const result = await api(`/api/mentoring/assignment-status?weekId=${encodeURIComponent(targetWeekId)}`);
      setLogs((Array.isArray(result?.assignments) ? result.assignments : []).filter((row) => String(row?.submitted_at || '').trim()));
    } catch (e) {
      setError(e?.message || '질답 배정 로그를 불러오지 못했습니다.');
      setLogs([]);
    }
  }

  async function loadRecord(targetStudentId = studentId, targetWeekId = weekId, { keepDraft = false } = {}) {
    if (!targetStudentId || !targetWeekId) return;
    setLoading(true);
    setError('');
    try {
      const result = await api(`/api/mentoring/record?studentId=${encodeURIComponent(targetStudentId)}&weekId=${encodeURIComponent(targetWeekId)}`);
      const distribution = normalizeDistribution(result?.week_record?.e_wrong_answer_distribution);
      const nextIndex = keepDraft ? targetIndex : firstAvailableProblemIndex(distribution.problems);
      setWeekRecordId(String(result?.week_record?.id || ''));
      setStudentSchedule(safeJson(result?.student?.schedule_json, {}));
      setMentorInfo(result?.mentor_info || { mentors: [] });
      setPersisted(distribution);
      setTargetIndex(nextIndex);
      if (keepDraft) {
        const uploaded = distribution.problems?.[nextIndex]?.images;
        if (Array.isArray(uploaded)) setDraft((prev) => ({ ...prev, images: uploaded }));
      } else {
        resetDraft(nextIndex);
      }
      await loadLogs(targetWeekId);
    } catch (e) {
      setError(e?.message || '질답 배정 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadBase(); }, []);
  useEffect(() => {
    if (fixedWeekId) setWeekId(String(fixedWeekId));
    if (fixedStudentId) setStudentId(String(fixedStudentId));
  }, [fixedStudentId, fixedWeekId]);
  useEffect(() => {
    if (weekId && studentId) void loadRecord(studentId, weekId);
  }, [weekId, studentId]);
  useEffect(() => {
    if (!studentPickerOpen) return undefined;
    const closePicker = (event) => {
      if (!studentPickerRef.current?.contains(event.target)) setStudentPickerOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setStudentPickerOpen(false);
    };
    document.addEventListener('pointerdown', closePicker);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closePicker);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [studentPickerOpen]);

  function selectStudent(value) {
    setStudentId(value);
    setStudentQuery('');
    setStudentPickerOpen(false);
    setSearchParams({ week: weekId, student: value }, { replace: true });
  }

  function selectMentor(mentor) {
    const best = mentor.overlaps[0] || null;
    const fallback = mentor.work[0] || null;
    const picked = best || fallback;
    const date = picked?.date || null;
    const start = best ? formatMinutes(best.start) : String(fallback?.time || '').split(/[~-]/)[0]?.trim();
    setSelectedMentor(mentor.name);
    setMentorPickerOpen(false);
    setDraft((prev) => ({
      ...prev,
      assignment: {
        mentor_id: mentor.id || mentor.name,
        mentor_name: mentor.name,
        mentor_role: 'mentor',
        mentor_subjects: mentor.subjects,
        mentor_work_slots: mentor.work.map((slot) => ({ day: slot.day, time: slot.time })),
        overlap_count: mentor.overlaps.length,
        overlap_preview: mentor.overlaps.slice(0, 3).map((item) => `${item.dayLabel} ${item.studentTime} / ${item.mentorTime}`),
        session_day_label: picked?.dayLabel || '',
        session_month: date ? String(date.month) : '',
        session_day: date ? String(date.date) : '',
        session_start_time: start || '',
        session_duration_minutes: Math.max(10, Math.min(60, Number(best?.minutes || 20))),
        assigned_at: new Date().toISOString(),
        assigned_by: String(user?.display_name || user?.username || user?.role || '총괄멘토')
      }
    }));
  }

  async function openImageUpload() {
    if (!studentId || !weekId) return;
    setError('');
    setImageUploadModal({
      open: true,
      loading: true,
      error: '',
      uploadUrl: '',
      problemIndex: targetIndex
    });
    try {
      const result = await api('/api/mentoring/wrong-answer/upload-link', {
        method: 'POST', body: { student_id: Number(studentId), week_id: Number(weekId), problem_index: targetIndex }
      });
      const url = String(result?.upload_url || '').trim();
      if (!url) throw new Error('업로드 링크를 만들지 못했습니다.');
      setImageUploadModal({
        open: true,
        loading: false,
        error: '',
        uploadUrl: url,
        problemIndex: targetIndex
      });
    } catch (e) {
      setImageUploadModal({
        open: true,
        loading: false,
        error: e?.message || '문제 이미지 업로드 링크 생성에 실패했습니다.',
        uploadUrl: '',
        problemIndex: targetIndex
      });
    }
  }

  async function deleteImage(image) {
    const imageId = String(image?.id || '').trim();
    if (!imageId) {
      setDraft((prev) => ({ ...prev, images: (prev.images || []).filter((item) => item !== image) }));
      return;
    }
    try {
      await api('/api/mentoring/wrong-answer/delete-image', {
        method: 'POST', body: {
          student_id: Number(studentId), week_id: Number(weekId), problem_index: targetIndex, image_id: imageId
        }
      });
      setDraft((prev) => ({ ...prev, images: (prev.images || []).filter((item) => String(item?.id) !== imageId) }));
    } catch (e) {
      setError(e?.message || '문제 이미지 삭제에 실패했습니다.');
    }
  }

  async function clearDraft() {
    setError('');
    const images = Array.isArray(draft.images) ? draft.images : [];
    try {
      for (const image of images) {
        const imageId = String(image?.id || '').trim();
        if (!imageId) continue;
        await api('/api/mentoring/wrong-answer/delete-image', {
          method: 'POST', body: {
            student_id: Number(studentId), week_id: Number(weekId), problem_index: targetIndex, image_id: imageId
          }
        });
      }
      resetDraft(targetIndex);
      setMessage('입력 내용을 삭제했습니다.');
    } catch (e) {
      setError(e?.message || '입력 내용 삭제에 실패했습니다.');
    }
  }

  async function submit() {
    if (!weekRecordId) return;
    if (![draft.subject, draft.material, draft.problem_name, draft.note].some((value) => String(value || '').trim()) && !(draft.images || []).length) {
      setError('과목, 교재명, 문제번호, 전달사항 또는 문제 이미지를 입력해 주세요.');
      return;
    }
    if (!draft.assignment?.mentor_name) {
      setError('배정할 클리닉 멘토를 선택해 주세요.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const submitted = {
        ...draft,
        submitted_at: new Date().toISOString(),
        submitted_by: String(user?.display_name || user?.username || user?.role || '')
      };
      const problems = [...persisted.problems];
      problems[targetIndex] = submitted;
      const payload = {
        ...persisted,
        problems,
        assignment: persisted.assignment || submitted.assignment,
        searched_at: new Date().toISOString()
      };
      await api(`/api/mentoring/week-record/${encodeURIComponent(weekRecordId)}`, {
        method: 'PUT', body: { e_wrong_answer_distribution: payload }
      });
      setPersisted(payload);
      resetDraft(firstAvailableProblemIndex(problems));
      setMessage('제출했습니다. 입력 칸은 초기화되었고 아래 로그와 질답 배정현황에 반영되었습니다.');
      await loadLogs(weekId);
      if (typeof onSubmitted === 'function') await onSubmitted();
    } catch (e) {
      setError(e?.message || '질답 기록 제출에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {!embedded ? <section className="card overflow-hidden">
        <div className="bg-gradient-to-r from-blue-50 via-white to-emerald-50 px-5 py-5 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Wrong answer assignment</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">질답 배정</h1>
              <p className="mt-1 text-sm text-slate-600">학생의 센터 재원 시간과 멘토 출근 시간을 비교해 바로 배정합니다.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select className="input min-w-56" value={weekId} onChange={(e) => {
                const value = String(e.target.value || ''); setWeekId(value); setSearchParams({ week: value, student: studentId }, { replace: true });
              }}>
                {weeks.map((week) => <option key={week.id} value={week.id}>{toRoundLabel(week)}</option>)}
              </select>
              <button type="button" className="btn-refresh" disabled={loading} onClick={() => loadRecord(studentId, weekId)}>{loading ? '불러오는 중...' : '새로고침'}</button>
            </div>
          </div>
        </div>
      </section> : null}

      <section className="card border-emerald-200 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-black text-slate-900">질답 기록</h2><p className="text-sm text-slate-500">입력 카드는 항상 1개만 표시되며 제출 후 즉시 비워집니다.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={studentPickerRef}>
              <button
                type="button"
                disabled={Boolean(fixedStudentId)}
                className="input flex min-w-60 items-center justify-between gap-3 text-left disabled:cursor-default disabled:bg-slate-50"
                onClick={() => {
                  setStudentQuery('');
                  setStudentPickerOpen((open) => !open);
                }}
                aria-haspopup="listbox"
                aria-expanded={studentPickerOpen}
                aria-label="학생 선택"
              >
                <span className="truncate">
                  {selectedStudent
                    ? `${selectedStudent.external_id ? `${selectedStudent.external_id} · ` : ''}${selectedStudent.name}`
                    : '학생을 선택해 주세요'}
                </span>
                {!fixedStudentId ? <span className="text-xs text-slate-400" aria-hidden="true">▼</span> : null}
              </button>
              {studentPickerOpen && !fixedStudentId ? (
                <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                  <input
                    autoFocus
                    className="input w-full"
                    value={studentQuery}
                    onChange={(event) => setStudentQuery(event.target.value)}
                    placeholder="학생 이름 또는 아이디 검색"
                    aria-label="학생 이름 또는 아이디 검색"
                  />
                  <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-100 p-1" role="listbox" aria-label="학생 검색 결과">
                    {filteredStudents.map((student) => {
                      const selected = String(student.id) === String(studentId);
                      return (
                        <button
                          key={student.id}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${selected ? 'bg-blue-600 font-bold text-white' : 'text-slate-800 hover:bg-blue-50'}`}
                          onClick={() => selectStudent(String(student.id))}
                          role="option"
                          aria-selected={selected}
                        >
                          <span className="truncate">{student.external_id ? `${student.external_id} · ` : ''}{student.name}</span>
                          {selected ? <span className="ml-2 text-xs">선택됨</span> : null}
                        </button>
                      );
                    })}
                    {!filteredStudents.length ? (
                      <div className="px-3 py-6 text-center text-sm text-slate-500">검색 결과가 없습니다.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="btn border border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-700"
              onClick={() => setMentorPickerOpen((open) => !open)}
              aria-expanded={mentorPickerOpen}
            >
              {selectedMentor ? '멘토 다시 선택' : '멘토 선택'}
            </button>
            {selectedMentor ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">배정 멘토 · {selectedMentor}</span> : null}
          </div>
        </div>
        {mentorPickerOpen ? (
          <div className="mt-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/80 via-white to-emerald-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-black text-slate-900">클리닉 멘토 선택</div>
                <div className="text-xs text-slate-600">{selectedStudent?.name || '학생'}의 센터 재원 시간과 많이 겹치는 멘토부터 표시합니다.</div>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">클리닉 멘토 {mentorCards.length}명</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {mentorCards.map((mentor) => {
                const tone = compatibilityTone(mentor);
                const selected = selectedMentor === mentor.name;
                return (
                  <button key={mentor.name} type="button" onClick={() => selectMentor(mentor)} className={[
                    'rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                    selected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : mentor.total > 0 ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-white'
                  ].join(' ')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-black text-slate-900">{mentor.name}</div>
                      <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${tone.cls}`}>{tone.label}</span>
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                      {mentor.work.length ? mentor.work.map((slot, slotIndex) => (
                        <div key={`${mentor.name}-${slot.day}-${slotIndex}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                          <b className="text-slate-800">{slot.dayLabel} {slot.date?.label || ''}</b> · {slot.time}
                        </div>
                      )) : <div className="rounded-lg bg-slate-50 px-2.5 py-2">출근 일정 미등록</div>}
                    </div>
                    <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs">
                      {mentor.overlaps.length ? (
                        <b className="text-emerald-700">겹치는 시간 {mentor.total}분</b>
                      ) : <span className="font-semibold text-rose-600">학생의 센터 재원 시간과 겹치지 않습니다.</span>}
                      <div className="mt-1 text-slate-600"><b className="text-slate-700">선택과목</b> · {mentor.note || '미등록'}</div>
                    </div>
                  </button>
                );
              })}
              {!mentorCards.length ? <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">등록된 클리닉 멘토 출근 정보가 없습니다.</div> : null}
            </div>
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">과목<input className="input mt-1 w-full" value={draft.subject} onChange={(e) => setDraft((prev) => ({ ...prev, subject: e.target.value }))} /></label>
          <label className="text-xs font-semibold text-slate-600">교재명<input className="input mt-1 w-full" value={draft.material} onChange={(e) => setDraft((prev) => ({ ...prev, material: e.target.value }))} /></label>
          <label className="text-xs font-semibold text-slate-600">문제번호<input className="input mt-1 w-full" value={draft.problem_name} onChange={(e) => setDraft((prev) => ({ ...prev, problem_name: e.target.value }))} /></label>
        </div>
        <label className="mt-3 block text-xs font-semibold text-slate-600">전달사항<textarea className="textarea mt-1 min-h-28 w-full" value={draft.note} onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))} /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn border border-violet-600 bg-violet-600 text-white hover:bg-violet-700" onClick={openImageUpload}>문제 이미지 업로드하기</button>
          <button type="button" className="btn-refresh" onClick={() => loadRecord(studentId, weekId, { keepDraft: true })}>업로드 반영</button>
          <button type="button" className="btn border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={clearDraft}>삭제</button>
          <button type="button" className="btn-primary ml-auto" disabled={saving || !weekRecordId} onClick={submit}>{saving ? '제출 중...' : '완료 및 제출'}</button>
        </div>
        {(draft.images || []).length ? <div className="mt-4 flex flex-wrap gap-3">{draft.images.map((image, index) => (
          <div key={image.id || image.url || index} className="relative rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            <img className="h-24 w-24 rounded-lg object-cover" src={resolveImageUrl(image.url)} alt="업로드 문제" />
            <button type="button" className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-300 bg-white font-black text-rose-600 shadow" onClick={() => deleteImage(image)} aria-label="이미지 삭제">×</button>
          </div>
        ))}</div> : null}
        {error ? <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</div> : null}
      </section>

      {!embedded ? <section className="card p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-black text-slate-900">회차별 질답 배정 로그</h2><p className="text-sm text-slate-500">문제 내용은 제외하고 배정 관계만 간단히 표시합니다.</p></div>
          <span className="text-xs font-semibold text-slate-500">{toRoundLabel(selectedWeek)} · {logs.length}건</span>
        </div>
        <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
          {logs.length ? logs.map((row, index) => (
            <div key={`${row.week_record_id}-${row.problem_index}-${index}`} className="flex flex-col gap-2 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-slate-800">
                <b className="text-blue-700">{row.assigned_by || row.submitted_by || '총괄멘토'}</b>
                <span className="mx-2 text-slate-300">→</span><b>{row.student_name}</b>
                <span className="mx-2 text-slate-300">·</span>{row.problem_items?.[0]?.subject || '과목 미입력'}
                <span className="mx-2 text-slate-300">→</span><b className="text-emerald-700">{row.mentor_name}</b>
              </div>
              <div className="text-xs text-slate-500">{row.submitted_at ? new Date(row.submitted_at).toLocaleString('ko-KR') : '-'}</div>
            </div>
          )) : <div className="bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">이 회차에 제출된 질답 배정 로그가 없습니다.</div>}
        </div>
      </section> : null}

      {imageUploadModal.open ? (
        <WrongAnswerImageUploadModal
          loading={imageUploadModal.loading}
          error={imageUploadModal.error}
          uploadUrl={imageUploadModal.uploadUrl}
          problemIndex={imageUploadModal.problemIndex}
          onClose={() => setImageUploadModal((prev) => ({ ...prev, open: false }))}
          onRefresh={() => loadRecord(studentId, weekId, { keepDraft: true })}
        />
      ) : null}
    </div>
  );
}
