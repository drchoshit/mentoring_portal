import express from 'express';
import multer from 'multer';
import crypto from 'crypto';

import { verifyWrongAnswerUploadToken } from '../lib/problemUploadToken.js';

const MAX_IMAGE_COUNT = 12;
const MAX_FILE_SIZE = 12 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_IMAGE_COUNT },
  fileFilter(req, file, cb) {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) return cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
    cb(null, true);
  }
});

function ensureWrongAnswerImagesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wrong_answer_images (
      id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      problem_index INTEGER NOT NULL,
      filename TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      data_blob BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wrong_answer_images_student_week
      ON wrong_answer_images(student_id, week_id, problem_index, created_at);
  `);
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
      .wrap{max-width:620px;margin:0 auto;padding:20px}
      .card{background:#fff;border:1px solid #d8e2f2;border-radius:16px;padding:18px;box-shadow:0 8px 26px rgba(17,37,79,.08)}
      h1{margin:0;font-size:20px}
      p{margin:10px 0 0;color:#445d7a;font-size:14px;line-height:1.5}
      .error{margin-top:10px;color:#b42318;font-size:13px}
      .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      button{appearance:none;border:0;border-radius:12px;padding:12px 14px;font-size:14px;font-weight:700;cursor:pointer}
      .primary{background:#2f6df6;color:#fff}
      .ghost{background:#e9efff;color:#1f3d8a}
      .camera{background:#dff5e8;color:#13623a}
      input[type=file]{display:none}
      .status{margin-top:10px;color:#334f74;font-size:13px}
      .preview{margin-top:12px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .thumb{border:1px solid #d8e2f2;border-radius:10px;background:#fff;overflow:hidden}
      .thumb img{display:block;width:100%;height:84px;object-fit:cover;background:#f7f9fc}
      .thumb-foot{padding:6px}
      .row{display:flex;align-items:center;justify-content:space-between;gap:6px}
      .muted{font-size:11px;color:#4f6482}
      .remove{font-size:11px;border-radius:8px;border:1px solid #d8e2f2;background:#fff;color:#334f74;padding:2px 6px}
      @media (max-width:420px){
        .preview{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>문제 이미지 업로드</h1>
        <p>촬영과 앨범 불러오기를 구분해서 사용할 수 있습니다. 촬영은 여러 번 반복해 누적한 뒤, 보낼 이미지만 선택해서 전송하세요.</p>
        ${escapedError ? `<div class="error">${escapedError}</div>` : ''}
        <form id="uploadForm" method="post" action="${escapedSubmitPath}" enctype="multipart/form-data">
          <input type="hidden" id="token" name="token" value="${escapedToken}" />
          <input id="cameraInput" type="file" accept="image/*" capture="environment" />
          <input id="albumInput" type="file" accept="image/*" multiple />
          <div class="actions">
            <button id="cameraBtn" type="button" class="camera">사진 촬영하기</button>
            <button id="albumBtn" type="button" class="ghost">앨범에서 불러오기</button>
            <button id="submitBtn" type="submit" class="primary">선택한 이미지 전송하기</button>
          </div>
        </form>
        <div id="status" class="status">아직 선택된 이미지가 없습니다.</div>
        <div id="preview" class="preview"></div>
      </div>
    </div>
    <script>
      const MAX_COUNT = 12;
      const form = document.getElementById('uploadForm');
      const tokenInput = document.getElementById('token');
      const cameraInput = document.getElementById('cameraInput');
      const albumInput = document.getElementById('albumInput');
      const cameraBtn = document.getElementById('cameraBtn');
      const albumBtn = document.getElementById('albumBtn');
      const submitBtn = document.getElementById('submitBtn');
      const statusEl = document.getElementById('status');
      const previewEl = document.getElementById('preview');

      let pending = [];

      function setStatus(text) {
        statusEl.textContent = text;
      }

      function buildId() {
        return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      }

      function escapeText(text) {
        return String(text || '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function addFiles(fileList, source) {
        const list = Array.from(fileList || []);
        if (!list.length) return;

        let added = 0;
        for (const file of list) {
          if (!file || !String(file.type || '').startsWith('image/')) continue;
          if (pending.length >= MAX_COUNT) break;
          pending.push({
            id: buildId(),
            file,
            source,
            selected: true,
            previewUrl: URL.createObjectURL(file)
          });
          added += 1;
        }
        if (!added) {
          setStatus('추가된 이미지가 없습니다. (최대 ' + MAX_COUNT + '장)');
        }
      }

      function removeItem(id) {
        const idx = pending.findIndex((x) => x.id === id);
        if (idx < 0) return;
        try { URL.revokeObjectURL(pending[idx].previewUrl); } catch (_) {}
        pending.splice(idx, 1);
      }

      function renderPreview() {
        const selectedCount = pending.filter((x) => x.selected).length;
        if (!pending.length) {
          previewEl.innerHTML = '';
          setStatus('아직 선택된 이미지가 없습니다.');
          submitBtn.disabled = true;
          return;
        }

        previewEl.innerHTML = pending.map((item, index) => {
          const safeName = escapeText(String(item.file && item.file.name ? item.file.name : 'image'));
          const sourceLabel = item.source === 'camera' ? '촬영' : '앨범';
          return '<div class="thumb" data-id="' + item.id + '">' +
            '<img src="' + item.previewUrl + '" alt="preview" />' +
            '<div class="thumb-foot">' +
              '<div class="row">' +
                '<label class="muted"><input data-action="toggle" type="checkbox" ' + (item.selected ? 'checked' : '') + ' /> 선택</label>' +
                '<button data-action="remove" type="button" class="remove">삭제</button>' +
              '</div>' +
              '<div class="muted">#' + (index + 1) + ' · ' + sourceLabel + '</div>' +
              '<div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + safeName + '</div>' +
            '</div>' +
          '</div>';
        }).join('');

        setStatus('총 ' + pending.length + '장 준비됨 / 전송 선택 ' + selectedCount + '장');
        submitBtn.disabled = selectedCount === 0;
      }

      cameraBtn.addEventListener('click', () => cameraInput.click());
      albumBtn.addEventListener('click', () => albumInput.click());

      cameraInput.addEventListener('change', () => {
        addFiles(cameraInput.files, 'camera');
        cameraInput.value = '';
        renderPreview();
      });

      albumInput.addEventListener('change', () => {
        addFiles(albumInput.files, 'album');
        albumInput.value = '';
        renderPreview();
      });

      previewEl.addEventListener('click', (e) => {
        const target = e.target;
        const action = target && target.dataset ? target.dataset.action : '';
        if (!action) return;
        const card = target.closest('.thumb');
        if (!card) return;
        const id = card.dataset.id;
        if (!id) return;
        if (action === 'remove') {
          removeItem(id);
          renderPreview();
        }
      });

      previewEl.addEventListener('change', (e) => {
        const target = e.target;
        const action = target && target.dataset ? target.dataset.action : '';
        if (action !== 'toggle') return;
        const card = target.closest('.thumb');
        if (!card) return;
        const id = card.dataset.id;
        const item = pending.find((x) => x.id === id);
        if (!item) return;
        item.selected = !!target.checked;
        renderPreview();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const selected = pending.filter((x) => x.selected);
        if (!selected.length) {
          setStatus('전송할 이미지를 최소 1장 선택해 주세요.');
          return;
        }

        submitBtn.disabled = true;
        cameraBtn.disabled = true;
        albumBtn.disabled = true;
        setStatus('업로드 중입니다...');
        let uploadedOk = false;
        try {
          const formData = new FormData();
          formData.append('token', tokenInput.value || '');
          for (const item of selected) {
            formData.append('images', item.file, item.file.name || 'upload.jpg');
          }

          const res = await fetch(form.action, { method: 'POST', body: formData });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

          for (const item of pending) {
            try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
          }
          pending = [];
          previewEl.innerHTML = '';
          setStatus('업로드 완료: ' + (data.uploaded_count || 0) + '장');
          uploadedOk = true;
        } catch (err) {
          setStatus('업로드 실패: ' + (err && err.message ? err.message : '오류'));
        } finally {
          submitBtn.disabled = false;
          cameraBtn.disabled = false;
          albumBtn.disabled = false;
          if (!uploadedOk) renderPreview();
        }
      });

      renderPreview();
    </script>
  </body>
</html>`;
}

