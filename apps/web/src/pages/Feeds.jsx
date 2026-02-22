import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const ROLE_LABEL = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '학습멘토',
  admin: '관리자',
  parent: '학부모'
};

function RolePill({ role }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gold-400/60 bg-gold-100 px-2 py-0.5 text-[11px] text-brand-800">
      {ROLE_LABEL[role] || role}
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

  const [form, setForm] = useState({
    to_user_ids: [],
    student_ids: [],
    target_field: '',
    title: '',
    body: ''
  });
  const [targetMode, setTargetMode] = useState('select');

  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');

  async function load() {
    setError('');
    try {
      const [r, rec, st, pm] = await Promise.all([
        api('/api/feeds'),
        api('/api/feeds/recipients'),
        api('/api/students'),
        api('/api/permissions')
      ]);
      setFeeds(r.feeds || []);
      setRecipients(rec.recipients || []);
      setStudents(st.students || []);
      setPerms(pm.permissions || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldLabelMap = useMemo(
    () => new Map((perms || []).map((p) => [p.field_key, p.label || p.field_key])),
    [perms]
  );
  const fieldOptions = useMemo(
    () => (perms || []).map((p) => ({ key: p.field_key, label: p.label || p.field_key })),
    [perms]
  );
  const filteredStudents = useMemo(() => {
    const q = String(studentQuery || '').trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => String(s?.name || '').toLowerCase().includes(q));
  }, [students, studentQuery]);
  const selectedStudentNames = useMemo(() => {
    const ids = new Set((form.student_ids || []).map((v) => Number(v)));
    return students.filter((s) => ids.has(Number(s.id))).map((s) => s.name);
  }, [students, form.student_ids]);

  function toggleId(field, id) {
    const n = Number(id);
    setForm((prev) => {
      const list = Array.isArray(prev[field]) ? prev[field] : [];
      const has = list.includes(n);
      return { ...prev, [field]: has ? list.filter((v) => v !== n) : [...list, n] };
    });
  }

  function setAllIds(field, ids) {
    setForm((prev) => ({ ...prev, [field]: ids.map((v) => Number(v)) }));
  }

  async function createFeed(e) {
    e.preventDefault();
    if (!form.to_user_ids.length || !String(form.body || '').trim()) return;
    setBusy(true);
    try {
      await api('/api/feeds', {
        method: 'POST',
        body: {
          to_user_ids: form.to_user_ids.map((v) => Number(v)),
          student_ids: form.student_ids.map((v) => Number(v)),
          target_field: form.target_field || null,
          title: form.title || null,
          body: form.body
        }
      });
      setForm({ to_user_ids: [], student_ids: [], target_field: '', title: '', body: '' });
      setTargetMode('select');
      setStudentPickerOpen(false);
      setStudentQuery('');
      await load();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function addComment(feedId, body) {
    const text = String(body || '').trim();
    if (!text) return;
    try {
      await api(`/api/feeds/${feedId}/comments`, { method: 'POST', body: { body: text } });
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

  const recipientCount = form.to_user_ids.length;
  const studentCount = form.student_ids.length;
  const estimatedCreateCount = recipientCount * Math.max(studentCount, 1);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-800">피드</div>
            <div className="text-sm text-slate-600">학생 이슈/워크플로우/요청 사항을 주고받습니다.</div>
          </div>
          <button className="btn-ghost whitespace-nowrap" onClick={load}>
            새로고침
          </button>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      {user?.role !== 'parent' ? (
        <div className="card p-5">
          <div className="text-sm font-semibold text-brand-800">피드 보내기</div>
          <form className="mt-3 grid grid-cols-12 gap-3" onSubmit={createFeed}>
            <div className="col-span-12 md:col-span-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">받는 대상 (다중 선택)</label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => setAllIds('to_user_ids', recipients.map((r) => Number(r.id)))}
                    disabled={busy || !recipients.length}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    className="text-slate-500 hover:underline"
                    onClick={() => setAllIds('to_user_ids', [])}
                    disabled={busy || !form.to_user_ids.length}
                  >
                    해제
                  </button>
                </div>
              </div>
              <div className="mt-1 max-h-36 overflow-auto rounded-xl border border-slate-200 bg-white p-2 space-y-1">
                {recipients.map((r) => {
                  const checked = form.to_user_ids.includes(Number(r.id));
                  return (
                    <label key={r.id} className="flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleId('to_user_ids', r.id)}
                        disabled={busy}
                      />
                      <span>
                        {r.display_name} ({ROLE_LABEL[r.role] || r.role})
                      </span>
                    </label>
                  );
                })}
                {!recipients.length ? <div className="text-xs text-slate-500">선택 가능한 대상이 없습니다.</div> : null}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{form.to_user_ids.length}명 선택됨</div>
            </div>

            <div className="col-span-12 md:col-span-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-600">대상 학생 (다중 선택)</label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="text-brand-700 hover:underline"
                    onClick={() => setAllIds('student_ids', students.map((s) => Number(s.id)))}
                    disabled={busy || !students.length}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    className="text-slate-500 hover:underline"
                    onClick={() => setAllIds('student_ids', [])}
                    disabled={busy || !form.student_ids.length}
                  >
                    해제
                  </button>
                </div>
              </div>

              <div className="mt-1">
                <button
                  type="button"
                  className="input w-full text-left"
                  onClick={() => setStudentPickerOpen((v) => !v)}
                  disabled={busy}
                >
                  {form.student_ids.length ? `${form.student_ids.length}명 선택됨` : '학생 선택 패널 열기'}
                </button>

                {studentPickerOpen ? (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                    <input
                      className="input"
                      placeholder="학생 이름 검색"
                      value={studentQuery}
                      onChange={(e) => setStudentQuery(e.target.value)}
                      disabled={busy}
                    />
                    <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                      {filteredStudents.map((s) => {
                        const checked = form.student_ids.includes(Number(s.id));
                        return (
                          <label key={s.id} className="flex items-center gap-2 text-sm text-slate-800">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleId('student_ids', s.id)}
                              disabled={busy}
                            />
                            <span>{s.name}</span>
                          </label>
                        );
                      })}
                      {!filteredStudents.length ? (
                        <div className="text-xs text-slate-500">검색 결과가 없습니다.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-1 text-[11px] text-slate-500">
                {form.student_ids.length
                  ? `${form.student_ids.length}명 선택됨`
                  : '학생 미선택 시 학생 지정 없는 공용 피드로 전송됩니다.'}
              </div>
              {selectedStudentNames.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedStudentNames.slice(0, 4).map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                    >
                      {name}
                    </span>
                  ))}
                  {selectedStudentNames.length > 4 ? (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                      +{selectedStudentNames.length - 4}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="col-span-12 md:col-span-2">
              <label className="text-xs text-slate-600">대상 필드</label>
              <div className="mt-1 space-y-2">
                <select
                  className="input"
                  value={targetMode === 'custom' ? '__custom__' : form.target_field || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__custom__') {
                      setTargetMode('custom');
                      setForm((prev) => ({ ...prev, target_field: '' }));
                    } else {
                      setTargetMode('select');
                      setForm((prev) => ({ ...prev, target_field: v }));
                    }
                  }}
                >
                  <option value="">(선택 안 함)</option>
                  {fieldOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                  <option value="__custom__">직접 입력</option>
                </select>

                {targetMode === 'custom' ? (
                  <input
                    className="input"
                    placeholder="직접 입력"
                    value={form.target_field}
                    onChange={(e) => setForm((prev) => ({ ...prev, target_field: e.target.value }))}
                  />
                ) : null}
              </div>
            </div>

            <div className="col-span-12 md:col-span-2">
              <label className="text-xs text-slate-600">제목(선택)</label>
              <input
                className="input mt-1"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </div>

            <div className="col-span-12">
              <label className="text-xs text-slate-600">내용</label>
              <textarea
                className="textarea mt-1"
                value={form.body}
                onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
              />
            </div>

            <div className="col-span-12 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                발송 예상 건수: {recipientCount}명 x {Math.max(studentCount, 1)} = {estimatedCreateCount}건
              </div>
              <button
                disabled={busy || !form.to_user_ids.length || !String(form.body || '').trim()}
                className="btn-primary"
              >
                {busy ? '전송 중..' : '전송'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="space-y-3">
        {feeds.map((f) => (
          <FeedCard
            key={f.id}
            feed={f}
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
  const canDelete = ['director', 'admin'].includes(currentUser?.role);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RolePill role={feed.from_role} />
            <div className="text-sm text-slate-800">
              {feed.from_name}
              {' -> '}
              {feed.to_name}
            </div>
            {feed.student_name ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                {feed.student_name}
              </span>
            ) : null}
            {feed.target_field ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                {(fieldLabelMap && fieldLabelMap.get(feed.target_field)) || feed.target_field}
              </span>
            ) : null}
          </div>
          {feed.title ? <div className="mt-1 text-sm font-semibold text-brand-800">{feed.title}</div> : null}
          <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{feed.body}</pre>
          <div className="mt-2 text-xs text-slate-500">{fmt(feed.created_at)}</div>
        </div>
        {canDelete ? (
          <button className="btn-ghost" onClick={() => onDelete(feed.id)}>
            삭제
          </button>
        ) : null}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="space-y-2">
          {(feed.comments || []).map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-700">
                  {c.from_name} ({ROLE_LABEL[c.from_role] || c.from_role})
                </div>
                <div className="text-[11px] text-slate-500">{fmt(c.created_at)}</div>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder="댓글 남기기"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            className="btn-primary min-w-[64px] whitespace-nowrap px-4"
            disabled={!String(comment || '').trim()}
            onClick={() => {
              onComment(feed.id, comment);
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
