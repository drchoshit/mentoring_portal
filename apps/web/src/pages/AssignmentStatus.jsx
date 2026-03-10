import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일', '-'];

const ROLE_LABEL = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '클리닉 멘토',
  admin: '관리자',
  parent: '학부모'
};

function toRoundLabel(label) {
  return String(label || '').replace(/주차/g, '회차');
}

function fmtDateTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function daySortValue(day) {
  const idx = DAY_ORDER.indexOf(String(day || '').trim());
  return idx < 0 ? 999 : idx;
}

function groupAssignments(items) {
  const mentorMap = new Map();
  for (const row of Array.isArray(items) ? items : []) {
    const mentorName = String(row?.mentor_name || '').trim() || '미배정';
    const mentorRole = String(row?.mentor_role || '').trim() || 'mentor';
    if (!mentorMap.has(mentorName)) {
      mentorMap.set(mentorName, {
        mentor_name: mentorName,
        mentor_role: mentorRole,
        days: new Map()
      });
    }
    const mentorEntry = mentorMap.get(mentorName);
    const day = String(row?.day_label || '-').trim() || '-';
    if (!mentorEntry.days.has(day)) mentorEntry.days.set(day, []);
    mentorEntry.days.get(day).push(row);
  }

  const grouped = Array.from(mentorMap.values()).map((mentorEntry) => ({
    ...mentorEntry,
    day_groups: Array.from(mentorEntry.days.entries())
      .map(([day, list]) => ({
        day,
        items: list.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || '')))
      }))
      .sort((a, b) => daySortValue(a.day) - daySortValue(b.day))
  }));

  grouped.sort((a, b) => String(a.mentor_name || '').localeCompare(String(b.mentor_name || '')));
  return grouped;
}

export default function AssignmentStatus() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(sp.get('week') || '');
  const [rows, setRows] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setQueryParams(patch) {
    const cur = Object.fromEntries([...sp.entries()]);
    const next = { ...cur, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] == null || next[k] === '') delete next[k];
    });
    setSp(next, { replace: true });
  }

  async function loadStatus(targetWeekId) {
    if (!targetWeekId) return;
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/mentoring/assignment-status?weekId=${encodeURIComponent(targetWeekId)}`);
      setRows(Array.isArray(data?.assignments) ? data.assignments : []);
      setViewer(data?.viewer || null);
    } catch (e) {
      setError(e?.message || '배정현황을 불러오지 못했습니다.');
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
      setWeeks(weekList);

      const hasWeek = weekId && weekList.some((x) => String(x.id) === String(weekId));
      const effectiveWeekId = hasWeek
        ? String(weekId)
        : (weekList[weekList.length - 1]?.id ? String(weekList[weekList.length - 1].id) : '');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => groupAssignments(rows), [rows]);
  const weekLabel = useMemo(() => {
    const found = (weeks || []).find((w) => String(w.id) === String(weekId));
    return found ? toRoundLabel(found.label) : '';
  }, [weeks, weekId]);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-800">배정현황</div>
            <div className="text-sm text-slate-600">
              {user?.role === 'mentor'
                ? '클리닉 멘토 본인에게 배정된 학생 목록을 요일별로 확인합니다.'
                : '멘토 배정 현황을 멘토/요일 기준으로 확인합니다.'}
            </div>
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
              {(weeks || []).map((w) => (
                <option key={w.id} value={w.id}>
                  {toRoundLabel(w.label)}
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
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>

      {busy ? (
        <div className="card p-5 text-sm text-slate-600">불러오는 중...</div>
      ) : grouped.length ? (
        grouped.map((mentorGroup) => (
          <div key={mentorGroup.mentor_name} className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold text-slate-900">{mentorGroup.mentor_name}</div>
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

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {mentorGroup.day_groups.map((dayGroup) => (
                <div key={`${mentorGroup.mentor_name}-${dayGroup.day}`} className="rounded-2xl border border-slate-200 bg-white/75 p-3">
                  <div className="text-sm font-semibold text-brand-800">{dayGroup.day}요일</div>
                  <div className="mt-2 space-y-2">
                    {dayGroup.items.map((item) => (
                      <div key={`${item.week_record_id}-${item.student_id}`} className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                        <div className="text-sm font-medium text-slate-900">
                          {item.external_id ? `${item.external_id} · ` : ''}
                          {item.student_name || '-'}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          일정: {item.session_date_label} / {item.session_range_text}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          배정일시: {fmtDateTime(item.assigned_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="card p-5 text-sm text-slate-600">해당 회차에 배정된 학생이 없습니다.</div>
      )}
    </div>
  );
}
