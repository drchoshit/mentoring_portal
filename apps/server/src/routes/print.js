import express from 'express';
import { canViewField, safeJson } from '../lib/permissions.js';

function isEnabledPrint(db, key) {
  const r = db.prepare('SELECT enabled FROM print_config WHERE field_key=?').get(key);
  return r ? Number(r.enabled) === 1 : true;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  return safeJson(v, fallback);
}

function textToHtml(value) {
  return esc(value || '-').replace(/\n/g, '<br/>');
}

function optionalTextToHtml(value) {
  const text = String(value ?? '').trim();
  return text ? esc(text).replace(/\n/g, '<br/>') : '';
}

function joinTextParts(parts, separator = ' · ') {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(separator);
}

function normalizeTask(raw) {
  if (!raw) return { text: '', done: null, progress: '' };
  if (typeof raw === 'string') return { text: raw, done: null, progress: '' };
  return {
    text: String(raw.text || '').trim(),
    done: raw.done === true ? true : raw.done === false ? false : null,
    progress: raw.progress ? String(raw.progress) : ''
  };
}

function parseTasks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeTask).filter((t) => t.text);
  const raw = String(value);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed)) return parsed.map(normalizeTask).filter((t) => t.text);
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ text, done: null, progress: '' }));
}

function renderTasksText(value) {
  const tasks = parseTasks(value);
  if (!tasks.length) return '-';
  return tasks
    .map((t, idx) => {
      if (t.done === true) return `${idx + 1}. ${t.text} (완료)`;
      if (t.done === false) return `${idx + 1}. ${t.text} (진행중${t.progress ? `, ${t.progress}` : ''})`;
      return `${idx + 1}. ${t.text}`;
    })
    .join('\n');
}

function fmtDate(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d || '');
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekRound(week) {
  const label = String(week?.label || '');
  const m = label.match(/(\d+)/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const idNum = Number(week?.id || 0);
  if (Number.isInteger(idNum) && idNum > 0) return idNum;
  return 0;
}

function makeSubjectRow(label, records, valueFn, rowClass = '') {
  const cls = rowClass ? ` class="${rowClass}"` : '';
  return `
    <tr${cls}>
      <th class="rowhead">${esc(label)}</th>
      ${records.map((r) => `<td><div class="cell">${valueFn(r)}</div></td>`).join('')}
    </tr>
  `;
}

function normalizeClinicEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entry = {
    mentor_name: String(raw.mentor_name || '').trim(),
    subject: String(raw.subject || '').trim(),
    material: String(raw.material || '').trim(),
    problem_name: String(raw.problem_name || '').trim(),
    problem_type: String(raw.problem_type || '').trim(),
    solved_date: String(raw.solved_date || '').trim(),
    summary: String(raw.summary || '').trim()
  };
  if (!entry.subject && !entry.material && !entry.problem_name && !entry.problem_type && !entry.summary) {
    return null;
  }
  return entry;
}

function parseClinicEntries(value) {
  const parsed = parseJson(value, []);
  if (Array.isArray(parsed)) return parsed.map(normalizeClinicEntry).filter(Boolean);
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
    return parsed.entries.map(normalizeClinicEntry).filter(Boolean);
  }
  return [];
}

function normalizeWrongAnswerAssignment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const assignment = {
    mentor_name: String(raw.mentor_name || '').trim(),
    session_month: String(raw.session_month || '').trim(),
    session_day: String(raw.session_day || '').trim(),
    session_start_time: String(raw.session_start_time || raw.session_time || '').trim(),
    session_duration_minutes: Math.max(1, Math.min(240, Number(raw.session_duration_minutes || 20) || 20))
  };
  if (!assignment.mentor_name && !assignment.session_month && !assignment.session_day && !assignment.session_start_time) {
    return null;
  }
  return assignment;
}

