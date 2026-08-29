const DEFAULT_KEEP_RECENT_WEEKS = 8;

function tableExists(db, tableName) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName)
  );
}

export function resolveProblemImageRetentionWeeks(value = process.env.PROBLEM_IMAGE_KEEP_RECENT_WEEKS) {
  const parsed = Number(value ?? DEFAULT_KEEP_RECENT_WEEKS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_KEEP_RECENT_WEEKS;
}

export function cleanupOldProblemImages(db, keepRecentWeeks = resolveProblemImageRetentionWeeks()) {
  const keepCount = resolveProblemImageRetentionWeeks(keepRecentWeeks);
  const keepRows = db
    .prepare('SELECT id FROM weeks ORDER BY id DESC LIMIT ?')
    .all(keepCount);
  const keepWeekIds = keepRows
    .map((row) => Number(row?.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0);

  const result = {
    keep_recent_weeks: keepCount,
    keep_week_ids: keepWeekIds,
    deleted_wrong_answer_images: 0,
    deleted_image_bytes: 0,
    records_preserved: true
  };

  if (!keepWeekIds.length || !tableExists(db, 'wrong_answer_images')) return result;

  const placeholders = keepWeekIds.map(() => '?').join(',');
  const where = `week_id NOT IN (${placeholders})`;
  const targets = db
    .prepare(`SELECT id, size_bytes FROM wrong_answer_images WHERE ${where}`)
    .all(...keepWeekIds);
  const deleteImage = db.prepare('DELETE FROM wrong_answer_images WHERE id=?');

  // Keep each transaction small. A nearly-full Render disk may not have room
  // for one large rollback journal covering every historical image at once.
  for (const target of targets) {
    const deleted = deleteImage.run(target.id);
    if (!deleted?.changes) continue;
    result.deleted_wrong_answer_images += Number(deleted.changes);
    result.deleted_image_bytes += Number(target?.size_bytes || 0);
  }
  return result;
}
