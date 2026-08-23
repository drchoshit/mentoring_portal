import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

function weekLabel(week) {
  const label = String(week?.label || '').replace(/주차/g, '회차');
  const start = String(week?.start_date || '').slice(5).replace('-', '/');
  const end = String(week?.end_date || '').slice(5).replace('-', '/');
  return start && end ? `${label} (${start} ~ ${end})` : label;
}

function statusView(status) {
  if (status === 'completed') return { label: '완료', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'missed') return { label: '미진행', tone: 'bg-rose-50 text-rose-700 border-rose-200' };
  return { label: '진행 전', tone: 'bg-slate-50 text-slate-600 border-slate-200' };
}

function LeadStatusButtons({ value, onChange }) {
  const options = [
    ['pending', '진행 전', 'slate'],
    ['completed', '완료', 'emerald'],
    ['missed', '미진행', 'rose']
  ];
  const activeTone = {
    slate: 'border-slate-600 bg-slate-700 text-white shadow-slate-100',
    emerald: 'border-emerald-600 bg-emerald-600 text-white shadow-emerald-100',
    rose: 'border-rose-500 bg-rose-500 text-white shadow-rose-100'
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([key, label, tone]) => {
        const active = value === key;
        return <button key={key} type="button" onClick={() => onChange(key)} className={`rounded-xl border px-3 py-2 text-xs font-black shadow-sm transition ${active ? activeTone[tone] : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>{label}</button>;
      })}
    </div>
  );
}

function rowKey(row) {
  return `${row.assignment_date}-${row.student_id}-${row.mentor_name}`;
}

export default function LeadMentoringStatus() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(String(searchParams.get('week') || ''));
  const [data, setData] = useState(null);
  const [mentorFilter, setMentorFilter] = useState('전체');
  const [statusFilter, setStatusFilter] = useState('all');
  const [drafts, setDrafts] = useState({});
  const [statusDrafts, setStatusDrafts] = useState({});
  const [savingKey, setSavingKey] = useState('');
  const [savingStatusKey, setSavingStatusKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(targetWeekId = weekId, { quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const suffix = targetWeekId ? `?weekId=${encodeURIComponent(targetWeekId)}` : '';
      const result = await api(`/api/mentor-assignments/lead-week-status${suffix}`);
      setData(result);
      const resolved = String(result?.week?.id || '');
      if (resolved && resolved !== String(weekId || '')) {
        setWeekId(resolved);
        setSearchParams({ week: resolved }, { replace: true });
      }
      setError('');
    } catch (err) {
      setError(err?.message || '총괄멘토링 현황을 불러오지 못했습니다.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    api('/api/weeks').then((result) => {
      const list = Array.isArray(result?.weeks) ? result.weeks : [];
      setWeeks(list);
      if (!weekId && list.length) setWeekId(String(list[list.length - 1].id));
    }).catch((err) => setError(err?.message || '회차 정보를 불러오지 못했습니다.'));
  }, []);

  useEffect(() => { void load(weekId); }, [weekId]);

  const rows = useMemo(() => Array.isArray(data?.assignments) ? data.assignments : [], [data?.assignments]);
  const summary = useMemo(() => {
    const completed = rows.filter((row) => row?.status?.status === 'completed').length;
    const missed = rows.filter((row) => row?.status?.status === 'missed').length;
    const questionsByStudent = new Map();
    for (const row of rows) questionsByStudent.set(row.student_id, Number(row?.question_count || 0));
    return {
      total: rows.length,
      completed,
      missed,
      pending: rows.length - completed - missed,
      questions: Array.from(questionsByStudent.values()).reduce((sum, count) => sum + count, 0)
    };
  }, [rows]);
  const mentorSummary = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const name = String(row?.mentor_name || '미지정');
      const current = map.get(name) || { name, total: 0, completed: 0, missed: 0, pending: 0, questions: 0, questionStudents: new Set() };
      current.total += 1;
      if (!current.questionStudents.has(row.student_id)) {
        current.questionStudents.add(row.student_id);
        current.questions += Number(row?.question_count || 0);
      }
      const status = String(row?.status?.status || 'pending');
      if (status === 'completed') current.completed += 1;
      else if (status === 'missed') current.missed += 1;
      else current.pending += 1;
      map.set(name, current);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [rows]);
  const dateOptions = useMemo(() => (data?.days || []).map((day) => ({
    value: day.date,
    label: `${day.day_label} ${String(day.date || '').slice(5).replace('-', '/')}`
  })), [data?.days]);

  function patchDraft(row, patch) {
    const key = rowKey(row);
    const nextDate = dateOptions.find((option) => option.value > row.assignment_date)?.value || dateOptions[0]?.value || '';
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        target_mentor_name: row.mentor_name,
        target_assignment_date: nextDate,
        ...(prev[key] || {}),
        ...patch
      }
    }));
  }

  function toggleDraft(row) {
    const key = rowKey(row);
    if (drafts[key]) {
      setDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
      return;
    }
    patchDraft(row, {});
  }

  async function reassign(row) {
    const key = rowKey(row);
    const draft = drafts[key] || {};
    if (!draft.target_mentor_name || !draft.target_assignment_date) return;
    setSavingKey(key);
    setError('');
    try {
      await api('/api/mentor-assignments/lead-today/reassign', {
        method: 'POST',
        body: {
          week_id: Number(weekId),
          student_id: row.student_id,
          source_assignment_date: row.assignment_date,
          source_mentor_name: row.mentor_name,
          target_assignment_date: draft.target_assignment_date,
          target_mentor_name: draft.target_mentor_name
        }
      });
      setDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
      await load(weekId, { quiet: true });
    } catch (err) {
      setError(err?.message || '총괄멘토링 재배정에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  function patchStatusDraft(row, patch) {
    const key = rowKey(row);
    setStatusDrafts((prev) => ({
      ...prev,
      [key]: {
        status: String(row?.status?.status || 'pending'),
        reason: String(row?.status?.reason || ''),
        ...(prev[key] || {}),
        ...patch
      }
    }));
  }

  async function saveStatus(row) {
    const key = rowKey(row);
    const draft = statusDrafts[key] || { status: String(row?.status?.status || 'pending'), reason: String(row?.status?.reason || '') };
    if (draft.status === 'missed' && !String(draft.reason || '').trim()) {
      setError('미진행 상태는 사유를 입력해야 저장할 수 있습니다.');
      return;
    }
    setSavingStatusKey(key);
    setError('');
    try {
      await api('/api/mentor-assignments/lead-today/status', {
        method: 'PUT',
        body: {
          week_id: Number(weekId),
          student_id: row.student_id,
          mentor_name: row.mentor_name,
          assignment_date: row.assignment_date,
          status: draft.status,
          reason: draft.status === 'missed' ? String(draft.reason || '').trim() : ''
        }
      });
      setStatusDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
      await load(weekId, { quiet: true });
    } catch (err) {
      setError(err?.message || '총괄멘토링 상태 수정에 실패했습니다.');
    } finally {
      setSavingStatusKey('');
    }
  }

  const filteredDays = (data?.days || []).map((day) => ({
    ...day,
    assignments: (day.assignments || []).filter((row) => {
      if (mentorFilter !== '전체' && row.mentor_name !== mentorFilter) return false;
      const status = String(row?.status?.status || 'pending');
      return statusFilter === 'all' || status === statusFilter;
    }).map((row) => ({ ...row, assignment_date: day.date, day_label: day.day_label }))
  }));

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-50 via-white to-emerald-50 p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><div className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Lead mentoring status</div><h1 className="mt-1 text-2xl font-black text-slate-900">총괄멘토링 현황</h1><p className="mt-1 text-sm text-slate-600">선택한 회차의 진행·미진행·질문 배정과 재배정 내역을 한눈에 확인합니다.</p></div>
            <div className="flex flex-wrap gap-2">
              <select className="input min-w-64" value={weekId} onChange={(event) => { const value = event.target.value; setWeekId(value); setSearchParams({ week: value }, { replace: true }); }}>{weeks.map((week) => <option key={week.id} value={week.id}>{weekLabel(week)}</option>)}</select>
              <button className="btn-refresh" type="button" disabled={loading} onClick={() => load(weekId)}>{loading ? '불러오는 중...' : '새로고침'}</button>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['전체 배정', summary.total, 'bg-blue-50 text-blue-700'], ['완료', summary.completed, 'bg-emerald-50 text-emerald-700'],
          ['진행 전', summary.pending, 'bg-slate-100 text-slate-700'], ['미진행', summary.missed, 'bg-rose-50 text-rose-700'],
          ['배정 질문', summary.questions, 'bg-violet-50 text-violet-700']
        ].map(([label, value, tone]) => <div key={label} className={`rounded-2xl p-4 ${tone}`}><div className="text-xs font-bold opacity-75">{label}</div><div className="mt-1 text-2xl font-black">{value}<span className="ml-1 text-xs font-semibold">{label === '배정 질문' ? '개' : '건'}</span></div></div>)}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-slate-900">총괄멘토별 요약</h2><p className="text-xs text-slate-500">회차 전체 실적과 질문 배정 수입니다.</p></div><div className="flex gap-2"><select className="input" value={mentorFilter} onChange={(event) => setMentorFilter(event.target.value)}><option>전체</option>{(data?.lead_mentors || []).map((name) => <option key={name}>{name}</option>)}</select><select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">전체 상태</option><option value="completed">완료</option><option value="pending">진행 전</option><option value="missed">미진행</option></select></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{mentorSummary.map((mentor) => <div key={mentor.name} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"><div className="font-black text-slate-900">{mentor.name}</div><div className="mt-3 grid grid-cols-4 gap-1 text-center text-xs"><div><b className="block text-base text-emerald-700">{mentor.completed}</b>완료</div><div><b className="block text-base text-slate-700">{mentor.pending}</b>대기</div><div><b className="block text-base text-rose-600">{mentor.missed}</b>미진행</div><div><b className="block text-base text-violet-700">{mentor.questions}</b>질문</div></div></div>)}</div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {filteredDays.map((day) => (
          <div key={day.date} className="card p-5">
            <div className="flex items-center justify-between"><div><h3 className="font-black text-slate-900">{day.day_label}요일</h3><div className="text-xs text-slate-500">{day.date}</div></div><span className="rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 shadow-sm">{day.assignments.length}건</span></div>
            <div className="mt-4 space-y-2.5">
              {day.assignments.map((row) => {
                const key = rowKey(row);
                const status = String(row?.status?.status || 'pending');
                const view = statusView(status);
                const draft = drafts[key];
                const statusDraft = statusDrafts[key] || { status, reason: String(row?.status?.reason || '') };
                return (
                  <article key={key} className="rounded-2xl border border-slate-200 bg-white p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-black text-slate-900">{row.student_name} <span className="text-xs font-medium text-slate-400">{row.external_id}</span></div><div className="mt-1 text-xs text-slate-500">담당 {row.mentor_name}{row.reassigned ? ' · 재배정' : ''} · 질문 {Number(row.question_count || 0)}개</div></div><span className={`rounded-xl border-2 px-3 py-1.5 text-xs font-black shadow-sm ${view.tone}`}>{view.label}</span></div>
                    {status === 'missed' && row.status?.reason ? <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{row.status.reason}</div> : null}
                    <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                      <LeadStatusButtons value={statusDraft.status} onChange={(value) => patchStatusDraft(row, { status: value })} />
                      {statusDraft.status === 'missed' ? <input className="input" value={statusDraft.reason} onChange={(event) => patchStatusDraft(row, { reason: event.target.value })} placeholder="미진행 사유" /> : <div />}
                      <button className="btn-primary min-w-24" type="button" disabled={savingStatusKey === key} onClick={() => saveStatus(row)}>{savingStatusKey === key ? '저장 중...' : '상태 저장'}</button>
                    </div>
                    {status === 'missed' ? <div className="mt-3"><button className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700" type="button" onClick={() => toggleDraft(row)}>{draft ? '재배정 닫기' : '다른 총괄멘토에게 재배정'}</button>{draft ? <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><select className="input" value={draft.target_mentor_name} onChange={(event) => patchDraft(row, { target_mentor_name: event.target.value })}>{(data?.lead_mentors || []).map((name) => <option key={name}>{name}</option>)}</select><select className="input" value={draft.target_assignment_date} onChange={(event) => patchDraft(row, { target_assignment_date: event.target.value })}>{dateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button className="btn-primary" type="button" disabled={savingKey === key} onClick={() => reassign(row)}>{savingKey === key ? '처리 중...' : '재배정'}</button></div> : null}</div> : null}
                  </article>
                );
              })}
              {!day.assignments.length ? <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">조건에 맞는 배정이 없습니다.</div> : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