function normalizeWrongAnswerProblem(raw, fallbackAssignment = null) {
  if (!raw || typeof raw !== 'object') return null;
  const statusRaw = String(raw.completion_status || '').trim();
  const completionStatus = statusRaw === 'done' || statusRaw === 'incomplete' ? statusRaw : 'pending';
  const completionFeedbackRaw = String(raw.completion_feedback || '').replace(/\r\n/g, '\n');
  const incompleteReasonRaw = String(raw.incomplete_reason || '').replace(/\r\n/g, '\n');

  const problem = {
    subject: String(raw.subject || '').trim(),
    material: String(raw.material || '').trim(),
    problem_name: String(raw.problem_name || '').trim(),
    problem_type: String(raw.problem_type || '').trim(),
    note: String(raw.note || '').trim(),
    completion_status: completionStatus,
    completion_feedback: completionStatus === 'done' ? completionFeedbackRaw.trim().slice(0, 1000) : '',
    incomplete_reason: completionStatus === 'incomplete' ? incompleteReasonRaw.trim().slice(0, 1000) : '',
    deleted_at: String(raw.deleted_at || '').trim(),
    assignment: normalizeWrongAnswerAssignment(raw.assignment || fallbackAssignment)
  };

  if (problem.deleted_at) return null;
  if (!problem.subject && !problem.material && !problem.problem_name && !problem.problem_type && !problem.note) {
    return null;
  }
  return problem;
}

function parseWrongAnswerProblems(value) {
  const parsed = parseJson(value, {});
  if (!parsed || typeof parsed !== 'object') return [];
  const topLevelAssignment = normalizeWrongAnswerAssignment(parsed.assignment || null);
  const problemsRaw = Array.isArray(parsed.problems)
    ? parsed.problems
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  return problemsRaw
    .map((item, idx) => normalizeWrongAnswerProblem(item, idx === 0 ? topLevelAssignment : null))
    .filter(Boolean);
}

function formatAssignmentSchedule(assignment) {
  if (!assignment) return '';
  const dateText = assignment.session_month && assignment.session_day
    ? `${assignment.session_month}/${assignment.session_day}`
    : '';
  const durationText = assignment.session_duration_minutes
    ? `${assignment.session_duration_minutes}분`
    : '';
  return joinTextParts([
    assignment.mentor_name ? `배정 멘토 ${assignment.mentor_name}` : '',
    joinTextParts([dateText, assignment.session_start_time], ' '),
    durationText
  ]);
}

