import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const ROLE_LABEL = {
  director: '원장',
  lead: '총괄멘토',
  mentor: '클리닉 멘토',
  admin: '관리자'
};

function fmtTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function previewText(partner) {
  if (!partner?.last_message_at) return '대화를 시작하세요.';
  if (partner.last_body) return partner.last_body;
  if (partner.last_has_image) return '이미지';
  if (partner.last_tag_student_id) return '학생 태그';
  return '메시지';
}

export default function FloatingChat() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [partners, setPartners] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [students, setStudents] = useState([]);
  const [body, setBody] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [tagStudentId, setTagStudentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const role = String(user?.role || '').trim();
  const canUseChat = ['director', 'admin', 'lead', 'mentor'].includes(role);
  const unreadTotal = useMemo(
    () => partners.reduce((sum, partner) => sum + Number(partner?.unread_count || 0), 0),
    [partners]
  );
  const selectedPartner = useMemo(
    () => partners.find((partner) => Number(partner.id) === Number(selectedId)) || null,
    [partners, selectedId]
  );

  async function loadPartners({ keepSelection = true } = {}) {
    if (!canUseChat) return;
    try {
      const data = await api('/api/chats/partners');
      const next = data.partners || [];
      setPartners(next);
      if (!keepSelection || (!selectedId && next.length)) {
        const firstUnread = next.find((partner) => Number(partner.unread_count || 0) > 0);
        setSelectedId(Number((firstUnread || next[0])?.id || 0) || null);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadStudents() {
    try {
      const data = await api('/api/students');
      setStudents(data.students || []);
    } catch {
      setStudents([]);
    }
  }

  async function loadMessages(partnerId = selectedId) {
    const id = Number(partnerId || 0);
    if (!id) {
      setMessages([]);
      return;
    }
    try {
      const data = await api(`/api/chats/messages?partnerId=${encodeURIComponent(id)}`);
      setMessages(data.messages || []);
      await loadPartners({ keepSelection: true });
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (!canUseChat) return undefined;
    loadPartners({ keepSelection: false });
    const timer = window.setInterval(() => loadPartners({ keepSelection: true }), 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseChat]);

  useEffect(() => {
    if (!open) return;
    loadStudents();
    if (!selectedId && partners.length) {
      setSelectedId(Number(partners[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !selectedId) return undefined;
    loadMessages(selectedId);
    const timer = window.setInterval(() => loadMessages(selectedId), 2500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length]);

  if (!canUseChat) return null;

  async function sendMessage(e) {
    e.preventDefault();
    const toUserId = Number(selectedId || 0);
    const text = String(body || '').trim();
    if (!toUserId || (!text && !imageFile && !tagStudentId)) return;

    const form = new FormData();
    form.append('to_user_id', String(toUserId));
    if (text) form.append('body', text);
    if (tagStudentId) form.append('tag_student_id', String(tagStudentId));
    if (imageFile) form.append('image', imageFile, imageFile.name || 'image');

    setBusy(true);
    setError('');
    try {
      await api('/api/chats/messages', { method: 'POST', body: form });
      setBody('');
      setImageFile(null);
      setTagStudentId('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadMessages(toUserId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openTaggedStudent(studentId) {
    const id = Number(studentId || 0);
    if (!id) return;
    window.open(`/students/${id}/mentoring`, '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      {open ? (
        <div className="fixed bottom-24 right-4 z-50 flex h-[min(680px,calc(100vh-7rem))] w-[min(920px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50/90 md:block">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">채팅</div>
                <div className="text-xs text-slate-500">{user?.display_name}</div>
              </div>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
            <div className="max-h-[calc(100%-57px)] overflow-y-auto p-2">
              {partners.map((partner) => {
                const active = Number(partner.id) === Number(selectedId);
                return (
                  <button
                    key={partner.id}
                    type="button"
                    className={[
                      'mb-1 w-full rounded-xl border px-3 py-2 text-left transition',
                      active
                        ? 'border-brand-700 bg-white shadow-sm'
                        : 'border-transparent hover:border-slate-200 hover:bg-white'
                    ].join(' ')}
                    onClick={() => setSelectedId(Number(partner.id))}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-semibold text-slate-900">
                        {partner.display_name}
                      </div>
                      {Number(partner.unread_count || 0) > 0 ? (
                        <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {partner.unread_count}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{ROLE_LABEL[partner.role] || partner.role}</div>
                    <div className="mt-1 truncate text-xs text-slate-600">{previewText(partner)}</div>
                  </button>
                );
              })}
              {!partners.length ? (
                <div className="px-3 py-6 text-sm text-slate-500">대화 가능한 대상이 없습니다.</div>
              ) : null}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                {selectedPartner ? (
                  <>
                    <div className="truncate text-sm font-semibold text-slate-900">{selectedPartner.display_name}</div>
                    <div className="text-xs text-slate-500">{ROLE_LABEL[selectedPartner.role] || selectedPartner.role}</div>
                  </>
                ) : (
                  <div className="text-sm font-semibold text-slate-900">대화 상대 선택</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="input block md:hidden"
                  value={selectedId || ''}
                  onChange={(event) => setSelectedId(Number(event.target.value) || null)}
                >
                  <option value="">대화 상대</option>
                  {partners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.display_name} ({ROLE_LABEL[partner.role] || partner.role})
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-ghost px-3 py-1.5 text-xs md:hidden" onClick={() => setOpen(false)}>
                  닫기
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/50 px-4 py-4">
              {messages.map((message) => {
                const mine = Number(message.from_user_id) === Number(user?.id);
                return (
                  <div key={message.id} className={['mb-3 flex', mine ? 'justify-end' : 'justify-start'].join(' ')}>
                    <div
                      className={[
                        'max-w-[82%] rounded-2xl border px-3 py-2 shadow-sm',
                        mine
                          ? 'border-brand-700 bg-brand-800 text-white'
                          : 'border-slate-200 bg-white text-slate-800'
                      ].join(' ')}
                    >
                      {message.body ? <div className="whitespace-pre-wrap text-sm">{message.body}</div> : null}
                      {message.image_base64 && message.image_mime ? (
                        <a
                          href={`data:${message.image_mime};base64,${message.image_base64}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block overflow-hidden rounded-xl border border-white/40 bg-white/20"
                        >
                          <img
                            className="max-h-56 w-full object-contain"
                            src={`data:${message.image_mime};base64,${message.image_base64}`}
                            alt={message.image_name || 'attached image'}
                          />
                        </a>
                      ) : null}
                      {message.tag_student_id ? (
                        <button
                          type="button"
                          className={[
                            'mt-2 inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold',
                            mine
                              ? 'border-white/50 bg-white/15 text-white'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          ].join(' ')}
                          onClick={() => openTaggedStudent(message.tag_student_id)}
                        >
                          #{message.tag_student_name || '학생'} 멘토링 열기
                        </button>
                      ) : null}
                      <div className={['mt-1 text-[10px]', mine ? 'text-white/70' : 'text-slate-400'].join(' ')}>
                        {fmtTime(message.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!selectedPartner ? (
                <div className="py-20 text-center text-sm text-slate-500">대화 상대를 선택하세요.</div>
              ) : null}
              {selectedPartner && !messages.length ? (
                <div className="py-20 text-center text-sm text-slate-500">아직 메시지가 없습니다.</div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            {error ? <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">{error}</div> : null}

            <form className="border-t border-slate-200 bg-white px-3 py-3" onSubmit={sendMessage}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  className="input max-w-full sm:max-w-56"
                  value={tagStudentId}
                  onChange={(event) => setTagStudentId(event.target.value)}
                  disabled={!selectedPartner || busy}
                >
                  <option value="">학생 태그</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.name}
                    </option>
                  ))}
                </select>

                <label className="btn-ghost cursor-pointer px-3 py-2">
                  이미지
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={!selectedPartner || busy}
                    onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                  />
                </label>

                {imageFile ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
                    onClick={() => {
                      setImageFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    {imageFile.name} 제거
                  </button>
                ) : null}
              </div>

              <div className="flex gap-2">
                <input
                  className="input min-w-0 flex-1"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="메시지 입력"
                  disabled={!selectedPartner || busy}
                />
                <button
                  type="submit"
                  className="btn-primary shrink-0"
                  disabled={!selectedPartner || busy || (!String(body || '').trim() && !imageFile && !tagStudentId)}
                >
                  전송
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <button
        type="button"
        className="fixed bottom-6 right-6 z-50 flex h-16 w-16 items-center justify-center rounded-full border border-brand-700 bg-brand-800 text-sm font-bold text-white shadow-2xl transition hover:bg-brand-900"
        onClick={() => setOpen((value) => !value)}
        aria-label="채팅 열기"
      >
        채팅
        {unreadTotal > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-rose-600 px-1.5 py-0.5 text-xs font-semibold text-white ring-2 ring-white">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        ) : null}
      </button>
    </>
  );
}
