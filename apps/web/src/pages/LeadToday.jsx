import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
const KO_TO_EN = Object.fromEntries(Object.entries(DAY_LABELS).map(([key, value]) => [value, key]));

function weekOptionLabel(week) {
  const label = String(week?.label || '').replace(/주차/g, '회차');
  const start = String(week?.start_date || '').slice(5).replace('-', '/');
  const end = String(week?.end_date || '').slice(5).replace('-', '/');
  return start && end ? `${label} (${start} ~ ${end})` : label;
}

function weekDateOptions(week) {
  const match = String(week?.start_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endText = String(week?.end_date || '').slice(0, 10);
  if (!match) return [];
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const options = [];
  for (let index = 0; index < 14; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    if (endText && value > endText) break;
    const day = DAYS[(date.getUTCDay() + 6) % 7];
    options.push({ value, label: `${DAY_LABELS[day]} ${date.getUTCMonth() + 1}/${date.getUTCDate()}` });
  }
  return options;
}

function workDateLabels(name, details, week) {
  const schedule = (details || []).find((item) => item?.name === name)?.schedule || {};
  const startMatch = String(week?.start_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const start = startMatch ? new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])) : null;
  return DAYS.flatMap((day, index) => {
    const value = schedule?.[day];
    const hasWork = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!hasWork) return [];
    if (!start) return [DAY_LABELS[day]];
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return [`${DAY_LABELS[day]} ${date.getMonth() + 1}/${date.getDate()}`];
  });
}

function scheduleItems(schedule, key) {
  return Array.isArray(schedule?.[key]) ? schedule[key] : [];
}

function isCenterItem(item) {
  return `${item?.type || ''} ${item?.title || ''}`.includes('센터');
}

function parseMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isHappeningNow(item, now = new Date()) {
  if (!isCenterItem(item)) return false;
  const matches = [...String(item?.time || '').matchAll(/(\d{1,2}):(\d{2})/g)];
  if (!matches.length) return true;
  const current = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now).replace(':', ''));
  const currentMinutes = Math.floor(current / 100) * 60 + (current % 100);
  const start = parseMinutes(matches[0][0]);
  const end = matches[1] ? parseMinutes(matches[1][0]) : start + 60;
  return currentMinutes >= start && currentMinutes <= end;
}

function statusMeta(status) {
  if (status?.status === 'completed') return {
    label: '멘토링 완료', icon: '✓',
    chip: 'bg-emerald-100 text-emerald-800',
    card: 'bg-emerald-50/55'
  };
  if (status?.status === 'missed') return {
    label: '미진행', icon: '×',
    chip: 'bg-rose-50 text-rose-700',
    card: 'bg-rose-50/45'
  };
  return {
    label: '진행 전', icon: '○',
    chip: 'bg-zinc-100 text-zinc-600',
    card: 'bg-white'
  };
}

