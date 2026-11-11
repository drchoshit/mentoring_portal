// Student synchronization must never turn a roster removal into lost learning records.
export function studentHasLearningRecords(db, studentId) {
  const tables = [
    'subject_records', 'week_records', 'mentoring_records', 'curriculum_history',
    'problem_uploads', 'wrong_answer_images', 'penalties', 'parent_legacy_images'
  ];
  for (const table of tables) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    if (db.prepare(`SELECT 1 FROM ${table} WHERE student_id=? LIMIT 1`).get(studentId)) return true;
  }
  return false;
}

export function assertStudentDeletionAllowed(db, studentId) {
  if (studentHasLearningRecords(db, studentId)) {
    throw Object.assign(new Error('학습 기록이 있는 학생은 삭제할 수 없습니다. 기존 학생과 기록을 유지해 주세요.'), {
      code: 'STUDENT_HAS_LEARNING_RECORDS'
    });
  }
}
