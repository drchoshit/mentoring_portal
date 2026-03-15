import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
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
  if (Array.isArray(value)) return value.map(normalizeLastHwTask).filter((t) => t.text);
  const raw = String(value);
  const parsed = safeJson(raw, null);
  if (Array.isArray(parsed)) return parsed.map(normalizeLastHwTask).filter((t) => t.text);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((text) => ({ text, done: null, progress: '' }));
}

function renderLastHw(value) {
  const tasks = parseLastHwTasks(value);
  if (!tasks.length) return null;
  return (
    <div className="space-y-2">
      {tasks.map((t, idx) => (
        <div key={`${t.text}-${idx}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-2 py-1.5 text-sm">
          <div className="flex-1 whitespace-pre-wrap text-slate-800">{t.text}</div>
          <TaskStatusBadge done={t.done} progress={t.progress} />
        </div>
      ))}
    </div>
  );
}

const DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
const DAYS = [
  { k: 'Mon', label: '월' },
  { k: 'Tue', label: '화' },
  { k: 'Wed', label: '수' },
  { k: 'Thu', label: '목' },
  { k: 'Fri', label: '금' },
  { k: 'Sat', label: '토' },
  { k: 'Sun', label: '일' }
];

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
  if (typeof value === 'object' && Array.isArray(value.entries)) return value.entries.map(normalizeClinicEntry);
  const parsed = safeJson(value, []);
  if (Array.isArray(parsed)) return parsed.map(normalizeClinicEntry);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) return parsed.entries.map(normalizeClinicEntry);
  return [];
}

function joinNonEmpty(parts, separator = ' · ') {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(separator);
}

function parseDateTimeValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateTimeLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = parseDateTimeValue(raw);
  if (!date) return raw;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function normalizeWrongAnswerAssignment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mentorName = String(raw.mentor_name || '').trim();
  const sessionMonth = String(raw.session_month || '').trim();
  const sessionDay = String(raw.session_day || '').trim();
  const sessionStartTime = String(raw.session_start_time || raw.session_time || '').trim();
  if (!mentorName && !sessionMonth && !sessionDay && !sessionStartTime) return null;
  return {
    mentor_name: mentorName,
    session_month: sessionMonth,
    session_day: sessionDay,
    session_start_time: sessionStartTime
  };
}

function normalizeWrongAnswerItem(raw, fallbackAssignment = null) {
  if (!raw || typeof raw !== 'object') return null;
  const completionStatus = ['done', 'incomplete'].includes(String(raw.completion_status || '').trim())
    ? String(raw.completion_status || '').trim()
    : 'pending';
  const item = {
    subject: String(raw.subject || '').trim(),
    material: String(raw.material || '').trim(),
    problem_name: String(raw.problem_name || '').trim(),
    problem_type: String(raw.problem_type || '').trim(),
    note: String(raw.note || '').trim(),
    completion_status: completionStatus,
    completion_feedback: String(raw.completion_feedback || '').trim(),
    incomplete_reason: String(raw.incomplete_reason || '').trim(),
    status_updated_at: String(raw.status_updated_at || '').trim(),
    deleted_at: String(raw.deleted_at || '').trim(),
    assignment: normalizeWrongAnswerAssignment(raw.assignment || fallbackAssignment)
  };
  if (item.deleted_at) return null;
  if (!item.subject && !item.material && !item.problem_name && !item.problem_type && !item.note) return null;
  return item;
}

function parseWrongAnswerItems(value) {
  const parsed = safeJson(value, {});
  if (!parsed || typeof parsed !== 'object') return [];
  const topLevelAssignment = normalizeWrongAnswerAssignment(parsed.assignment || null);
  const problems = Array.isArray(parsed.problems)
    ? parsed.problems
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  return problems
    .map((item, idx) => normalizeWrongAnswerItem(item, idx === 0 ? topLevelAssignment : null))
    .filter(Boolean);
}

function QnaStatusBadge({ status }) {
  const tone = status === 'done'
    ? 'border-emerald-200/80 bg-emerald-50/90 text-emerald-800'
    : status === 'incomplete'
      ? 'border-amber-200/80 bg-amber-50/90 text-amber-800'
      : 'border-slate-200/80 bg-slate-50/90 text-slate-700';
  const label = status === 'done' ? '완료' : status === 'incomplete' ? '미완료' : '진행중';
  return (
    <span className={['inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm', tone].join(' ')}>
      {label}
    </span>
  );
}

function TaskStatusBadge({ done, progress, hideWhenEmpty = false }) {
  if (hideWhenEmpty && done == null && !progress) return null;

  if (done === true) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
        완료
      </span>
    );
  }

  if (done === false) {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800">
        진행중{progress ? ` · ${progress}` : ''}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
      상태 미선택
    </span>
  );
}

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200/80 bg-white/88 px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-sm">
      {children}
    </span>
  );
}

const SECTION_TONES = {
  header: 'border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,248,237,0.96),rgba(255,255,255,0.98))]',
  calendar: 'border-emerald-200/70 bg-[linear-gradient(135deg,rgba(238,253,245,0.95),rgba(255,255,255,0.98))]',
  penalties: 'border-rose-200/70 bg-[linear-gradient(135deg,rgba(255,241,242,0.95),rgba(255,255,255,0.98))]',
  mentor: 'border-violet-200/70 bg-[linear-gradient(135deg,rgba(245,243,255,0.95),rgba(255,255,255,0.98))]',
  curriculum: 'border-sky-200/70 bg-[linear-gradient(135deg,rgba(240,249,255,0.95),rgba(255,255,255,0.98))]',
  subjects: 'border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.95),rgba(255,255,255,0.98))]',
  daily: 'border-cyan-200/70 bg-[linear-gradient(135deg,rgba(236,254,255,0.95),rgba(255,255,255,0.98))]',
  clinic: 'border-indigo-200/70 bg-[linear-gradient(135deg,rgba(238,242,255,0.95),rgba(255,255,255,0.98))]',
  weekly: 'border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(255,255,255,0.98))]'
};

const DEFAULT_PARENT_MENTOR_NOTICE = '멘토 및 멘토링 요일은 학생의 일정에 따라 변경될 수 있습니다.';

const SUBJECT_TONES = [
  'border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.92),rgba(255,255,255,0.96))]',
  'border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.92),rgba(255,255,255,0.96))]',
  'border-violet-200/70 bg-[linear-gradient(135deg,rgba(245,243,255,0.92),rgba(255,255,255,0.96))]',
  'border-sky-200/70 bg-[linear-gradient(135deg,rgba(240,249,255,0.92),rgba(255,255,255,0.96))]',
  'border-rose-200/70 bg-[linear-gradient(135deg,rgba(255,241,242,0.92),rgba(255,255,255,0.96))]'
];

const SECTION_CARD_BASE =
  'card overflow-hidden rounded-[28px] border bg-white/85 p-5 md:p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm';

function sectionCardClass(tone) {
  return [SECTION_CARD_BASE, tone].join(' ');
}

function InfoPill({ label, value }) {
  return (
    <span className="inline-flex min-w-[120px] flex-col rounded-2xl border border-white/80 bg-white/88 px-3.5 py-2 text-left shadow-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className="mt-1 text-sm font-semibold text-slate-900">{value || '-'}</span>
    </span>
  );
}

function SectionTitle({ title, right }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
      <div className="text-[15px] font-semibold tracking-[-0.01em] text-brand-950">{title}</div>
      {right ? (
        <div className="inline-flex items-center rounded-full border border-white/80 bg-white/85 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          {right}
        </div>
      ) : null}
    </div>
  );
}

function classifySchedule(it) {
  const type = String(it?.type || '').trim();
  const title = String(it?.title || '').trim();

  const isAbsence = type.includes('결석') || title.includes('결석') || type.includes('결강') || title.includes('결강');
  const isCenter = type.includes('센터');
  const isExternal = type.includes('외부');

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
    <div className="mt-3">
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
        <span className="inline-flex items-center rounded-full border border-emerald-200/80 bg-white/90 px-3 py-1 shadow-sm">센터</span>
        <span className="inline-flex items-center rounded-full border border-sky-200/80 bg-white/90 px-3 py-1 shadow-sm">센터 외</span>
        <span className="inline-flex items-center rounded-full border border-rose-200/80 bg-white/90 px-3 py-1 shadow-sm">결석/결강</span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="grid min-w-[980px] grid-cols-7 gap-4">
          {DAYS.map((d, idx) => {
            const dateLabel = start
              ? (() => {
                  const day = new Date(start);
                  day.setDate(day.getDate() + idx);
                  return `${DAY_LABELS[d.k]} (${fmtMD(day)})`;
                })()
              : DAY_LABELS[d.k];
            const items = Array.isArray(schedule?.[d.k]) ? schedule[d.k] : [];
            return (
              <div key={d.k} className="rounded-[24px] border border-white/80 bg-white/88 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                <div className="text-sm font-semibold text-slate-900">{dateLabel}</div>
                <div className="mt-3 space-y-2.5">
                  {items.length ? (
                    items.map((it, i) => {
                      const kind = classifySchedule(it);
                      return (
                        <div key={i} className={['rounded-2xl border px-3 py-2.5 shadow-sm', scheduleTone(kind)].join(' ')}>
                          <div className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">{it.time || ''}</div>
                          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-900">{it.title || ''}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-5 text-center text-sm text-slate-500">
                      일정 없음
                    </div>
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

function RecordBox({ title, value, tone = 'border-slate-200 bg-white/60' }) {
  if (!value) return null;
  return (
    <div className={['rounded-2xl border p-4 shadow-sm', tone].join(' ')}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-800">{title}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value}</div>
    </div>
  );
}

function DayNote({ label, value }) {
  const tasks = parseLastHwTasks(value);

  return (
    <div className="grid grid-cols-[56px,1fr] gap-3 rounded-[24px] border border-white/80 bg-white/88 p-3 shadow-sm">
      <div className="flex h-14 items-center justify-center rounded-2xl bg-brand-900 text-lg font-semibold text-white shadow-sm">
        {label}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Daily Task</div>
        {tasks.length ? (
          <div className="mt-2 space-y-2">
            {tasks.map((task, idx) => (
              <div key={`${task.text}-${idx}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{task.text}</div>
                  <TaskStatusBadge done={task.done} progress={task.progress} hideWhenEmpty />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-500">없음</div>
        )}
      </div>
    </div>
  );
}

function DailyTasksWeekPanel({ title, tasksByDay }) {
  return (
    <div className="rounded-[24px] border border-white/80 bg-white/76 p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-900">{title}</div>
      <div className="mt-3 grid grid-cols-1 gap-3">
        {DAYS.map((d) => <DayNote key={`${title}-${d.k}`} label={d.label} value={tasksByDay?.[d.k]} />)}
      </div>
    </div>
  );
}

function BlockedSection({ blocked, children }) {
  if (!blocked) return <>{children}</>;
  return <div className="pointer-events-none select-none blur-[3px]">{children}</div>;
}

export default function Parent() {
  const [loading, setLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [allWeeks, setAllWeeks] = useState([]);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedWeekId, setSelectedWeekId] = useState('');
  const [record, setRecord] = useState(null);
  const [mentorNotice, setMentorNotice] = useState(null);

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const r = await api('/api/parent/overview');
      const list = r.items || [];
      setItems(list);
      const firstStudent = list[0]?.student?.id ? String(list[0].student.id) : '';
      setSelectedStudentId((prev) => prev || firstStudent);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWeeks() {
    try {
      const r = await api('/api/weeks');
      const list = Array.isArray(r?.weeks) ? r.weeks : [];
      list.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      setAllWeeks(list);
      if (!selectedWeekId && list[0]?.id) setSelectedWeekId(String(list[0].id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadParentMentorNotice() {
    try {
      const r = await api('/api/settings/parent-mentor-notice');
      if (r && Object.prototype.hasOwnProperty.call(r, 'value')) {
        setMentorNotice(String(r.value ?? ''));
      } else {
        setMentorNotice(null);
      }
    } catch {
      setMentorNotice(null);
    }
  }

  async function loadRecord(studentId, weekId) {
    if (!studentId || !weekId) {
      setRecord(null);
      return;
    }
    setError('');
    setRecordLoading(true);
    setRecord(null);
    try {
      const r = await api(`/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(weekId)}`);
      setRecord(r);
    } catch (e) {
      setError(e.message);
      setRecord(null);
    } finally {
      setRecordLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
    loadWeeks();
    loadParentMentorNotice();
  }, []);

  useEffect(() => {
    if (!selectedStudentId || !selectedWeekId) {
      setRecord(null);
      return;
    }
    const selectedItem = items.find((x) => String(x.student.id) === String(selectedStudentId));
    const isShared = (selectedItem?.weeks || []).some((w) => String(w.id) === String(selectedWeekId));
    if (!isShared) {
      setRecord(null);
      return;
    }
    loadRecord(selectedStudentId, selectedWeekId);
  }, [items, selectedStudentId, selectedWeekId]);

  const selected = useMemo(
    () => items.find((x) => String(x.student.id) === String(selectedStudentId)),
    [items, selectedStudentId]
  );
  const sharedWeeks = selected?.weeks || [];
  const sharedWeekIds = useMemo(() => new Set(sharedWeeks.map((w) => String(w.id))), [sharedWeeks]);
  const visibleWeeks = useMemo(
    () => (allWeeks || []).filter((w) => sharedWeekIds.has(String(w.id))),
    [allWeeks, sharedWeekIds]
  );
  const isSelectedWeekShared = useMemo(() => sharedWeekIds.has(String(selectedWeekId)), [sharedWeekIds, selectedWeekId]);
  const isLockedWeek = !isSelectedWeekShared;

  const selectedWeek = useMemo(
    () => allWeeks.find((w) => String(w.id) === String(selectedWeekId)),
    [allWeeks, selectedWeekId]
  );
  const selectedWeekRound = useMemo(() => getWeekRound(selectedWeek), [selectedWeek?.id, selectedWeek?.label]);
  const useNewDailyTaskLayout = selectedWeekRound >= 4;
  const showClinicSection = selectedWeekRound >= 5;

  useEffect(() => {
    if (!visibleWeeks.length) {
      if (selectedWeekId) setSelectedWeekId('');
      return;
    }
    const exists = visibleWeeks.some((w) => String(w.id) === String(selectedWeekId));
    if (!exists) setSelectedWeekId(String(visibleWeeks[0].id));
  }, [visibleWeeks, selectedWeekId]);

  const schedule = selected?.student?.schedule || {};
  const mentorAssignment = selected?.mentor_assignment || null;
  const mentorName = String(mentorAssignment?.mentor || '').trim();
  const mentorDays = Array.isArray(mentorAssignment?.scheduledDays) ? mentorAssignment.scheduledDays : [];
  const mentorNoticeText = mentorNotice == null ? DEFAULT_PARENT_MENTOR_NOTICE : mentorNotice;

  const subjectRecords = useMemo(() => (record?.subject_records || []), [record]);
  const weekRecord = useMemo(() => (record?.week_record || {}), [record]);
  const dailyTasks = useMemo(() => safeJson(weekRecord?.b_daily_tasks, {}), [weekRecord]);
  const dailyTasksThisWeek = useMemo(() => safeJson(weekRecord?.b_daily_tasks_this_week, {}), [weekRecord]);
  const clinicEntries = useMemo(() => parseClinicEntries(weekRecord?.d_clinic_records), [weekRecord]);
  const wrongAnswerItems = useMemo(() => parseWrongAnswerItems(weekRecord?.e_wrong_answer_distribution), [weekRecord]);
  const scores = useMemo(() => safeJson(weekRecord?.scores_json, []), [weekRecord]);
  const showQnaClinicSection = showClinicSection || wrongAnswerItems.length > 0 || clinicEntries.length > 0;
  const combinedQnaEntries = useMemo(() => {
    const wrongAnswerEntries = wrongAnswerItems.map((item, idx) => {
      const question = joinNonEmpty([
        item.subject,
        item.material,
        item.problem_name,
        item.problem_type
      ]);
      if (!question) return null;

      return {
        key: `wrong-answer-${idx}`,
        question,
        mentorName: item.assignment?.mentor_name || '',
        dateLabel: formatDateTimeLabel(item.status_updated_at),
        status: item.completion_status,
        sortTime: parseDateTimeValue(item.status_updated_at)?.getTime() || 0,
        originalOrder: idx
      };
    });

    const clinicQnaEntries = clinicEntries.map((entry, idx) => {
      const question = joinNonEmpty([
        entry.subject,
        entry.material,
        entry.problem_name,
        entry.problem_type
      ]);
      if (!question) return null;

      return {
        key: `clinic-${idx}`,
        question,
        mentorName: entry.mentor_name || '',
        dateLabel: formatDateTimeLabel(entry.solved_date),
        status: 'done',
        sortTime: parseDateTimeValue(entry.solved_date)?.getTime() || 0,
        originalOrder: wrongAnswerItems.length + idx
      };
    }).filter(Boolean);

    return [...wrongAnswerEntries, ...clinicQnaEntries]
      .filter(Boolean)
      .sort((a, b) => {
        if (b.sortTime !== a.sortTime) return b.sortTime - a.sortTime;
        return a.originalOrder - b.originalOrder;
      })
      .map((entry, idx) => ({
        ...entry,
        title: `질답 기록 ${idx + 1}`
      }));
  }, [clinicEntries, wrongAnswerItems]);

  const penaltyItems = selected?.penalties?.items || [];
  const totalPenaltyPoints =
    typeof selected?.penalties?.totalPoints === 'number'
      ? selected.penalties.totalPoints
      : penaltyItems.reduce((acc, p) => acc + Number(p.points || 0), 0);

  if (loading) {
    return (
      <div className="card p-5">
        <div className="text-sm text-slate-600">불러오는 중...</div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="card p-5">
        <div className="text-sm text-slate-600">본인 학생 정보가 없습니다.</div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>
    );
  }

  const weekRange = selectedWeek?.start_date && selectedWeek?.end_date ? `${selectedWeek.start_date} ~ ${selectedWeek.end_date}` : '';
  const sharedWeek = sharedWeeks.find((w) => String(w.id) === String(selectedWeekId));
  const recordUpdated = sharedWeek?.updated_at || '';

  return (
    <div className="relative space-y-5 pb-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 rounded-[40px] bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_38%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0))]" />

      <div className={sectionCardClass(SECTION_TONES.header)}>
        <div className="grid gap-5 xl:grid-cols-[1.35fr,0.95fr] xl:items-end">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700">Parent Dashboard</div>
            <div className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-brand-950">
              {selected?.student?.name || '학생'} 학생의 주간 멘토링 기록
            </div>
            <div className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              공유가 완료된 회차만 확인할 수 있습니다. 학습 진행 상황, 질답 내용, 멘토 피드백을 한 화면에서 더 보기 쉽게 정리했습니다.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <InfoPill label="회차" value={toRoundLabel(selectedWeek?.label || '-')} />
              <InfoPill label="기간" value={weekRange || '-'} />
              <InfoPill label="기록 업데이트" value={recordUpdated || '-'} />
              <Badge>벌점 합계 {totalPenaltyPoints}점</Badge>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/80 bg-white/86 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">학생 선택</div>
                <select className="input mt-2" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
                  {items.map((x) => (
                    <option key={x.student.id} value={String(x.student.id)}>{x.student.name} {x.student.grade ? `(${x.student.grade})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">회차 선택</div>
                <select className="input mt-2" value={selectedWeekId} onChange={(e) => setSelectedWeekId(e.target.value)}>
                  {visibleWeeks.length ? (
                    visibleWeeks.map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {toRoundLabel(w.label)} {w.start_date && w.end_date ? `(${w.start_date}~${w.end_date})` : ''} · 공유됨
                      </option>
                    ))
                  ) : (
                    <option value="">공유된 회차 없음</option>
                  )}
                </select>
              </div>
            </div>
          </div>
        </div>

        {isLockedWeek ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50/90 px-4 py-3 text-sm font-medium text-amber-900">
            아직 멘토링 기록의 작성/검수가 끝나지 않았습니다. 보통 멘토링한 24시간 이내 공유됩니다.
          </div>
        ) : null}

        {error ? <div className="mt-4 text-sm text-red-600">{error}</div> : null}
      </div>

      <BlockedSection blocked={isLockedWeek}>
        <div className={sectionCardClass(SECTION_TONES.calendar)}>
          <SectionTitle title="주간 일정 캘린더" right={weekRange || '회차 선택'} />
          <WeeklyCalendar schedule={schedule} weekStart={selectedWeek?.start_date} />
        </div>
      </BlockedSection>

      <BlockedSection blocked={isLockedWeek}>
        <div className={sectionCardClass(SECTION_TONES.penalties)}>
          <SectionTitle title="벌점 내역" right={`총 ${totalPenaltyPoints}점 · ${penaltyItems.length}건`} />
          <div className="mt-4 space-y-2 max-h-[420px] overflow-auto pr-1">
            {penaltyItems.length ? penaltyItems.slice(0, 20).map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 rounded-2xl border border-white/80 bg-white/82 p-3.5 shadow-sm">
                <div>
                  <div className="text-sm font-medium text-slate-800">{p.reason}</div>
                  <div className="mt-1 text-xs text-slate-500">{p.created_at || p.date || ''}</div>
                </div>
                <Badge>{p.points > 0 ? `+${p.points}` : p.points}</Badge>
              </div>
            )) : <div className="text-sm text-slate-400">벌점 내역 없음</div>}
          </div>

          {Array.isArray(scores) && scores.length ? (
            <div className="mt-6 border-t border-slate-200/70 pt-4">
              <SectionTitle title="성적 / 진단" right={`총 ${scores.length}건`} />
              <div className="mt-4 overflow-auto rounded-[24px] border border-white/80 bg-white/82 p-3 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2 pr-3">구분</th>
                      <th className="py-2 pr-3">과목</th>
                      <th className="py-2 pr-3">내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((r, idx) => (
                      <tr key={idx} className="border-t border-slate-200">
                        <td className="py-2 pr-3">{r.label || ''}</td>
                        <td className="py-2 pr-3">{r.subject || ''}</td>
                        <td className="py-2 pr-3 whitespace-pre-wrap">{r.note || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </BlockedSection>

      <div className={sectionCardClass(SECTION_TONES.mentor)}>
        <SectionTitle title="이번회차 멘토 안내" right={selectedWeek?.label ? `${toRoundLabel(selectedWeek.label)}` : ''} />
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <InfoPill label="이번주 멘토" value={mentorName || '-'} />
          <InfoPill label="멘토링 진행 요일" value={mentorDays.length ? mentorDays.join(', ') : '-'} />
        </div>
        <div className="mt-3 rounded-2xl border border-white/80 bg-white/78 px-4 py-3 text-sm leading-6 text-slate-600 shadow-sm">{mentorNoticeText}</div>
      </div>

      <BlockedSection blocked={isLockedWeek}>
        <div className={sectionCardClass(SECTION_TONES.subjects)}>
          <SectionTitle title="과목별 기록" right={selectedWeek?.label ? `${toRoundLabel(selectedWeek.label)}` : ''} />
          {recordLoading ? <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div> : record ? (
            <div className="mt-4 space-y-4">
              {subjectRecords.length ? subjectRecords.map((sr, idx) => {
                const blocks = [
                  { key: 'a_last_hw', label: '지난주 과제', value: renderLastHw(sr.a_last_hw), tone: 'border-blue-200/60 bg-blue-50/70' },
                  { key: 'a_hw_exec', label: '과제 이행도', value: sr.a_hw_exec, tone: 'border-emerald-200/60 bg-emerald-50/70' },
                  { key: 'a_this_hw', label: '이번주 과제', value: renderLastHw(sr.a_this_hw), tone: 'border-amber-200/60 bg-amber-50/70' },
                  { key: 'a_comment', label: '과목 별 코멘트', value: sr.a_comment, tone: 'border-amber-200/60 bg-amber-50/70' }
                ].filter((b) => b.value);
                return (
                  <div key={sr.id} className={['rounded-[24px] border p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]', SUBJECT_TONES[idx % SUBJECT_TONES.length]].join(' ')}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-brand-900">{sr.subject_name}</div>
                      <div className="text-xs text-slate-500">{sr.updated_at ? `업데이트: ${sr.updated_at}` : ''}</div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {blocks.length ? blocks.map((b) => <RecordBox key={b.key} title={b.label} value={b.value} tone={b.tone} />) : <div className="text-sm text-slate-400">공유된 기록이 아직 없습니다.</div>}
                    </div>
                  </div>
                );
              }) : <div className="text-sm text-slate-400">과목 기록 없음</div>}
            </div>
          ) : <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>}
        </div>
      </BlockedSection>

      <BlockedSection blocked={isLockedWeek}>
        <div className={sectionCardClass(SECTION_TONES.daily)}>
          <SectionTitle title="일일 학습 과제" right={selectedWeek?.label ? `${toRoundLabel(selectedWeek.label)}` : ''} />
          {recordLoading ? <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div> : record ? (
            <div className="mt-4 grid grid-cols-1 gap-4">
              {useNewDailyTaskLayout ? (
                <DailyTasksWeekPanel title="일일 학습 과제(이번주)" tasksByDay={dailyTasksThisWeek} />
              ) : (
                <DailyTasksWeekPanel title="일일 학습 과제" tasksByDay={dailyTasks} />
              )}
            </div>
          ) : <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>}
        </div>
      </BlockedSection>

      {showQnaClinicSection ? (
        <BlockedSection blocked={isLockedWeek}>
          <div className={sectionCardClass(SECTION_TONES.clinic)}>
            <SectionTitle title="학생 별 주간 질답 클리닉 내용" right={selectedWeek?.label ? `${toRoundLabel(selectedWeek.label)}` : ''} />
            {recordLoading ? (
              <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div>
            ) : record ? (
              <div className="mt-4 space-y-4">
                {combinedQnaEntries.length ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <InfoPill label="질답 기록" value={`${combinedQnaEntries.length}건`} />
                      <InfoPill label="완료" value={`${combinedQnaEntries.filter((entry) => entry.status === 'done').length}건`} />
                      <InfoPill label="진행중/미완료" value={`${combinedQnaEntries.filter((entry) => entry.status !== 'done').length}건`} />
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {combinedQnaEntries.map((entry) => {
                        const metaLine = joinNonEmpty([
                          entry.mentorName ? `진행 멘토 ${entry.mentorName}` : '',
                          entry.dateLabel
                        ]);

                        return (
                          <div key={entry.key} className="rounded-[24px] border border-white/80 bg-white/88 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-brand-900">{entry.title}</div>
                                {metaLine ? <div className="mt-1 text-xs text-slate-500">{metaLine}</div> : null}
                              </div>
                              <QnaStatusBadge status={entry.status} />
                            </div>

                            <div className="mt-4 space-y-3">
                              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-800">학생 질문</div>
                                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{entry.question}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">공유된 질답/클리닉 기록이 없습니다.</div>
                )}
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>
            )}
          </div>
        </BlockedSection>
      ) : null}

      <div className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-xs leading-5 text-slate-500 shadow-sm">
        안내: 학부모 페이지는 조회 전용이며, 공유가 완료된 회차의 기록만 표시됩니다.
      </div>
    </div>
  );
}
