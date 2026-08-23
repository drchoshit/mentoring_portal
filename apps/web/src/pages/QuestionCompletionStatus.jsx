import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

function weekLabel(week) {
  const label = String(week?.label || '').replace(/주차/g, '회차');
  const start = String(week?.start_date || '').slice(5).replace('-', '/');
  const end = String(week?.end_date || '').slice(5).replace('-', '/');
  return start && end ? `${label} (${start} ~ ${end})` : label;
}

function itemKey(item) {
  return `${item.week_record_id}-${item.problem_index}`;
}

function statusView(status) {
  if (status === 'done') return { label: '해결 완료', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (status === 'incomplete') return { label: '미해결', tone: 'border-rose-200 bg-rose-50 text-rose-700' };
  return { label: '확인 대기', tone: 'border-amber-200 bg-amber-50 text-amber-700' };
}

export default function QuestionCompletionStatus() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(String(searchParams.get('week') || ''));
  const [rows, setRows] = useState([]);
  const [mentorInfo, setMentorInfo] = useState({ mentors: [] });
  const [statusFilter, setStatusFilter] = useState('all');
  const [mentorFilter, setMentorFilter] = useState('전체');
  const [reassignKey, setReassignKey] = useState('');
  const [targetMentor, setTargetMentor] = useState('');
  const [statusDrafts, setStatusDrafts] = useState({});
  const [savingKey, setSavingKey] = useState('');
  const [savingStateKey, setSavingStateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load(targetWeekId = weekId, { quiet = false } = {}) {
    if (!targetWeekId) return;
    if (!quiet) setLoading(true);
    try {
      const result = await api(`/api/mentoring/assignment-status?weekId=${encodeURIComponent(targetWeekId)}`);
      setRows(Array.isArray(result?.assignments) ? result.assignments : []);
      setMentorInfo(result?.mentor_info || { mentors: [] });
      setError('');
    } catch (err) {
      setError(err?.message || '질답 완료 현황을 불러오지 못했습니다.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    api('/api/weeks').then((result) => {
      const list = Array.isArray(result?.weeks) ? result.weeks : [];
      setWeeks(list);
      const valid = list.some((week) => String(week.id) === String(weekId));
      if (!valid && list.length) {
        const value = String(list[list.length - 1].id);
        setWeekId(value);
        setSearchParams({ week: value }, { replace: true });
      }
    }).catch((err) => setError(err?.message || '회차 정보를 불러오지 못했습니다.'));
  }, []);

  useEffect(() => { if (weekId) void load(weekId); }, [weekId]);

  const clinicMentors = useMemo(() => {
    const names = new Set();
    for (const mentor of mentorInfo?.mentors || []) {
      const role = String(mentor?.role || '').trim().toLowerCase();
      const name = String(mentor?.name || mentor?.display_name || '').trim();
      if (name && (role === 'mentor' || role.includes('클리닉'))) names.add(name);
    }
    for (const row of rows) if (row?.mentor_name) names.add(String(row.mentor_name));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [mentorInfo, rows]);
  const summary = useMemo(() => ({
    total: rows.length,
    done: rows.filter((row) => row.completion_status === 'done').length,
    incomplete: rows.filter((row) => row.completion_status === 'incomplete').length,
    pending: rows.filter((row) => !['done', 'incomplete'].includes(row.completion_status)).length
  }), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    if (mentorFilter !== '전체' && row.mentor_name !== mentorFilter) return false;
    const status = ['done', 'incomplete'].includes(row.completion_status) ? row.completion_status : 'pending';
    return statusFilter === 'all' || status === statusFilter;
  }), [mentorFilter, rows, statusFilter]);

  async function reassign(item) {
    const key = itemKey(item);
    if (!targetMentor) return;
    setSavingKey(key);
    setError('');
    setMessage('');
    try {
      await api(`/api/mentoring/assignment-status/${encodeURIComponent(item.week_record_id)}`, {
        method: 'PUT',
        body: {
          problem_index: Number(item.problem_index || 0),
          mentor_id: targetMentor,
          mentor_name: targetMentor,
          mentor_role: 'mentor'
        }
      });
      if (item.completion_status !== 'pending') {
        await api(`/api/mentoring/assignment-status/${encodeURIComponent(item.week_record_id)}/problem-state`, {
          method: 'PUT',
          body: { problem_index: Number(item.problem_index || 0), completion_status: 'pending' }
        });
      }
      setReassignKey('');
      setTargetMentor('');
      setMessage(`${item.student_name} 학생의 질문을 ${targetMentor} 멘토에게 재배정했습니다.`);
      await load(weekId, { quiet: true });
    } catch (err) {
      setError(err?.message || '질문 재배정에 실패했습니다.');
    } finally {
      setSavingKey('');
    }
  }

  function patchStatusDraft(item, patch) {
    const key = itemKey(item);
    setStatusDrafts((prev) => ({
      ...prev,
      [key]: {
        completion_status: String(item?.completion_status || 'pending'),
        completion_feedback: String(item?.completion_feedback || ''),
        incomplete_reason: String(item?.incomplete_reason || ''),
        ...(prev[key] || {}),
        ...patch
      }
    }));
  }

  async function saveStatus(item) {
    const key = itemKey(item);
    const draft = statusDrafts[key] || {
      completion_status: String(item?.completion_status || 'pending'),
      completion_feedback: String(item?.completion_feedback || ''),
      incomplete_reason: String(item?.incomplete_reason || '')
    };
    if (draft.completion_status === 'incomplete' && !String(draft.incomplete_reason || '').trim()) {
      setError('미해결 상태는 사유를 입력해야 저장할 수 있습니다.');
      return;
    }
    setSavingStateKey(key);
    setError('');
    setMessage('');
    try {
      await api(`/api/mentoring/assignment-status/${encodeURIComponent(item.week_record_id)}/problem-state`, {
        method: 'PUT',
        body: {
          problem_index: Number(item.problem_index || 0),
          completion_status: draft.completion_status,
          completion_feedback: draft.completion_status === 'done' ? String(draft.completion_feedback || '').trim() : '',
          incomplete_reason: draft.completion_status === 'incomplete' ? String(draft.incomplete_reason || '').trim() : ''
        }
      });
      setStatusDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setMessage(`${item.student_name} 학생의 질문 처리 상태를 수정했습니다.`);
      await load(weekId, { quiet: true });
    } catch (err) {
      setError(err?.message || '질문 처리 상태 수정에 실패했습니다.');
    } finally {
      setSavingStateKey('');
    }
  }

  return (
    <div className="space-y-6">
      <section className="card overflow-hidden"><div className="bg-gradient-to-r from-violet-50 via-white to-blue-50 p-5 md:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.18em] text-violet-600">Question completion status</div><h1 className="mt-1 text-2xl font-black text-slate-900">질답 완료 현황</h1><p className="mt-1 text-sm text-slate-600">회차별 질문 해결 상태를 확인하고 필요하면 다른 클리닉 멘토에게 재배정합니다.</p></div><div className="flex flex-wrap gap-2"><select className="input min-w-64" value={weekId} onChange={(event) => { const value = event.target.value; setWeekId(value); setSearchParams({ week: value }, { replace: true }); }}>{weeks.map((week) => <option key={week.id} value={week.id}>{weekLabel(week)}</option>)}</select><button className="btn-refresh" type="button" disabled={loading} onClick={() => load(weekId)}>{loading ? '불러오는 중...' : '새로고침'}</button></div></div></div></section>

      {error ? <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
        ['전체 질문', summary.total, 'bg-violet-50 text-violet-700'], ['해결 완료', summary.done, 'bg-emerald-50 text-emerald-700'],
        ['확인 대기', summary.pending, 'bg-amber-50 text-amber-700'], ['미해결', summary.incomplete, 'bg-rose-50 text-rose-700']
      ].map(([label, value, tone]) => <div key={label} className={`rounded-2xl p-4 ${tone}`}><div className="text-xs font-bold opacity-75">{label}</div><div className="mt-1 text-2xl font-black">{value}<span className="ml-1 text-xs">개</span></div></div>)}</section>

      <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-slate-900">질문별 처리 현황</h2><p className="text-xs text-slate-500">문제 이미지는 제외하고 배정과 해결 상태만 간단히 표시합니다.</p></div><div className="flex flex-wrap gap-2"><select className="input" value={mentorFilter} onChange={(event) => setMentorFilter(event.target.value)}><option>전체</option>{clinicMentors.map((name) => <option key={name}>{name}</option>)}</select><select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">전체 상태</option><option value="done">해결 완료</option><option value="pending">확인 대기</option><option value="incomplete">미해결</option></select></div></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{filtered.map((item) => { const key = itemKey(item); const problem = item?.problem_items?.[0] || {}; const view = statusView(item.completion_status); const editing = reassignKey === key; const statusDraft = statusDrafts[key] || { completion_status: String(item.completion_status || 'pending'), completion_feedback: String(item.completion_feedback || ''), incomplete_reason: String(item.incomplete_reason || '') }; return <article key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-slate-900">{item.student_name} <span className="text-xs font-medium text-slate-400">{item.external_id}</span></div><div className="mt-1 text-xs text-slate-500">{problem.subject || '과목 미입력'} · {problem.material || '교재 미입력'} · {problem.problem_name || `질문 ${Number(item.problem_order || 1)}`}</div></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${view.tone}`}>{view.label}</span></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-lg bg-blue-50 px-2.5 py-1.5 font-bold text-blue-700">담당 {item.mentor_name}</span><span className="text-slate-500">배정 {item.session_date_label} {item.session_range_text}</span><span className="text-slate-400">배정자 {item.assigned_by || '-'}</span></div>{item.completion_status === 'done' && item.completion_feedback ? <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{item.completion_feedback}</div> : null}{item.completion_status === 'incomplete' && item.incomplete_reason ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{item.incomplete_reason}</div> : null}<div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto]"><select className="input" value={statusDraft.completion_status} onChange={(event) => patchStatusDraft(item, { completion_status: event.target.value })}><option value="pending">확인 대기</option><option value="done">해결 완료</option><option value="incomplete">미해결</option></select>{statusDraft.completion_status === 'done' ? <input className="input" value={statusDraft.completion_feedback} onChange={(event) => patchStatusDraft(item, { completion_feedback: event.target.value })} placeholder="처리 내용" /> : statusDraft.completion_status === 'incomplete' ? <input className="input" value={statusDraft.incomplete_reason} onChange={(event) => patchStatusDraft(item, { incomplete_reason: event.target.value })} placeholder="미해결 사유" /> : <div />}<button className="btn-ghost" type="button" disabled={savingStateKey === key} onClick={() => saveStatus(item)}>{savingStateKey === key ? '저장 중...' : '상태 저장'}</button></div><div className="mt-3"><button type="button" className="text-xs font-bold text-violet-700" onClick={() => { if (editing) { setReassignKey(''); setTargetMentor(''); } else { setReassignKey(key); setTargetMentor(item.mentor_name || clinicMentors[0] || ''); } }}>{editing ? '재배정 닫기' : '다른 클리닉 멘토로 재배정'}</button>{editing ? <div className="mt-2 flex gap-2"><select className="input flex-1" value={targetMentor} onChange={(event) => setTargetMentor(event.target.value)}>{clinicMentors.map((name) => <option key={name}>{name}</option>)}</select><button className="btn-primary" type="button" disabled={!targetMentor || savingKey === key} onClick={() => reassign(item)}>{savingKey === key ? '저장 중...' : '재배정'}</button></div> : null}</div></article>;})}{!filtered.length ? <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400 lg:col-span-2">조건에 맞는 질문이 없습니다.</div> : null}</div>
      </section>
    </div>
  );
}
