import express from 'express';
import multer from 'multer';
import { requireRole } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

function parseJsonFile(req) {
  if (!req.file) throw new Error('Missing file');
  const txt = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(txt);
}

function ensureAppSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnInfo(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function hasColumn(db, table, col) {
  try {
    const rows = columnInfo(db, table);
    return rows.some((r) => r.name === col);
  } catch {
    return false;
  }
}

function columnAllowsNull(db, table, column) {
  const cols = columnInfo(db, table);
  const c = cols.find((x) => x.name === column);
  if (!c) return true;
  return Number(c.notnull || 0) !== 1;
}

function deleteStudentCascade(db, studentId) {
  const id = Number(studentId);
  if (!id) return;

  const tx = db.transaction(() => {
    if (tableExists(db, 'parent_links')) {
      db.prepare('DELETE FROM parent_links WHERE student_id=?').run(id);
    }
    if (tableExists(db, 'parent_credentials')) {
      db.prepare('DELETE FROM parent_credentials WHERE student_id=?').run(id);
    }

    if (tableExists(db, 'feeds')) {
      const canNull = columnAllowsNull(db, 'feeds', 'student_id');
      if (canNull) {
        db.prepare('UPDATE feeds SET student_id=NULL WHERE student_id=?').run(id);
      } else {
        db.prepare('DELETE FROM feeds WHERE student_id=?').run(id);
      }
    }

    if (tableExists(db, 'mentoring_records')) {
      db.prepare('DELETE FROM mentoring_records WHERE student_id=?').run(id);
    }
    if (tableExists(db, 'week_records')) {
      db.prepare('DELETE FROM week_records WHERE student_id=?').run(id);
    }
    if (tableExists(db, 'subject_records')) {
      db.prepare('DELETE FROM subject_records WHERE student_id=?').run(id);
    }
    if (tableExists(db, 'mentoring_subjects')) {
      db.prepare('DELETE FROM mentoring_subjects WHERE student_id=?').run(id);
    }
    if (tableExists(db, 'penalties')) {
      db.prepare('DELETE FROM penalties WHERE student_id=?').run(id);
    }

    db.prepare('DELETE FROM students WHERE id=?').run(id);
  });

  tx();
}

const KO_TO_EN_DAY = {
  '월': 'Mon',
  '화': 'Tue',
  '수': 'Wed',
  '목': 'Thu',
  '금': 'Fri',
  '토': 'Sat',
  '일': 'Sun'
};

const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildScheduleJson({ weekStart, weekRangeText, items }) {
  const out = {
    week_start: weekStart || null,
    week_range_text: weekRangeText || ''
  };
  for (const d of EN_DAYS) out[d] = [];

  // items: [{day:'월', start:'08:00', end:'13:00', type:'센터', description:''}, ...]
  for (const it of items || []) {
    const koDay = String(it?.day || '').trim();
    const enDay = KO_TO_EN_DAY[koDay];
    if (!enDay) continue;

    const start = String(it?.start || '').trim();
    const end = String(it?.end || '').trim();
    const type = String(it?.type || '').trim();
    const desc = String(it?.description || '').trim();

    if (!start || !end) continue;

    const time = `${start}~${end}`;
    const title = desc ? `${type} ${desc}`.trim() : (type || '');

    out[enDay].push({
      time,
      title,
      type
    });
  }

  // 정렬(시간 문자열 기준)
  for (const d of EN_DAYS) {
    out[d].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }

  return out;
}

export default function importRoutes(db) {
  const router = express.Router();

  // 기존: 학생 목록 import (전화번호까지 반영하도록 개선)
  router.post('/students', requireRole('director', 'admin'), upload.single('file'), (req, res) => {
    let payload;
    try {
      payload = parseJsonFile(req);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const students = Array.isArray(payload) ? payload : payload.students;
    if (!Array.isArray(students)) return res.status(400).json({ error: 'Expected array' });

    const stmtGet = db.prepare('SELECT id FROM students WHERE external_id=?');
    const stmtUpsert = db.prepare(`
      INSERT INTO students (external_id, name, grade, student_phone, parent_phone, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(external_id) DO UPDATE SET
        name = excluded.name,
        grade = excluded.grade,
        student_phone = excluded.student_phone,
        parent_phone = excluded.parent_phone
    `);

    let created = 0;
    let updated = 0;
    let deleted = 0;
    const incomingIds = new Set();

    const tx = db.transaction(() => {
      for (const s of students) {
        const external_id = String(s.external_id || s.id || s.studentId || s.code || '').trim();
        const name = String(s.name || '').trim();
        if (!external_id || !name) continue;

        const before = stmtGet.get(external_id);
        incomingIds.add(external_id);

        const grade = s.grade ? String(s.grade) : null;
        const student_phone = s.studentPhone ? String(s.studentPhone) : (s.student_phone ? String(s.student_phone) : null);
        const parent_phone = s.parentPhone ? String(s.parentPhone) : (s.parent_phone ? String(s.parent_phone) : null);

        stmtUpsert.run(external_id, name, grade, student_phone, parent_phone);

        if (before) updated += 1;
        else created += 1;
      }
    });

    tx();

    if (incomingIds.size) {
      const rows = db.prepare('SELECT id, external_id FROM students WHERE external_id IS NOT NULL AND external_id != ?').all('');
      for (const r of rows) {
        const ext = String(r.external_id || '').trim();
        if (!ext || incomingIds.has(ext)) continue;
        deleteStudentCascade(db, r.id);
        deleted += 1;
      }
    }

    writeAudit(db, {
      user_id: req.user.id,
      action: 'import',
      entity: 'students',
      details: { created, updated, deleted }
    });

    return res.json({ created, updated, deleted });
  });

  // 기존: 벌점 import
  router.post('/penalties', requireRole('director', 'admin'), upload.single('file'), (req, res) => {
    let payload;
    try { payload = parseJsonFile(req); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    const studentsFromPayload = Array.isArray(payload?.students) ? payload.students : [];
    const studentNameById = new Map();
    for (const s of studentsFromPayload) {
      const sid = String(s?.id || '').trim();
      const name = String(s?.name || '').trim();
      if (sid && name) studentNameById.set(sid, name);
    }

    const items = [];
    const pushPenalty = (p, baseStudent = null) => {
      if (!p) return;
      const nestedStudent = p?.student || null;
      items.push({
        ...(p || {}),
        student_id:
          p?.student_id ||
          p?.studentId ||
          p?.student_external_id ||
          p?.external_id ||
          nestedStudent?.id ||
          nestedStudent?.external_id ||
          baseStudent?.id ||
          baseStudent?.external_id ||
          null,
        student_name:
          p?.student_name ||
          p?.studentName ||
          nestedStudent?.name ||
          baseStudent?.name ||
          null
      });
    };
    const getPenaltyArray = (obj) => {
      if (!obj || typeof obj !== 'object') return [];
      const direct = [
        obj.penalties,
        obj.items,
        obj.records,
        obj.entries,
        obj.history,
        obj.list,
        obj.rows
      ];
      for (const arr of direct) {
        if (Array.isArray(arr) && arr.length) return arr;
      }
      return [];
    };
    const flattenStudentBlock = (block) => {
      if (!block) return false;
      const arr = getPenaltyArray(block);
      if (!arr.length) return false;
      for (const p of arr) pushPenalty(p, block?.student || block);
      return true;
    };

    if (Array.isArray(payload)) {
      const asStudentBlocks = payload.some((row) => Array.isArray(row?.penalties));
      if (asStudentBlocks) {
        for (const block of payload) flattenStudentBlock(block);
      } else {
        for (const p of payload) pushPenalty(p, null);
      }
    } else if (Array.isArray(payload?.penalties)) {
      for (const p of payload.penalties) pushPenalty(p, payload?.student || null);
    } else if (Array.isArray(payload?.items)) {
      for (const block of payload.items) {
        if (!flattenStudentBlock(block)) pushPenalty(block, block?.student || null);
      }
    } else if (Array.isArray(payload?.records)) {
      for (const block of payload.records) {
        if (!flattenStudentBlock(block)) pushPenalty(block, block?.student || null);
      }
    } else if (Array.isArray(payload?.rows)) {
      for (const block of payload.rows) {
        if (!flattenStudentBlock(block)) pushPenalty(block, block?.student || null);
      }
    } else if (Array.isArray(payload?.list)) {
      for (const block of payload.list) {
        if (!flattenStudentBlock(block)) pushPenalty(block, block?.student || null);
      }
    } else if (Array.isArray(payload?.students)) {
      for (const s of payload.students) flattenStudentBlock(s);
    } else if (Array.isArray(payload?.data)) {
      const asStudentBlocks = payload.data.some((row) => getPenaltyArray(row).length > 0);
      if (asStudentBlocks) {
        for (const block of payload.data) flattenStudentBlock(block);
      } else {
        for (const p of payload.data) pushPenalty(p, null);
      }
    }

    if (!Array.isArray(items) || !items.length) {
      const topKeys = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).slice(0, 20)
        : [];
      return res.status(400).json({ error: 'Expected array', keys: topKeys });
    }

    const findStudentByExternal = db.prepare('SELECT id FROM students WHERE external_id=?');
    const findStudentByName = db.prepare('SELECT id FROM students WHERE name=?');
    const findStudentById = db.prepare('SELECT id FROM students WHERE id=?');
    const findWeekByLabel = db.prepare('SELECT id FROM weeks WHERE label=?');
    const findWeekByDate = db.prepare('SELECT id FROM weeks WHERE start_date <= ? AND end_date >= ? ORDER BY id DESC LIMIT 1');
    const findLatestWeek = db.prepare('SELECT id FROM weeks ORDER BY id DESC LIMIT 1');

    const pointsCol = hasColumn(db, 'penalties', 'points')
      ? 'points'
      : (hasColumn(db, 'penalties', 'amount') ? 'amount' : 'points');
    const dateCol = hasColumn(db, 'penalties', 'date')
      ? 'date'
      : (hasColumn(db, 'penalties', 'created_at') ? 'created_at' : null);
    const hasWeekId = hasColumn(db, 'penalties', 'week_id');
    const weekRequired = hasWeekId && !columnAllowsNull(db, 'penalties', 'week_id');

    let replaced = 0;
    let inserted = 0;
    let skippedNoStudent = 0;
    let skippedNoWeek = 0;
    let usedFallbackWeek = 0;
    const tx = db.transaction(() => {
      // Import semantics: replace existing penalties with uploaded file data.
      db.prepare('DELETE FROM penalties').run();

      for (const p of items) {
        const rawDate = String(p.date || p.day || p.occurred_on || p.occurredOn || p.created_at || p.createdAt || '').trim();
        const date = rawDate ? rawDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
        const points = Number(p.points ?? p.point ?? p.amount ?? p.score ?? p.value ?? p.penalty_points ?? p.penaltyPoint ?? 0);
        const ruleTitle = String(p.rule_title || p.ruleTitle || p.title || '').trim();
        const memo = String(p.memo || p.note || p.reason || p.description || p.desc || p.content || '').trim();
        const reason = [ruleTitle, memo].filter(Boolean).join(' - ').trim();
        if (!reason) continue;

        let studentId = null;
        if (p.student_external_id || p.external_id || p.studentId || p.student_id || p?.student?.id || p?.student?.external_id) {
          const ext = String(p.student_external_id || p.external_id || p.studentId || p.student_id || p?.student?.id || p?.student?.external_id).trim();
          studentId = findStudentByExternal.get(ext)?.id ?? null;
          if (!studentId && /^\d+$/.test(ext)) {
            studentId = findStudentById.get(Number(ext))?.id ?? null;
          }
        }
        if (!studentId && (p.student_name || p.studentName || p?.student?.name)) {
          studentId = findStudentByName.get(String(p.student_name || p.studentName || p?.student?.name))?.id ?? null;
        }
        if (!studentId && p.student_id) {
          const name = studentNameById.get(String(p.student_id).trim());
          if (name) studentId = findStudentByName.get(String(name))?.id ?? null;
        }
        if (!studentId) {
          skippedNoStudent += 1;
          continue;
        }

        let weekId = null;
        if (p.week_id || p.weekId || p.week) {
          const rawWeek = p.week_id ?? p.weekId ?? p.week;
          const num = Number(rawWeek);
          weekId = Number.isFinite(num) && num > 0 ? num : null;
        }

        if (!weekId && (p.week_label || p.weekLabel || p.week_name || p.weekName)) {
          const label = String(p.week_label || p.weekLabel || p.week_name || p.weekName).trim();
          if (label) {
            weekId = findWeekByLabel.get(label)?.id ?? null;
          }
        }

        if (!weekId && date) {
          weekId = findWeekByDate.get(date, date)?.id ?? null;
        }

        if (weekRequired && !weekId) {
          const fallbackWeek = findLatestWeek.get()?.id ?? null;
          if (fallbackWeek) {
            weekId = fallbackWeek;
            usedFallbackWeek += 1;
          } else {
            skippedNoWeek += 1;
            continue;
          }
        }

        const cols = ['student_id'];
        const vals = [studentId];
        if (hasWeekId) {
          cols.push('week_id');
          vals.push(weekId);
        }
        cols.push(pointsCol);
        vals.push(points);
        cols.push('reason');
        vals.push(reason);
        if (dateCol) {
          cols.push(dateCol);
          vals.push(date);
        }

        const placeholders = cols.map(() => '?').join(', ');
        const sql = `INSERT INTO penalties (${cols.join(', ')}) VALUES (${placeholders})`;
        db.prepare(sql).run(...vals);
        inserted += 1;
      }
    });
    tx();
    replaced = inserted;

    writeAudit(db, { user_id: req.user.id, action: 'import', entity: 'penalties', details: { replaced, inserted, skippedNoStudent, skippedNoWeek, usedFallbackWeek } });
    return res.json({ replaced, inserted, skippedNoStudent, skippedNoWeek, usedFallbackWeek });
  });

  // 신규: 일정 백업 업로드 (학생 정보는 유지, 캘린더(schedule_json)만 갱신)
  // 프론트가 호출하는 경로: /api/import/schedule-backup
  router.post('/schedule-backup', requireRole('director', 'admin'), upload.single('file'), (req, res) => {
    let payload;
    try {
      payload = parseJsonFile(req);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const studentSchedules = Array.isArray(payload?.studentSchedules) ? payload.studentSchedules : [];
    const schedules = Array.isArray(payload?.schedules) ? payload.schedules : [];
    const settings = payload?.settings ?? null;

    // week_start 결정: schedules에 있으면 그 값(대부분 1개), 없으면 null
    let weekStart = null;
    if (schedules.length) {
      for (const sc of schedules) {
        const ws = String(sc?.week_start || '').trim();
        if (ws) { weekStart = ws; break; }
      }
    }
    const weekRangeText = String(settings?.week_range_text || '').trim();

    // app_settings에 settings 저장(없으면 테이블 생성)
    ensureAppSettingsTable(db);
    const upsertSetting = db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = datetime('now')
    `);

    const stmtGetStudent = db.prepare('SELECT id FROM students WHERE external_id=?');
    const stmtUpdateScheduleJson = db.prepare('UPDATE students SET schedule_json=? WHERE external_id=?');

    // 백업 schedule 맵 구성: external_id -> schedule array
    // 우선 studentSchedules 사용(더 깔끔). 없으면 schedules에서 모아서 사용.
    const scheduleMap = new Map(); // ext -> items[]
    for (const ss of studentSchedules) {
      const ext = String(ss?.id || '').trim();
      if (!ext) continue;
      const items = Array.isArray(ss?.schedule) ? ss.schedule : [];
      scheduleMap.set(ext, items);
    }
    if (!scheduleMap.size && schedules.length) {
      for (const sc of schedules) {
        const ext = String(sc?.student_id || '').trim();
        if (!ext) continue;
        const arr = scheduleMap.get(ext) || [];
        arr.push({
          day: sc.day,
          start: sc.start,
          end: sc.end,
          type: sc.type,
          description: sc.description
        });
        scheduleMap.set(ext, arr);
      }
    }

    let scheduleUpdated = 0;
    let savedSettings = 0;
    let skippedMissing = 0;

    const tx = db.transaction(() => {
      // 1) settings 저장
      if (settings) {
        upsertSetting.run('schedule_backup_settings', JSON.stringify(settings));
        savedSettings = 1;
      }

      // 2) 각 학생 schedule_json 생성/저장 (프론트 CalendarModal 즉시 호환)
      for (const [external_id, items] of scheduleMap.entries()) {
        // 학생이 DB에 있어야 저장
        const exists = stmtGetStudent.get(external_id);
        if (!exists) {
          skippedMissing += 1;
          continue;
        }

        const scheduleJson = buildScheduleJson({
          weekStart,
          weekRangeText,
          items
        });

        stmtUpdateScheduleJson.run(JSON.stringify(scheduleJson), external_id);
        scheduleUpdated += 1;
      }
    });

    tx();

    writeAudit(db, {
      user_id: req.user.id,
      action: 'import',
      entity: 'schedule-backup',
      details: { scheduleUpdated, savedSettings, skippedMissing }
    });

    return res.json({ scheduleUpdated, savedSettings, skippedMissing });
  });

  return router;
}
