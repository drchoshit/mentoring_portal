// Mentoring.jsx (FULL REPLACEMENT)
// ?�번 반영: (1) 그라?�이???�거 + ?��? ?�색 ?�색 배경
//          (2) ?�생 ?�보 ?�역 분리 ???�적/?�신 카드 ?�에 가로형 ?�력 �?//          (3) ?�드 모음: ?�드�??��? ?�성/목록 + ?�장/총괄/관리자 ??�� 버튼
//          (4) 과제?�행???�력 ?�역 ?�이 = ?�옆 textarea 카드 ?�이?� ?�일
//          (5) 모든 ???�역(최외�?card) ?�두�? ??굵고 진한 골드
//          (6) 과목 ?�환 ???�동?�??+ 과목 ?�??버튼?� "모든 과목" ?�괄 ?�??// ?�른 기능?��? ?��?(캘린???�크?�로???�드 ?�송/과목 추�?/주간 과제·?�드�??�쇄/과거기록)

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { API_BASE, api, getToken } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };

const ROLE_KO = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '학습멘토',
  admin: '관리자',
  parent: '학부모'
};
const ROLE_ORDER = {
  director: 0,
  lead: 1,
  admin: 2,
  mentor: 3,
  parent: 4
};

const SUBJECT_FIELD_KEYS = ['a_curriculum', 'a_last_hw', 'a_hw_exec', 'a_progress', 'a_this_hw', 'a_comment'];
const SUBJECT_TONES = [
  'border-emerald-200/60 bg-emerald-50/35',
  'border-teal-200/60 bg-teal-50/35',
  'border-rose-200/60 bg-rose-50/30',
  'border-violet-200/60 bg-violet-50/30',
  'border-sky-200/60 bg-sky-50/30'
];
const SUBJECT_INNER_TONES = [
  'border-emerald-100/80 bg-emerald-50/55',
  'border-teal-100/80 bg-teal-50/55',
  'border-rose-100/80 bg-rose-50/50',
  'border-violet-100/80 bg-violet-50/50',
  'border-sky-100/80 bg-sky-50/50'
];

