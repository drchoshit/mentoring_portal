import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../api.js';
import { useAuth } from '../auth/AuthProvider.jsx';

const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KO_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

function safeJson(text, fallback) {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function isoToDate(iso) {
  if (!iso) return null;
  const raw = String(iso).trim();
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

function fmtYMD(value) {
  const d = isoToDate(value);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-5xl p-5 bg-white">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-brand-900">{title}</div>
          <button className="btn-ghost" onClick={onClose}>닫기</button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function CalendarModal({ student, weekStart: weekStartProp, weekRangeText: weekRangeProp, onClose }) {
  const schedule = safeJson(student?.schedule_json, {});
  const weekStart = isoToDate(schedule?.week_start || weekStartProp);
  const weekRangeText = schedule?.week_range_text || weekRangeProp || '';

  const dayHeaders = EN_DAYS.map((_, i) => {
    const label = KO_DAYS[i];
    if (!weekStart) return `${label}`;
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return `${label}(${fmtMD(d)})`;
  });

  return (
    <Modal title={`${student?.name || ''} 님 주간 캘린더`} onClose={onClose}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-700">
          {weekRangeText ? <span className="font-medium">{weekRangeText}</span> : null}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm border border-slate-200 rounded-xl overflow-hidden">
          <thead>
            <tr className="bg-slate-50 text-slate-700">
              {dayHeaders.map((h) => (
                <th key={h} className="p-2 text-left whitespace-nowrap border-b border-slate-200">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {EN_DAYS.map((k, idx) => {
                const items = Array.isArray(schedule?.[k]) ? schedule[k] : [];
                return (
                  <td key={k} className="align-top p-2 border-b border-slate-200">
                    <div className="space-y-2 min-w-40">
                      {items.length ? items.map((it, i) => {
                        const type = String(it?.type || '').trim();
                        const isCenter = type.includes('센터');
                        const isExternal = type.includes('외부');
                        const baseCls = isCenter
                          ? 'border-emerald-200 bg-emerald-50'
                          : isExternal
                            ? 'border-sky-200 bg-sky-50'
                            : 'border-slate-200 bg-white';
                        return (
                          <div key={`${idx}-${i}`} className={`rounded-lg border px-2 py-1 ${baseCls}`}>
                            <div className="text-xs text-slate-600 whitespace-nowrap">{it?.time || ''}</div>
                            <div className="text-slate-800 leading-snug break-words">{it?.title || ''}</div>
                          </div>
                        );
                      }) : <div className="text-xs text-slate-400">—</div>}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        센터/외부(민간 라벨 입력)만 표시됩니다. 미등원 등 기타 항목은 파일 내용에 따라 표시될 수 있습니다.
      </div>
    </Modal>
  );
}

function PenaltyModal({ student, onClose }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!student?.id) return undefined;

    setLoading(true);
    setError('');
    api(`/api/penalties?studentId=${encodeURIComponent(student.id)}`)
      .then((r) => {
        if (!active) return;
        setItems(Array.isArray(r?.items) ? r.items : []);
        setTotalPoints(Number(r?.totalPoints || 0));
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || '불러오기에 실패했습니다.');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [student?.id]);

  return (
    <Modal title={`${student?.name || ''} 벌점 상세`} onClose={onClose}>
      {loading ? <div className="text-sm text-slate-600">불러오는 중...</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {!loading && !error ? (
        <div className="space-y-3">
          <div className="text-sm text-slate-700">
            누적 벌점: <span className="font-semibold text-brand-900">{totalPoints}</span>
          </div>
          <div className="space-y-2">
            {items.length ? (
              items.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 p-3">
                  <div>
                    <div className="text-sm text-slate-800">{p.reason}</div>
                    <div className="text-xs text-slate-500">{p.created_at || p.date || ''}</div>
                  </div>
                  <div className="text-xs font-semibold text-brand-900">{p.points > 0 ? `+${p.points}` : p.points}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-400">벌점 내역 없음</div>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function MentorImportMissingModal({ items, onClose }) {
  return (
    <Modal title="학생 별 멘토 파일 확인" onClose={onClose}>
      <div className="text-sm text-slate-700">
        리스트에 없는 학생 {items.length}명
      </div>
      <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600 bg-slate-50">
              <th className="p-2 whitespace-nowrap">ID</th>
              <th className="p-2 whitespace-nowrap">이름</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={`${it.id}-${it.name}`} className="border-t border-slate-200">
                <td className="p-2 whitespace-nowrap">{it.id}</td>
                <td className="p-2 whitespace-nowrap">{it.name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function MentorImportResultModal({ result, onClose }) {
  const status = String(result?.status || 'ok');
  const items = Array.isArray(result?.missing) ? result.missing : [];
  const storedCount = Number(result?.storedCount || 0);
  const message = String(result?.message || '').trim();

  const summaryText = status === 'failed'
    ? (message || '파일 불러오기에 실패했습니다.')
    : status === 'partial'
      ? `일부 학생 매칭 실패: ${items.length}명`
      : '파일 불러오기가 완료되었습니다.';

  const summaryClass = status === 'failed'
    ? 'text-red-600'
    : status === 'partial'
      ? 'text-amber-700'
      : 'text-emerald-700';

  return (
    <Modal title="학생 별 멘토 파일 확인" onClose={onClose}>
      <div className={`text-sm ${summaryClass}`}>{summaryText}</div>
      <div className="mt-2 text-xs text-slate-600">
        반영 학생: {storedCount}명 / 미매칭 학생: {items.length}명
      </div>
      {items.length ? (
        <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 bg-slate-50">
                <th className="p-2 whitespace-nowrap">ID</th>
                <th className="p-2 whitespace-nowrap">이름</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={`${it.id}-${it.name}`} className="border-t border-slate-200">
                  <td className="p-2 whitespace-nowrap">{it.id}</td>
                  <td className="p-2 whitespace-nowrap">{it.name || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  );
}

function LegacyImagesModal({ student, onClose }) {
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState([]);
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  async function load() {
    if (!student?.id) return;
    setLoading(true);
    setError('');
    try {
      const r = await api(`/api/students/${student.id}/legacy-images`);
      setImages(Array.isArray(r?.images) ? r.images : []);
    } catch (e) {
      setError(e.message || '불러오기에 실패했습니다.');
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [student?.id]);

  const remaining = Math.max(0, 3 - images.length);

  async function upload() {
    if (!files.length) {
      setError('이미지를 선택해 주세요.');
      return;
    }
    if (files.length > remaining) {
      setError(`최대 ${remaining}장까지 추가할 수 있습니다.`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      await api(`/api/students/${student.id}/legacy-images`, { method: 'POST', body: form });
      setFiles([]);
      setInputKey((k) => k + 1);
      await load();
    } catch (e) {
      setError(e.message || '업로드에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(imageId) {
    if (!imageId) return;
    const ok = confirm('이미지를 삭제할까요?');
    if (!ok) return;

    setBusy(true);
    setError('');
    try {
      await api(`/api/students/${student.id}/legacy-images/${imageId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e.message || '삭제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${student?.name || ''} 이전 기록 업로드`} onClose={onClose}>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="text-xs text-slate-500">최대 3장까지 업로드할 수 있습니다.</div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {images.length ? (
          images.map((img) => (
            <div key={img.id} className="relative rounded-xl border border-slate-200 bg-white/70 p-2">
              <img
                src={`data:${img.mime_type};base64,${img.data_base64}`}
                alt="legacy record"
                className="w-full rounded-lg border border-slate-200 object-contain"
              />
              <button
                className="btn-ghost text-red-600 absolute top-2 right-2"
                onClick={() => remove(img.id)}
                disabled={busy}
              >
                삭제
              </button>
            </div>
          ))
        ) : (
          <div className="text-sm text-slate-400">등록된 이미지가 없습니다.</div>
        )}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          key={inputKey}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        <button className="btn-primary" onClick={upload} disabled={busy || remaining <= 0}>
          업로드
        </button>
        <div className="text-xs text-slate-500">남은 업로드: {remaining}장</div>
      </div>
    </Modal>
  );
}

function StudentDetailModal({ student, onClose, onSaved }) {
  const [name, setName] = useState(student?.name || '');
  const [grade, setGrade] = useState(student?.grade || '');
  const [studentPhone, setStudentPhone] = useState(student?.student_phone || '');
  const [parentPhone, setParentPhone] = useState(student?.parent_phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/students/${student.id}`, {
        method: 'PUT',
        body: {
          name: name.trim(),
          grade: grade.trim(),
          student_phone: studentPhone.trim(),
          parent_phone: parentPhone.trim(),
          schedule: safeJson(student?.schedule_json, {})
        }
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="학생 정보" onClose={onClose}>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-slate-600">학생 ID</div>
          <div className="mt-1 input bg-slate-50 flex items-center">{student?.external_id || ''}</div>
        </div>
        <div />
        <label className="block">
          <div className="text-xs text-slate-600">이름</div>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="text-xs text-slate-600">학년</div>
          <input className="input mt-1" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="예: 고2" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-600">학생 전화</div>
          <input className="input mt-1" value={studentPhone} onChange={(e) => setStudentPhone(e.target.value)} placeholder="010-0000-0000" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-600">보호자 전화</div>
          <input className="input mt-1" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="010-0000-0000" />
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>저장</button>
      </div>
    </Modal>
  );
}

function StudentCreateModal({ onClose, onSaved }) {
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/students', {
        method: 'POST',
        body: {
          external_id: externalId.trim() || null,
          name: name.trim(),
          grade: grade.trim(),
          student_phone: studentPhone.trim(),
          parent_phone: parentPhone.trim(),
          schedule: {}
        }
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message || '학생 추가에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="학생 추가" onClose={onClose}>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <div className="text-xs text-slate-600">학생 ID (external_id)</div>
          <input className="input mt-1" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="비워두면 자동" />
        </label>
        <div />
        <label className="block">
          <div className="text-xs text-slate-600">이름</div>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="text-xs text-slate-600">학년</div>
          <input className="input mt-1" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="예: 고2" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-600">학생 전화</div>
          <input className="input mt-1" value={studentPhone} onChange={(e) => setStudentPhone(e.target.value)} placeholder="010-0000-0000" />
        </label>
        <label className="block">
          <div className="text-xs text-slate-600">보호자 전화</div>
          <input className="input mt-1" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="010-0000-0000" />
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" onClick={create} disabled={busy || !name.trim()}>추가</button>
      </div>
    </Modal>
  );
}

export default function Students() {
  const showStudentAddButtons = false;
  const showStudentDeleteButtons = true;
  const { user } = useAuth();
  const nav = useNavigate();
  const [students, setStudents] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const [studentInfoFile, setStudentInfoFile] = useState(null);
  const [scheduleFile, setScheduleFile] = useState(null);
  const [penaltyFile, setPenaltyFile] = useState(null);
  const [mentorFile, setMentorFile] = useState(null);
  const [mentorImportMap, setMentorImportMap] = useState({});
  const [mentorImportResult, setMentorImportResult] = useState(null);
  const [busyImport, setBusyImport] = useState(false);
  const [busyBackup, setBusyBackup] = useState(false);
  const backupInputRef = useRef(null);
  const [legacyStudent, setLegacyStudent] = useState(null);
  const [workflowDates, setWorkflowDates] = useState({});
  const [selectedWorkflowStudentIds, setSelectedWorkflowStudentIds] = useState([]);
  const [bulkSharingParents, setBulkSharingParents] = useState(false);

  const [penaltySummary, setPenaltySummary] = useState({});
  const [detailStudent, setDetailStudent] = useState(null);
  const [calendarStudent, setCalendarStudent] = useState(null);
  const [penaltyStudent, setPenaltyStudent] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const workflowCardRef = useRef(null);

  const role = user?.role;
  const isMentor = role === 'mentor';
  const canImport = (role === 'director' || role === 'admin');
  const canLegacyUpload = role === 'director';
  const canSeePhones = role === 'director' || role === 'admin';
  const canSeeDetail = role === 'director' || role === 'admin';
  const canSeeDelete = role === 'director' || role === 'admin';
  const canSeePenalty = !isMentor;
  const canSeeId = !isMentor;
  const canSeeMentorColumns = role === 'director' || role === 'admin';
  const canBulkShareParents = role === 'director';

  function jumpToWorkflowStatus() {
    workflowCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadPenaltySummary() {
    try {
      const r = await api('/api/penalties/summary');
      const next = {};
      (r?.items || []).forEach((row) => {
        next[row.student_id] = {
          totalPoints: Number(row.totalPoints || 0),
          count: Number(row.count || 0)
        };
      });
      setPenaltySummary(next);
    } catch {
      setPenaltySummary({});
    }
  }

  async function load() {
    setError('');
    try {
      const s = await api('/api/students');
      const w = await api('/api/weeks');
      setStudents(s.students || []);
      setWeeks(w.weeks || []);
      let nextWeekId = selectedWeek;
      const shouldDeferWorkflowLoad = !nextWeekId && (w.weeks || []).length;
      if (shouldDeferWorkflowLoad) {
        nextWeekId = String(w.weeks[0].id);
        setSelectedWeek(nextWeekId);
      }
      await loadPenaltySummary();
      if (user?.role === 'director' || user?.role === 'admin') {
        await loadMentorAssignments();
        if (nextWeekId && !shouldDeferWorkflowLoad) {
          await loadWorkflowDates(nextWeekId);
        }
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (canImport) {
      loadMentorAssignments();
    } else {
      setMentorImportMap({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport]);

  useEffect(() => {
    if (!selectedWeek || !canSeeMentorColumns) return;
    loadWorkflowDates(selectedWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek, canSeeMentorColumns]);

  async function downloadBackup() {
    if (!canImport) return;
    setError('');
    setBusyBackup(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadFile('/api/backups/export', `mentoring_backup_${stamp}.json`);
    } catch (e) {
      setError(e.message || '백업 다운로드에 실패했습니다.');
    } finally {
      setBusyBackup(false);
    }
  }

  async function importBackup(file) {
    if (!file) return;
    if (!canImport) return;

    const ok = confirm('백업 파일을 불러오면 현재 데이터가 모두 덮어씌워집니다. 진행할까요?');
    if (!ok) return;

    setBusyBackup(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api('/api/backups/import', { method: 'POST', body: fd });
      await load();
      alert('불러오기가 완료되었습니다. 페이지를 새로고침해 주세요.');
    } catch (e) {
      setError(e.message || '불러오기에 실패했습니다.');
    } finally {
      setBusyBackup(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return students;
    return students.filter(s => String(s.name || '').includes(q) || String(s.external_id || '').includes(q));
  }, [students, query]);

  const mentorAssignedCount = useMemo(() => {
    if (!canSeeMentorColumns) return 0;
    return filtered.filter((s) => {
      const keys = [];
      if (s.external_id) keys.push(String(s.external_id));
      keys.push(String(s.id));
      let info = null;
      for (const key of keys) {
        if (mentorImportMap?.[key]) {
          info = mentorImportMap[key];
          break;
        }
      }
      return String(info?.mentor || '').trim();
    }).length;
  }, [canSeeMentorColumns, filtered, mentorImportMap]);

  const sharedCount = useMemo(() => {
    if (!canSeeMentorColumns) return 0;
    return filtered.filter((s) => workflowDates?.[s.id]?.sharedAt).length;
  }, [canSeeMentorColumns, filtered, workflowDates]);

  const selectedWeekObj = useMemo(
    () => (weeks || []).find((w) => String(w.id) === String(selectedWeek)),
    [weeks, selectedWeek]
  );
  const selectedWorkflowSet = useMemo(
    () => new Set((selectedWorkflowStudentIds || []).map((id) => String(id))),
    [selectedWorkflowStudentIds]
  );
  const filteredWorkflowStudentIds = useMemo(
    () => (filtered || []).map((s) => String(s.id)),
    [filtered]
  );
  const selectedWorkflowCount = useMemo(
    () => filteredWorkflowStudentIds.filter((id) => selectedWorkflowSet.has(id)).length,
    [filteredWorkflowStudentIds, selectedWorkflowSet]
  );
  const allWorkflowSelected = filteredWorkflowStudentIds.length > 0
    && selectedWorkflowCount === filteredWorkflowStudentIds.length;
  const selectedWeekRangeText = selectedWeekObj?.start_date && selectedWeekObj?.end_date
    ? `${selectedWeekObj.start_date}~${selectedWeekObj.end_date}`
    : '';

  useEffect(() => {
    setSelectedWorkflowStudentIds([]);
  }, [selectedWeek]);

  useEffect(() => {
    const validIds = new Set((students || []).map((s) => String(s.id)));
    setSelectedWorkflowStudentIds((prev) => prev.filter((id) => validIds.has(String(id))));
  }, [students]);

  async function uploadFile(endpoint, file) {
    if (!file) {
      setError('파일을 선택해 주세요.');
      return;
    }
    setBusyImport(true);
    setError('');
    setMentorImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api(endpoint, { method: 'POST', body: fd });
      await load();
      if (endpoint === '/api/import/penalties') {
        const inserted = Number(result?.inserted || 0);
        const skippedNoStudent = Number(result?.skippedNoStudent || 0);
        const skippedNoWeek = Number(result?.skippedNoWeek || 0);
        if (inserted === 0) {
          setError(`벌점 반영 0건 (학생 매칭 실패 ${skippedNoStudent}건, 주차 매칭 실패 ${skippedNoWeek}건). 파일의 학생 ID/이름이 현재 학생 목록과 같은지 확인해주세요.`);
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyImport(false);
    }
  }

  function buildMentorMap(data) {
    const list = Array.isArray(data?.assignments) ? data.assignments : [];
    const next = {};
    list.forEach((row) => {
      const entry = {
        mentor: String(row?.mentor ?? '').trim(),
        scheduledDays: Array.isArray(row?.scheduledDays) ? row.scheduledDays : []
      };
      if (row?.student_id != null) next[String(row.student_id)] = entry;
      if (row?.external_id) next[String(row.external_id)] = entry;
    });
    return next;
  }

  async function loadMentorAssignments() {
    try {
      const r = await api('/api/mentor-assignments');
      setMentorImportMap(buildMentorMap(r?.data));
    } catch {
      setMentorImportMap({});
    }
  }

  async function loadWorkflowDates(weekId) {
    if (!weekId || !canSeeMentorColumns) {
      setWorkflowDates({});
      return;
    }
    try {
      const r = await api(`/api/students/workflow-dates?weekId=${encodeURIComponent(weekId)}`);
      const next = {};
      (r?.items || []).forEach((row) => {
        if (row?.student_id != null) {
          next[row.student_id] = {
            mentorSubmittedAt: row.mentor_submitted_at || '',
            leadSubmittedAt: row.lead_submitted_at || '',
            sharedAt: row.shared_at || ''
          };
        }
      });
      setWorkflowDates(next);
    } catch {
      setWorkflowDates({});
    }
  }

  async function importMentorFile(file) {
    if (!file) {
      setError('파일을 선택해 주세요.');
      return;
    }
    setBusyImport(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api('/api/mentor-assignments/import', { method: 'POST', body: fd });
      setMentorImportMap(buildMentorMap(r?.data));
      const missing = Array.isArray(r?.missing) ? r.missing : [];
      const storedCount = Array.isArray(r?.data?.assignments) ? r.data.assignments.length : 0;
      setMentorImportResult({
        status: missing.length ? 'partial' : 'ok',
        storedCount,
        missing,
        message: ''
      });
    } catch (e) {
      const msg = e.message || '학생 별 멘토 파일 불러오기에 실패했습니다.';
      setMentorImportResult({
        status: 'failed',
        storedCount: 0,
        missing: [],
        message: msg
      });
      setError(e.message || '학생 별 멘토 파일을 읽는 데 실패했습니다.');
    } finally {
      setBusyImport(false);
    }
  }

  function confirmImportAction(label) {
    return confirm(`${label}\n\n진행할까요? 기존 데이터가 업데이트될 수 있습니다.`);
  }

  const getMentorInfo = (student) => {
    if (!student) return null;
    const keys = [];
    if (student.external_id) keys.push(String(student.external_id));
    keys.push(String(student.id));
    for (const key of keys) {
      if (mentorImportMap?.[key]) return mentorImportMap[key];
    }
    return null;
  };

  // 추가: 학생 삭제
  async function deleteStudent(s) {
    if (!s?.id) return;
    const name = String(s.name || '').trim();
    const ext = String(s.external_id || '').trim();
    const ok = confirm(`정말 삭제할까요?\n\n이름: ${name}\nID: ${ext}\n\n(학생 관련 데이터도 함께 삭제될 수 있습니다)`);
    if (!ok) return;

    setError('');
    try {
      await api(`/api/students/${s.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function toggleWorkflowStudent(studentId) {
    if (!canBulkShareParents) return;
    const key = String(studentId);
    setSelectedWorkflowStudentIds((prev) =>
      prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]
    );
  }

  function toggleWorkflowStudentsOnPage() {
    if (!canBulkShareParents) return;
    setSelectedWorkflowStudentIds((prev) => {
      const prevSet = new Set(prev.map((id) => String(id)));
      if (allWorkflowSelected) {
        return prev.filter((id) => !filteredWorkflowStudentIds.includes(String(id)));
      }
      filteredWorkflowStudentIds.forEach((id) => prevSet.add(id));
      return Array.from(prevSet);
    });
  }

  function collectSelectedWorkflowIds() {
    return Array.from(
      new Set(
        (selectedWorkflowStudentIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
  }

  async function bulkShareWithParent() {
    if (!canBulkShareParents) return;
    if (!selectedWeek) {
      alert('먼저 주차를 선택해 주세요.');
      return;
    }
    const targetIds = Array.from(
      new Set(
        (selectedWorkflowStudentIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    if (!targetIds.length) {
      alert('학부모에게 공유할 학생을 먼저 체크해 주세요.');
      return;
    }
    const ok = confirm(
      `${selectedWeekObj?.label || '선택 주차'} 기준으로 선택한 ${targetIds.length}명의 멘토링 기록을 학부모에게 공유할까요?`
    );
    if (!ok) return;

    setBulkSharingParents(true);
    setError('');
    try {
      const r = await api('/api/mentoring/workflow/share-with-parent/bulk', {
        method: 'POST',
        body: {
          week_id: Number(selectedWeek),
          student_ids: targetIds
        }
      });
      await loadWorkflowDates(selectedWeek);
      setSelectedWorkflowStudentIds([]);

      const updatedCount = Array.isArray(r?.updated) ? r.updated.length : Number(r?.updated_count || 0);
      const skippedCount = Array.isArray(r?.skipped) ? r.skipped.length : Number(r?.skipped_count || 0);
      alert(
        `학부모 공유 처리 완료\n선택: ${targetIds.length}명\n공유 완료: ${updatedCount}명\n건너뜀: ${skippedCount}명`
      );
    } catch (e) {
      const msg = e.message || '학부모 공유 처리 중 오류가 발생했습니다.';
      setError(msg);
      alert(`학부모 공유 처리 실패\n${msg}`);
    } finally {
      setBulkSharingParents(false);
    }
  }

  async function bulkUnshareWithParent() {
    if (!canBulkShareParents) return;
    if (!selectedWeek) {
      alert('먼저 주차를 선택해 주세요.');
      return;
    }
    const targetIds = collectSelectedWorkflowIds();
    if (!targetIds.length) {
      alert('학부모 공유를 취소할 학생을 먼저 체크해 주세요.');
      return;
    }
    const ok = confirm(
      `${selectedWeekObj?.label || '선택 주차'} 기준으로 선택한 ${targetIds.length}명의 학부모 공유를 취소할까요?`
    );
    if (!ok) return;

    setBulkSharingParents(true);
    setError('');
    try {
      const r = await api('/api/mentoring/workflow/unshare-with-parent/bulk', {
        method: 'POST',
        body: {
          week_id: Number(selectedWeek),
          student_ids: targetIds
        }
      });
      await loadWorkflowDates(selectedWeek);
      setSelectedWorkflowStudentIds([]);

      const updatedCount = Array.isArray(r?.updated) ? r.updated.length : Number(r?.updated_count || 0);
      const skippedCount = Array.isArray(r?.skipped) ? r.skipped.length : Number(r?.skipped_count || 0);
      alert(
        `학부모 공유 취소 완료\n선택: ${targetIds.length}명\n취소 완료: ${updatedCount}명\n건너뜀: ${skippedCount}명`
      );
    } catch (e) {
      const msg = e.message || '학부모 공유 취소 중 오류가 발생했습니다.';
      setError(msg);
      alert(`학부모 공유 취소 실패\n${msg}`);
    } finally {
      setBulkSharingParents(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-800">학생</div>
            <div className="text-sm text-slate-600">학생을 선택해 주차별 멘토링 기록으로 이동합니다.</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select className="input w-40" value={selectedWeek} onChange={(e)=>setSelectedWeek(e.target.value)}>
              {(weeks || []).map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
            <input className="input w-64" placeholder="검색(이름/ID)" value={query} onChange={(e)=>setQuery(e.target.value)} />
            {canSeeMentorColumns ? (
              <button className="btn-ghost whitespace-nowrap px-4" onClick={jumpToWorkflowStatus}>
                제출/공유 현황 이동
              </button>
            ) : null}
            {canImport && showStudentAddButtons ? (
              <button className="btn-primary whitespace-nowrap px-4" onClick={() => setCreateOpen(true)}>
                추가
              </button>
            ) : null}
            <button className="btn-ghost whitespace-nowrap px-4" onClick={load}>새로고침</button>
            {canImport ? (
              <>
                <button className="btn-primary whitespace-nowrap px-4" onClick={downloadBackup} disabled={busyBackup}>
                  전체 저장
                </button>
                <button className="btn-ghost whitespace-nowrap px-4" onClick={() => backupInputRef.current?.click()} disabled={busyBackup}>
                  불러오기
                </button>
              </>
            ) : null}
          </div>
        </div>
        {canImport ? (
          <div className="mt-2 text-xs text-rose-600">
            *전체 저장은 모든 데이터를 백업 파일로 다운로드합니다.
          </div>
        ) : null}
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>
      {canImport ? (
        <input
          ref={backupInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => importBackup(e.target.files?.[0] || null)}
        />
      ) : null}

      {canImport ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <div className="text-sm font-semibold text-brand-800">학생 정보 불러오기</div>
            <div className="mt-1 text-xs text-slate-500">학생 리스트/상세 정보 JSON 파일을 업로드합니다.</div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                className="input flex-1"
                type="file"
                accept=".json,application/json"
                onChange={(e) => setStudentInfoFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn-primary whitespace-nowrap"
                disabled={busyImport}
                onClick={() => {
                  if (!confirmImportAction('학생 정보 불러오기')) return;
                  uploadFile('/api/import/students', studentInfoFile);
                }}
              >
                불러오기
              </button>
            </div>
          </div>
          <div className="card p-5">
            <div className="text-sm font-semibold text-brand-800">학생 일정 불러오기</div>
            <div className="mt-1 text-xs text-slate-500">학생 일정 JSON 파일을 업로드합니다. (캘린더만 갱신)</div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                className="input flex-1"
                type="file"
                accept=".json,application/json"
                onChange={(e) => setScheduleFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn-primary whitespace-nowrap"
                disabled={busyImport}
                onClick={() => {
                  if (!confirmImportAction('학생 일정 불러오기')) return;
                  uploadFile('/api/import/schedule-backup', scheduleFile);
                }}
              >
                불러오기
              </button>
            </div>
          </div>

          <div className="card p-5">
            <div className="text-sm font-semibold text-brand-800">벌점 정보 불러오기</div>
            <div className="mt-1 text-xs text-slate-500">벌점 JSON 파일을 업로드합니다.</div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                className="input flex-1"
                type="file"
                accept=".json,application/json"
                onChange={(e) => setPenaltyFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn-primary whitespace-nowrap"
                disabled={busyImport}
                onClick={() => {
                  if (!confirmImportAction('벌점 정보 불러오기')) return;
                  uploadFile('/api/import/penalties', penaltyFile);
                }}
              >
                불러오기
              </button>
            </div>
          </div>

          <div className="card p-5">
            <div className="text-sm font-semibold text-brand-800">학생 별 멘토 파일 불러오기</div>
            <div className="mt-1 text-xs text-slate-500">학생별 멘토/요일 JSON 파일을 업로드합니다.</div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                className="input flex-1"
                type="file"
                accept=".json,application/json"
                onChange={(e) => setMentorFile(e.target.files?.[0] || null)}
              />
              <button
                className="btn-primary whitespace-nowrap"
                disabled={busyImport}
                onClick={() => {
                  if (!confirmImportAction('학생 별 멘토 파일 불러오기')) return;
                  importMentorFile(mentorFile);
                }}
              >
                불러오기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-brand-800">등록된 학생 ({filtered.length}명)</div>
            <div className="mt-1 text-xs text-slate-600">학생 기본 정보 및 멘토링 이동 액션</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
              검색 결과 {filtered.length}명
            </span>
            {canSeeMentorColumns ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">
                멘토 배정 {mentorAssignedCount}명
              </span>
            ) : null}
            {canSeeMentorColumns ? (
              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-800">
                학부모 공유 {sharedCount}명
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600 bg-slate-50/80">
                {canSeeId ? <th className="py-3 px-3 whitespace-nowrap">ID</th> : null}
                <th className="px-3 whitespace-nowrap">이름</th>
                <th className="px-3 whitespace-nowrap">학년</th>
                {canSeePhones ? <th className="px-3 whitespace-nowrap">학생전화</th> : null}
                {canSeePhones ? <th className="px-3 whitespace-nowrap">보호자전화</th> : null}
                {canSeePenalty ? <th className="px-3 whitespace-nowrap">벌점</th> : null}
                <th className="px-3 text-right whitespace-nowrap">상세</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => {
                return (
                  <tr key={s.id} className={['border-t border-slate-200 transition-colors', idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white/80', 'hover:bg-gold-50/50'].join(' ')}>
                    {canSeeId ? <td className="py-2 px-3 whitespace-nowrap">{s.external_id || ''}</td> : null}
                    <td className="px-3 whitespace-nowrap font-medium text-slate-900">{s.name}</td>
                    <td className="px-3 whitespace-nowrap">{s.grade || ''}</td>
                    {canSeePhones ? <td className="px-3 whitespace-nowrap">{s.student_phone || ''}</td> : null}
                    {canSeePhones ? <td className="px-3 whitespace-nowrap">{s.parent_phone || ''}</td> : null}
                    {canSeePenalty ? (
                      <td className="px-3 whitespace-nowrap">
                        <button
                          className="btn-ghost"
                          onClick={() => setPenaltyStudent(s)}
                          disabled={!penaltySummary?.[s.id]?.count}
                        >
                          {penaltySummary?.[s.id] ? penaltySummary[s.id].totalPoints : '-'}
                        </button>
                      </td>
                    ) : null}
                    <td className="px-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        {canSeeDetail ? (
                          <button className="btn-ghost" onClick={() => setDetailStudent(s)} disabled={!canImport}>상세</button>
                        ) : null}
                        <button className="btn-ghost" onClick={() => setCalendarStudent(s)}>캘린더</button>

                        {canSeeDelete && showStudentDeleteButtons ? (
                          <button
                            className="btn-ghost text-red-600"
                            onClick={() => deleteStudent(s)}
                            disabled={!canImport}
                          >
                            삭제
                          </button>
                        ) : null}

                        {canLegacyUpload ? (
                          <button className="btn-ghost" onClick={() => setLegacyStudent(s)}>
                            기록 업로드
                          </button>
                        ) : null}

                        <button
                          className="btn-primary"
                          onClick={() => nav(`/students/${s.id}/mentoring?week=${encodeURIComponent(selectedWeek)}`)}
                          disabled={!selectedWeek}
                        >
                          멘토링
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {canSeeMentorColumns ? (
        <div ref={workflowCardRef} className="card p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-brand-800">멘토링 기록 제출/공유 현황 ({filtered.length}명)</div>
                {canBulkShareParents ? (
                  <>
                    <button
                      className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs"
                      onClick={bulkShareWithParent}
                      disabled={bulkSharingParents || !selectedWeek || !selectedWorkflowStudentIds.length}
                    >
                      {bulkSharingParents ? '공유 중...' : '학부모 공유'}
                    </button>
                    <button
                      className="btn-ghost whitespace-nowrap px-3 py-1.5 text-xs"
                      onClick={bulkUnshareWithParent}
                      disabled={bulkSharingParents || !selectedWeek || !selectedWorkflowStudentIds.length}
                    >
                      {bulkSharingParents ? '처리 중...' : '공유 취소'}
                    </button>
                    <span className="text-xs text-slate-500">
                      선택 {selectedWorkflowStudentIds.length}명
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            {selectedWeekObj ? <div className="text-xs text-slate-600">{selectedWeekObj.label}</div> : null}
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white/90 shadow-inner">
            <table className="w-full min-w-[1060px] text-sm">
              <colgroup>
                {canBulkShareParents ? <col className="bg-amber-50/35" /> : null}
                <col className="bg-amber-50/60" />
                <col className="bg-emerald-50/55" />
                <col className="bg-emerald-50/35" />
                <col className="bg-sky-50/40" />
                <col className="bg-sky-50/30" />
                <col className="bg-sky-50/40" />
              </colgroup>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 bg-slate-100/70">
                  {canBulkShareParents ? (
                    <th className="py-2 px-3 whitespace-nowrap border-b border-slate-200 text-center" rowSpan={2}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-600"
                        checked={allWorkflowSelected}
                        onChange={toggleWorkflowStudentsOnPage}
                        disabled={bulkSharingParents || !filteredWorkflowStudentIds.length}
                        aria-label="전체 선택"
                      />
                    </th>
                  ) : null}
                  <th className="py-2 px-3 whitespace-nowrap border-b border-slate-200">학생 리스트(위 등록된 학생과 동일)</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200" colSpan={2}>이번주 멘토명 / 멘토링 요일</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200" colSpan={3}>학습멘토링 기록 제출일 / 총괄멘토링 기록 제출일 / 학부모 공유일</th>
                </tr>
                <tr className="text-left text-slate-700 bg-white/80">
                  <th className="py-2.5 px-3 whitespace-nowrap border-b border-slate-200">학생</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200">이번주 멘토명</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200">멘토링 요일</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200">학습멘토링 기록 제출일</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200">총괄멘토링 기록 제출일</th>
                  <th className="px-3 whitespace-nowrap border-b border-slate-200">학부모 공유일</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, idx) => {
                  const mentorInfo = getMentorInfo(s);
                  const mentorName = String(mentorInfo?.mentor || '').trim();
                  const mentorDays = Array.isArray(mentorInfo?.scheduledDays) ? mentorInfo.scheduledDays : [];
                  const workflow = workflowDates?.[s.id] || {};
                  const mentorSubmitted = workflow.mentorSubmittedAt ? fmtYMD(workflow.mentorSubmittedAt) : '';
                  const leadSubmitted = workflow.leadSubmittedAt ? fmtYMD(workflow.leadSubmittedAt) : '';
                  const shared = workflow.sharedAt ? fmtYMD(workflow.sharedAt) : '';
                  const checked = selectedWorkflowSet.has(String(s.id));
                  return (
                    <tr key={`workflow-${s.id}`} className={['transition-colors', idx % 2 === 1 ? 'bg-white/75' : 'bg-white/95', 'hover:bg-gold-50/45'].join(' ')}>
                      {canBulkShareParents ? (
                        <td className="px-3 whitespace-nowrap border-b border-slate-100 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-emerald-600"
                            checked={checked}
                            onChange={() => toggleWorkflowStudent(s.id)}
                            disabled={bulkSharingParents}
                            aria-label={`${s.name || '학생'} 선택`}
                          />
                        </td>
                      ) : null}
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-900 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">{s.external_id || '-'}</span>
                          <span>{s.name || '-'}</span>
                        </div>
                      </td>
                      <td className="px-3 whitespace-nowrap border-b border-slate-100">
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-800">
                          {mentorName || '-'}
                        </span>
                      </td>
                      <td className="px-3 whitespace-nowrap border-b border-slate-100">{mentorDays.length ? mentorDays.join(', ') : '-'}</td>
                      <td className="px-3 whitespace-nowrap border-b border-slate-100">
                        {mentorSubmitted ? (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-700">
                            {mentorSubmitted}
                          </span>
                        ) : (
                          <span className="text-slate-400">미제출</span>
                        )}
                      </td>
                      <td className="px-3 whitespace-nowrap border-b border-slate-100">
                        {leadSubmitted ? (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-700">
                            {leadSubmitted}
                          </span>
                        ) : (
                          <span className="text-slate-400">미제출</span>
                        )}
                      </td>
                      <td className="px-3 whitespace-nowrap border-b border-slate-100">
                        {shared ? (
                          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs text-sky-800">
                            {shared}
                          </span>
                        ) : (
                          <span className="text-slate-400">미공유</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <StudentCreateModal onClose={() => setCreateOpen(false)} onSaved={load} />
      ) : null}
      {detailStudent ? (
        <StudentDetailModal student={detailStudent} onClose={() => setDetailStudent(null)} onSaved={load} />
      ) : null}
      {calendarStudent ? (
        <CalendarModal
          student={calendarStudent}
          weekStart={selectedWeekObj?.start_date}
          weekRangeText={selectedWeekRangeText}
          onClose={() => setCalendarStudent(null)}
        />
      ) : null}
      {penaltyStudent ? (
        <PenaltyModal student={penaltyStudent} onClose={() => setPenaltyStudent(null)} />
      ) : null}
      {mentorImportResult ? (
        <MentorImportResultModal result={mentorImportResult} onClose={() => setMentorImportResult(null)} />
      ) : null}
      {legacyStudent ? (
        <LegacyImagesModal student={legacyStudent} onClose={() => setLegacyStudent(null)} />
      ) : null}
    </div>
  );
}
