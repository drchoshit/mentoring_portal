import { createHash } from 'node:crypto';
import { hasCurriculum } from './curriculum.js';

const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

function candidatesFrom(db, target, source) {
  // IDs alone are insufficient when comparing different database snapshots.
  const student = db.prepare('SELECT id,name FROM students WHERE id=?').get(target.student_id);
  const subject = db.prepare('SELECT id,student_id,name FROM mentoring_subjects WHERE id=?').get(target.subject_id);
  if (student?.name !== target.student_name || subject?.name !== target.subject_name
    || subject?.student_id !== target.student_id) return [];
  const rows = db.prepare(`SELECT r.*, w.label AS week_label, w.start_date AS week_start_date
    FROM subject_records r JOIN weeks w ON w.id=r.week_id
    WHERE r.student_id=? AND r.subject_id=? AND r.week_id<=? ORDER BY r.week_id DESC`)
    .all(target.student_id, target.subject_id, target.week_id);
  const candidates = [];
  for (const row of rows) {
    if (row.week_id === target.week_id && (row.week_label !== target.week_label
      || row.week_start_date !== target.week_start_date)) continue;
    const add = (value, timestamp, origin) => {
      if (hasCurriculum(value)) candidates.push({ value, week_id: row.week_id, timestamp: timestamp || '', source, origin });
    };
    add(row.a_curriculum, row.curriculum_updated_at || row.updated_at, `subject_record:${row.id}`);
    if (tableExists(db, 'curriculum_history')) {
      for (const revision of db.prepare(`SELECT * FROM curriculum_history WHERE subject_record_id=?
        AND student_id=? AND subject_id=? AND week_id=? ORDER BY id DESC`)
        .all(row.id, row.student_id, row.subject_id, row.week_id)) {
        add(revision.after_value, revision.created_at, `history:${revision.id}:after`);
        if (!hasCurriculum(revision.after_value)) add(revision.before_value, revision.created_at, `history:${revision.id}:before`);
      }
    }
    if (tableExists(db, 'audit_logs')) {
      for (const audit of db.prepare("SELECT * FROM audit_logs WHERE entity='subject_record' AND entity_id=? ORDER BY id DESC").all(row.id)) {
        let detail; try { detail = JSON.parse(audit.details_json); } catch { continue; }
        if (detail?.student_id != null && Number(detail.student_id) !== row.student_id) continue;
        if (detail?.week_id != null && Number(detail.week_id) !== row.week_id) continue;
        if (detail?.subject_id != null && Number(detail.subject_id) !== row.subject_id) continue;
        // For a clear operation, its before-value is the last recoverable version.
        add(detail?.after?.a_curriculum, audit.created_at, `audit:${audit.id}:after`);
        if (!hasCurriculum(detail?.after?.a_curriculum)) add(detail?.before?.a_curriculum, audit.created_at, `audit:${audit.id}:before`);
      }
    }
  }
  return candidates;
}

export function planCurriculumRecovery(db, { studentNames, weekId, sources = [] }) {
  if (!db.prepare('SELECT id FROM weeks WHERE id=?').get(weekId)) throw Error('Target week does not exist');
  const plan = { week_id: weekId, students: [], changes: [], unresolved: [], skipped_existing: 0, source_errors: [] };
  for (const name of studentNames) {
    const matches = db.prepare('SELECT id,name FROM students WHERE name=?').all(name);
    if (matches.length !== 1) throw Error(`Student must match exactly once: ${name} (${matches.length} matches)`);
    const student = matches[0]; plan.students.push(student);
    const targets = db.prepare(`SELECT r.*, s.name AS student_name, m.name AS subject_name,
      w.label AS week_label, w.start_date AS week_start_date
      FROM subject_records r JOIN students s ON s.id=r.student_id
      JOIN mentoring_subjects m ON m.id=r.subject_id JOIN weeks w ON w.id=r.week_id
      WHERE r.student_id=? AND r.week_id=? AND (m.deleted_from_week_id IS NULL OR m.deleted_from_week_id>?)`)
      .all(student.id, weekId, weekId);
    if (!targets.length) plan.unresolved.push({ student_id: student.id, reason: 'No subject records in target week' });
    for (const target of targets) {
      if (hasCurriculum(target.a_curriculum)) { plan.skipped_existing++; continue; }
      let candidates = candidatesFrom(db, target, 'current database');
      for (const source of sources) {
        try { candidates.push(...candidatesFrom(source.db, target, source.name)); }
        catch (error) { plan.source_errors.push({ source: source.name, record_id: target.id, error: error.message }); }
      }
      candidates.sort((a, b) => b.week_id - a.week_id || b.timestamp.localeCompare(a.timestamp));
      const best = candidates[0];
      const tied = best ? candidates.filter((c) => c.week_id === best.week_id && c.timestamp === best.timestamp) : [];
      const values = new Set(tied.map((c) => c.value));
      if (!best || values.size !== 1) {
        plan.unresolved.push({ record_id: target.id, student_id: student.id, subject_name: target.subject_name,
          reason: !best ? 'No surviving curriculum found' : 'Conflicting source versions require review', candidates: tied });
        continue;
      }
      plan.changes.push({ record_id: target.id, student_id: student.id, student_name: student.name,
        subject_id: target.subject_id, subject_name: target.subject_name, week_id: weekId,
        before: target.a_curriculum, after: best.value, evidence: best });
    }
  }
  return plan;
}

function protectedDigest(db, changes) {
  const ignoredCurricula = new Set(changes.map((c) => c.record_id));
  const hash = createHash('sha256');
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    if (name === 'curriculum_history') continue;
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    hash.update(name);
    for (const row of db.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).iterate()) {
      if (name === 'subject_records' && ignoredCurricula.has(row.id)) row.a_curriculum = '<recovery-target>';
      hash.update(JSON.stringify(row));
    }
  }
  return hash.digest('hex');
}

export function applyCurriculumRecovery(db, plan) {
  return db.transaction(() => {
    if (!Array.isArray(plan.changes) || !plan.changes.length) return { restored: 0 };
    const beforeDigest = protectedDigest(db, plan.changes);
    for (const change of plan.changes) {
      const row = db.prepare(`SELECT r.*, s.name student_name, m.name subject_name FROM subject_records r
        JOIN students s ON s.id=r.student_id JOIN mentoring_subjects m ON m.id=r.subject_id WHERE r.id=?`).get(change.record_id);
      if (!row || row.student_id !== change.student_id || row.subject_id !== change.subject_id
        || row.week_id !== change.week_id || row.student_name !== change.student_name || row.subject_name !== change.subject_name
        || row.a_curriculum !== change.before || hasCurriculum(row.a_curriculum) || !hasCurriculum(change.after)) {
        throw Error(`Recovery target changed or is not empty: ${change.record_id}. No changes applied.`);
      }
      db.prepare('UPDATE subject_records SET a_curriculum=? WHERE id=?').run(change.after, row.id);
    }
    const afterDigest = protectedDigest(db, plan.changes);
    if (beforeDigest !== afterDigest) throw Error('Unrelated data changed; entire recovery rolled back');
    return { restored: plan.changes.length, protected_digest_before: beforeDigest, protected_digest_after: afterDigest };
  }).immediate();
}
