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

function makeSubjectRow(label, records, valueFn, rowClass = '') {
  const cls = rowClass ? ` class="${rowClass}"` : '';
  return `
    <tr${cls}>
      <th class="rowhead">${esc(label)}</th>
      ${records.map((r) => `<td><div class="cell">${valueFn(r)}</div></td>`).join('')}
    </tr>
  `;
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
    const schoolGrades = profile?.school_grades && typeof profile.school_grades === 'object' ? profile.school_grades : {};

    const dailyTasks = parseJson(weekRecord?.b_daily_tasks, {});
    const dailyFeedback = parseJson(weekRecord?.b_lead_daily_feedback, {});

    const requiredPrintFields = new Set([
      'a_curriculum',
      'a_last_hw',
      'a_hw_exec',
      'a_progress',
      'a_this_hw',
      'a_comment',
      'b_daily_tasks',
      'b_lead_daily_feedback',
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

    const schoolGradeText = [
      `1학년: 1학기 ${schoolGrades?.['1']?.['1'] || '-'} / 2학기 ${schoolGrades?.['1']?.['2'] || '-'}`,
      `2학년: 1학기 ${schoolGrades?.['2']?.['1'] || '-'} / 2학기 ${schoolGrades?.['2']?.['2'] || '-'}`,
      `3학년: 1학기 ${schoolGrades?.['3']?.['1'] || '-'} / 2학기 ${schoolGrades?.['3']?.['2'] || '-'}`
    ].join('\n');

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
      grid-template-columns: 1.05fr 1fr;
      gap: 1.4mm;
    }
    .bottom-right {
      display: grid;
      grid-template-rows: auto auto;
      gap: 1.4mm;
    }
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
              <th>이름</th><td>${esc(student.name || '-')}</td>
              <th>ID</th><td>${esc(student.external_id || '-')}</td>
              <th>학년</th><td>${esc(student.grade || '-')}</td>
            </tr>
            <tr>
              <th>목표대학</th><td>${esc(studentInfo.goal_univ || '-')}</td>
              <th>목표학과</th><td>${esc(studentInfo.goal_major || '-')}</td>
              <th>학교</th><td>${esc(studentInfo.school_name || '-')}</td>
            </tr>
            <tr>
              <th>학교학년</th><td>${esc(studentInfo.school_grade || '-')}</td>
              <th>학습멘토</th><td>${esc(studentInfo.mentor_name || '-')}</td>
              <th>총괄멘토</th><td>${esc(studentInfo.lead_name || '-')}</td>
            </tr>
            <tr>
              <th>주차</th><td>${esc(week.label || '-')}</td>
              <th>기간</th><td>${esc(`${week.start_date || ''} ~ ${week.end_date || ''}`)}</td>
              <th>출력일</th><td>${esc(fmtDate(new Date().toISOString()))}</td>
            </tr>
          </table>
        </div>

        <div class="card score-card">
          <h3>성적/내신 요약</h3>
          <table class="dense">
            <tr><th style="width:22mm;">모의/수능</th><td>${textToHtml(mockText)}</td></tr>
            <tr><th>내신</th><td>${textToHtml(schoolGradeText)}</td></tr>
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

      <div class="bottom">
        <div class="card tasks-card">
          <h3>일일 학습 과제</h3>
          <table class="dense day-table">
            <thead><tr><th style="width:12mm;">요일</th><th>과제</th></tr></thead>
            <tbody>
              ${days.map((d) => `<tr><th>${esc(d.label)}</th><td>${textToHtml(printable('b_daily_tasks') ? dailyTasks?.[d.key] : '')}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="bottom-right">
          <div class="card daily-feedback-card">
            <h3>요일 별 총괄멘토 피드백</h3>
            <table class="dense feedback-table">
              <thead><tr><th style="width:12mm;">요일</th><th>피드백</th></tr></thead>
              <tbody>
                ${days.map((d) => `<tr><th>${esc(d.label)}</th><td>${textToHtml(printable('b_lead_daily_feedback') ? dailyFeedback?.[d.key] : '')}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>

          <div class="card weekly-feedback-card">
            <h3>주간 총괄멘토 피드백</h3>
            <table class="dense weekly-table">
              <tbody>
                <tr>
                  <td class="note">${textToHtml(printable('c_lead_weekly_feedback') ? weekRecord?.c_lead_weekly_feedback : '')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