function safeJson(v, fallback) {
  try {
    return JSON.parse(v || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function fmtKoreanDateTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function fmtMD(d) {
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${m}/${dd}`;
}

function fmtWeekLabel(week) {
  if (!week) return '';
  const start = parseDateOnly(week.start_date);
  const end = parseDateOnly(week.end_date);
  if (start && end) return `${week.label} (${fmtMD(start)}~${fmtMD(end)})`;
  return week.label || '';
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
  if (Array.isArray(value)) return value.map(normalizeLastHwTask);
  if (typeof value === 'object') {
    const arr = value.tasks || value.items || value.list;
    if (Array.isArray(arr)) return arr.map(normalizeLastHwTask);
  }
  const raw = String(value);
  const parsed = safeJson(raw, null);
  if (Array.isArray(parsed)) return parsed.map(normalizeLastHwTask);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((text) => ({ text, done: null, progress: '' }));
}

function serializeLastHwTasks(tasks) {
  const cleaned = (tasks || []).map((t) => ({
    text: String(t?.text || '').trim(),
    done: t?.done === true ? true : t?.done === false ? false : null,
    progress: t?.done === false ? String(t?.progress || '') : ''
  }));
  return cleaned.length ? JSON.stringify(cleaned) : '';
}

function getPerm(perms, field_key) {
  const p = (perms || []).find((x) => x.field_key === field_key);
  const roles_view = p?.roles_view || safeJson(p?.roles_view_json, []);
  const roles_edit = p?.roles_edit || safeJson(p?.roles_edit_json, []);
  return {
    label: p?.label || field_key,
    roles_view: Array.isArray(roles_view) ? roles_view : [],
    roles_edit: Array.isArray(roles_edit) ? roles_edit : []
  };
}

function canEdit(perms, role, field_key) {
  const p = getPerm(perms, field_key);
  return (p.roles_edit || []).includes(role);
}

function canView(perms, role, field_key) {
  const p = getPerm(perms, field_key);
  return (p.roles_view || []).includes(role);
}

// ??�� 기반 ??권한 가?�화)
function toneByRoles(roles) {
  const rs = new Set(roles || []);
  if (rs.has('director')) {
    return {
      shell: 'border-slate-200/80 bg-slate-50/70',
      badge: 'border-slate-200 bg-slate-100 text-slate-800'
    };
  }
  if (rs.has('lead')) {
    return {
      shell: 'border-emerald-200 bg-emerald-50/70',
      badge: 'border-emerald-200 bg-emerald-100/70 text-emerald-900'
    };
  }
  if (rs.has('mentor')) {
    return {
      shell: 'border-violet-200 bg-violet-50/70',
      badge: 'border-violet-200 bg-violet-100/70 text-violet-900'
    };
  }
  if (rs.has('admin')) {
    return {
      shell: 'border-slate-200 bg-slate-50/70',
      badge: 'border-slate-200 bg-slate-100 text-slate-800'
    };
  }
  return {
    shell: 'border-slate-200 bg-white/60',
    badge: 'border-slate-200 bg-white text-slate-700'
  };
}

function RoleTag({ role, active }) {
  const cls = active ? 'border-brand-900 bg-brand-900 text-white' : 'border-slate-200 bg-white text-slate-700';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>
      {ROLE_KO[role] || role}
    </span>
  );
}

function AutoGrowTextarea({ value, onValueChange, onBlur, disabled, minHeight = 240 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    const next = Math.max(ref.current.scrollHeight, minHeight);
    ref.current.style.height = `${next}px`;
  }, [value, minHeight]);

  return (
    <textarea
      ref={ref}
      className="textarea mt-3 w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 focus:ring-0 focus:border-transparent"
      value={value}
      onChange={(e) => {
        const el = e.target;
        el.style.height = 'auto';
        const next = Math.max(el.scrollHeight, minHeight);
        el.style.height = `${next}px`;
        onValueChange?.(e.target.value);
      }}
      onBlur={onBlur}
      disabled={disabled}
      rows={1}
      style={{ minHeight }}
    />
  );
}

function LastHwTasksEditor({ value, editable, percentOptions, onChangeValue, onBlur, showProgress = true }) {
  const [tasks, setTasks] = useState(() => parseLastHwTasks(value));

  useEffect(() => {
    setTasks(parseLastHwTasks(value));
  }, [value]);

  function commit(next) {
    setTasks(next);
    onChangeValue?.(serializeLastHwTasks(next));
  }

  function updateTask(idx, patch) {
    const next = tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    commit(next);
  }

  function addTask() {
    commit([...(tasks || []), { text: '', done: null, progress: '' }]);
  }

  function removeTask(idx) {
    const next = tasks.filter((_, i) => i !== idx);
    commit(next);
  }

  if (!editable) {
    const list = parseLastHwTasks(value);
    return (
      <div className="mt-3 space-y-2">
        {list.length ? (
          list.map((t, idx) => (
            <div key={`${t.text}-${idx}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm">
              <div className="flex-1 whitespace-pre-wrap text-slate-900">{t.text}</div>
              {t.done === true ? (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
                  완료
                </span>
              ) : t.done === false ? (
                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800">
                  진행중{showProgress && t.progress ? ` · ${t.progress}` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                  상태 미선택
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="text-sm text-slate-500">기록 없음</div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {tasks.map((t, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-start">
          <div className={showProgress ? 'col-span-12 lg:col-span-6' : 'col-span-12 lg:col-span-7'}>
            <input
              className="input"
              value={t.text || ''}
              placeholder="과제 입력"
              onChange={(e) => updateTask(idx, { text: e.target.value })}
              onBlur={onBlur}
            />
          </div>
          <div className={showProgress ? 'col-span-12 lg:col-span-3 flex gap-2' : 'col-span-12 lg:col-span-4 flex gap-2'}>
            <button
              type="button"
              className={['btn', t.done === true ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-700'].join(' ')}
              onClick={() => updateTask(idx, { done: true, progress: '' })}
              onBlur={onBlur}
            >
              완료
            </button>
            <button
              type="button"
              className={['btn', t.done === false ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200 text-slate-700'].join(' ')}
              onClick={() => updateTask(idx, { done: false })}
              onBlur={onBlur}
            >
              진행중
            </button>
          </div>
          {showProgress ? (
            <div className="col-span-12 lg:col-span-2">
              {t.done === false ? (
                <select
                  className="input"
                  value={t.progress || ''}
                  onChange={(e) => updateTask(idx, { progress: e.target.value })}
                  onBlur={onBlur}
                >
                  {percentOptions.map((v) => (
                    <option key={v || '__empty__'} value={v}>
                      {v || '선택'}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-slate-500 pt-2">이행도 선택</div>
              )}
            </div>
          ) : null}
          <div className="col-span-12 lg:col-span-1 flex justify-end">
            <button type="button" className="btn-ghost text-red-700" onClick={() => removeTask(idx)}>
              삭제
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="btn-ghost text-brand-800" onClick={addTask}>
        과제 추가
      </button>
    </div>
  );
}
function FieldShell({ title, subtitle, editRoles, currentRole, right, children, className = '' }) {
  const tone = toneByRoles(editRoles);
  const roles = Array.isArray(editRoles) ? editRoles : [];
  const active = roles.includes(currentRole);

  return (
    <div className={['rounded-2xl border p-5 shadow-sm backdrop-blur', tone.shell, className].join(' ')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-brand-900">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-slate-600">{subtitle}</div> : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-600">편집 가능</span>
            {roles.length ? roles.map((r) => <RoleTag key={r} role={r} active={r === currentRole} />) : <span className="text-[11px] text-slate-500">없음</span>}
            <span className={['ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]', tone.badge].join(' ')}>
              {active ? '현재 역할 편집 가능' : '읽기 전용'}
            </span>
          </div>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}

function confirmOrThrow(message) {
  const ok = window.confirm(message);
  if (!ok) throw new Error('__CANCEL__');
}

function PageBackground() {
  return (
    <div className="fixed inset-0 -z-10 bg-gradient-to-b from-stone-50 to-stone-200" />
  );
}

function GoldCard({ className = '', children }) {
  return (
    <div className={['card border-2 border-[#b58a2a] bg-white/70 shadow-sm', className].join(' ')}>
      {children}
    </div>
  );
}

export default function Mentoring() {
  const { studentId } = useParams();
  const [sp, setSp] = useSearchParams();
  const { user } = useAuth();

  const [weeks, setWeeks] = useState([]);
  const [weekId, setWeekId] = useState(sp.get('week') || '');
  const [perms, setPerms] = useState([]);
  const [rec, setRec] = useState(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [recipients, setRecipients] = useState([]);
  const [feedForm, setFeedForm] = useState({ to_user_id: '', target_field: '', title: '', body: '' });
  const [studentFeeds, setStudentFeeds] = useState([]);
  const [feedsError, setFeedsError] = useState('');

  const [newSubject, setNewSubject] = useState('');
  const [showCalendar, setShowCalendar] = useState(true);

  // 과목 ?�력 보존/?�동?�?�용 draft
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const draftScopeRef = useRef('');
  const profileRef = useRef(null);

  const parentMode = user?.role === 'parent';
  const weekRecordId = rec?.week_record?.id;

  function setQueryParams(patch) {
    const cur = Object.fromEntries([...sp.entries()]);
    const next = { ...cur, ...patch };
    Object.keys(next).forEach((k) => {
      if (next[k] === '' || next[k] == null) delete next[k];
    });
    setSp(next, { replace: true });
  }

  async function loadStudentFeeds() {
    setFeedsError('');
    try {
      const data = await api(`/api/feeds?studentId=${encodeURIComponent(studentId)}&limit=300`);
      setStudentFeeds(Array.isArray(data?.feeds) ? data.feeds : []);
    } catch {
      setStudentFeeds([]);
      setFeedsError('피드 모음을 불러오지 못했습니다.');
    }
  }

  async function loadAll() {
    setError('');
    try {
      const w = await api('/api/weeks');
      setWeeks(w.weeks || []);

      const p = await api('/api/permissions');
      setPerms(p.permissions || []);

      if (user?.role && user.role !== 'parent') {
        const rcp = await api('/api/feeds/recipients');
        setRecipients(rcp.recipients || []);
      }

      const effectiveWeek = weekId || (w.weeks?.[0]?.id ? String(w.weeks[0].id) : '');
      if (!weekId && effectiveWeek) {
        setWeekId(effectiveWeek);
        setQueryParams({ week: effectiveWeek });
      }

      if (effectiveWeek) {
        const r = await api(
          `/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(effectiveWeek)}`
        );
        setRec(r);
      }

      await loadStudentFeeds();
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  // subjectDrafts 초기??병합: 주차 ?�는 ?�생??바뀌면 reset, 같�? 범위�??�규 과목�?추�?
  useEffect(() => {
    if (!rec?.subject_records) return;
    const scopeKey = `${studentId}:${weekId || ''}`;
    const records = rec.subject_records || [];

    const build = () => {
      const next = {};
      for (const r of records) {
        const id = String(r.id);
        next[id] = {};
        for (const k of SUBJECT_FIELD_KEYS) next[id][k] = r?.[k] ?? '';
      }
      return next;
    };

    if (draftScopeRef.current !== scopeKey) {
      draftScopeRef.current = scopeKey;
      setSubjectDrafts(build());
      return;
    }

    // 같�? 범위�? ?�는 과목�?채�?
    setSubjectDrafts((prev) => {
      const next = { ...(prev || {}) };
      for (const r of records) {
        const id = String(r.id);
        if (!next[id]) {
          next[id] = {};
          for (const k of SUBJECT_FIELD_KEYS) next[id][k] = r?.[k] ?? '';
        }
      }
      return next;
    });
  }, [rec?.subject_records, studentId, weekId]);

  async function changeWeek(id) {
    setWeekId(id);
    setQueryParams({ week: id });
    try {
      const r = await api(
        `/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(id)}`
      );
      setRec(r);

      await loadStudentFeeds();
    } catch (e) {
      setError(e.message);
    }
  }

  async function openPrintPage() {
    if (!weekId) {
      setError('주차를 먼저 선택해 주세요.');
      return;
    }

    let popup = null;
    try {
      popup = window.open('about:blank', '_blank');
      if (!popup) throw new Error('팝업이 차단되었습니다. 팝업 차단을 해제해 주세요.');

      popup.document.write(
        '<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family: Malgun Gothic, sans-serif; padding: 20px;">인쇄 페이지를 준비 중입니다...</body></html>'
      );
      popup.document.close();

      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const url = `${API_BASE}/api/print?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(weekId)}&autoprint=1`;
      const res = await fetch(url, { method: 'GET', headers });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          msg = data?.error || data?.message || msg;
        } catch {}
        throw new Error(msg);
      }

      const html = await res.text();
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
    } catch (e) {
      if (popup && !popup.closed) {
        popup.document.open();
        popup.document.write(
          `<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family: Malgun Gothic, sans-serif; padding: 20px;">인쇄 페이지를 열지 못했습니다.<br/><br/>${String(e?.message || '알 수 없는 오류')}</body></html>`
        );
        popup.document.close();
      }
      setError(e?.message || '인쇄 페이지를 열지 못했습니다.');
    }
  }

  const schedule = useMemo(() => safeJson(rec?.student?.schedule_json, {}), [rec]);
  const scheduleWeekStart = schedule?.week_start || rec?.week?.start_date || '';
  const dailyTasksValue = useMemo(() => safeJson(rec?.week_record?.b_daily_tasks, {}), [rec]);
  const dailyFeedbackValue = useMemo(() => safeJson(rec?.week_record?.b_lead_daily_feedback, {}), [rec]);
  const [dailyTasksDraft, setDailyTasksDraft] = useState(dailyTasksValue);
  const [dailyFeedbackDraft, setDailyFeedbackDraft] = useState(dailyFeedbackValue);
  const [leadWeeklyDraft, setLeadWeeklyDraft] = useState(rec?.week_record?.c_lead_weekly_feedback || '');
  const [directorCommentDraft, setDirectorCommentDraft] = useState(rec?.week_record?.c_director_commentary || '');

  useEffect(() => setDailyTasksDraft(dailyTasksValue), [dailyTasksValue]);
  useEffect(() => setDailyFeedbackDraft(dailyFeedbackValue), [dailyFeedbackValue]);
  useEffect(() => setLeadWeeklyDraft(rec?.week_record?.c_lead_weekly_feedback || ''), [rec?.week_record?.c_lead_weekly_feedback]);
  useEffect(() => setDirectorCommentDraft(rec?.week_record?.c_director_commentary || ''), [rec?.week_record?.c_director_commentary]);

  // 보기 ?�책: parent�?server-permission 기반, �??�는 "?�션?� ?�출"
  const canEditA = (field) => canEdit(perms, user?.role, field);
  const canViewA = (field) => (parentMode ? canView(perms, user?.role, field) : true);

  async function addSubject() {
    if (!newSubject.trim()) return;
    setBusy(true);
    try {
      confirmOrThrow('과목을 추가할까요?');
      await api(`/api/mentoring/subjects/${studentId}`, { method: 'POST', body: { name: newSubject.trim() } });
      setNewSubject('');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSubject(subjectId, subjectName) {
    if (!subjectId) return;
    setBusy(true);
    try {
      const label = subjectName ? `"${subjectName}"` : '해당 과목';
      confirmOrThrow(`과목 ${label} 삭제할까요?`);
      await api(`/api/mentoring/subjects/${studentId}/${subjectId}`, { method: 'DELETE' });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveWeekRecord(patch) {
    if (!weekRecordId) return;
    setBusy(true);
    try {
      confirmOrThrow('주간 기록을 저장할까요?');
      await api(`/api/mentoring/week-record/${weekRecordId}`, { method: 'PUT', body: patch });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function autoSaveWeekRecord(patch) {
    if (!weekRecordId || parentMode) return;
    try {
      await api(`/api/mentoring/week-record/${weekRecordId}`, { method: 'PUT', body: patch });
    } catch (e) {
      setError(e?.message || '주간 기록 저장에 실패했습니다.');
    }
  }

  async function doMentorSubmit() {
    setBusy(true);
    try {
      confirmOrThrow('학습멘토 제출을 진행할까요?');
      await api('/api/mentoring/workflow/submit', {
        method: 'POST',
        body: { student_id: Number(studentId), week_id: Number(weekId) }
      });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doShare() {
    setBusy(true);
    try {
      confirmOrThrow('해당 주차 기록을 학부모와 공유할까요?');
      if (weekRecordId) {
        await api(`/api/mentoring/week-record/${weekRecordId}`, {
          method: 'PUT',
          body: { shared_with_parent: 1 }
        });
      } else {
        await api('/api/mentoring/workflow/share-with-parent', {
          method: 'POST',
          body: { student_id: Number(studentId), week_id: Number(weekId) }
        });
      }
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [leadReason, setLeadReason] = useState('');
  async function submitToDirector() {
    setBusy(true);
    try {
      confirmOrThrow('원장께 제출할까요?');
      await api('/api/mentoring/workflow/submit-to-director', {
        method: 'POST',
        body: { student_id: Number(studentId), week_id: Number(weekId), reason: leadReason }
      });
      setLeadReason('');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [directorNote, setDirectorNote] = useState('');
  async function sendToLead() {
    setBusy(true);
    try {
      confirmOrThrow('총괄멘토에게 전송할까요?');
      await api('/api/mentoring/workflow/send-to-lead', {
        method: 'POST',
        body: { student_id: Number(studentId), week_id: Number(weekId), note: directorNote }
      });
      setDirectorNote('');
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const fieldOptions = useMemo(() => {
    return (perms || []).map((p) => ({ key: p.field_key, label: p.label || p.field_key }));
  }, [perms]);

  // 받는 ?�??구성:
  // - ?�버 recipients?�서 role==='mentor'???�외
  // - ?�??"?�습멘토(?�체기록)" = ?�재 로그???�용??id) ?�션 추�?(멘토 계정????
  const recipientOptions = useMemo(() => {
    const base = Array.isArray(recipients) ? recipients.filter((r) => r.role !== 'mentor') : [];
    const out = [...base];

    if (user?.id && user?.role === 'mentor') {
      out.unshift({
        id: user.id,
        role: 'mentor',
        display_name: '학습멘토(전체기록)'
      });
    }
    return out;
  }, [recipients, user?.id, user?.role]);

  async function sendFeed(e) {
    e.preventDefault();
    if (!feedForm.to_user_id || !feedForm.title.trim() || !feedForm.body.trim()) return;

    setBusy(true);
    try {
      confirmOrThrow('피드를 전송할까요?');
      await api('/api/feeds', {
        method: 'POST',
        body: {
          to_user_id: Number(feedForm.to_user_id),
          student_id: Number(studentId),
          target_field: feedForm.target_field || null,
          title: feedForm.title.trim(),
          body: feedForm.body
        }
      });
      setFeedForm({ to_user_id: '', target_field: '', title: '', body: '' });
      await loadStudentFeeds();
    } catch (e2) {
      if (e2?.message !== '__CANCEL__') setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function addFeedComment(feedId, body) {
    if (!body.trim()) return;
    try {
      await api(`/api/feeds/${feedId}/comments`, { method: 'POST', body: { body } });
      await loadStudentFeeds();
    } catch (e) {
      setFeedsError(e?.message || '피드 댓글 등록에 실패했습니다.');
    }
  }

  async function deleteFeed(feedId) {
    try {
      confirmOrThrow('피드를 삭제할까요?');
      await api(`/api/feeds/${feedId}`, { method: 'DELETE' });
      await loadStudentFeeds();
    } catch (e) {
      if (e?.message === '__CANCEL__') return;
      setFeedsError(e?.message || '피드 삭제에 실패했습니다.');
    }
  }

  // 과목 기록
  const subjectRecords = rec?.subject_records || [];

  function updateSubjectDraft(subjectRecordId, patch) {
    const sid = String(subjectRecordId);
    setSubjectDrafts((prev) => {
      const cur = prev?.[sid] || {};
      return {
        ...(prev || {}),
        [sid]: { ...cur, ...patch }
      };
    });
  }

  async function autoSaveOneSubject(subjectRecordId) {
    const sid = String(subjectRecordId);
    if (!sid) return;
    const draft = subjectDrafts?.[sid];
    if (!draft) return;

    try {
      const body = {};
      for (const k of SUBJECT_FIELD_KEYS) body[k] = draft?.[k] ?? '';
      await api(`/api/mentoring/subject-record/${sid}`, { method: 'PUT', body });
    } catch (e) {
      // 저장 실패 시 draft 유지
      setError(e?.message || '과목 기록 저장에 실패했습니다.');
    }
  }

  async function saveAllSubjectsCore({ confirm = true } = {}) {
    if (parentMode) return;
    if (!subjectRecords.length) return;
    const editableKeys = SUBJECT_FIELD_KEYS.filter((k) => canEdit(perms, user?.role, k));
    if (!editableKeys.length) return;
    if (confirm) confirmOrThrow('모든 과목 진도를 저장할까요?');

    for (const r of subjectRecords) {
      const sid = String(r.id);
      const draft = subjectDrafts?.[sid] || {};
      const body = {};
      for (const k of editableKeys) body[k] = draft?.[k] ?? '';
      await api(`/api/mentoring/subject-record/${sid}`, { method: 'PUT', body });
    }
  }

  async function saveAllSubjects() {
    setBusy(true);
    try {
      await saveAllSubjectsCore({ confirm: true });
      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (parentMode) return;
    if (!weekRecordId) {
      setError('주차를 먼저 선택해 주세요.');
      return;
    }

    setError('');
    setBusy(true);
    try {
      confirmOrThrow('전체 저장할까요?');
      const patch = {};
      if (canEditA('b_daily_tasks')) patch.b_daily_tasks = dailyTasksDraft;
      if (canEditA('b_lead_daily_feedback')) patch.b_lead_daily_feedback = dailyFeedbackDraft;
      if (canEditA('c_lead_weekly_feedback')) patch.c_lead_weekly_feedback = leadWeeklyDraft;
      if (canEditA('c_director_commentary')) patch.c_director_commentary = directorCommentDraft;

      if (Object.keys(patch).length) {
        await api(`/api/mentoring/week-record/${weekRecordId}`, {
          method: 'PUT',
          body: patch
        });
      }

      await saveAllSubjectsCore({ confirm: false });

      if (profileRef.current?.saveProfile && user?.role !== 'parent') {
        await profileRef.current.saveProfile({ confirm: false, manageBusy: false });
      }

      await loadAll();
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e?.message || '전체 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }


  // ?�드 3??분해
  const groupedFeeds = useMemo(() => {
    const arr = Array.isArray(studentFeeds) ? [...studentFeeds] : [];
    arr.sort((a, b) => {
      const ra = ROLE_ORDER[a?.from_role] ?? 99;
      const rb = ROLE_ORDER[b?.from_role] ?? 99;
      if (ra !== rb) return ra - rb;
      const ta = new Date(a?.created_at || 0).getTime();
      const tb = new Date(b?.created_at || 0).getTime();
      return tb - ta;
    });

    const director = [];
    const lead = [];
    const admin = [];

    for (const f of arr) {
      if (f?.from_role === 'director') director.push(f);
      else if (f?.from_role === 'lead') lead.push(f);
      else admin.push(f); // admin + 기�?(mentor ??
    }
    return { director, lead, admin };
  }, [studentFeeds]);

  if (!rec) {
    return (
      <div className="relative">
        <PageBackground />
        <GoldCard className="p-5">
          <div className="text-sm text-slate-700">데이터를 불러오는 중...</div>
          {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
        </GoldCard>
      </div>
    );
  }

  return (
    <div className="relative">
      <PageBackground />

      <div className="space-y-6 pb-10">
        <GoldCard className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-brand-900">멘토링 기록</div>
              <div className="text-sm text-slate-800">
                {rec.student.name} · {rec.student.grade || ''}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select className="input w-44" value={weekId} onChange={(e) => changeWeek(e.target.value)}>
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {fmtWeekLabel(w) || w.label}
                  </option>
                ))}
              </select>
              <button className="btn-ghost" type="button" onClick={openPrintPage}>
                인쇄
              </button>
              <button className="btn-ghost" onClick={loadAll}>
                새로고침
              </button>
            </div>
          </div>
          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </GoldCard>

        {/* (2) 학생 정보 분리(가로형) + (성적/내신은 아래 카드) */}
        <StudentProfileSection
          ref={profileRef}
          studentId={studentId}
          profileJson={rec?.student?.profile_json}
          userRole={user?.role}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
        />

        {/* 캘린더 */}
        <GoldCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-brand-900">{rec.student.name} 주간 캘린더</div>
              <div className="text-xs text-slate-700">
                {schedule?.week_range_text ? schedule.week_range_text : '주간 일정 · 가로형'}
              </div>
            </div>
            <button className="btn-ghost" onClick={() => setShowCalendar((v) => !v)}>
              {showCalendar ? '닫기' : '열기'}
            </button>
          </div>

          {showCalendar ? <WeeklyCalendar schedule={schedule} weekStart={scheduleWeekStart} /> : null}
        </GoldCard>

        {/* (3) 피드 모음: 작성 + 목록 */}
        <GoldCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-900">학생 피드 모음</div>
              <div className="text-xs text-slate-700">원장 / 총괄멘토 / 관리자(기록 포함) 분리</div>
            </div>
            <button className="btn-ghost" onClick={loadStudentFeeds}>
              새로고침
            </button>
          </div>

          {feedsError ? <div className="mt-3 text-sm text-red-600">{feedsError}</div> : null}

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <FeedsColumn
              title="원장 피드"
              feeds={groupedFeeds.director}
              currentUser={user}
              onComment={addFeedComment}
              onDelete={deleteFeed}
            />
            <FeedsColumn
              title="총괄멘토 피드"
              feeds={groupedFeeds.lead}
              currentUser={user}
              onComment={addFeedComment}
              onDelete={deleteFeed}
            />
            <FeedsColumn
              title="관리자 피드"
              feeds={groupedFeeds.admin}
              currentUser={user}
              onComment={addFeedComment}
              onDelete={deleteFeed}
            />
          </div>
        </GoldCard>

        {/* 학습 커리큘럼 */}
        <GoldCard className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-900">학습 커리큘럼</div>
              <div className="text-xs text-slate-700">과목 추가 · 가로 스크롤</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input w-64"
                placeholder="새 과목명"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                disabled={parentMode}
              />
              <button className="btn-primary" onClick={addSubject} disabled={busy || parentMode || !newSubject.trim()}>
                과목 추가
              </button>
            </div>
          </div>

          <div className="mt-4">
            <CurriculumStrip
              subjects={subjectRecords}
              perms={perms}
              role={user?.role}
              busy={busy}
              parentMode={parentMode}
              drafts={subjectDrafts}
              onChangeDraft={updateSubjectDraft}
              onAutoSave={autoSaveOneSubject}
            />
          </div>
        </GoldCard>

        {/* 수강 진도 */}
        <GoldCard className="p-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-900">수강 진도 (과목 별)</div>
              <div className="text-xs text-slate-700">과목 추가 · 가로 스크롤</div>
            </div>
            <button
              className="btn-primary"
              disabled={busy || parentMode || !subjectRecords.length}
              type="button"
              onClick={saveAllSubjects}
            >
              저장
            </button>
          </div>

          <div className="mt-4 space-y-6">
            {subjectRecords.map((r, idx) => (
              <SubjectWideEditor
                key={r.id}
                record={r}
                toneClass={SUBJECT_TONES[idx % SUBJECT_TONES.length]}
                innerToneClass={SUBJECT_INNER_TONES[idx % SUBJECT_INNER_TONES.length]}
                perms={perms}
                role={user?.role}
                busy={busy}
                parentMode={parentMode}
                draft={subjectDrafts?.[String(r.id)] || {}}
                onChangeDraft={(patch) => updateSubjectDraft(r.id, patch)}
                onAutoSave={() => autoSaveOneSubject(r.id)}
                onDelete={() => deleteSubject(r.id, r.subject_name)}
              />
            ))}
            {!subjectRecords.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm text-slate-700 shadow-sm">
                과목 추가
              </div>
            ) : null}
          </div>
        </GoldCard>

        {/* 주간 과제/피드백 */}
        <GoldCard className="p-5">
          <div className="text-sm font-semibold text-brand-900">주간 과제/피드백</div>
          <div className="mt-1 text-xs text-slate-700">일일 학습 과제 및 주간 총평, 원장 코멘터리</div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DailyTasksCard
              title="일일 학습 과제"
              fieldKey="b_daily_tasks"
              value={dailyTasksDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('b_daily_tasks')}
              editable={canEditA('b_daily_tasks')}
              onSave={(v) => saveWeekRecord({ b_daily_tasks: v })}
              onAutoSave={(v) => autoSaveWeekRecord({ b_daily_tasks: v })}
              onChangeValue={setDailyTasksDraft}
              busy={busy}
              textareaMinHClass="min-h-[48px]"
              parentMode={parentMode}
            />
            <DailyTasksCard
              title="요일 별 총괄멘토 피드백"
              fieldKey="b_lead_daily_feedback"
              value={dailyFeedbackDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('b_lead_daily_feedback')}
              editable={canEditA('b_lead_daily_feedback')}
              onSave={(v) => saveWeekRecord({ b_lead_daily_feedback: v })}
              onAutoSave={(v) => autoSaveWeekRecord({ b_lead_daily_feedback: v })}
              onChangeValue={setDailyFeedbackDraft}
              busy={busy}
              textareaMinHClass="min-h-[48px]"
              parentMode={parentMode}
            />
          </div>

          <div className="mt-6 space-y-6">
            <TextFieldCard
              title="주간 총괄멘토 피드백"
              fieldKey="c_lead_weekly_feedback"
              value={leadWeeklyDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('c_lead_weekly_feedback')}
              editable={canEditA('c_lead_weekly_feedback')}
              onSave={(txt) => saveWeekRecord({ c_lead_weekly_feedback: txt })}
              onChangeValue={setLeadWeeklyDraft}
              busy={busy}
              textareaMinHClass="min-h-[50px]"
              parentMode={parentMode}
            />
            <TextFieldCard
              title="원장 코멘터리"
              fieldKey="c_director_commentary"
              value={directorCommentDraft}
              perms={perms}
              currentRole={user?.role}
              visible={canViewA('c_director_commentary')}
              editable={canEditA('c_director_commentary')}
              onSave={(txt) => saveWeekRecord({ c_director_commentary: txt })}
              onChangeValue={setDirectorCommentDraft}
              busy={busy}
              textareaMinHClass="min-h-[50px]"
              parentMode={parentMode}
            />
          </div>
        </GoldCard>

        {/* 피드백 공유 */}
        <GoldCard className="p-5">
          <div className="text-sm font-semibold text-brand-900">피드백 공유</div>
            <div className="mt-2 text-xs text-slate-700">학습멘토링 및 총괄멘토링 작성 → 원장/관리자 검토 → 학부모 공유</div>

          <div className="mt-4 flex flex-col gap-3">
            {user?.role === 'mentor' ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-slate-900">학습멘토링 제출</div>
                  <div className="text-xs text-slate-700">총괄/원장에게 완료 피드 전송</div>
                </div>
                <button className="btn-primary" disabled={busy} onClick={doMentorSubmit}>
                  제출
                </button>
              </div>
            ) : null}

            {user?.role === 'lead' ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">원장에게 제출</div>
                    <div className="text-xs text-slate-700">수정/보완할 부분이 있을 경우에만 원장에게 제출</div>
                  </div>
                  <button className="btn-primary" disabled={busy} onClick={submitToDirector}>
                    제출
                  </button>
                </div>
                <textarea
                  className="textarea mt-3 min-h-[70px]"
            placeholder="댓글 입력"
                  value={leadReason}
                  onChange={(e) => setLeadReason(e.target.value)}
                />
              </div>
            ) : null}

            {user?.role === 'director' ? (
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">총괄멘토에게 전송</div>
                    <div className="text-xs text-slate-700">수정 사항/코멘트 전달</div>
                  </div>
                  <button className="btn-primary" disabled={busy} onClick={sendToLead}>
                    전송
                  </button>
                </div>
                <textarea
                  className="textarea mt-3 min-h-[70px]"
            placeholder="댓글 입력"
                  value={directorNote}
                  onChange={(e) => setDirectorNote(e.target.value)}
                />
              </div>
            ) : null}

            {(user?.role === 'lead' || user?.role === 'director' || user?.role === 'admin') ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-slate-900">학부모 공유</div>
                  <div className="text-xs text-slate-700">해당 주차 기록을 학부모가 열람 가능하도록 전환</div>
                </div>
                <button className="btn-primary" disabled={busy} onClick={doShare}>
                  공유
                </button>
              </div>
            ) : null}
          </div>
        </GoldCard>

        {/* 학생 관리 피드백 쓰기 */}
        {user?.role !== 'parent' ? (
          <GoldCard className="p-5">
            <div className="text-sm font-semibold text-brand-900">학생 관리 피드백 쓰기</div>
            <div className="mt-1 text-xs text-slate-700">받는 사람을 선택하고 피드, 제목(필수), 내용을 작성해 전송하세요.</div>

            <form className="mt-3 grid grid-cols-12 gap-3" onSubmit={sendFeed}>
              <div className="col-span-12 md:col-span-3">
                <label className="text-xs text-slate-800">받는 사람</label>
                <select
                  className="input mt-1"
                  value={feedForm.to_user_id}
                  onChange={(e) => setFeedForm({ ...feedForm, to_user_id: e.target.value })}
                >
                  <option value="">선택</option>
                  {recipientOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.display_name} ({ROLE_KO[r.role] || r.role})
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-slate-600">학습멘토(전체기록)는 본인에게 전송되지 않습니다.</div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <label className="text-xs text-slate-800">피드 유형</label>
                <select
                  className="input mt-1"
                  value={feedForm.target_field}
                  onChange={(e) => setFeedForm({ ...feedForm, target_field: e.target.value })}
                >
                  <option value="">(선택 없음)</option>
                  {fieldOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-12 md:col-span-6">
                <label className="text-xs text-slate-800">제목</label>
                <input
                  className="input mt-1"
                  value={feedForm.title}
                  onChange={(e) => setFeedForm({ ...feedForm, title: e.target.value })}
            placeholder="댓글 입력"
                />
                {!feedForm.title.trim() ? <div className="mt-1 text-[11px] text-red-600">제목은 필수입니다.</div> : null}
              </div>

              <div className="col-span-12">
                <label className="text-xs text-slate-800">내용</label>
                <textarea
                  className="textarea mt-1 min-h-[44px]"
                  value={feedForm.body}
                  onChange={(e) => setFeedForm({ ...feedForm, body: e.target.value })}
                />
              </div>

              <div className="col-span-12 flex justify-end">
                <button className="btn-primary" disabled={busy || !feedForm.to_user_id || !feedForm.title.trim() || !feedForm.body.trim()}>
                  전송
                </button>
              </div>
            </form>
          </GoldCard>
        ) : null}

        <GoldCard className="p-5">
          <div className="text-sm font-semibold text-brand-900">과거 기록 보기</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {weeks.map((w) => (
              <a
                key={w.id}
                className="btn-ghost"
                target="_blank"
                rel="noreferrer"
                href={`/students/${encodeURIComponent(studentId)}/mentoring?week=${encodeURIComponent(w.id)}`}
              >
                {w.label}
              </a>
            ))}
          </div>
        </GoldCard>
      </div>
    </div>
  );
}

/* 캘린더 센터/외부/미등원 색상 구분 */
function classifySchedule(it) {
  const type = String(it?.type || '').trim();
  const title = String(it?.title || '').trim();

  const isAbsence = type.includes('미등원') || title.includes('미등원') || type.includes('결석') || title.includes('결석');
  const isCenter = type.includes('센터') || title.includes('센터');
  const isExternal = type.includes('외부') || title.includes('외부');

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
    <div className="mt-4">
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-800">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5">
          센터
        </span>
        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5">
          센터 외
        </span>
        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5">
          결석/미등원
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[980px] grid grid-cols-7 gap-3">
          {DAYS.map((d, idx) => {
            const dateLabel = start
              ? (() => {
                  const day = new Date(start);
                  day.setDate(day.getDate() + idx);
                  return `${DAY_LABELS[d]} (${fmtMD(day)})`;
                })()
              : `${DAY_LABELS[d]} (${d})`;
            return (
            <div key={d} className="rounded-2xl border border-slate-200 bg-white/70 p-3 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">
                {dateLabel}
              </div>

              <div className="mt-2 space-y-2">
                {(Array.isArray(schedule?.[d]) ? schedule[d] : []).length ? (
                  (Array.isArray(schedule?.[d]) ? schedule[d] : []).map((it, idx) => {
                    const kind = classifySchedule(it);
                    return (
                      <div key={idx} className={['rounded-xl border px-3 py-2 shadow-sm', scheduleTone(kind)].join(' ')}>
                        <div className="text-xs text-slate-700 whitespace-nowrap">{it.time || ''}</div>
                        <div className="text-sm text-slate-900 whitespace-pre-wrap">{it.title || ''}</div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm text-slate-700">일정 없음</div>
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

/* 피드 3컬럼 + 피드 작성 + 댓글 */
function FeedsColumn({ title, feeds, currentUser, onComment, onDelete }) {
  const list = Array.isArray(feeds) ? feeds : [];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-700">{list.length}건</div>
      </div>

      <div className="mt-3 space-y-3 max-h-[560px] overflow-auto pr-1">
        {list.length ? (
          list.map((f) => (
            <FeedCard
              key={f.id}
              feed={f}
              currentUser={currentUser}
              onComment={onComment}
              onDelete={onDelete}
            />
          ))
        ) : (
          <div className="text-sm text-slate-700">피드가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function FeedCard({ feed, currentUser, onComment, onDelete }) {
  const fromName = feed?.from_name || '작성자';
  const fromRole = feed?.from_role || '';
  const createdLabel = fmtKoreanDateTime(feed?.created_at);
  const title = feed?.title || '';
  const targetField = feed?.target_field || '';
  const comments = Array.isArray(feed?.comments) ? feed.comments : [];

  const [comment, setComment] = useState('');
  const canDelete =
    ['director', 'lead', 'admin'].includes(currentUser?.role) ||
    (Number(feed?.from_user_id) === Number(currentUser?.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-slate-800">
            {ROLE_KO[fromRole] || fromRole} · {fromName}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600">{createdLabel}</div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {targetField ? (
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
              {targetField}
            </div>
          ) : null}

          {canDelete ? (
            <button className="btn-ghost text-red-700" type="button" onClick={() => onDelete?.(feed.id)}>
              삭제
            </button>
          ) : null}
        </div>
      </div>

      {title ? <div className="mt-2 text-sm font-semibold text-slate-900 whitespace-pre-wrap">{title}</div> : null}
      <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{feed?.body || ''}</div>

      <div className="mt-3 border-t border-slate-200 pt-3">
        <div className="text-[11px] text-slate-700">댓글</div>

        <div className="mt-2 space-y-2">
          {comments.length ? (
            comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-800">
                    {c.from_name} ({ROLE_KO[c.from_role] || c.from_role})
                  </div>
                  <div className="text-[11px] text-slate-600">{fmtKoreanDateTime(c.created_at)}</div>
                </div>
                <div className="mt-1 text-sm text-slate-900 whitespace-pre-wrap">{c.body || ''}</div>
              </div>
            ))
          ) : (
            <div className="text-sm text-slate-700">댓글이 없습니다.</div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1 min-w-0"
            placeholder="댓글 입력"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            className="btn-primary whitespace-nowrap px-4 min-w-[64px]"
            type="button"
            disabled={!comment.trim()}
            onClick={() => {
              onComment?.(feed.id, comment);
              setComment('');
            }}
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

/* 학습 커리큘럼(과목별: 하단 가로 스크롤) */
function CurriculumStrip({ subjects, perms, role, parentMode, busy, drafts, onChangeDraft, onAutoSave }) {
  const fieldKey = 'a_curriculum';
  const perm = getPerm(perms, fieldKey);
  const editRoles = perm.roles_edit || [];
  const editable = canEdit(perms, role, fieldKey) && !parentMode;
  const visible = parentMode ? canView(perms, role, fieldKey) : true;
  const tone = toneByRoles(editRoles);
  const list = Array.isArray(subjects) ? subjects : [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700 shadow-sm">
        권한 설정에 의해 숨김
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max pb-1">
        {list.map((r, idx) => {
          const sid = String(r.id);
          const val = drafts?.[sid]?.[fieldKey] ?? '';
          const subjectTone = SUBJECT_TONES[idx % SUBJECT_TONES.length];

          return (
            <div key={r.id} className="shrink-0 w-[240px]">
              <div className={['rounded-2xl border p-3 shadow-sm', subjectTone].join(' ')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 break-words">{r.subject_name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(editRoles || []).map((rKey) => (
                        <RoleTag key={rKey} role={rKey} active={rKey === role} />
                      ))}
                    </div>
                  </div>
                  <div className={['shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[11px]', tone.badge].join(' ')}>
                    {editable ? '편집' : '읽기'}
                  </div>
                </div>

                <textarea
                  className="textarea mt-3 min-h-[140px] whitespace-pre-wrap break-words"
                  value={val}
                  onChange={(e) => onChangeDraft?.(r.id, { [fieldKey]: e.target.value })}
                  onBlur={() => {
                    if (editable) onAutoSave?.(r.id);
                  }}
                  disabled={!editable || busy}
                />

                {!editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
              </div>
            </div>
          );
        })}
        <div className="text-xs text-slate-700">{list.length}건</div>
      </div>
    </div>
  );
}

/* 과목별 편집: 가로 정렬 레이아웃 */
function SubjectWideEditor({ record, perms, role, busy, parentMode, draft, onChangeDraft, onAutoSave, onDelete, toneClass = '', innerToneClass = '' }) {
  const canEditField = (k) => canEdit(perms, role, k);
  const canViewField = (k) => (parentMode ? canView(perms, role, k) : true);
  const [localDraft, setLocalDraft] = useState(() => draft || {});
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setLocalDraft(draft || {});
    if (record?.id) dirtyRef.current = false;
  }, [draft, record?.id]);

  function editRolesOf(k) {
    const p = getPerm(perms, k);
    return p.roles_edit || [];
  }

  function buildField(k, label, type) {
    if (!canViewField(k)) return null;
    const editRoles = editRolesOf(k);
    return {
      k,
      label,
      type,
      editable: canEditField(k) && !parentMode,
      editRoles,
      tone: toneByRoles(editRoles),
      val: localDraft?.[k] ?? ''
    };
  }

  const lastHw = buildField('a_last_hw', '지난주 과제', 'text');
  const exec = null;
  const thisHw = buildField('a_this_hw', '이번주 과제', 'text');
  const comment = buildField('a_comment', '과목 별 코멘트', 'text');

  const percentOptions = useMemo(() => {
    const arr = [''].concat(Array.from({ length: 21 }, (_, i) => `${i * 5}%`));
    return arr;
  }, []);

  const TASK_TEXTAREA_MIN_HEIGHT = 250;
  const COMMENT_TEXTAREA_MIN_HEIGHT = 120;

  function updateLocalField(key, value) {
    dirtyRef.current = true;
    setLocalDraft((prev) => ({ ...(prev || {}), [key]: value }));
    onChangeDraft({ [key]: value });
  }

  function handleAutoSave() {
    dirtyRef.current = false;
    onAutoSave?.();
  }

  function FieldHeader({ field }) {
    return (
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-slate-800">{field.label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(field.editRoles || []).map((r) => (
              <RoleTag key={r} role={r} active={r === role} />
            ))}
          </div>
        </div>
        <div className={['shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[11px]', field.tone.badge].join(' ')}>
          {field.editable ? '편집' : '읽기'}
        </div>
      </div>
    );
  }

  function PercentFieldBody({ field, minHeight, onAutoSave }) {
    return (
      <div className="mt-3 flex items-start" style={{ minHeight }}>
        <select
          className="input w-full"
          value={field.val}
          onChange={(e) => updateLocalField(field.k, e.target.value)}
          onBlur={() => {
            if (field.editable) onAutoSave?.();
          }}
          disabled={!field.editable}
        >
          {percentOptions.map((v) => (
            <option key={v || '__empty__'} value={v}>
              {v || '선택'}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={['rounded-2xl border p-4 shadow-sm', toneClass || 'border-slate-200 bg-white/70'].join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-brand-900">{record.subject_name}</div>
        {!parentMode ? (
          <button className="btn-ghost text-red-700" type="button" disabled={busy} onClick={onDelete}>
                과목 삭제
          </button>
        ) : null}
      </div>

      <div className="mt-4 space-y-4">
        {lastHw ? (
          <div className={['rounded-2xl border p-4 shadow-sm', innerToneClass || 'border-slate-200/70 bg-slate-50/60'].join(' ')}>
            <div className="rounded-xl border border-white/60 bg-white/55 px-2 py-0">
              <FieldHeader field={lastHw} />
              <LastHwTasksEditor
                value={lastHw.val}
                editable={lastHw.editable}
                percentOptions={percentOptions}
                onChangeValue={(val) => updateLocalField(lastHw.k, val)}
                onBlur={() => {
                  if (lastHw.editable) handleAutoSave();
                }}
              />
              {!lastHw.editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
            </div>
          </div>
        ) : null}

        {thisHw ? (
          <div className={['rounded-2xl border p-4 shadow-sm', innerToneClass || 'border-slate-200/70 bg-slate-50/60'].join(' ')}>
            <div className="rounded-xl border border-white/60 bg-white/55 px-2 py-0">
              <FieldHeader field={thisHw} />
              <LastHwTasksEditor
                value={thisHw.val}
                editable={thisHw.editable}
                percentOptions={percentOptions}
                showProgress={false}
                onChangeValue={(val) => updateLocalField(thisHw.k, val)}
                onBlur={() => {
                  if (thisHw.editable) handleAutoSave();
                }}
              />
              {!thisHw.editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
            </div>
          </div>
        ) : null}

        {comment ? (
          <div className={['rounded-2xl border p-4 shadow-sm', innerToneClass || 'border-slate-200/70 bg-slate-50/60'].join(' ')}>
            <FieldHeader field={comment} />
            <AutoGrowTextarea
              value={comment.val}
              minHeight={COMMENT_TEXTAREA_MIN_HEIGHT}
              disabled={!comment.editable}
              onBlur={() => {
                if (comment.editable) handleAutoSave();
              }}
              onValueChange={(val) => updateLocalField(comment.k, val)}
            />
            {!comment.editable ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* 일일 카드 */
function DailyTasksCard({
  title,
  fieldKey,
  value,
  visible,
  editable,
  onSave,
  onAutoSave,
  onChangeValue,
  busy,
  textareaMinHClass,
  perms,
  currentRole,
  parentMode
}) {
  const [local, setLocal] = useState(value || {});
  const lastSavedRef = useRef('');
  const timerRef = useRef(null);
  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setLocal(value || {});
    lastSavedRef.current = JSON.stringify(value || {});
  }, [value]);

  useEffect(() => {
    if (!editable || parentMode) return;
    const serialized = JSON.stringify(local || {});
    if (serialized === lastSavedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSavedRef.current = serialized;
      onAutoSave?.(local);
    }, 800);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [local, editable, parentMode, onAutoSave]);

  const p = getPerm(perms, fieldKey);
  const editRoles = p.roles_edit || [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-900">{title}</div>
        <div className="mt-2 text-sm text-slate-700">권한 설정에 의해 숨김</div>
      </div>
    );
  }

  return (
    <FieldShell
      title={title}
      subtitle="요일별 텍스트 입력"
      editRoles={editRoles}
      currentRole={currentRole}
      right={
        <button className="btn-primary" disabled={busy || !editable || parentMode} onClick={() => onSave(local)}>
          저장
        </button>
      }
    >
      <div className="space-y-2">
        {DAYS.map((d) => (
          <div key={d} className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-2 text-xs text-slate-800 pt-2">
              {d} <span className="text-slate-600">({DAY_LABELS[d]})</span>
            </div>
            <textarea
              className={['textarea col-span-10', textareaMinHClass || 'min-h-[48px]'].join(' ')}
              value={local?.[d] || ''}
              onChange={(e) => {
                const next = { ...local, [d]: e.target.value };
                setLocal(next);
                skipSyncRef.current = true;
                onChangeValue?.(next);
              }}
              disabled={!editable || parentMode}
            />
          </div>
        ))}
      </div>
      {!editable || parentMode ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
    </FieldShell>
  );
}

/* 텍스트 카드 */
function TextFieldCard({ title, fieldKey, value, visible, editable, onSave, onChangeValue, busy, textareaMinHClass, perms, currentRole, parentMode }) {
  const [txt, setTxt] = useState(value || '');
  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setTxt(value || '');
  }, [value]);

  const p = getPerm(perms, fieldKey);
  const editRoles = p.roles_edit || [];

  if (!visible && parentMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-900">{title}</div>
        <div className="mt-2 text-sm text-slate-700">권한 설정에 의해 숨김</div>
      </div>
    );
  }

  return (
    <FieldShell
      title={title}
      subtitle={p?.label && p.label !== fieldKey ? `필드: ${p.label}` : `필드: ${fieldKey}`}
      editRoles={editRoles}
      currentRole={currentRole}
      right={
        <button className="btn-primary" disabled={busy || !editable || parentMode} onClick={() => onSave(txt)}>
          저장
        </button>
      }
    >
      <textarea
        className={['textarea', textareaMinHClass || 'min-h-[70px]'].join(' ')}
        value={txt || ''}
        onChange={(e) => {
          const next = e.target.value;
          setTxt(next);
          skipSyncRef.current = true;
          onChangeValue?.(next);
        }}
        disabled={!editable || parentMode}
      />
      {!editable || parentMode ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
    </FieldShell>
  );
}

/* (2) 학생 정보 분리 + 성적/내신 카드 */
const StudentProfileSection = forwardRef(function StudentProfileSection({ studentId, profileJson, userRole, busy, setBusy, setError }, ref) {
  const isReadOnly = userRole === 'parent';

  const defaultProfile = useMemo(
    () => ({
      mock_scores: [{ exam: '6.9', kor: '', math: '', eng: '', soc: '', sci: '' }],
      school_grades: { '1': { '1': '', '2': '' }, '2': { '1': '', '2': '' }, '3': { '1': '', '2': '' } },
      student_info: {
        goal_univ: '',
        goal_major: '',
        school_name: '',
        school_grade: '',
        mentor_name: '',
        lead_name: ''
      }
    }),
    []
  );

  const [profile, setProfile] = useState(() => safeJson(profileJson, defaultProfile));
  useEffect(() => setProfile(safeJson(profileJson, defaultProfile)), [profileJson, defaultProfile]);

  const gradeAverage = useMemo(() => {
    const vals = [];
    const grades = profile?.school_grades || {};
    for (const y of ['1', '2', '3']) {
      for (const s of ['1', '2']) {
        const raw = grades?.[y]?.[s];
        if (raw == null || String(raw).trim() === '') continue;
        const num = Number(raw);
        if (!Number.isNaN(num)) vals.push(num);
      }
    }
    if (!vals.length) return '';
    const avg = vals.reduce((acc, v) => acc + v, 0) / vals.length;
    return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
  }, [profile?.school_grades]);

  function updateMockRow(idx, patch) {
    const next = { ...profile };
    next.mock_scores = Array.isArray(next.mock_scores) ? [...next.mock_scores] : [];
    next.mock_scores[idx] = { ...(next.mock_scores[idx] || {}), ...patch };
    setProfile(next);
  }

  function addMockRow() {
    const next = { ...profile };
    next.mock_scores = Array.isArray(next.mock_scores) ? [...next.mock_scores] : [];
    next.mock_scores.push({ exam: '', kor: '', math: '', eng: '', soc: '', sci: '' });
    setProfile(next);
  }

  function updateSchoolGrade(year, sem, val) {
    const next = { ...profile };
    const base = next.school_grades ? { ...next.school_grades } : {};
    const yearRow = base[year] ? { ...base[year] } : {};
    yearRow[sem] = val;
    base[year] = yearRow;
    next.school_grades = base;
    setProfile(next);
  }

  function updateInfo(patch) {
    const next = { ...profile };
    next.student_info = next.student_info || {};
    next.student_info = { ...next.student_info, ...patch };
    setProfile(next);
  }

  async function saveProfile({ confirm = true, manageBusy = true } = {}) {
    if (manageBusy) setBusy(true);
    try {
      if (confirm) confirmOrThrow('학생 프로필(학생정보/성적) 저장할까요?');
      await api(`/api/students/${encodeURIComponent(studentId)}/profile`, {
        method: 'PUT',
        body: { profile_json: JSON.stringify(profile) }
      });
    } catch (e) {
      if (e?.message !== '__CANCEL__') setError(e.message || '학생 프로필 저장 실패');
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  useImperativeHandle(ref, () => ({ saveProfile }));

  return (
    <div className="space-y-6">
      {/* 학생 정보: 분리된 가로형 */}
      <GoldCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-brand-900">학생 정보</div>
            <div className="text-xs text-slate-700">학생 단위 정보(주차와 무관)</div>
          </div>
          <button className="btn-primary" disabled={busy || isReadOnly} onClick={saveProfile}>
            저장
          </button>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">목표 대학</div>
            <input className="input mt-1" value={profile?.student_info?.goal_univ || ''} onChange={(e) => updateInfo({ goal_univ: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">목표 학과</div>
            <input className="input mt-1" value={profile?.student_info?.goal_major || ''} onChange={(e) => updateInfo({ goal_major: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">학교</div>
            <input className="input mt-1" value={profile?.student_info?.school_name || ''} onChange={(e) => updateInfo({ school_name: e.target.value })} disabled={isReadOnly} />
          </div>

          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">학년</div>
            <input className="input mt-1" value={profile?.student_info?.school_grade || ''} onChange={(e) => updateInfo({ school_grade: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">학습멘토</div>
            <input className="input mt-1" value={profile?.student_info?.mentor_name || ''} onChange={(e) => updateInfo({ mentor_name: e.target.value })} disabled={isReadOnly} />
          </div>
          <div className="col-span-12 md:col-span-4">
            <div className="text-xs text-slate-800">총괄멘토</div>
            <input className="input mt-1" value={profile?.student_info?.lead_name || ''} onChange={(e) => updateInfo({ lead_name: e.target.value })} disabled={isReadOnly} />
          </div>

          {isReadOnly ? <div className="col-span-12 text-xs text-slate-700">읽기 전용</div> : null}
        </div>
      </GoldCard>

      {/* 성적/내신 */}
      <GoldCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-brand-900">성적/내신</div>
            <div className="text-xs text-slate-700">학생 단위 정보(주차와 무관)</div>
          </div>
          <button className="btn-primary" disabled={busy || isReadOnly} onClick={saveProfile}>
            저장
          </button>
        </div>

        <div className="mt-4 grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-7 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">수능/모의고사</div>
              <button className="btn-ghost" type="button" onClick={addMockRow} disabled={isReadOnly}>
                행 추가
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-700">
                    <th className="py-2 w-20">시행월</th>
                    <th className="w-24">국어</th>
                    <th className="w-24">수학</th>
                    <th className="w-24">영어</th>
                    <th className="w-24">탐구1</th>
                    <th className="w-24">탐구2</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(profile.mock_scores) ? profile.mock_scores : []).map((r, idx) => (
                    <tr key={idx} className="border-t border-slate-200">
                      <td className="py-2">
                        <input className="input" value={r.exam || ''} onChange={(e) => updateMockRow(idx, { exam: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.kor || ''} onChange={(e) => updateMockRow(idx, { kor: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.math || ''} onChange={(e) => updateMockRow(idx, { math: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.eng || ''} onChange={(e) => updateMockRow(idx, { eng: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.soc || ''} onChange={(e) => updateMockRow(idx, { soc: e.target.value })} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={r.sci || ''} onChange={(e) => updateMockRow(idx, { sci: e.target.value })} disabled={isReadOnly} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isReadOnly ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
          </div>

          <div className="col-span-12 lg:col-span-5 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">내신 성적</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-700">
                    <th className="py-2 w-20">시행월</th>
                    <th className="w-24">1학기</th>
                    <th className="w-24">2학기</th>
                  </tr>
                </thead>
                <tbody>
                  {['1', '2', '3'].map((y) => (
                    <tr key={y} className="border-t border-slate-200">
                      <td className="py-2">{y}학년</td>
                      <td>
                        <input className="input" value={profile?.school_grades?.[y]?.['1'] || ''} onChange={(e) => updateSchoolGrade(y, '1', e.target.value)} disabled={isReadOnly} />
                      </td>
                      <td>
                        <input className="input" value={profile?.school_grades?.[y]?.['2'] || ''} onChange={(e) => updateSchoolGrade(y, '2', e.target.value)} disabled={isReadOnly} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50/70">
                    <td className="py-2 font-semibold text-slate-800">평균</td>
                    <td colSpan={2}>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
                        {gradeAverage || '-'}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {isReadOnly ? <div className="mt-2 text-xs text-slate-700">읽기 전용</div> : null}
          </div>
        </div>
      </GoldCard>
    </div>
  );
});
