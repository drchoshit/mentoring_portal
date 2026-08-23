import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
const KO_TO_EN = Object.fromEntries(Object.entries(DAY_LABELS).map(([key, value]) => [value, key]));

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

function MentorPicker({ names, selected, onSelect, showAll, counts, details, week }) {
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
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? 'bg-[#5b8def] text-white' : 'bg-[#eef3f9] text-zinc-500'}`}>{name === '전체' ? counts.all : (counts[name] || 0)}명</span>
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

function StudentCard({ row, dayLabel, weekId, canChangeStatus, onMissed, onCompleted }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState(row?.status?.reason || '');
  const todayKey = KO_TO_EN[dayLabel];
  const todayItems = scheduleItems(row.schedule, todayKey);
  const inCenter = todayItems.some((item) => isHappeningNow(item));
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
            {inCenter ? <span className="inline-flex items-center gap-1 rounded-full bg-[#5b8def] px-2 py-0.5 font-black text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />지금 재원 중</span> : null}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">오늘 일정</div>
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
      {expanded ? <WeeklySchedule schedule={row.schedule} today={dayLabel} /> : null}
    </article>
  );
}

export default function LeadToday() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isAdmin = ['admin', 'director'].includes(String(user?.role || ''));

  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const result = await api('/api/mentor-assignments/lead-today');
      setData(result);
      setError('');
    } catch (err) {
      setError(err?.message || '오늘의 멘토링을 불러오지 못했습니다.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 60000);
    return () => window.clearInterval(timer);
  }, []);

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
        body: { student_id: row.student_id, week_id: data.week.id, mentor_name: row.mentor_name, reason }
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
        body: { student_id: row.student_id, week_id: data.week.id, mentor_name: row.mentor_name }
      });
      await load({ quiet: true });
    } catch (err) {
      setError(err?.message || '진행 처리에 실패했습니다.');
    }
  }

  const overviewRows = selected && selected !== '전체' ? rows : (data?.assignments || []);
  const overviewCompleted = overviewRows.filter((row) => row?.status?.status === 'completed').length;
  const overviewMissed = overviewRows.filter((row) => row?.status?.status === 'missed').length;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-r from-[#dcecff] via-[#eaf3ff] to-[#f1f7ff] px-7 py-7 shadow-[0_12px_30px_rgba(91,141,239,0.13)]">
        <div className="pointer-events-none absolute -right-16 -top-28 h-64 w-64 rounded-full bg-white/55 blur-2xl" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#3970c9]">
            <span>Today</span><span className="h-1 w-1 rounded-full bg-[#5b8def]" />
            <span>{data?.date || ''} {data?.day_label ? `${data.day_label}요일` : ''}</span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#1d2b43]">오늘의 총괄 멘토링</h1>
          <p className="mt-1 text-sm text-[#60728e]">담당 멘토를 선택하고 오늘의 진행 상황을 빠르게 관리하세요.</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="min-w-[88px] rounded-2xl bg-white/75 px-4 py-3 shadow-sm"><div className="text-[10px] font-bold text-slate-400">오늘 배정</div><div className="mt-0.5 text-xl font-black text-[#1d2b43]">{overviewRows.length}<span className="ml-0.5 text-xs font-medium text-slate-400">명</span></div></div>
          <div className="min-w-[88px] rounded-2xl bg-emerald-50/90 px-4 py-3"><div className="text-[10px] font-bold text-emerald-600">완료</div><div className="mt-0.5 text-xl font-black text-emerald-700">{overviewCompleted}</div></div>
          <div className="min-w-[88px] rounded-2xl bg-rose-50/90 px-4 py-3"><div className="text-[10px] font-bold text-rose-500">미진행</div><div className="mt-0.5 text-xl font-black text-rose-600">{overviewMissed}</div></div>
          <button type="button" onClick={() => load()} className="rounded-2xl bg-[#5b8def] px-4 text-xs font-bold text-white shadow-sm shadow-blue-200/70 transition hover:bg-[#4779d8]">↻ 새로고침</button>
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
      <section className="py-2">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><h2 className="text-sm font-black text-[#1d2b43]">총괄멘토 선택</h2><p className="mt-0.5 text-xs text-slate-500">선택한 이름이 오늘 업무의 ‘나’로 표시됩니다.</p></div>
          {data?.source_updated_at ? <div className="text-right text-xs text-slate-400"><div>{data?.source === 'medi-weekly-live' ? '메디위클리 실시간 연동' : '포털 배정 데이터'}</div><div>{new Date(data.source_updated_at).toLocaleString('ko-KR')}</div></div> : null}
        </div>
        {loading ? <div className="card p-8 text-center text-sm text-slate-500">배정 정보를 불러오는 중입니다.</div> : (
          <MentorPicker names={data?.lead_mentors || []} selected={selected} onSelect={setSelected} showAll={isAdmin} counts={assignmentCounts} details={data?.lead_mentor_details || []} week={data?.week} />
        )}
      </section>

      {selected ? (
        <section className="space-y-2.5">
          <div className="pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#5b8def]">Mentoring queue</div><div className="mt-1 flex items-baseline gap-2"><h2 className="text-lg font-black text-[#1d2b43]">{selected === '전체' ? '전체 총괄멘토' : `${selected} (나)`}</h2><span className="text-xs text-slate-400">{data?.week?.label || '현재 회차'}</span></div></div>
              <div className="flex items-center gap-2 text-xs"><strong className="rounded-full bg-[#e3efff] px-3 py-1.5 text-[#3970c9]">오늘 {rows.length}명</strong><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">완료 {completed}</span><span className="rounded-full bg-zinc-100 px-3 py-1.5 text-zinc-600">진행 전 {pending}</span><span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-600">미진행 {missed}</span></div>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#e1eaf5]"><div className="h-full rounded-full bg-[#5b8def] transition-all" style={{ width: `${rows.length ? Math.round((completed / rows.length) * 100) : 0}%` }} /></div>
          </div>
          {rows.length ? rows.map((row) => <StudentCard key={`${row.mentor_name}-${row.student_id}`} row={row} dayLabel={data.day_label} weekId={data.week?.id} canChangeStatus={['lead', 'admin'].includes(String(user?.role || ''))} onMissed={markMissed} onCompleted={markCompleted} />) : (
            <div className="rounded-xl bg-white p-8 text-center shadow-sm"><div className="text-sm font-bold text-slate-700">오늘 배정된 학생이 없습니다.</div><div className="mt-1 text-xs text-slate-500">배정 데이터와 선택한 멘토 이름을 확인해 주세요.</div></div>
          )}
        </section>
      ) : !loading ? <div className="rounded-xl bg-[#e3efff] p-7 text-center text-sm font-bold text-[#3970c9]">위에서 내 이름을 선택해 주세요.</div> : null}
    </div>
  );
}