function MentorPicker({ names, selected, onSelect, showAll, counts, weekCounts, details, week, viewScope }) {
  const options = showAll ? ['전체', ...names] : names;
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {options.map((name) => {
        const active = selected === name;
        const workDates = name === '전체' ? [] : workDateLabels(name, details, week);
        return (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            className={`group relative rounded-xl px-3.5 py-3 text-left transition ${active
              ? 'bg-[#dcecff] text-[#2d62b6] shadow-[0_7px_18px_rgba(91,141,239,0.18)]'
              : 'bg-white text-[#1d2b43] shadow-[0_3px_12px_rgba(51,79,118,0.06)] hover:-translate-y-px hover:bg-[#f4f8ff] hover:shadow-md'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold">{name}{active && name !== '전체' ? ' (나)' : ''}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? 'bg-[#5b8def] text-white' : 'bg-[#eef3f9] text-zinc-500'}`}>
                {viewScope === 'week'
                  ? `회차 ${name === '전체' ? (weekCounts?.all || 0) : (weekCounts?.[name] || 0)}`
                  : `오늘 ${name === '전체' ? counts.all : (counts[name] || 0)} · 회차 ${name === '전체' ? (weekCounts?.all || 0) : (weekCounts?.[name] || 0)}`}
              </span>
            </div>
            {name !== '전체' ? <div className={`mt-1.5 truncate text-[10px] ${active ? 'text-[#3970c9]' : workDates.length ? 'text-[#5b8def]' : 'text-zinc-400'}`}>{workDates.length ? `출근 ${workDates.join(' · ')}` : '출근일 미등록'}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

function WeeklySchedule({ schedule, today }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {DAYS.map((day) => {
        const items = scheduleItems(schedule, day);
        const active = DAY_LABELS[day] === today;
        return (
          <div key={day} className={`min-h-20 rounded-xl p-2.5 ${active ? 'bg-[#e3efff]' : 'bg-zinc-50/70'}`}>
            <div className={`text-xs font-bold ${active ? 'text-[#3970c9]' : 'text-zinc-500'}`}>{DAY_LABELS[day]}요일</div>
            <div className="mt-1.5 space-y-1">
              {items.length ? items.map((item, index) => (
                <div key={`${day}-${index}`} className="text-[11px] leading-4 text-slate-700">
                  <span className="font-medium">{item?.time || ''}</span>{item?.time && item?.title ? ' · ' : ''}{item?.title || item?.type || ''}
                </div>
              )) : <div className="text-[11px] text-slate-400">일정 없음</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DirectorConsultingList({ rows, weekId, week }) {
  const navigate = useNavigate();
  const items = Array.isArray(rows) ? rows : [];
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 shadow-[0_10px_28px_rgba(180,120,35,0.10)]">
      <div className="flex flex-col gap-2 border-b border-amber-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.17em] text-amber-600">Director consulting</div>
          <h2 className="mt-1 text-lg font-black text-slate-900">원장 컨설팅 리스트</h2>
          <p className="mt-0.5 text-xs text-slate-500">원장 계정에서만 보이는 {week?.label || '선택 회차'} 컨설팅 대상입니다.</p>
        </div>
        <span className="w-fit rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800">총 {items.length}명</span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((row) => {
          const days = Array.isArray(row?.consulting_days) ? row.consulting_days : [];
          const centerSchedules = DAYS.flatMap((day) => scheduleItems(row?.schedule, day)
            .filter(isCenterItem)
            .map((item) => `${DAY_LABELS[day]} ${item?.time || '시간 미정'}`));
          return (
            <article key={`${row.mentor_name}-${row.student_id}`} className="rounded-2xl border border-amber-100 bg-white/90 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-black text-slate-950">{row.student_name}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{row.external_id || '-'}{row.grade ? ` · ${row.grade}` : ''}</div>
                </div>
                <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">{row.mentor_name}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(days.length ? days : ['요일 미지정']).map((day) => <span key={day} className="rounded-md bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-700">{day === '요일 미지정' ? day : `${day}요일`}</span>)}
                <span className="rounded-md bg-violet-50 px-2 py-1 text-[11px] font-bold text-violet-700">질문 {Number(row.question_count || 0)}개</span>
              </div>
              <div className="mt-3 text-[11px] leading-5 text-slate-500">{centerSchedules.length ? centerSchedules.slice(0, 3).join(' · ') : '센터 재원 일정 미등록'}</div>
              <button className="btn-ghost mt-3 w-full text-xs" type="button" onClick={() => navigate(`/students/${row.student_id}/mentoring?week=${weekId}`)}>컨설팅 기록 열기</button>
            </article>
          );
        })}
        {!items.length ? <div className="rounded-2xl border border-dashed border-amber-200 bg-white/70 p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">선택 회차의 원장 컨설팅 대상이 없습니다.</div> : null}
      </div>
    </section>
  );
}

function StudentCard({ row, dayLabel, weekId, week, assignmentDate, leadMentors, isCurrentDate, canChangeStatus, onMissed, onCompleted, onReassign }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState(row?.status?.reason || '');
  const [showReassign, setShowReassign] = useState(false);
  const dateOptions = weekDateOptions(week);
  const defaultTargetDate = dateOptions.find((option) => option.value > assignmentDate)?.value || dateOptions[0]?.value || '';
  const [targetDate, setTargetDate] = useState(defaultTargetDate);
  const [targetMentor, setTargetMentor] = useState(String(row?.mentor_name || ''));
  const [reassigning, setReassigning] = useState(false);
  const todayKey = KO_TO_EN[dayLabel];
  const todayItems = scheduleItems(row.schedule, todayKey);
  const inCenter = isCurrentDate && todayItems.some((item) => isHappeningNow(item));
  const meta = statusMeta(row.status);

  return (
    <article className={`overflow-hidden rounded-2xl px-4 py-3.5 shadow-[0_4px_16px_rgba(51,79,118,0.07)] transition hover:-translate-y-px hover:shadow-[0_9px_26px_rgba(51,79,118,0.11)] ${meta.card}`}>
      <div className="grid items-center gap-3 lg:grid-cols-[minmax(11rem,0.9fr)_minmax(18rem,1.8fr)_8.5rem_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-black text-slate-950">{row.student_name}</h3>
            {row.grade ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{row.grade}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span>{row.mentor_name}</span>
            {row.forced ? <span className="font-bold text-amber-600">추가 배정</span> : null}
            {row.reassigned ? <span className="font-bold text-violet-600">재배정</span> : null}
            <span className="rounded-full bg-violet-50 px-2 py-0.5 font-bold text-violet-700">질문 {Number(row.question_count || 0)}개</span>
            {inCenter ? <span className="inline-flex items-center gap-1 rounded-full bg-[#5b8def] px-2 py-0.5 font-black text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />지금 재원 중</span> : null}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">선택 요일 일정</div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {todayItems.length ? todayItems.map((item, index) => (
              <span key={index} className={`max-w-full truncate rounded-md px-2 py-1 text-[11px] font-medium ${isCenterItem(item) ? 'bg-[#e3efff] text-[#3970c9]' : 'bg-slate-50 text-slate-600'}`}>
                {item?.time || '시간 미정'} · {item?.title || item?.type || '일정'}
              </span>
            )) : <span className="text-xs text-slate-400">등록 일정 없음</span>}
          </div>
        </div>

        <div className={`inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-black ${meta.chip}`}>
          <span className="text-base leading-none">{meta.icon}</span>{meta.label}
        </div>

        <div className="flex shrink-0 flex-wrap justify-start gap-1.5 lg:justify-end">
          <button className="btn-ghost px-3 py-1.5 text-xs" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? '접기' : '주간 일정'}</button>
          {canChangeStatus ? <button className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-default disabled:opacity-50" type="button" disabled={row?.status?.status === 'completed'} onClick={() => onCompleted(row)}>✓ 진행</button> : null}
          {canChangeStatus ? <button className="btn-danger-soft px-3 py-1.5 text-xs" type="button" onClick={() => setShowReason((value) => !value)}>× 미진행</button> : null}
          {canChangeStatus && row?.status?.status === 'missed' ? <button className="rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100" type="button" onClick={() => setShowReassign((value) => !value)}>↻ 재배정</button> : null}
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => navigate(`/students/${row.student_id}/mentoring?week=${weekId}`)}>기록 작성</button>
        </div>
      </div>

      {row?.status?.status === 'missed' && row.status.reason ? (
        <div className="mt-2 bg-rose-50/70 px-3 py-2 text-xs text-rose-700"><strong className="mr-2">미진행 사유</strong>{row.status.reason}</div>
      ) : null}
      {showReason ? (
        <div className="mt-3 rounded-lg bg-rose-50/70 p-3">
          <label className="text-xs font-bold text-rose-700">미진행 사유 (필수)</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input className="input !border-0 flex-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="오늘 진행하지 못한 사유를 입력해 주세요." />
            <button className="btn-danger" type="button" disabled={!reason.trim()} onClick={async () => { await onMissed(row, reason); setShowReason(false); }}>× 미진행 확정</button>
          </div>
        </div>
      ) : null}
      {showReassign ? (
        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3">
          <div className="text-xs font-black text-violet-800">미진행 학생 재배정</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select className="input" value={targetMentor} onChange={(event) => setTargetMentor(event.target.value)}>
              {(leadMentors || []).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select className="input" value={targetDate} onChange={(event) => setTargetDate(event.target.value)}>
              {dateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button className="btn-primary" type="button" disabled={reassigning || !targetMentor || !targetDate} onClick={async () => {
              setReassigning(true);
              try {
                await onReassign(row, { targetMentor, targetDate });
                setShowReassign(false);
              } finally {
                setReassigning(false);
              }
            }}>{reassigning ? '재배정 중...' : '재배정 확정'}</button>
          </div>
        </div>
      ) : null}
      {expanded ? <WeeklySchedule schedule={row.schedule} today={dayLabel} /> : null}
    </article>
  );
}

export default function LeadToday() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(String(searchParams.get('week') || ''));
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isAdmin = ['admin', 'director'].includes(String(user?.role || ''));
  const isDirector = String(user?.role || '') === 'director';
  const isWeekView = data?.view_scope === 'week';

  async function load({ quiet = false, targetWeekId = weekId } = {}) {
    if (!quiet) setLoading(true);
    try {
      const query = targetWeekId ? `?weekId=${encodeURIComponent(targetWeekId)}` : '';
      const result = await api(`/api/mentor-assignments/lead-today${query}`);
      setData(result);
      const resolvedWeekId = String(result?.week?.id || '');
      if (resolvedWeekId && resolvedWeekId !== String(weekId || '')) {
        setWeekId(resolvedWeekId);
        setSearchParams({ week: resolvedWeekId }, { replace: true });
      }
      setError('');
    } catch (err) {
      setError(err?.message || '오늘의 멘토링을 불러오지 못했습니다.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    api('/api/weeks')
      .then((result) => setWeeks(Array.isArray(result?.weeks) ? result.weeks : []))
      .catch((err) => setError(err?.message || '회차 정보를 불러오지 못했습니다.'));
  }, []);

  useEffect(() => {
    void load({ targetWeekId: weekId });
    const timer = window.setInterval(() => load({ quiet: true, targetWeekId: weekId }), 60000);
    return () => window.clearInterval(timer);
  }, [weekId]);

  const rows = useMemo(() => {
    const all = Array.isArray(data?.assignments) ? data.assignments : [];
    if (!selected || selected === '전체') return selected === '전체' ? all : [];
    return all.filter((row) => row.mentor_name === selected);
  }, [data?.assignments, selected]);
  const completed = rows.filter((row) => row?.status?.status === 'completed').length;
  const missed = rows.filter((row) => row?.status?.status === 'missed').length;
  const pending = rows.length - completed - missed;
  const assignmentCounts = useMemo(() => {
    const result = { all: Array.isArray(data?.assignments) ? data.assignments.length : 0 };
    for (const row of data?.assignments || []) result[row.mentor_name] = (result[row.mentor_name] || 0) + 1;
    return result;
  }, [data?.assignments]);

  async function markMissed(row, reason) {
    try {
      await api('/api/mentor-assignments/lead-today/missed', {
        method: 'POST',
        body: { student_id: row.student_id, week_id: data.week.id, mentor_name: row.mentor_name, assignment_date: row.assignment_date || data.date, reason }
      });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.message || '미진행 처리에 실패했습니다.');
    }
  }

  async function markCompleted(row) {
    try {
      await api('/api/mentor-assignments/lead-today/completed', {
        method: 'POST',
        body: { student_id: row.student_id, week_id: data.week.id, mentor_name: row.mentor_name, assignment_date: row.assignment_date || data.date }
      });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.message || '진행 처리에 실패했습니다.');
    }
  }

  async function reassign(row, { targetMentor, targetDate }) {
    try {
      await api('/api/mentor-assignments/lead-today/reassign', {
        method: 'POST',
        body: {
          student_id: row.student_id,
          week_id: data.week.id,
          source_assignment_date: row.assignment_date || data.date,
          source_mentor_name: row.mentor_name,
          target_assignment_date: targetDate,
          target_mentor_name: targetMentor
        }
      });
      await load({ quiet: true, targetWeekId: weekId });
    } catch (err) {
      setError(err?.message || '재배정에 실패했습니다.');
      throw err;
    }
  }

  const overviewRows = selected && selected !== '전체' ? rows : (data?.assignments || []);
  const overviewCompleted = overviewRows.filter((row) => row?.status?.status === 'completed').length;
  const overviewMissed = overviewRows.filter((row) => row?.status?.status === 'missed').length;
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const isCurrentDate = String(data?.date || '') === currentDate;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-r from-[#dcecff] via-[#eaf3ff] to-[#f1f7ff] px-7 py-7 shadow-[0_12px_30px_rgba(91,141,239,0.13)]">
        <div className="pointer-events-none absolute -right-16 -top-28 h-64 w-64 rounded-full bg-white/55 blur-2xl" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#3970c9]">
            <span>{isCurrentDate ? 'Today' : 'Selected round'}</span><span className="h-1 w-1 rounded-full bg-[#5b8def]" />
            <span>{isWeekView
              ? `${data?.week?.start_date || ''} ~ ${data?.week?.end_date || ''}`
              : `${data?.date || ''} ${data?.day_label ? `${data.day_label}요일` : ''}`}</span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#1d2b43]">{isCurrentDate ? '오늘의 총괄 멘토링' : '회차별 총괄 멘토링'}</h1>
          <p className="mt-1 text-sm text-[#60728e]">회차와 담당 멘토를 선택하고 진행 상황을 빠르게 확인하세요.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <label className="min-w-64 rounded-2xl bg-white/75 px-4 py-2.5 shadow-sm">
            <span className="block text-[10px] font-bold text-slate-400">회차 선택</span>
            <select className="mt-1 w-full bg-transparent text-sm font-bold text-[#1d2b43] outline-none" value={weekId} onChange={(event) => {
              const value = String(event.target.value || '');
              setWeekId(value);
              setSearchParams({ week: value }, { replace: true });
            }}>
              {weeks.map((week) => <option key={week.id} value={week.id}>{weekOptionLabel(week)}</option>)}
            </select>
          </label>
          <div className="min-w-[88px] rounded-2xl bg-white/75 px-4 py-3 shadow-sm"><div className="text-[10px] font-bold text-slate-400">{isWeekView ? '회차 배정' : '선택일 배정'}</div><div className="mt-0.5 text-xl font-black text-[#1d2b43]">{overviewRows.length}<span className="ml-0.5 text-xs font-medium text-slate-400">명</span></div></div>
          <div className="min-w-[88px] rounded-2xl bg-emerald-50/90 px-4 py-3"><div className="text-[10px] font-bold text-emerald-600">완료</div><div className="mt-0.5 text-xl font-black text-emerald-700">{overviewCompleted}</div></div>
          <div className="min-w-[88px] rounded-2xl bg-rose-50/90 px-4 py-3"><div className="text-[10px] font-bold text-rose-500">미진행</div><div className="mt-0.5 text-xl font-black text-rose-600">{overviewMissed}</div></div>
          <button type="button" onClick={() => load({ targetWeekId: weekId })} className="rounded-2xl bg-[#5b8def] px-4 text-xs font-bold text-white shadow-sm shadow-blue-200/70 transition hover:bg-[#4779d8]">↻ 새로고침</button>
        </div>
        </div>
      </section>

      {error ? <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {data?.live_sync?.configured && data?.live_sync?.error ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">메디위클리 최신 배정을 불러오지 못해 마지막 동기화 데이터를 표시합니다. · {data.live_sync.error}</div>
      ) : null}
      {data?.schedule_sync?.configured && data?.schedule_sync?.error ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">메디 스케줄의 일부 일정을 연결하지 못했습니다. · {data.schedule_sync.error}</div>
      ) : null}
      {isDirector ? <DirectorConsultingList rows={data?.director_consulting_assignments || []} weekId={data?.week?.id} week={data?.week} /> : null}
      <section className="py-2">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><h2 className="text-sm font-black text-[#1d2b43]">총괄멘토 선택</h2><p className="mt-0.5 text-xs text-slate-500">선택한 이름이 해당 회차 업무의 ‘나’로 표시됩니다.</p></div>
          {data?.source_updated_at ? <div className="text-right text-xs text-slate-400"><div>{data?.source === 'medi-weekly-live' ? '메디위클리 실시간 연동' : '포털 배정 데이터'}</div><div>{new Date(data.source_updated_at).toLocaleString('ko-KR')}</div></div> : null}
        </div>
        {loading ? <div className="card p-8 text-center text-sm text-slate-500">배정 정보를 불러오는 중입니다.</div> : (
          <MentorPicker names={data?.lead_mentors || []} selected={selected} onSelect={setSelected} showAll={isAdmin} counts={assignmentCounts} weekCounts={data?.weekly_assignment_counts || {}} details={data?.lead_mentor_details || []} week={data?.week} viewScope={data?.view_scope || 'day'} />
        )}
      </section>

      {selected ? (
        <section className="space-y-2.5">
          <div className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5b8def]">Mentoring queue</div><div className="mt-1 flex items-baseline gap-2"><h2 className="text-lg font-black text-[#1d2b43]">{selected === '전체' ? '전체 총괄멘토' : `${selected} (나)`}</h2><span className="text-xs text-slate-400">{data?.week?.label || '현재 회차'}</span></div></div>
              <div className="flex items-center gap-2 text-xs"><strong className="rounded-full bg-[#e3efff] px-3 py-1.5 text-[#3970c9]">{isWeekView ? '회차' : '선택일'} {rows.length}명</strong><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">완료 {completed}</span><span className="rounded-full bg-zinc-100 px-3 py-1.5 text-zinc-600">진행 전 {pending}</span><span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-600">미진행 {missed}</span></div>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#e1eaf5]"><div className="h-full rounded-full bg-[#5b8def] transition-all" style={{ width: `${rows.length ? Math.round((completed / rows.length) * 100) : 0}%` }} /></div>
          </div>
          {rows.length ? rows.map((row) => <StudentCard key={`${data?.week?.id}-${row.assignment_date || data?.date}-${row.mentor_name}-${row.student_id}`} row={row} dayLabel={row.day_label || data.day_label} weekId={data.week?.id} week={data.week} assignmentDate={row.assignment_date || data.date} leadMentors={data?.lead_mentors || []} isCurrentDate={isCurrentDate && String(row.assignment_date || data.date) === currentDate} canChangeStatus={['lead', 'admin'].includes(String(user?.role || ''))} onMissed={markMissed} onCompleted={markCompleted} onReassign={reassign} />) : (
            <div className="rounded-xl bg-white p-8 text-center shadow-sm"><div className="text-sm font-bold text-slate-700">{isWeekView ? '선택한 회차에 배정된 학생이 없습니다.' : '선택한 회차의 해당 요일에 배정된 학생이 없습니다.'}</div><div className="mt-1 text-xs text-slate-500">배정 데이터와 선택한 멘토 이름을 확인해 주세요.</div></div>
          )}
        </section>
      ) : !loading ? <div className="rounded-xl bg-[#e3efff] p-7 text-center text-sm font-bold text-[#3970c9]">위에서 내 이름을 선택해 주세요.</div> : null}
    </div>
  );
}
