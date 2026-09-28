// Treat legacy serialized empty editors as empty, too.
export function hasCurriculum(value) {
  if (value == null) return false;
  if (typeof value === 'string') {
    if (!value.trim()) return false;
    try { return hasCurriculum(JSON.parse(value)); } catch { return true; }
  }
  if (typeof value === 'object') return Object.values(value).some(hasCurriculum);
  return true;
}

export function latestCurriculum(db, studentId, subjectId, beforeWeekId, sourceWeekId = null) {
  // A pinned source is an upper bound; a gap there must not break inheritance.
  return db.prepare(`SELECT * FROM subject_records
    WHERE student_id=? AND subject_id=? AND week_id < ? AND week_id <= ?
    ORDER BY week_id DESC, id DESC`)
    .all(studentId, subjectId, beforeWeekId, sourceWeekId || beforeWeekId)
    .find((row) => hasCurriculum(row.a_curriculum));
}

export function fillMissingCurricula(db, studentId, weekId, sourceWeekId = null) {
  return db.transaction(() => {
    const subjects = db.prepare(`SELECT id FROM mentoring_subjects WHERE student_id=?
      AND (deleted_from_week_id IS NULL OR deleted_from_week_id > ?)`)
      .all(studentId, weekId);
    let count = 0;
    for (const subject of subjects) {
      const target = db.prepare(`SELECT * FROM subject_records
        WHERE student_id=? AND week_id=? AND subject_id=?`).get(studentId, weekId, subject.id);
      if (hasCurriculum(target?.a_curriculum)) continue;
      const source = latestCurriculum(db, studentId, subject.id, weekId, sourceWeekId);
      if (!source) continue;
      // Only the missing curriculum changes: homework, comments and authors stay intact.
      if (target) {
        db.prepare('UPDATE subject_records SET a_curriculum=? WHERE id=?')
          .run(source.a_curriculum, target.id);
      } else {
        db.prepare(`INSERT INTO subject_records (student_id, week_id, subject_id, a_curriculum)
          VALUES (?, ?, ?, ?)`).run(studentId, weekId, subject.id, source.a_curriculum);
      }
      count++;
    }
    return count;
  })();
}

export function ensureCurriculumHistory(db) {
  // No foreign keys: revisions must survive removal of a source row/student/week.
  db.exec(`
    CREATE TABLE IF NOT EXISTS curriculum_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_record_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      week_id INTEGER NOT NULL, subject_id INTEGER NOT NULL,
      before_value TEXT, after_value TEXT, operation TEXT NOT NULL,
      changed_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_curriculum_history_record ON curriculum_history(subject_record_id, id);
    CREATE TRIGGER IF NOT EXISTS curriculum_history_insert AFTER INSERT ON subject_records
    WHEN NEW.a_curriculum IS NOT NULL
    BEGIN
      INSERT INTO curriculum_history (subject_record_id, student_id, week_id, subject_id, after_value, operation, changed_by)
      VALUES (NEW.id, NEW.student_id, NEW.week_id, NEW.subject_id, NEW.a_curriculum, 'insert', NEW.updated_by);
    END;
    CREATE TRIGGER IF NOT EXISTS curriculum_history_update AFTER UPDATE OF a_curriculum ON subject_records
    WHEN OLD.a_curriculum IS NOT NEW.a_curriculum
    BEGIN
      INSERT INTO curriculum_history (subject_record_id, student_id, week_id, subject_id, before_value, after_value, operation, changed_by)
      VALUES (NEW.id, NEW.student_id, NEW.week_id, NEW.subject_id, OLD.a_curriculum, NEW.a_curriculum, 'update', NEW.updated_by);
    END;
    CREATE TRIGGER IF NOT EXISTS curriculum_history_delete AFTER DELETE ON subject_records
    WHEN OLD.a_curriculum IS NOT NULL
    BEGIN
      INSERT INTO curriculum_history (subject_record_id, student_id, week_id, subject_id, before_value, operation, changed_by)
      VALUES (OLD.id, OLD.student_id, OLD.week_id, OLD.subject_id, OLD.a_curriculum, 'delete', OLD.updated_by);
    END;
  `);
}
