import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

function RolePill({ role }) {
  const m = {
    director: '원장',
    lead: '총괄멘토',
    mentor: '학습멘토',
    admin: '관리자',
    parent: '학부모'
  };
  return (
    <span className="inline-flex items-center rounded-full border border-gold-400/60 bg-gold-100 px-2 py-0.5 text-[11px] text-brand-800">
      {m[role] || role}
    </span>
  );
}

function fmt(dt) {
  if (!dt) return '';
  return String(dt).replace('T', ' ').slice(0, 16);
}

export default function Feeds() {
  const { user } = useAuth();
  const [feeds, setFeeds] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [students, setStudents] = useState([]);
  const [perms, setPerms] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({ to_user_id: '', student_id: '', target_field: '', title: '', body: '' });
  const [targetMode, setTargetMode] = useState('select');

  async function load() {
    setError('');
    try {
      const r = await api('/api/feeds');
      setFeeds(r.feeds || []);
      const rec = await api('/api/feeds/recipients');
      setRecipients(rec.recipients || []);
      const st = await api('/api/students');
      setStudents(st.students || []);
      const pm = await api('/api/permissions');
      setPerms(pm.permissions || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studentMap = useMemo(() => new Map(students.map(s => [String(s.id), s])), [students]);
  const fieldLabelMap = useMemo(() => new Map((perms || []).map(p => [p.field_key, p.label || p.field_key])), [perms]);
  const fieldOptions = useMemo(() => (perms || []).map(p => ({ key: p.field_key, label: p.label || p.field_key })), [perms]);

  async function createFeed(e) {
    e.preventDefault();
    if (!form.to_user_id || !form.body) return;
    setBusy(true);
    try {
      await api('/api/feeds', {
        method: 'POST',
        body: {
          to_user_id: Number(form.to_user_id),
          student_id: form.student_id ? Number(form.student_id) : null,
          target_field: form.target_field || null,
          title: form.title || null,
          body: form.body
        }
      });
      setForm({ to_user_id: '', student_id: '', target_field: '', title: '', body: '' });
      await load();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function addComment(feedId, body) {
    if (!body) return;
    try {
      await api(`/api/feeds/${feedId}/comments`, { method: 'POST', body: { body } });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteFeed(feedId) {
    if (!confirm('피드를 삭제할까요?')) return;
    try {
      await api(`/api/feeds/${feedId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-800">피드</div>
            <div className="text-sm text-slate-600">학생 이슈/워크플로우/요청 사항을 주고받습니다.</div>
          </div>
          <button className="btn-ghost whitespace-nowrap" onClick={load}>새로고침</button>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      {user?.role !== 'parent' ? (
        <div className="card p-5">
          <div className="text-sm font-semibold text-brand-800">피드 보내기</div>
          <form className="mt-3 grid grid-cols-12 gap-3" onSubmit={createFeed}>
            <div className="col-span-12 md:col-span-3">
              <label className="text-xs text-slate-600">받는 대상</label>
              <select className="input mt-1" value={form.to_user_id} onChange={(e) => setForm({ ...form, to_user_id: e.target.value })}>
                <option value="">선택</option>
                {recipients.map(r => <option key={r.id} value={r.id}>{r.display_name} ({({director:'원장',lead:'총괄멘토',mentor:'학습멘토',admin:'관리자',parent:'학부모'})[r.role] || r.role})</option>)}
              </select>
            </div>
            <div className="col-span-12 md:col-span-3">
              <label className="text-xs text-slate-600">대상 학생</label>
              <select className="input mt-1" value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
                <option value="">(선택)</option>
                {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col-span-12 md:col-span-3">
              <label className="text-xs text-slate-600">대상 필드</label>
              <div className="mt-1 space-y-2">
                <select
                  className="input"
                  value={targetMode === 'custom' ? '__custom__' : (form.target_field || '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__custom__') {
                      setTargetMode('custom');
                      setForm({ ...form, target_field: '' });
                    } else {
                      setTargetMode('select');
                      setForm({ ...form, target_field: v });
                    }
                  }}
                >
                  <option value="">(선택 안 함)</option>
                  {fieldOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  <option value="__custom__">직접 입력</option>
                </select>

                {targetMode === 'custom' ? (
                  <input
                    className="input"
                    placeholder="직접 입력"
                    value={form.target_field}
                    onChange={(e) => setForm({ ...form, target_field: e.target.value })}
                  />
                ) : null}
              </div>
            </div>
            <div className="col-span-12 md:col-span-3">
              <label className="text-xs text-slate-600">제목(선택)</label>
              <input className="input mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="col-span-12">
              <label className="text-xs text-slate-600">내용</label>
              <textarea className="textarea mt-1" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <div className="col-span-12 flex justify-end">
              <button disabled={busy} className="btn-primary">{busy ? '전송 중...' : '전송'}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="space-y-3">
        {feeds.map(f => (
          <FeedCard
            key={f.id}
            feed={f}
            student={f.student_id ? studentMap.get(String(f.student_id)) : null}
            fieldLabelMap={fieldLabelMap}
            onComment={addComment}
            onDelete={deleteFeed}
            currentUser={user}
          />
        ))}
        {!feeds.length ? <div className="text-sm text-slate-600">피드가 없습니다.</div> : null}
      </div>
    </div>
  );
}

function FeedCard({ feed, onComment, onDelete, currentUser, fieldLabelMap }) {
  const [comment, setComment] = useState('');

  const canDelete = currentUser?.role === 'director' || Number(feed.from_user_id) === Number(currentUser?.id);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RolePill role={feed.from_role} />
            <div className="text-sm text-slate-800">{feed.from_name} → {feed.to_name}</div>
            {feed.student_name ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">{feed.student_name}</span>
            ) : null}
            {feed.target_field ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">{(fieldLabelMap && fieldLabelMap.get(feed.target_field)) ? fieldLabelMap.get(feed.target_field) : feed.target_field}</span>
            ) : null}
          </div>
          {feed.title ? <div className="mt-1 text-sm font-semibold text-brand-800">{feed.title}</div> : null}
          <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{feed.body}</pre>
          <div className="mt-2 text-xs text-slate-500">{fmt(feed.created_at)}</div>
        </div>
        {canDelete ? (
          <button className="btn-ghost" onClick={() => onDelete(feed.id)}>삭제</button>
        ) : null}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="space-y-2">
          {(feed.comments || []).map(c => (
            <div key={c.id} className="rounded-xl bg-white/70 border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-700">{c.from_name} ({c.from_role})</div>
                <div className="text-[11px] text-slate-500">{fmt(c.created_at)}</div>
              </div>
              <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input className="input flex-1 min-w-0" placeholder="댓글 남기기" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary whitespace-nowrap px-4 min-w-[64px]" onClick={() => { onComment(feed.id, comment); setComment(''); }}>등록</button>
        </div>
      </div>
    </div>
  );
}
