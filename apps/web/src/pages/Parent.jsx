import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

function safeJson(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(v);
  } catch {
    return fallback;
  }
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
  if (Array.isArray(value)) return value.map(normalizeLastHwTask).filter((t) => t.text);
  const raw = String(value);
  const parsed = safeJson(raw, null);
  if (Array.isArray(parsed)) return parsed.map(normalizeLastHwTask).filter((t) => t.text);
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((text) => ({ text, done: null, progress: '' }));
}

function renderLastHw(value) {
  const tasks = parseLastHwTasks(value);
  if (!tasks.length) return null;
  return (
    <div className="space-y-2">
      {tasks.map((t, idx) => (
        <div key={`${t.text}-${idx}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/70 px-2 py-1.5 text-sm">
          <div className="flex-1 whitespace-pre-wrap text-slate-800">{t.text}</div>
          {t.done === true ? (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
              완료
            </span>
          ) : t.done === false ? (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-800">
              진행중{t.progress ? ` · ${t.progress}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
              상태 미선택
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const DAY_LABELS = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
const DAYS = [
  { k: 'Mon', label: '월' },
  { k: 'Tue', label: '화' },
  { k: 'Wed', label: '수' },
  { k: 'Thu', label: '목' },
  { k: 'Fri', label: '금' },
  { k: 'Sat', label: '토' },
  { k: 'Sun', label: '일' }
];

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function fmtMD(d) {
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `${m}/${dd}`;
}

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100/70 px-2 py-0.5 text-[11px] text-amber-900">
      {children}
    </span>
  );
}

const SECTION_TONES = {
  header: 'border-amber-200/60 bg-amber-50/35',
  calendar: 'border-emerald-200/60 bg-emerald-50/35',
  penalties: 'border-rose-200/60 bg-rose-50/35',
  mentor: 'border-violet-200/60 bg-violet-50/30',
  curriculum: 'border-sky-200/60 bg-sky-50/30',
  subjects: 'border-amber-200/60 bg-amber-50/30',
  daily: 'border-blue-200/60 bg-blue-50/30',
  weekly: 'border-emerald-200/60 bg-emerald-50/30'
};

const DEFAULT_PARENT_MENTOR_NOTICE = '멘토 및 멘토링 요일은 학생의 일정에 따라 변경될 수 있습니다.';

const SUBJECT_TONES = [
  'border-emerald-200/60 bg-emerald-50/35',
  'border-amber-200/60 bg-amber-50/35',
  'border-violet-200/60 bg-violet-50/30',
  'border-sky-200/60 bg-sky-50/30',
  'border-rose-200/60 bg-rose-50/30'
];

function InfoPill({ label, value }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs text-slate-700">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900">{value || '-'}</span>
    </span>
  );
}

function SectionTitle({ title, right }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="text-sm font-semibold text-brand-900">{title}</div>
      {right ? <div className="text-xs text-slate-500">{right}</div> : null}
    </div>
  );
}

function classifySchedule(it) {
  const type = String(it?.type || '').trim();
  const title = String(it?.title || '').trim();

  const isAbsence = type.includes('결석') || title.includes('결석') || type.includes('결강') || title.includes('결강');
  const isCenter = type.includes('센터');
  const isExternal = type.includes('외부');

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
    <div className="mt-3">
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5">센터</span>
        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5">센터 외</span>
        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5">결석/결강</span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[940px] grid grid-cols-7 gap-3">
          {DAYS.map((d, idx) => {
            const dateLabel = start
              ? (() => {
                  const day = new Date(start);
                  day.setDate(day.getDate() + idx);
                  return `${DAY_LABELS[d.k]} (${fmtMD(day)})`;
                })()
              : DAY_LABELS[d.k];
            const items = Array.isArray(schedule?.[d.k]) ? schedule[d.k] : [];
            return (
              <div key={d.k} className="rounded-2xl border border-slate-200 bg-white/70 p-3 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">{dateLabel}</div>
                <div className="mt-2 space-y-2">
                  {items.length ? (
                    items.map((it, i) => {
                      const kind = classifySchedule(it);
                      return (
                        <div key={i} className={['rounded-xl border px-3 py-2 shadow-sm', scheduleTone(kind)].join(' ')}>
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

function RecordBox({ title, value, tone = 'border-slate-200 bg-white/60' }) {
  if (!value) return null;
  return (
    <div className={['rounded-xl border p-3', tone].join(' ')}>
      <div className="text-xs font-semibold text-brand-800">{title}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{value}</div>
    </div>
  );
}

function DayNote({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
      <div className="text-xs font-semibold text-brand-800">{label}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{value || '없음'}</div>
    </div>
  );
}

export default function Parent() {
  const [loading, setLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [allWeeks, setAllWeeks] = useState([]);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedWeekId, setSelectedWeekId] = useState('');
  const [record, setRecord] = useState(null);
  const [mentorNotice, setMentorNotice] = useState(null);

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const r = await api('/api/parent/overview');
      const list = r.items || [];
      setItems(list);
      const firstStudent = list[0]?.student?.id ? String(list[0].student.id) : '';
      setSelectedStudentId((prev) => prev || firstStudent);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWeeks() {
    try {
      const r = await api('/api/weeks');
      const list = Array.isArray(r?.weeks) ? r.weeks : [];
      list.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
      setAllWeeks(list);
      if (!selectedWeekId && list[0]?.id) {
        setSelectedWeekId(String(list[0].id));
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadParentMentorNotice() {
    try {
      const r = await api('/api/settings/parent-mentor-notice');
      if (r && Object.prototype.hasOwnProperty.call(r, 'value')) {
        setMentorNotice(String(r.value ?? ''));
      } else {
        setMentorNotice(null);
      }
    } catch {
      setMentorNotice(null);
    }
  }

  async function loadRecord(studentId, weekId) {
    if (!studentId || !weekId) {
      setRecord(null);
      return;
    }
    setError('');
    setRecordLoading(true);
    setRecord(null);
    try {
      const r = await api(`/api/mentoring/record?studentId=${encodeURIComponent(studentId)}&weekId=${encodeURIComponent(weekId)}`);
      setRecord(r);
    } catch (e) {
      setError(e.message);
      setRecord(null);
    } finally {
      setRecordLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
    loadWeeks();
    loadParentMentorNotice();
  }, []);

  useEffect(() => {
    if (selectedStudentId && selectedWeekId) {
      loadRecord(selectedStudentId, selectedWeekId);
    }
  }, [selectedStudentId, selectedWeekId]);

  const selected = useMemo(
    () => items.find((x) => String(x.student.id) === String(selectedStudentId)),
    [items, selectedStudentId]
  );
  const sharedWeeks = selected?.weeks || [];
  const sharedWeekIds = useMemo(() => new Set(sharedWeeks.map((w) => String(w.id))), [sharedWeeks]);
  const selectedWeek = useMemo(
    () => allWeeks.find((w) => String(w.id) === String(selectedWeekId)),
    [allWeeks, selectedWeekId]
  );
  const schedule = selected?.student?.schedule || {};
  const mentorAssignment = selected?.mentor_assignment || null;
  const mentorName = String(mentorAssignment?.mentor || '').trim();
  const mentorDays = Array.isArray(mentorAssignment?.scheduledDays) ? mentorAssignment.scheduledDays : [];
  const mentorNoticeText = mentorNotice == null ? DEFAULT_PARENT_MENTOR_NOTICE : mentorNotice;

  const subjectRecords = useMemo(() => (record?.subject_records || []), [record]);
  const weekRecord = useMemo(() => (record?.week_record || {}), [record]);

  const dailyTasks = useMemo(() => safeJson(weekRecord?.b_daily_tasks, {}), [weekRecord]);
  const scores = useMemo(() => safeJson(weekRecord?.scores_json, []), [weekRecord]);

  const penaltyItems = selected?.penalties?.items || [];
  const totalPenaltyPoints =
    typeof selected?.penalties?.totalPoints === 'number'
      ? selected.penalties.totalPoints
      : penaltyItems.reduce((acc, p) => acc + Number(p.points || 0), 0);

  if (loading) {
    return (
      <div className="card p-5">
        <div className="text-sm text-slate-600">불러오는 중...</div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="card p-5">
        <div className="text-sm text-slate-600">
          본인 학생 정보가 없습니다. (아이디가 학생 코드(external_id)와 동일해야 합니다.)
        </div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>
    );
  }

  const weekRange =
    selectedWeek?.start_date && selectedWeek?.end_date ? `${selectedWeek.start_date} ~ ${selectedWeek.end_date}` : '';
  const sharedWeek = sharedWeeks.find((w) => String(w.id) === String(selectedWeekId));
  const recordUpdated = sharedWeek?.updated_at || '';

  return (
    <div className="space-y-4 pb-10">
      <div className={['card p-5', SECTION_TONES.header].join(' ')}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-lg font-semibold text-brand-900">학부모 확인 페이지</div>
            <div className="text-sm text-slate-600">공유된 주차의 기록만 확인할 수 있습니다.</div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div>
              <div className="text-xs text-slate-500">학생</div>
              <select
                className="input"
                value={selectedStudentId}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedStudentId(v);
                  if (!selectedWeekId && allWeeks[0]?.id) setSelectedWeekId(String(allWeeks[0].id));
                }}
              >
                {items.map((x) => (
                  <option key={x.student.id} value={String(x.student.id)}>
                    {x.student.name} {x.student.grade ? `(${x.student.grade})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-slate-500">주차</div>
              <select className="input" value={selectedWeekId} onChange={(e) => setSelectedWeekId(e.target.value)}>
                {allWeeks.map((w) => (
                  <option key={w.id} value={String(w.id)}>
                    {w.label} {w.start_date && w.end_date ? `(${w.start_date}~${w.end_date})` : ''}{' '}
                    {sharedWeekIds.has(String(w.id)) ? '· 공유됨' : '· 미공유'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <InfoPill label="주차" value={selectedWeek?.label || '-'} />
          <InfoPill label="기간" value={weekRange || '-'} />
          <Badge>벌점 합계: {totalPenaltyPoints}점</Badge>
          {recordUpdated ? <InfoPill label="기록 업데이트" value={recordUpdated} /> : null}
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className={['card p-5', SECTION_TONES.calendar].join(' ')}>
        <SectionTitle title="주간 일정 캘린더" right={weekRange || '주차 선택'} />
        <WeeklyCalendar schedule={schedule} weekStart={selectedWeek?.start_date} />
      </div>

      <div className={['card p-5', SECTION_TONES.penalties].join(' ')}>
        <SectionTitle title="벌점 내역" right={`총 ${totalPenaltyPoints}점 · ${penaltyItems.length}건`} />
        <div className="mt-3 space-y-2 max-h-[420px] overflow-auto pr-1">
          {penaltyItems.length ? (
            penaltyItems.slice(0, 20).map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 p-3">
                <div>
                  <div className="text-sm text-slate-800">{p.reason}</div>
                  <div className="text-xs text-slate-500">{p.created_at || p.date || ''}</div>
                </div>
                <Badge>{p.points > 0 ? `+${p.points}` : p.points}</Badge>
              </div>
            ))
          ) : (
            <div className="text-sm text-slate-400">벌점 내역 없음</div>
          )}
        </div>

        {Array.isArray(scores) && scores.length ? (
          <div className="mt-6 border-t border-slate-200/70 pt-4">
            <SectionTitle title="성적 / 진단" right={`총 ${scores.length}건`} />
            <div className="mt-3 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-3">구분</th>
                    <th className="py-2 pr-3">과목</th>
                    <th className="py-2 pr-3">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((r, idx) => (
                    <tr key={idx} className="border-t border-slate-200">
                      <td className="py-2 pr-3">{r.label || ''}</td>
                      <td className="py-2 pr-3">{r.subject || ''}</td>
                      <td className="py-2 pr-3 whitespace-pre-wrap">{r.note || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div className={['card p-5', SECTION_TONES.mentor].join(' ')}>
        <SectionTitle title="이번주 멘토 안내" right={selectedWeek?.label ? `${selectedWeek.label}` : ''} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <InfoPill label="이번주 멘토" value={mentorName || '-'} />
          <InfoPill label="멘토링 진행 요일" value={mentorDays.length ? mentorDays.join(', ') : '-'} />
        </div>
        <div className="mt-2 text-xs text-slate-600">
          {mentorNoticeText}
        </div>
      </div>

      <div className={['card p-5', SECTION_TONES.curriculum].join(' ')}>
        <SectionTitle title="학습 커리큘럼" right={selectedWeek?.label ? `${selectedWeek.label}` : ''} />
        {recordLoading ? (
          <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div>
        ) : record ? (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {subjectRecords.length ? (
              subjectRecords.map((sr, idx) => (
                <div key={sr.id} className={['rounded-2xl border p-4 shadow-sm', SUBJECT_TONES[idx % SUBJECT_TONES.length]].join(' ')}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-brand-900">{sr.subject_name}</div>
                    <div className="text-xs text-slate-500">{sr.updated_at ? `업데이트: ${sr.updated_at}` : ''}</div>
                  </div>
                  {sr.a_curriculum ? (
                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{sr.a_curriculum}</div>
                  ) : (
                    <div className="mt-2 text-sm text-slate-400">커리큘럼 없음</div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-400">과목 기록 없음</div>
            )}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>
        )}
      </div>

      <div className={['card p-5', SECTION_TONES.subjects].join(' ')}>
        <SectionTitle title="과목별 기록" right={selectedWeek?.label ? `${selectedWeek.label}` : ''} />
        {recordLoading ? (
          <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div>
        ) : record ? (
          <div className="mt-3 space-y-4">
            {subjectRecords.length ? (
              subjectRecords.map((sr, idx) => {
                const lastHwBlock = { key: 'a_last_hw', label: '지난주 과제', value: renderLastHw(sr.a_last_hw) };
                const thisHwBlock = {
                  key: 'a_this_hw',
                  label: '이번주 과제',
                  value: renderLastHw(sr.a_this_hw),
                  tone: 'border-amber-200/60 bg-amber-50/70'
                };
                const commentBlock = {
                  key: 'a_comment',
                  label: '과목 별 코멘트',
                  value: sr.a_comment,
                  tone: 'border-amber-200/60 bg-amber-50/70'
                };
                const blocks = [lastHwBlock, thisHwBlock, commentBlock].filter((b) => b.value);
                return (
                  <div key={sr.id} className={['rounded-2xl border p-4 shadow-sm', SUBJECT_TONES[idx % SUBJECT_TONES.length]].join(' ')}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-brand-900">{sr.subject_name}</div>
                      <div className="text-xs text-slate-500">{sr.updated_at ? `업데이트: ${sr.updated_at}` : ''}</div>
                    </div>
                    <div className="mt-3 space-y-3">
                      {blocks.length ? (
                        blocks.map((b) => <RecordBox key={b.key} title={b.label} value={b.value} tone={b.tone} />)
                      ) : (
                        <div className="text-sm text-slate-400">공유된 기록이 아직 없습니다.</div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-400">과목 기록 없음</div>
            )}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>
        )}
      </div>

      <div className={['card p-5', SECTION_TONES.daily].join(' ')}>
        <SectionTitle title="일일 학습 과제" right={selectedWeek?.label ? `${selectedWeek.label}` : ''} />
        {recordLoading ? (
          <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div>
        ) : record ? (
          <div className="mt-3 space-y-2">
            {DAYS.map((d) => (
              <DayNote key={d.k} label={d.label} value={dailyTasks?.[d.k]} />
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>
        )}
      </div>

      <div className={['card p-5', SECTION_TONES.weekly].join(' ')}>
        <SectionTitle title="주간 총괄멘토 피드백" right={selectedWeek?.label ? `${selectedWeek.label}` : ''} />
        {recordLoading ? (
          <div className="mt-3 text-sm text-slate-500">기록을 불러오는 중...</div>
        ) : record ? (
          <>
            {weekRecord?.c_lead_weekly_feedback ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <div className="text-xs font-semibold text-brand-800">주간 총괄멘토 피드백</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{weekRecord.c_lead_weekly_feedback}</div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">피드백 없음</div>
            )}
            {weekRecord?.c_director_commentary ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <div className="text-xs font-semibold text-brand-800">원장 코멘트</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{weekRecord.c_director_commentary}</div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-3 text-sm text-slate-500">공유된 기록이 없습니다.</div>
        )}
      </div>

      <div className="text-xs text-slate-400 px-1">
        안내: 학부모 페이지는 조회 전용이며, 공유된 주차의 기록만 표시됩니다.
      </div>
    </div>
  );
}
