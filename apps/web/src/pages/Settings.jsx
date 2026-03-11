// apps/web/src/pages/Settings.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '../api.js';

const ADMIN_ROLES = ['director','lead','mentor','admin'];
const ROLE_LABEL = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '클리닉 멘토',
  admin: '관리자',
  parent: '학부모'
};

const DEFAULT_PARENT_MENTOR_NOTICE = '멘토 및 멘토링 요일은 학생의 일정에 따라 변경될 수 있습니다.';

function toRoundLabel(label) {
  return String(label || '').replace(/주차/g, '회차');
}

function toLocalDatetimeInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoOrEmpty(localDateTimeValue) {
  const s = String(localDateTimeValue || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function Section({ title, children }) {
  return (
    <div className="card p-5">
      <div className="text-sm font-semibold text-brand-800">{title}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('admin_users');

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="text-lg font-semibold text-brand-800">설정</div>
        <div className="mt-1 text-sm text-slate-600">원장만 접근 가능한 시스템 설정</div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { k: 'admin_users', label: '관리자 권한' },
            { k: 'parent_users', label: '유저 권한' },
            { k: 'fields', label: '필드 권한' },
            { k: 'weeks', label: '회차' },
            { k: 'parent_view', label: '학부모 화면' },
            { k: 'print', label: '인쇄 설정' },
            { k: 'backup', label: '백업' }
          ].map(t => (
            <button
              key={t.k}
              className={tab === t.k ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setTab(t.k)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'admin_users' ? <AdminUsersTab /> : null}
      {tab === 'parent_users' ? <ParentUsersTab /> : null}
      {tab === 'fields' ? <FieldsTab /> : null}
      {tab === 'weeks' ? <WeeksTab /> : null}
      {tab === 'parent_view' ? <ParentViewTab /> : null}
      {tab === 'print' ? <PrintTab /> : null}
      {tab === 'backup' ? <BackupTab /> : null}
    </div>
  );
}

function AdminUsersTab() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'mentor' });

  async function load() {
    setError('');
    try {
      const r = await api('/api/users');
      // 관리자 권한 탭에서는 직원 계정만 보여줌
      setUsers((r.users || []).filter(u => ADMIN_ROLES.includes(String(u.role))));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    const body = {
      username: form.username,
      password: form.password,
      display_name: form.display_name,
      role: form.role
    };
    try {
      await api('/api/users', { method: 'POST', body });
      setForm({ username: '', password: '', display_name: '', role: 'mentor' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function update(u, patch) {
    try {
      await api(`/api/users/${u.id}`, { method: 'PUT', body: { ...u, ...patch } });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(u) {
    const ok = confirm(`유저를 삭제할까요?\n\n아이디: ${u.username}\n이름: ${u.display_name}\n역할: ${ROLE_LABEL[u.role] || u.role}`);
    if (!ok) return;
    try {
      await api(`/api/users/${u.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Section title="관리자 권한 (원장/총괄멘토/클리닉 멘토/관리자)">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <form className="grid grid-cols-12 gap-3" onSubmit={create}>
        <div className="col-span-12 md:col-span-3">
          <label className="text-xs text-slate-600">아이디</label>
          <input className="input mt-1" value={form.username} onChange={(e)=>setForm({ ...form, username: e.target.value })} />
        </div>
        <div className="col-span-12 md:col-span-3">
          <label className="text-xs text-slate-600">비밀번호</label>
          <input className="input mt-1" value={form.password} onChange={(e)=>setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="col-span-12 md:col-span-3">
          <label className="text-xs text-slate-600">이름(표시)</label>
          <input className="input mt-1" value={form.display_name} onChange={(e)=>setForm({ ...form, display_name: e.target.value })} />
        </div>
        <div className="col-span-12 md:col-span-2">
          <label className="text-xs text-slate-600">역할</label>
          <select className="input mt-1" value={form.role} onChange={(e)=>setForm({ ...form, role: e.target.value })}>
            {ADMIN_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
          </select>
        </div>
        <div className="col-span-12 md:col-span-1 flex items-end justify-end">
          <button className="btn-primary w-full">추가</button>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2">ID</th>
              <th>아이디</th>
              <th>이름</th>
              <th>역할</th>
              <th>활성</th>
              <th className="text-right">삭제</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-slate-200">
                <td className="py-2">{u.id}</td>
                <td>{u.username}</td>
                <td>
                  <input className="input" value={u.display_name || ''} onChange={(e)=>update(u, { display_name: e.target.value })} />
                </td>
                <td>
                  <select className="input" value={u.role || 'mentor'} onChange={(e)=>update(u, { role: e.target.value })}>
                    {ADMIN_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
                  </select>
                </td>
                <td>
                  <select className="input" value={u.is_active ? '1' : '0'} onChange={(e)=>update(u, { is_active: e.target.value === '1' ? 1 : 0 })}>
                    <option value="1">on</option>
                    <option value="0">off</option>
                  </select>
                </td>
                <td className="text-right">
                  <button className="btn-ghost text-red-600" onClick={()=>remove(u)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ParentUsersTab() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busyIssue, setBusyIssue] = useState(false);
  const [resetExisting, setResetExisting] = useState(false);
  const [status, setStatus] = useState('');

  async function load() {
    setError('');
    setStatus('');
    try {
      const r = await api('/api/users/parents');
      setRows(r.users || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function issue() {
    const ok = confirm(
      `학생(=학부모) 계정을 발급/갱신할까요?\n\n- 아이디(username)는 학생 ID(external_id)로 고정\n- 비밀번호는 소문자 2 + 숫자 4 랜덤\n- 기존 계정 비번 재발급: ${resetExisting ? '예' : '아니오'}`
    );
    if (!ok) return;

    setBusyIssue(true);
    setError('');
    setStatus('');
    try {
      const r = await api('/api/users/parents/issue', { method: 'POST', body: { reset_existing: resetExisting } });
      setStatus(`완료: 생성 ${r.created} / 갱신 ${r.updated} / 스킵 ${r.skipped} / 비번발급 ${r.reset_count}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyIssue(false);
    }
  }

  async function toggleActive(row, active) {
    setError('');
    try {
      await api(`/api/users/parents/${row.student_id}/active`, { method: 'PUT', body: { is_active: active } });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }


  async function downloadJson() {
    try {
      await downloadFile('/api/users/parents/export.json', `parent_users_${new Date().toISOString().slice(0,10)}.json`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function downloadExcelCsv() {
    try {
      await downloadFile('/api/users/parents/export.csv', `parent_users_${new Date().toISOString().slice(0,10)}.csv`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Section title="유저 권한 (학생=학부모, 아이디=학생ID 고정)">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {status ? <div className="text-sm text-emerald-700">{status}</div> : null}

      <div className="rounded-xl border border-slate-200 bg-white/60 p-4">
        <div className="text-sm font-semibold text-slate-800">계정 발급/다운로드</div>
        <div className="mt-1 text-xs text-slate-600">
          학부모(학생)는 본인 아이디/비밀번호로만 로그인 가능하며, 아이디/비밀번호 변경은 불가합니다(원장만 발급 API로 재발급).
        </div>

        <div className="mt-3 flex flex-col lg:flex-row lg:items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={resetExisting} onChange={(e)=>setResetExisting(e.target.checked)} />
            기존 계정도 비밀번호 재발급(새 랜덤)
          </label>

          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <button className="btn-primary" onClick={issue} disabled={busyIssue}>랜덤 계정 발급/갱신</button>
            <button className="btn-ghost" onClick={downloadJson}>JSON 다운로드</button>
            <button className="btn-ghost" onClick={downloadExcelCsv}>엑셀(CSV) 다운로드</button>
            <button className="btn-ghost" onClick={load}>새로고침</button>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2">이름</th>
              <th>ID(username)</th>
              <th>랜덤 비밀번호</th>
              <th>역할</th>
              <th>활성</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.student_id} className="border-t border-slate-200">
                <td className="py-2 whitespace-nowrap">{r.name}</td>
                <td className="font-mono text-xs whitespace-nowrap">{r.username}</td>
                <td className="font-mono text-xs whitespace-nowrap">{r.password || ''}</td>
                <td className="whitespace-nowrap">{ROLE_LABEL.parent}</td>
                <td className="whitespace-nowrap">
                  <select
                    className="input"
                    value={r.is_active ? '1' : '0'}
                    onChange={(e)=>toggleActive(r, e.target.value === '1')}
                  >
                    <option value="1">on</option>
                    <option value="0">off</option>
                  </select>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td className="py-3 text-slate-500" colSpan={5}>학생이 없습니다.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ParentViewTab() {
  const [notice, setNotice] = useState(DEFAULT_PARENT_MENTOR_NOTICE);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    setStatus('');
    try {
      const r = await api('/api/settings/parent-mentor-notice');
      if (r && Object.prototype.hasOwnProperty.call(r, 'value')) {
        setNotice(String(r.value ?? ''));
      } else {
        setNotice(DEFAULT_PARENT_MENTOR_NOTICE);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      await api('/api/settings/parent-mentor-notice', { method: 'PUT', body: { value: notice } });
      setStatus('저장했습니다.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="학부모 화면 문구">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {status ? <div className="text-sm text-emerald-700">{status}</div> : null}
      <div className="text-xs text-slate-600">
        학부모 페이지에 표시되는 "이번주 멘토 안내" 문구를 수정할 수 있습니다.
      </div>
      <div className="mt-3">
        <label className="text-xs text-slate-600">멘토 안내 문구</label>
        <textarea
          className="input mt-1 min-h-[120px]"
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <button className="btn-primary" onClick={save} disabled={busy}>
          저장
        </button>
      </div>
    </Section>
  );
}

/* 아래 4개 탭은 너가 이미 갖고 있던 코드 그대로 유지하면 됨.
   (너가 올린 Settings.jsx에서 FieldsTab/WeeksTab/PrintTab/BackupTab 부분을 그대로 붙여 넣으면 된다.)
*/

function FieldsTab() {
  const [perms, setPerms] = useState([]);
  const [error, setError] = useState('');

  const roleOptions = [
    { key: 'director', label: '원장' },
    { key: 'lead', label: '총괄멘토' },
    { key: 'mentor', label: '클리닉 멘토' },
    { key: 'admin', label: '관리자' },
    { key: 'parent', label: '학부모' }
  ];

  function toggle(arr, role) {
    const set = new Set(Array.isArray(arr) ? arr : []);
    if (set.has(role)) set.delete(role);
    else set.add(role);
    return Array.from(set);
  }

  async function load() {
    setError('');
    try {
      const r = await api('/api/permissions');
      setPerms(r.permissions || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(p, patch) {
    try {
      await api(`/api/permissions/${p.id}`, { method: 'PUT', body: { ...p, ...patch } });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Section title="멘토링 필드 권한">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2">표시 이름(한글)</th>
              <th>열람 권한</th>
              <th>편집 권한</th>
              <th>학부모 노출</th>
            </tr>
          </thead>
          <tbody>
            {perms.map(p => (
              <tr key={p.id} className="border-t border-slate-200 align-top">
                <td className="py-2">
                  <input
                    className="input"
                    value={p.label || ''}
                    placeholder="예: 학습 커리큘럼"
                    onChange={(e)=>save(p, { label: e.target.value })}
                  />
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {roleOptions.map(r => (
                      <label key={r.key} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={(p.roles_view || []).includes(r.key)}
                          onChange={() => save(p, { roles_view: toggle(p.roles_view, r.key) })}
                        />
                        <span className="text-slate-700">{r.label}</span>
                      </label>
                    ))}
                  </div>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {roleOptions.map(r => (
                      <label key={r.key} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-2 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={(p.roles_edit || []).includes(r.key)}
                          onChange={() => save(p, { roles_edit: toggle(p.roles_edit, r.key) })}
                        />
                        <span className="text-slate-700">{r.label}</span>
                      </label>
                    ))}
                  </div>
                </td>
                <td className="py-2">
                  <select
                    className="input w-28"
                    value={p.parent_visible ? '1' : '0'}
                    onChange={(e)=>save(p, { parent_visible: e.target.value === '1' })}
                  >
                    <option value="1">노출</option>
                    <option value="0">비노출</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500">
        표시 이름(한글)을 수정하면 피드/인쇄 설정/학부모 화면에서도 동일하게 한글로 표시됩니다.
      </div>
    </Section>
  );
}

function WeeksTab() {
  const [weeks, setWeeks] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ label: '', start_date: '', end_date: '' });

  async function load() {
    setError('');
    try {
      const r = await api('/api/weeks');
      setWeeks((r.weeks || []).map((w) => ({ ...w, label: toRoundLabel(w.label) })));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api('/api/weeks', { method: 'POST', body: { ...form, label: toRoundLabel(form.label) } });
      setForm({ label: '', start_date: '', end_date: '' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function update(w, patch) {
    try {
      const next = { ...w, ...patch };
      if (Object.prototype.hasOwnProperty.call(next, 'label')) next.label = toRoundLabel(next.label);
      await api(`/api/weeks/${w.id}`, { method: 'PUT', body: next });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Section title="회차 설정">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <form className="grid grid-cols-12 gap-3" onSubmit={create}>
        <div className="col-span-12 md:col-span-4">
          <label className="text-xs text-slate-600">회차 이름</label>
          <input className="input mt-1" value={form.label} onChange={(e)=>setForm({ ...form, label: toRoundLabel(e.target.value) })} placeholder="1회차" />
        </div>
        <div className="col-span-12 md:col-span-3">
          <label className="text-xs text-slate-600">시작일</label>
          <input className="input mt-1" value={form.start_date} onChange={(e)=>setForm({ ...form, start_date: e.target.value })} placeholder="예: 2026-01-01" />
        </div>
        <div className="col-span-12 md:col-span-3">
          <label className="text-xs text-slate-600">종료일</label>
          <input className="input mt-1" value={form.end_date} onChange={(e)=>setForm({ ...form, end_date: e.target.value })} placeholder="예: 2026-01-01" />
        </div>
        <div className="col-span-12 md:col-span-2 flex items-end">
          <button className="btn-primary w-full">추가</button>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2">ID</th>
              <th>label</th>
              <th>start</th>
              <th>end</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.id} className="border-t border-slate-200">
                <td className="py-2">{w.id}</td>
                <td><input className="input" value={w.label} onChange={(e)=>update(w, { label: toRoundLabel(e.target.value) })} /></td>
                <td><input className="input" value={w.start_date || ''} onChange={(e)=>update(w, { start_date: e.target.value })} /></td>
                <td><input className="input" value={w.end_date || ''} onChange={(e)=>update(w, { end_date: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PrintTab() {
  const [config, setConfig] = useState([]);
  const [perms, setPerms] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    setBusy(true);
    try {
      const r = await api('/api/print/config');
      setConfig(r.config || []);
      const p = await api('/api/permissions');
      setPerms(p.permissions || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(field_key, enabled) {
    setError('');
    try {
      await api('/api/print/config', { method: 'POST', body: { field_key, enabled } });
      setConfig(prev => {
        const arr = Array.isArray(prev) ? [...prev] : [];
        const idx = arr.findIndex(x => x.field_key === field_key);
        if (idx >= 0) arr[idx] = { ...arr[idx], enabled };
        else arr.push({ field_key, enabled });
        return arr;
      });
    } catch (e) {
      setError(e.message);
    }
  }

  const enabledMap = useMemo(() => new Map((config || []).map(x => [x.field_key, !!x.enabled])), [config]);
  const labelMap = useMemo(() => new Map((perms || []).map(p => [p.field_key, (p.label || '').trim()])), [perms]);

  const orderedFields = useMemo(() => {
    const keys = (perms || []).map(p => p.field_key);
    for (const c of config || []) if (!keys.includes(c.field_key)) keys.push(c.field_key);
    return keys;
  }, [perms, config]);

  return (
    <Section title="인쇄 설정">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="text-xs text-slate-500">
        아래 항목은 “멘토링 인쇄 페이지(보고서)”에서 해당 항목을 출력할지(인쇄) 숨길지(미인쇄) 결정합니다.
      </div>

      <div className="mt-4 space-y-2">
        {orderedFields.length === 0 ? (
          <div className="text-sm text-slate-500">인쇄 설정 항목이 없습니다.</div>
        ) : orderedFields.map((field_key) => {
          const label = labelMap.get(field_key);
          const shown = label || String(field_key);
          const enabled = enabledMap.has(field_key) ? enabledMap.get(field_key) : true;

          return (
            <div key={field_key} className="rounded-xl border border-slate-200 bg-white/60 px-3 py-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis" title={shown}>
                    {shown}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    “{shown}” 항목을 {enabled ? '출력합니다.' : '출력하지 않습니다.'}
                    {!label ? ` (표시 이름이 비어 있어 field_key로 표시 중: ${String(field_key)})` : ''}
                  </div>
                </div>

                <select
                  className="input w-28"
                  disabled={busy}
                  value={enabled ? '1' : '0'}
                  onChange={(e)=>toggle(field_key, e.target.value === '1')}
                >
                  <option value="1">인쇄</option>
                  <option value="0">미인쇄</option>
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-xs text-slate-500">
        항목 이름(표시 이름)은 “필드 권한” 탭에서 변경할 수 있습니다.
      </div>
    </Section>
  );
}

function BackupTab() {
  const [list, setList] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [forensicBusy, setForensicBusy] = useState(false);
  const [forensicSince, setForensicSince] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() - (5 * 24 * 60 * 60 * 1000))));
  const [forensicCutoff, setForensicCutoff] = useState(() => toLocalDatetimeInputValue(new Date()));
  const [forensicReportFile, setForensicReportFile] = useState('');
  const [forensicSummary, setForensicSummary] = useState(null);
  const [forensicLogs, setForensicLogs] = useState([]);
  const [fullBusy, setFullBusy] = useState(false);
  const [fullRestoreFile, setFullRestoreFile] = useState(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeFile, setMergeFile] = useState(null);
  const [mergeTables, setMergeTables] = useState('week_records,subject_records');
  const [mergeResult, setMergeResult] = useState(null);

  async function load() {
    setError('');
    setStatus('');
    try {
      const r = await api('/api/backups/list');
      setList(r.backups || []);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadLatestForensics({ silent = false } = {}) {
    if (!silent) {
      setError('');
      setStatus('');
    }
    try {
      const r = await api('/api/backups/forensics/latest?preview_rows=10');
      setForensicReportFile(r.report_file || '');
      setForensicSummary(r.summary || null);
      setForensicLogs([]);
      if (!silent) {
        setStatus(r.report_file ? `최신 포렌식 리포트: ${r.report_file}` : '최신 포렌식 리포트를 불러왔습니다');
      }
    } catch (e) {
      const msg = String(e?.message || '');
      if (silent && msg.toLowerCase().includes('no forensic report found')) return;
      if (!silent) setError(msg || '포렌식 리포트 조회 실패');
    }
  }

  useEffect(() => {
    load();
    loadLatestForensics({ silent: true });
  }, []);

  async function backupNow() {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const r = await api('/api/backups/now', { method: 'POST', body: {} });
      setStatus(r.file ? `백업 생성됨: ${r.file}` : '백업 완료');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pruneOldestHalf() {
    const ok = confirm('가장 오래된 백업의 50%를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
    if (!ok) return;
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const r = await api('/api/backups/prune', {
        method: 'POST',
        body: { mode: 'oldest', ratio: 0.5, keep_min: 1 }
      });
      setStatus(`정리 완료: ${r.deleted_count || 0}개 삭제`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(file) {
    if (!file) return;
    const ok = confirm(`이 백업 파일을 삭제할까요?\n\n${file}`);
    if (!ok) return;
    setError('');
    setStatus('');
    setBusy(true);
    try {
      await api(`/api/backups/file/${encodeURIComponent(file)}`, { method: 'DELETE' });
      setStatus(`삭제 완료: ${file}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runForensics({ recoverPrimary = false } = {}) {
    const ok = recoverPrimary
      ? confirm('손상된 원본 db.sqlite에 대해 sqlite3 .recover 최종 복구를 시도할까요? 시간이 다소 걸릴 수 있습니다.')
      : confirm('쉘 없이 서버 포렌식 복구를 실행할까요? 실행 후 최신 후보 DB와 최근 행 미리보기를 확인할 수 있습니다.');
    if (!ok) return;
    setError('');
    setStatus('');
    setForensicBusy(true);
    try {
      const body = {
        since: toIsoOrEmpty(forensicSince) || undefined,
        cutoff: toIsoOrEmpty(forensicCutoff) || undefined,
        top: 3,
        limit: 1000,
        preview_rows: 12,
        recover_primary: recoverPrimary
      };
      const r = await api('/api/backups/forensics/run', { method: 'POST', body });
      setForensicReportFile(r.report_file || '');
      setForensicSummary(r.summary || null);
      setForensicLogs(Array.isArray(r.logs) ? r.logs : []);
      if (recoverPrimary) {
        setStatus(r.report_file ? `최종 복구 시도 완료: ${r.report_file}` : '최종 복구 시도 완료');
      } else {
        setStatus(r.report_file ? `포렌식 완료: ${r.report_file}` : '포렌식 완료');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setForensicBusy(false);
    }
  }

  async function downloadForensicReport() {
    if (!forensicReportFile) return;
    setError('');
    setStatus('');
    try {
      await downloadFile(`/api/backups/forensics/file/${encodeURIComponent(forensicReportFile)}`, forensicReportFile);
      setStatus(`포렌식 리포트 다운로드: ${forensicReportFile}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function promoteTopCandidate() {
    const candidatePath = String(forensicSummary?.topCandidates?.[0]?.path || '').trim();
    const reportHint = forensicReportFile ? `\n리포트: ${forensicReportFile}` : '';
    const candidateHint = candidatePath ? `\n후보: ${candidatePath}` : '';
    const ok = confirm(
      `최상위 후보 DB를 현재 기본 DB로 확정할까요?\n이 작업 후 서비스 재시작(재배포 또는 수동 restart)이 필요합니다.${reportHint}${candidateHint}`
    );
    if (!ok) return;

    setError('');
    setStatus('');
    setForensicBusy(true);
    try {
      const r = await api('/api/backups/forensics/promote', {
        method: 'POST',
        body: {
          report_file: forensicReportFile || undefined,
          candidate_path: candidatePath || undefined,
          restart_after: false
        }
      });

      const mode = String(r.mode || '');
      const modeLabel = mode === 'rename'
        ? 'rename(저장공간 절약 모드)'
        : mode === 'copy'
          ? 'copy'
          : mode || 'unknown';
      setStatus(`기본 DB 확정 완료 (${modeLabel}) - 이제 서비스 재시작(Deploy/Manual Restart) 해주세요.`);
      setForensicLogs(Array.isArray(r.logs) ? r.logs : []);
      await load();
      await loadLatestForensics({ silent: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setForensicBusy(false);
    }
  }

  async function mergeForensicReport() {
    if (!mergeFile) {
      setError('병합할 포렌식 JSON 파일을 선택하세요.');
      return;
    }
    const ok = confirm('선택한 포렌식 JSON 데이터를 현재 DB에 병합할까요? 같은 id는 updated_at 기준 최신 값만 반영됩니다.');
    if (!ok) return;

    setError('');
    setStatus('');
    setMergeBusy(true);
    try {
      const body = new FormData();
      body.append('file', mergeFile);
      const since = toIsoOrEmpty(forensicSince);
      const cutoff = toIsoOrEmpty(forensicCutoff);
      if (since) body.append('since', since);
      if (cutoff) body.append('cutoff', cutoff);
      if (String(mergeTables || '').trim()) {
        body.append('tables', String(mergeTables).trim());
      }

      const r = await api('/api/backups/forensics/merge-report', { method: 'POST', body });
      setMergeResult(r);
      setStatus(`병합 완료: table ${r?.merged_tables ?? 0}개 / inserted ${r?.inserted ?? 0} / updated ${r?.updated ?? 0} / skipped ${r?.skipped ?? 0}`);
      await loadLatestForensics({ silent: true });
    } catch (e) {
      setError(e.message || '포렌식 리포트 병합 실패');
    } finally {
      setMergeBusy(false);
    }
  }

  async function downloadFullSnapshot() {
    setError('');
    setStatus('');
    setFullBusy(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `mentoring_full_${stamp}.sqlite`;
      await downloadFile('/api/backups/full-export', fileName);
      setStatus(`전체 데이터 다운로드 완료: ${fileName}`);
    } catch (e) {
      setError(e.message || '전체 데이터 다운로드 실패');
    } finally {
      setFullBusy(false);
    }
  }

  async function restoreFullSnapshot() {
    if (!fullRestoreFile) {
      setError('복원할 .sqlite 파일을 선택하세요.');
      return;
    }
    const ok = confirm(
      '선택한 전체 데이터 파일로 현재 DB를 덮어쓸까요?\n\n주의: 적용 후 서비스 재시작(Deploy/Manual Restart)이 필요합니다.'
    );
    if (!ok) return;

    setError('');
    setStatus('');
    setFullBusy(true);
    try {
      const body = new FormData();
      body.append('file', fullRestoreFile);
      const r = await api('/api/backups/full-import', { method: 'POST', body });
      const warnings = Array.isArray(r?.warnings) && r.warnings.length
        ? ` / 경고: ${r.warnings.join(' | ')}`
        : '';
      setStatus(`전체 복원 파일 적용 완료 (restart 필요)${warnings}`);
      await load();
    } catch (e) {
      setError(e.message || '전체 복원 실패');
    } finally {
      setFullBusy(false);
    }
  }

  return (
    <Section title="백업">
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {status ? <div className="text-sm text-emerald-700">{status}</div> : null}

      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={backupNow} disabled={busy}>지금 백업</button>
        <button className="btn-ghost" onClick={pruneOldestHalf} disabled={busy}>오래된 50% 삭제</button>
        <button className="btn-ghost" onClick={load} disabled={busy}>목록 새로고침</button>
      </div>

      <div className="mt-4 text-xs text-slate-600">
        서버가 30분마다 자동 백업하며, 이 버튼은 즉시 백업 파일을 생성합니다.
      </div>

      <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
        <div className="text-sm font-semibold text-sky-900">전체 데이터 수동 백업/복원 (SQLite)</div>
        <div className="mt-1 text-xs text-sky-800">
          텍스트/사진(BLOB) 포함 전체 DB를 파일로 내려받고, 같은 파일을 다시 올려 전체 복원할 수 있습니다.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={downloadFullSnapshot} disabled={fullBusy || forensicBusy}>
            전체 데이터 파일 다운로드
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
          <input
            type="file"
            accept=".sqlite,.db,application/octet-stream"
            className="input"
            onChange={(e) => setFullRestoreFile(e.target.files?.[0] || null)}
            disabled={fullBusy || forensicBusy}
          />
          <button
            className="btn-ghost"
            onClick={restoreFullSnapshot}
            disabled={fullBusy || forensicBusy || !fullRestoreFile}
          >
            선택 파일 전체 복원
          </button>
        </div>
        <div className="mt-1 text-[11px] text-slate-600">
          복원 적용 후에는 Render에서 수동 재시작(Manual Restart) 또는 재배포가 필요합니다.
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <div className="text-sm font-semibold text-amber-900">포렌식 복구 (쉘 없이)</div>
        <div className="mt-1 text-xs text-amber-800">
          DB 손상 시 백업 후보를 자동 스캔해 최근 데이터 흔적을 추출합니다. 기간을 지정한 뒤 실행하세요.
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-600">조회 시작 (로컬 시간)</label>
            <input
              type="datetime-local"
              className="input mt-1"
              value={forensicSince}
              onChange={(e) => setForensicSince(e.target.value)}
              disabled={forensicBusy}
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">조회 종료 (로컬 시간)</label>
            <input
              type="datetime-local"
              className="input mt-1"
              value={forensicCutoff}
              onChange={(e) => setForensicCutoff(e.target.value)}
              disabled={forensicBusy}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => runForensics()} disabled={forensicBusy}>
            포렌식 실행
          </button>
          <button className="btn-ghost" onClick={() => runForensics({ recoverPrimary: true })} disabled={forensicBusy}>
            손상 원본 최종복구
          </button>
          <button className="btn-ghost" onClick={promoteTopCandidate} disabled={forensicBusy || !forensicSummary}>
            최상위 후보 DB 확정
          </button>
          <button className="btn-ghost" onClick={() => loadLatestForensics()} disabled={forensicBusy}>
            최신 리포트 불러오기
          </button>
          <button className="btn-ghost" onClick={downloadForensicReport} disabled={forensicBusy || !forensicReportFile}>
            리포트 JSON 다운로드
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
          <div className="text-xs font-semibold text-emerald-900">포렌식 리포트 병합 (업로드)</div>
          <div className="mt-1 text-[11px] text-emerald-800">
            스냅샷/외부에서 받은 포렌식 JSON 파일을 업로드해 현재 DB에 누락 행을 합칩니다.
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              type="file"
              accept=".json,application/json"
              className="input"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setMergeFile(f);
              }}
              disabled={forensicBusy || mergeBusy}
            />
            <input
              className="input"
              placeholder="대상 테이블 (콤마구분)"
              value={mergeTables}
              onChange={(e) => setMergeTables(e.target.value)}
              disabled={forensicBusy || mergeBusy}
            />
            <button
              className="btn-primary"
              onClick={mergeForensicReport}
              disabled={forensicBusy || mergeBusy || !mergeFile}
            >
              {mergeBusy ? '병합 중...' : '선택 리포트 병합'}
            </button>
          </div>
          <div className="mt-1 text-[11px] text-slate-600">
            기본값: <span className="font-mono">week_records,subject_records</span>
          </div>

          {mergeResult ? (
            <div className="mt-2 rounded border border-emerald-200 bg-white p-2">
              <div className="text-[11px] text-slate-700">
                merged_tables={mergeResult.merged_tables ?? 0}, inserted={mergeResult.inserted ?? 0}, updated={mergeResult.updated ?? 0}, skipped={mergeResult.skipped ?? 0}
              </div>
              <div className="mt-1 space-y-1">
                {Object.entries(mergeResult.summary || {}).map(([table, s]) => (
                  <div key={table} className="text-[11px] text-slate-700">
                    {table}: input {s.input_rows ?? 0} / ins {s.inserted ?? 0} / upd {s.updated ?? 0} / older {s.skipped_older ?? 0} / invalid {s.skipped_invalid ?? 0} / no_ts {s.skipped_no_ts ?? 0}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {forensicSummary ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-white p-3">
            <div className="text-xs text-slate-700">
              리포트 파일: <span className="font-mono">{forensicReportFile || '-'}</span>
            </div>
            <div className="mt-1 text-xs text-slate-700">
              생성 시각: {forensicSummary.generatedAt || '-'} / 후보 수: {forensicSummary.candidateCount ?? 0}
            </div>
            <div className="mt-2 text-xs font-semibold text-slate-700">상위 후보 DB</div>
            <div className="mt-1 space-y-1">
              {(forensicSummary.topCandidates || []).length === 0 ? (
                <div className="text-xs text-slate-500">상위 후보가 없습니다.</div>
              ) : (forensicSummary.topCandidates || []).map((c, idx) => (
                <div key={`${c.path || 'candidate'}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                  <div className="text-[11px] text-slate-600">marker: {c.marker || '-'}</div>
                  <div className="font-mono text-[11px] text-slate-700 break-all">{c.path || '-'}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 text-xs font-semibold text-slate-700">추출 결과</div>
            <div className="mt-1 space-y-2">
              {(forensicSummary.extracts || []).length === 0 ? (
                <div className="text-xs text-slate-500">추출된 데이터가 없습니다.</div>
              ) : (forensicSummary.extracts || []).map((ext, extIdx) => (
                <div key={`${ext.path || 'extract'}-${extIdx}`} className="rounded border border-slate-200 px-2 py-2">
                  <div className="font-mono text-[11px] text-slate-700 break-all">{ext.path || '-'}</div>
                  <div className="mt-1 text-[11px] text-slate-600">
                    총 {ext.totalRows ?? 0}개 행 {ext.error ? `(오류: ${ext.error})` : ''}
                  </div>
                  <div className="mt-1 space-y-1">
                    {(ext.tables || []).map((t) => (
                      <div key={`${ext.path || 'extract'}-${t.table}`} className="text-[11px] text-slate-700">
                        {t.table}: {t.rowCount ?? 0} rows ({t.timestampColumn || '-'})
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {forensicLogs.length > 0 ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-slate-700">실행 로그(최근 30줄)</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{forensicLogs.join('\n')}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-2">파일</th>
              <th className="py-2 w-28">관리</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td className="py-3 text-slate-500" colSpan={2}>백업이 없습니다</td></tr>
            ) : list.map((f) => (
              <tr key={f} className="border-t border-slate-200">
                <td className="py-2 font-mono text-xs">{f}</td>
                <td className="py-2">
                  <button className="btn-ghost text-red-600" onClick={() => deleteOne(f)} disabled={busy}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
} 

