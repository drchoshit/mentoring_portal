import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { verifyWrongAnswerUploadToken } from '../lib/problemUploadToken.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'problem-images');
const MAX_IMAGE_COUNT = 12;
const MAX_FILE_SIZE = 12 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const ext = String(path.extname(file?.originalname || '') || '.jpg').slice(0, 8).toLowerCase();
    const safeExt = /^[.][a-z0-9]+$/.test(ext) ? ext : '.jpg';
    const name = `wa_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_IMAGE_COUNT },
  fileFilter(req, file, cb) {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) return cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
    cb(null, true);
  }
});

const DEFAULT_WRONG_ANSWER_ITEM = {
  subject: '',
  material: '',
  problem_name: '',
  problem_type: '',
  note: '',
  images: []
};

function safeJson(text, fallback) {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeProblemImage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim();
  if (!url) return null;
  return {
    id: String(raw.id || '').trim() || `img_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    filename: String(raw.filename || '').trim(),
    stored_name: String(raw.stored_name || '').trim(),
    url,
    mime_type: String(raw.mime_type || '').trim(),
    size: Number(raw.size || 0) || 0,
    uploaded_at: String(raw.uploaded_at || '').trim(),
    uploaded_via: String(raw.uploaded_via || '').trim()
  };
}

function normalizeWrongAnswerItem(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    subject: String(base.subject || '').trim(),
    material: String(base.material || '').trim(),
    problem_name: String(base.problem_name || '').trim(),
    problem_type: String(base.problem_type || '').trim(),
    note: String(base.note || '').trim(),
    images: Array.isArray(base.images) ? base.images.map(normalizeProblemImage).filter(Boolean) : []
  };
}

