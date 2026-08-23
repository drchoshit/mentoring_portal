import fs from 'node:fs';
import path from 'node:path';

let backupInProgress = null;

function backupBusyError() {
  const error = new Error('A database backup is already in progress');
  error.code = 'BACKUP_IN_PROGRESS';
  return error;
}

export function isBackupInProgress() {
  return Boolean(backupInProgress);
}

export async function createAtomicSqliteBackup(db, outputPath) {
  if (backupInProgress) throw backupBusyError();

  const target = path.resolve(String(outputPath || '').trim());
  if (!target) throw new Error('Backup output path is required');
  const partial = `${target}.partial-${process.pid}-${Date.now()}`;

  backupInProgress = (async () => {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    try {
      await db.backup(partial);
      await fs.promises.rename(partial, target);
      return target;
    } catch (error) {
      try { await fs.promises.unlink(partial); } catch {}
      throw error;
    }
  })();

  try {
    return await backupInProgress;
  } finally {
    backupInProgress = null;
  }
}