export default function printRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const student_id = Number(req.query.studentId);
    const week_id = Number(req.query.weekId);
    const autoPrint = String(req.query.autoprint ?? '1') !== '0';

    if (!student_id || !week_id) return res.status(400).send('Missing studentId/weekId');
    if (req.user.role === 'parent') return res.status(403).send('Forbidden');

    const student = db.prepare('SELECT * FROM students WHERE id=?').get(student_id);
    const week = db.prepare('SELECT * FROM weeks WHERE id=?').get(week_id);
    if (!student || !week) return res.status(404).send('Not found');
    const weekRound = getWeekRound(week);
    const useNewDailyTaskLayout = weekRound >= 4;

    const subjRecords = db.prepare(
      `SELECT r.*, s.name as subject_name
       FROM subject_records r
       JOIN mentoring_subjects s ON s.id=r.subject_id
       WHERE r.student_id=? AND r.week_id=?
       ORDER BY s.id`
    ).all(student_id, week_id);
    const weekRecord = db.prepare('SELECT * FROM week_records WHERE student_id=? AND week_id=?').get(student_id, week_id);

    const profile = parseJson(student.profile_json, {});
    const studentInfo = profile?.student_info || {};
    const mockScores = Array.isArray(profile?.mock_scores) ? profile.mock_scores : [];

    const dailyTasks = parseJson(weekRecord?.b_daily_tasks, {});
    const dailyTasksThisWeek = parseJson(weekRecord?.b_daily_tasks_this_week, {});
    const clinicEntries = parseClinicEntries(weekRecord?.d_clinic_records);
    const wrongAnswerProblems = parseWrongAnswerProblems(weekRecord?.e_wrong_answer_distribution);
    const weeklyLeadFeedback = String(weekRecord?.c_lead_weekly_feedback || '').trim();

    const requiredPrintFields = new Set([
      'a_curriculum',
      'a_last_hw',
      'a_hw_exec',
      'a_progress',
      'a_this_hw',
      'a_comment',
      'b_daily_tasks',
      'b_daily_tasks_this_week',
      'd_clinic_records',
      'e_wrong_answer_distribution',
      'c_lead_weekly_feedback'
    ]);
    const printable = (k) => canViewField(db, req.user.role, k) && (requiredPrintFields.has(k) || isEnabledPrint(db, k));

    const days = [
      { key: 'Mon', label: '월' },
      { key: 'Tue', label: '화' },
      { key: 'Wed', label: '수' },
      { key: 'Thu', label: '목' },
      { key: 'Fri', label: '금' },
      { key: 'Sat', label: '토' },
      { key: 'Sun', label: '일' }
    ];

    const subjectColumns = subjRecords.length
      ? subjRecords
      : [{ subject_name: '과목 없음', a_curriculum: '', a_last_hw: '', a_hw_exec: '', a_progress: '', a_this_hw: '', a_comment: '' }];

    const subjectRowsHtml = [
      makeSubjectRow('학습\n커리큘럼', subjectColumns, (r) => textToHtml(printable('a_curriculum') ? r.a_curriculum : ''), 'row-curriculum'),
      makeSubjectRow('지난주 과제', subjectColumns, (r) => textToHtml(printable('a_last_hw') ? renderTasksText(r.a_last_hw) : ''), 'row-last-hw'),
      makeSubjectRow('이번주 과제', subjectColumns, (r) => textToHtml(printable('a_this_hw') ? renderTasksText(r.a_this_hw) : ''), 'row-this-hw'),
      makeSubjectRow('과목 별\n코멘트', subjectColumns, (r) => textToHtml(printable('a_comment') ? r.a_comment : ''), 'row-comment')
    ].join('');

    const mockText = mockScores.length
      ? mockScores.map((m) => {
          const exam = m?.exam || '';
          const kor = m?.kor || '-';
          const math = m?.math || '-';
          const eng = m?.eng || '-';
          const soc = m?.soc || '-';
          const sci = m?.sci || '-';
          return `${exam} | 국:${kor} 수:${math} 영:${eng} 탐1:${soc} 탐2:${sci}`;
        }).join('\n')
      : '-';

    const schoolGradeLabel = (() => {
      const schoolName = String(studentInfo.school_name || '').trim();
      const gradeText = String(studentInfo.school_grade || student.grade || '').trim();
      if (schoolName && gradeText) return `${schoolName} (${gradeText})`;
      return schoolName || gradeText || '-';
    })();

    const clinicEntryHtml = printable('d_clinic_records') && clinicEntries.length
      ? `
        <div class="qa-section">
          <div class="qa-section-title">클리닉 질답 기록</div>
          ${clinicEntries.map((entry, idx) => {
            const questionText = joinTextParts([
              entry.subject,
              entry.material,
              entry.problem_name,
              entry.problem_type
            ]);
            const metaText = joinTextParts([
              entry.mentor_name ? `진행 멘토 ${entry.mentor_name}` : '',
              entry.solved_date ? `해결일 ${entry.solved_date}` : ''
            ]);
            return `
              <div class="qa-entry">
                <div class="qa-entry-head">
                  <span>질답 ${idx + 1}</span>
                  ${metaText ? `<span class="qa-meta">${esc(metaText)}</span>` : ''}
                </div>
                <div class="qa-line">
                  <span class="qa-label">학생 질문</span>
                  <div class="qa-value">${optionalTextToHtml(questionText) || '-'}</div>
                </div>
                <div class="qa-line">
                  <span class="qa-label">마무리/피드백</span>
                  <div class="qa-value">${optionalTextToHtml(entry.summary) || '-'}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : '';

    const wrongAnswerHtml = printable('e_wrong_answer_distribution') && wrongAnswerProblems.length
      ? `
        <div class="qa-section">
          <div class="qa-section-title">오답·질문 배정 정리</div>
          ${wrongAnswerProblems.map((problem, idx) => {
            const questionText = joinTextParts([
              problem.subject,
              problem.material,
              problem.problem_name,
              problem.problem_type
            ]);
            const assignmentText = formatAssignmentSchedule(problem.assignment);
            const resultText = problem.completion_status === 'done'
              ? (problem.completion_feedback || '완료 처리됨')
              : problem.completion_status === 'incomplete'
                ? (problem.incomplete_reason || '미완료 처리됨')
                : '진행중';
            const resultLabel = problem.completion_status === 'done'
              ? '마무리 상태'
              : problem.completion_status === 'incomplete'
                ? '미완료 사유'
                : '진행 상태';
            return `
              <div class="qa-entry">
                <div class="qa-entry-head">
                  <span>배정 ${idx + 1}</span>
                  ${assignmentText ? `<span class="qa-meta">${esc(assignmentText)}</span>` : ''}
                </div>
                <div class="qa-line">
                  <span class="qa-label">질문 문제</span>
                  <div class="qa-value">${optionalTextToHtml(questionText) || '-'}</div>
                </div>
                ${problem.note ? `
                  <div class="qa-line">
                    <span class="qa-label">전달사항</span>
                    <div class="qa-value">${optionalTextToHtml(problem.note)}</div>
                  </div>
                ` : ''}
                <div class="qa-line">
                  <span class="qa-label">${esc(resultLabel)}</span>
                  <div class="qa-value">${optionalTextToHtml(resultText) || '-'}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `
      : '';

    const weeklyLeadFeedbackHtml = printable('c_lead_weekly_feedback') && weeklyLeadFeedback
      ? `
        <div class="qa-section qa-section-brief">
          <div class="qa-section-title">총괄멘토 주간 피드백</div>
          <div class="qa-brief">${optionalTextToHtml(weeklyLeadFeedback)}</div>
        </div>
      `
      : '';

    const clinicSummaryHtml = clinicEntryHtml || wrongAnswerHtml || weeklyLeadFeedbackHtml
      ? `${clinicEntryHtml}${wrongAnswerHtml}${weeklyLeadFeedbackHtml}`
      : `<div class="qa-empty">기록된 주간 질답/클리닉 내용이 없습니다.</div>`;

    const taskFieldKey = useNewDailyTaskLayout ? 'b_daily_tasks_this_week' : 'b_daily_tasks';
    const taskCardClass = useNewDailyTaskLayout ? 'tasks-this-week-card' : 'tasks-card';
    const taskTitle = useNewDailyTaskLayout ? '일일 학습 과제(이번주)' : '일일 학습 과제';
    const taskSource = useNewDailyTaskLayout ? dailyTasksThisWeek : dailyTasks;

    const bottomSectionHtml = `
      <div class="card ${taskCardClass}">
        <h3>${taskTitle}</h3>
        <table class="dense day-table">
          <thead><tr><th style="width:12mm;">요일</th><th>과제</th></tr></thead>
          <tbody>
            ${days.map((d) => `<tr><th>${esc(d.label)}</th><td>${textToHtml(printable(taskFieldKey) ? taskSource?.[d.key] : '')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="card clinic-summary-card">
        <h3>주간 질답 클리닉 내용</h3>
        ${clinicSummaryHtml}
      </div>
    `;

    const bottomClass = 'bottom bottom-clinic';

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mentoring Print</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; font-family: 'Malgun Gothic', 'Noto Sans KR', Arial, sans-serif; color: #111827; }

    #paper {
      width: 285mm;
      height: 198mm;
      overflow: hidden;
      border: 1px solid #97adc4;
      background: #fff;
    }
    #content {
      width: 285mm;
      padding: 3.2mm;
      transform-origin: top left;
    }

    .title {
      text-align: center;
      font-size: 15px;
      font-weight: 700;
      border: 1px solid #9cb0c5;
      background: linear-gradient(90deg, #e7f0fb 0%, #eef8f2 55%, #fff4e7 100%);
      color: #1e3448;
      padding: 2mm 2mm;
      margin-bottom: 1.8mm;
    }

    .meta {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.4mm;
      margin-bottom: 1.6mm;
    }
    .card {
      border: 1px solid #9fb4c9;
      padding: 1.35mm;
      background: #fbfdff;
    }
    .card h3 {
      margin: 0 0 0.8mm 0;
      font-size: 10px;
      color: #1a3a56;
      font-weight: 700;
    }
    .student-card { background: #f4f9ff; border-color: #9db7d7; }
    .score-card { background: #f7f5ff; border-color: #b3afda; }
    .subject-card { background: #fffdf8; border-color: #d6c6af; }
    .tasks-card { background: #f5f9ff; border-color: #9fb8d6; }
    .tasks-this-week-card { background: #eef8f1; border-color: #a8c9ae; }
    .daily-feedback-card { background: #f3faf5; border-color: #9fc8ac; }
    .weekly-feedback-card { background: #fff6ed; border-color: #d8bda1; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td {
      border: 1px solid #9fb4c9;
      padding: 0.9mm 1.1mm;
      font-size: 8.3px;
      line-height: 1.22;
      vertical-align: middle;
      word-break: break-word;
      white-space: pre-wrap;
    }
    th { background: #e8f1fa; font-weight: 700; color: #18354f; }
    .rowhead { width: 15mm; background: #edf4fb; }
    .cell { white-space: pre-wrap; line-height: 1.28; }

    .subject-block { margin-bottom: 1.4mm; }
    .subject-table .header th { background: #d9e9f8; font-size: 8.5px; }
    .subject-table tbody tr.row-curriculum th,
    .subject-table tbody tr.row-curriculum td { background: #edf6ff; }
    .subject-table tbody tr.row-last-hw th,
    .subject-table tbody tr.row-last-hw td { background: #f6f1ff; }
    .subject-table tbody tr.row-this-hw th,
    .subject-table tbody tr.row-this-hw td { background: #edf9f1; }
    .subject-table tbody tr.row-comment th,
    .subject-table tbody tr.row-comment td { background: #fff6ec; }

    .bottom {
      display: grid;
      gap: 1.4mm;
    }
    .bottom.bottom-clinic { grid-template-columns: minmax(0, 4fr) minmax(0, 6fr); }
    .dense th, .dense td { font-size: 8.1px; padding: 0.78mm 1.0mm; }
    .day-table thead th { background: #dfecfa; }
    .feedback-table thead th { background: #dff1e5; }
    .day-table tbody tr:nth-child(even) td { background: #fbfdff; }
    .feedback-table tbody tr:nth-child(even) td { background: #f9fdfa; }
    .weekly-table td { background: #fffdf9; }
    .weekly-table td.note { min-height: 18mm; }

    .info-table th { width: 13mm; background: #f3f7fb; }
    .info-table td { background: #fff; }
    .muted { color: #4b5563; }
    .clinic-summary-card { background: #fff8ef; border-color: #d6bea2; }
    .qa-section + .qa-section { margin-top: 1.0mm; }
    .qa-section-title {
      margin-bottom: 0.7mm;
      padding: 0.6mm 0.9mm;
      border: 1px solid #dcc7ad;
      background: #fff3e3;
      color: #6a4625;
      font-size: 8.1px;
      font-weight: 700;
    }
    .qa-entry {
      border: 1px solid #e1d3bf;
      background: #fffdf9;
      padding: 0.85mm 1.0mm;
    }
    .qa-entry + .qa-entry { margin-top: 0.8mm; }
    .qa-entry-head {
      display: flex;
      justify-content: space-between;
      gap: 1mm;
      margin-bottom: 0.55mm;
      font-size: 8.0px;
      font-weight: 700;
      color: #23405a;
    }
    .qa-meta {
      font-weight: 400;
      color: #5b6470;
    }
    .qa-line {
      display: grid;
      grid-template-columns: 14mm minmax(0, 1fr);
      gap: 0.8mm;
      align-items: start;
    }
    .qa-line + .qa-line { margin-top: 0.45mm; }
    .qa-label {
      display: inline-block;
      padding: 0.2mm 0.45mm;
      border-radius: 2px;
      background: #edf4fb;
      color: #27445d;
      font-size: 7.8px;
      font-weight: 700;
      text-align: center;
    }
    .qa-value {
      min-width: 0;
      font-size: 7.95px;
      line-height: 1.28;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .qa-section-brief .qa-brief {
      border: 1px solid #ecd6b8;
      background: #fffaf4;
      padding: 0.9mm 1.0mm;
      font-size: 7.95px;
      line-height: 1.3;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .qa-empty {
      border: 1px dashed #d4c3ae;
      background: #fffdf9;
      padding: 2.2mm 1.4mm;
      text-align: center;
      font-size: 8.0px;
      color: #6b7280;
    }

    .footer-note {
      margin-top: 0.8mm;
      font-size: 7.8px;
      color: #6b7280;
      text-align: right;
    }
  </style>
</head>
<body>
  <div id="paper">
    <div id="content">
      <div class="title">MEDICAL ROADMAP 멘토링</div>

      <div class="meta">
        <div class="card student-card">
          <h3>학생 정보</h3>
          <table class="info-table dense">
            <tr>
              <th>이름</th><td colspan="3">${esc(student.name || '-')}</td>
              <th>ID</th><td>${esc(student.external_id || '-')}</td>
            </tr>
            <tr>
              <th>학교(학년)</th><td>${esc(schoolGradeLabel)}</td>
              <th>목표대학</th><td>${esc(studentInfo.goal_univ || '-')}</td>
              <th>목표학과</th><td>${esc(studentInfo.goal_major || '-')}</td>
            </tr>
            <tr>
              <th>회차</th><td>${esc(String(week.label || '-').replace(/주차/g, '회차'))}</td>
              <th>기간</th><td>${esc(`${week.start_date || ''} ~ ${week.end_date || ''}`)}</td>
              <th>출력일</th><td>${esc(fmtDate(new Date().toISOString()))}</td>
            </tr>
          </table>
        </div>

        <div class="card score-card">
          <h3>성적 요약</h3>
          <table class="dense">
            <tr><th style="width:22mm;">모의/수능</th><td>${textToHtml(mockText)}</td></tr>
          </table>
        </div>
      </div>

      <div class="subject-block card subject-card">
        <h3>학습 커리큘럼 + 수강 진도(과목 별)</h3>
        <table class="dense subject-table">
          <thead class="header">
            <tr>
              <th class="rowhead">구분</th>
              ${subjectColumns.map((r) => `<th>${esc(r.subject_name || '-')}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${subjectRowsHtml}
          </tbody>
        </table>
      </div>

      <div class="${bottomClass}">
        ${bottomSectionHtml}
      </div>

      <div class="footer-note muted">자동 맞춤 인쇄: A4 가로 1페이지</div>
    </div>
  </div>

  <script>
    (function() {
      const AUTO_PRINT = ${autoPrint ? 'true' : 'false'};

      function fitToPage() {
        const paper = document.getElementById('paper');
        const content = document.getElementById('content');
        if (!paper || !content) return;

        content.style.transform = 'scale(1)';
        const scaleX = paper.clientWidth / content.scrollWidth;
        const scaleY = paper.clientHeight / content.scrollHeight;
        const scale = Math.min(scaleX, scaleY, 1);
        const widthBoost = 1.0;
        const scaleFinal = Math.min(scale * widthBoost, scaleX, scaleY, 1);
        const scaledWidth = content.scrollWidth * scaleFinal;
        const offsetX = Math.max((paper.clientWidth - scaledWidth) / 2, 0);
        content.style.transform = 'translate(' + offsetX + 'px, 0) scale(' + scaleFinal + ')';
      }

      window.addEventListener('load', function() {
        fitToPage();
        if (AUTO_PRINT) {
          setTimeout(function() { window.print(); }, 200);
        }
      });

      window.addEventListener('resize', fitToPage);
    })();
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  // Director can configure which fields print
  router.get('/config', (req, res) => {
    const rows = db.prepare('SELECT * FROM print_config ORDER BY id').all();
    res.json({ config: rows });
  });

  router.put('/config/:field_key', (req, res) => {
    if (req.user.role !== 'director') return res.status(403).json({ error: 'Forbidden' });
    const { field_key } = req.params;
    const enabled = Number(req.body?.enabled ?? 1) ? 1 : 0;
    db.prepare('INSERT OR IGNORE INTO print_config (field_key, enabled) VALUES (?,?)').run(field_key, enabled);
    db.prepare('UPDATE print_config SET enabled=? WHERE field_key=?').run(enabled, field_key);
    res.json({ ok: true });
  });

  return router;
}