function normalizeWrongAnswerDistribution(value) {
  if (!value || typeof value !== 'object') {
    return { problems: [{ ...DEFAULT_WRONG_ANSWER_ITEM }], assignment: null, searched_at: '' };
  }
  const problemsRaw = Array.isArray(value.problems)
    ? value.problems
    : Array.isArray(value.items)
      ? value.items
      : [];
  const problems = problemsRaw.length
    ? problemsRaw.map(normalizeWrongAnswerItem)
    : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
  const assignment = value.assignment && typeof value.assignment === 'object' ? value.assignment : null;
  return {
    problems,
    assignment,
    searched_at: String(value.searched_at || '').trim()
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderUploadPage({ token = '', submitPath = '/api/problem-upload/mobile/submit', error = '' } = {}) {
  const escapedToken = escapeHtml(token);
  const escapedSubmitPath = escapeHtml(submitPath);
  const escapedError = escapeHtml(error);
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>문제 이미지 업로드</title>
    <style>
      body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;background:#f4f7fb;color:#122034}
      .wrap{max-width:560px;margin:0 auto;padding:20px}
      .card{background:#fff;border:1px solid #d8e2f2;border-radius:16px;padding:18px;box-shadow:0 8px 26px rgba(17,37,79,.08)}
      h1{margin:0;font-size:20px}
      p{margin:10px 0 0;color:#445d7a;font-size:14px;line-height:1.5}
      .error{margin-top:10px;color:#b42318;font-size:13px}
      .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      button{appearance:none;border:0;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:700;cursor:pointer}
      .primary{background:#2f6df6;color:#fff}
      .ghost{background:#e9efff;color:#1f3d8a}
      input[type=file]{display:none}
      .status{margin-top:10px;color:#334f74;font-size:13px}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>문제 이미지 업로드</h1>
        <p>질문할 문제 이미지를 여러 장 선택한 뒤 전송해 주세요. 새 촬영 또는 앨범 선택이 가능합니다.</p>
        ${escapedError ? `<div class="error">${escapedError}</div>` : ''}
        <form id="uploadForm" method="post" action="${escapedSubmitPath}" enctype="multipart/form-data">
          <input type="hidden" name="token" value="${escapedToken}" />
          <input id="images" type="file" name="images" accept="image/*" capture="environment" multiple />
          <div class="actions">
            <button id="pickBtn" type="button" class="ghost">새 촬영/앨범 선택</button>
            <button id="submitBtn" type="submit" class="primary">전송하기</button>
          </div>
        </form>
        <div id="status" class="status">파일을 선택해 주세요.</div>
      </div>
    </div>
    <script>
      const form = document.getElementById('uploadForm');
      const fileInput = document.getElementById('images');
      const pickBtn = document.getElementById('pickBtn');
      const submitBtn = document.getElementById('submitBtn');
      const statusEl = document.getElementById('status');

      function setStatus(text) {
        statusEl.textContent = text;
      }

      pickBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const count = fileInput.files ? fileInput.files.length : 0;
        setStatus(count ? count + '장 선택됨' : '파일을 선택해 주세요.');
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const files = fileInput.files;
        if (!files || !files.length) {
          setStatus('이미지를 먼저 선택해 주세요.');
          return;
        }
        submitBtn.disabled = true;
        pickBtn.disabled = true;
        setStatus('업로드 중입니다...');
        try {
          const formData = new FormData(form);
          const res = await fetch(form.action, { method: 'POST', body: formData });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          setStatus('업로드 완료: ' + (data.uploaded_count || 0) + '장');
        } catch (err) {
          setStatus('업로드 실패: ' + (err && err.message ? err.message : '오류'));
        } finally {
          submitBtn.disabled = false;
          pickBtn.disabled = false;
        }
      });

      // Attempt to open picker automatically on mobile browsers.
      window.setTimeout(() => {
        try { fileInput.click(); } catch (_) {}
      }, 250);
    </script>
  </body>
</html>`;
}

export default function problemUploadRoutes(db) {
  const router = express.Router();

  router.get('/mobile', (req, res) => {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).type('html').send(renderUploadPage({ error: '유효하지 않은 링크입니다.' }));
    }
    try {
      verifyWrongAnswerUploadToken(token);
      return res.type('html').send(renderUploadPage({ token }));
    } catch {
      return res.status(400).type('html').send(renderUploadPage({ error: '링크가 만료되었거나 잘못되었습니다.' }));
    }
  });

  router.post('/mobile/submit', (req, res) => {
    upload.array('images', MAX_IMAGE_COUNT)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err?.message || '파일 업로드에 실패했습니다.' });
      }

      const token = String(req.body?.token || '').trim();
      if (!token) return res.status(400).json({ error: '유효하지 않은 업로드 토큰입니다.' });

      let payload;
      try {
        payload = verifyWrongAnswerUploadToken(token);
      } catch {
        return res.status(400).json({ error: '링크가 만료되었거나 잘못되었습니다.' });
      }

      const studentId = Number(payload.student_id || 0);
      const weekId = Number(payload.week_id || 0);
      const problemIndex = Number(payload.problem_index || 0);
      if (!studentId || !weekId || !Number.isInteger(problemIndex) || problemIndex < 0 || problemIndex > 99) {
        return res.status(400).json({ error: '업로드 대상 정보가 올바르지 않습니다.' });
      }

      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: '업로드할 이미지가 없습니다.' });

      const weekRecord = db.prepare('SELECT id, e_wrong_answer_distribution FROM week_records WHERE student_id=? AND week_id=?').get(studentId, weekId);
      if (!weekRecord?.id) return res.status(404).json({ error: '주간 기록을 찾지 못했습니다.' });

      const current = normalizeWrongAnswerDistribution(safeJson(weekRecord.e_wrong_answer_distribution, {}));
      const problems = Array.isArray(current.problems) ? [...current.problems] : [{ ...DEFAULT_WRONG_ANSWER_ITEM }];
      while (problems.length <= problemIndex) problems.push({ ...DEFAULT_WRONG_ANSWER_ITEM });

      const target = normalizeWrongAnswerItem(problems[problemIndex] || {});
      const now = new Date().toISOString();
      const uploaded = files.map((file) => {
        const storedName = String(path.basename(file.filename || '')).trim();
        return {
          id: `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
          filename: String(file.originalname || '').trim(),
          stored_name: storedName,
          url: `/uploads/problem-images/${storedName}`,
          mime_type: String(file.mimetype || '').trim(),
          size: Number(file.size || 0),
          uploaded_at: now,
          uploaded_via: 'qr_mobile'
        };
      });

      target.images = [...(Array.isArray(target.images) ? target.images : []), ...uploaded];
      problems[problemIndex] = target;

      const next = {
        ...current,
        problems
      };

      db.prepare("UPDATE week_records SET e_wrong_answer_distribution=?, updated_at=datetime('now') WHERE id=?")
        .run(JSON.stringify(next), weekRecord.id);

      return res.json({
        ok: true,
        uploaded_count: uploaded.length,
        problem_index: problemIndex,
        images: uploaded
      });
    });
  });

  return router;
}