export default function problemUploadRoutes(db) {
  const router = express.Router();

  ensureWrongAnswerImagesTable(db);

  router.get('/image/:imageId', (req, res) => {
    const imageId = String(req.params?.imageId || '').trim();
    if (!imageId) return res.status(400).json({ error: 'Missing image id' });

    const row = db
      .prepare('SELECT mime_type, data_blob FROM wrong_answer_images WHERE id=? AND deleted_at IS NULL')
      .get(imageId);
    if (!row?.data_blob) return res.status(404).json({ error: 'Image not found' });

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', String(row.mime_type || 'image/jpeg'));
    return res.send(row.data_blob);
  });

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

      const weekRecord = db.prepare('SELECT id FROM week_records WHERE student_id=? AND week_id=?').get(studentId, weekId);
      if (!weekRecord?.id) return res.status(404).json({ error: '주간 기록을 찾지 못했습니다.' });

      const now = new Date().toISOString();
      const insertImage = db.prepare(`
        INSERT INTO wrong_answer_images
          (id, student_id, week_id, problem_index, filename, mime_type, size_bytes, data_blob, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL)
      `);
      const uploaded = [];

      const tx = db.transaction(() => {
        for (const file of files) {
          const imageId = `img_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
          insertImage.run(
            imageId,
            studentId,
            weekId,
            problemIndex,
            String(file.originalname || '').trim(),
            String(file.mimetype || '').trim(),
            Number(file.size || 0),
            file.buffer
          );

          uploaded.push({
            id: imageId,
            filename: String(file.originalname || '').trim(),
            stored_name: imageId,
            url: `/api/problem-upload/image/${imageId}`,
            mime_type: String(file.mimetype || '').trim(),
            size: Number(file.size || 0),
            uploaded_at: now,
            uploaded_via: 'qr_mobile'
          });
        }
      });
      tx();

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
