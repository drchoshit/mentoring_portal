import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE, api } from '../api.js';

const DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일', '-'];
const DAY_OPTIONS = ['월', '화', '수', '목', '금', '토', '일'];
const JS_DAY_TO_KO = ['일', '월', '화', '수', '목', '금', '토'];

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

function groupAssignments(items) {
  const mentorMap = new Map();
  for (const row of Array.isArray(items) ? items : []) {
    const mentorName = String(row?.mentor_name || '').trim() || '미배정';
    const mentorRole = String(row?.mentor_role || '').trim() || 'mentor';

    if (!mentorMap.has(mentorName)) {
      mentorMap.set(mentorName, {
        mentor_name: mentorName,
        mentor_role: mentorRole,
        items: []
      });
    }
    mentorMap.get(mentorName).items.push(row);
  }

  const grouped = Array.from(mentorMap.values()).map((mentor) => {
    const sortedItems = [...mentor.items].sort((a, b) => {
      const scheduleDiff = scheduleSortValue(a) - scheduleSortValue(b);
      if (scheduleDiff !== 0) return scheduleDiff;

      const studentCmp = String(a.student_name || '').localeCompare(String(b.student_name || ''));
      if (studentCmp !== 0) return studentCmp;

      return String(a.external_id || '').localeCompare(String(b.external_id || ''));
    });

    return {
      ...mentor,
      items: sortedItems
    };
  });

  grouped.sort((a, b) => String(a.mentor_name || '').localeCompare(String(b.mentor_name || '')));
  return grouped;
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
  const isDirector = viewer?.role === 'director';
  const canUpdateState = Boolean(viewer?.role && viewer.role !== 'parent');
  const canIssueBriefing = ['director', 'lead', 'admin'].includes(String(viewer?.role || '').trim());

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

  const grouped = useMemo(() => groupAssignments(rows), [rows]);
  const mentorOptions = useMemo(() => {
    return grouped.map((group) => ({
      mentor_name: String(group?.mentor_name || '').trim(),
      mentor_role: String(group?.mentor_role || '').trim() || 'mentor'
    })).filter((row) => row.mentor_name);
  }, [grouped]);
  const weekLabel = useMemo(() => {
    const found = (weeks || []).find((w) => String(w.id) === String(weekId));
    return found ? toRoundLabel(found.label) : '';
  }, [weeks, weekId]);

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

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-800">배정현황</div>
            <div className="text-sm text-slate-600">
              멘토별 배정 목록을 예정 시간순으로 확인합니다.
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
        {canIssueBriefing ? (
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
        grouped.map((mentorGroup) => (
          <div key={mentorGroup.mentor_name} className="card p-5">
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
                const isEditing = isDirector && editingKey === rowKey;
                const isDoneEditing = doneEditKey === rowKey;
                const isIncompleteEditing = incompleteEditKey === rowKey;
                const isStateSaving = stateSavingKey === rowKey;
                const status = normalizeCompletionStatus(item?.completion_status);
                const completionFeedback = String(item?.completion_feedback || '').trim();
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
                        {isDirector ? (
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
                          <select
                            className="input mt-1 h-8"
                            value={editForm.session_day_label}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, session_day_label: e.target.value }))}
                          >
                            <option value="">선택</option>
                            {DAY_OPTIONS.map((day) => (
                              <option key={`edit-day-${rowKey}-${day}`} value={day}>{day}</option>
                            ))}
                          </select>
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
    </div>
  );
}
