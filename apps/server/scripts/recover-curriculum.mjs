import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { planCurriculumRecovery, applyCurriculumRecovery } from '../src/lib/curriculumRecovery.js';

// No server bootstrap/import: inspection must never migrate or seed a real DB.
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1] || ''; };
const dbPath = option('--db');
const reportPath = option('--report');
const applyPath = option('--apply-plan');
if (!dbPath || (!reportPath && !applyPath)) {
  throw Error('Usage: --db PATH --week ID --students "name1,name2" --report NEW.json [--backups DIR] | --db PATH --apply-plan PLAN.json');
}
const databasePath = path.resolve(dbPath);
const db = new Database(databasePath, { readonly: !applyPath, fileMustExist: true });
const opened = [];
try {
  if (applyPath) {
    const plan = JSON.parse(fs.readFileSync(applyPath, 'utf8'));
    if (plan.database_path !== databasePath) throw Error('Plan belongs to a different database');
    if (!plan.changes?.length) throw Error('Plan has no recoverable changes');
    // Keep the safety snapshot beside the report, outside rotating backup directories.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.resolve(path.dirname(applyPath), `before-curriculum-recovery-${stamp}.sqlite`);
    await db.backup(backupPath);
    const outcome = applyCurriculumRecovery(db, plan);
    fs.writeFileSync(`${applyPath}.applied-${stamp}.json`, JSON.stringify({ ...outcome, safety_backup: backupPath, plan: path.resolve(applyPath) }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...outcome, safety_backup: backupPath }));
  } else {
    const weekId = Number(option('--week'));
    const studentNames = [...new Set(option('--students').split(',').map((s) => s.trim()).filter(Boolean))];
    if (!Number.isInteger(weekId) || weekId <= 0 || !studentNames.length) throw Error('Explicit week and student names required');
    const backupDir = option('--backups');
    const errors = [];
    if (backupDir) {
      for (const name of fs.readdirSync(backupDir).filter((name) => /\.(sqlite|db)$/i.test(name)).sort()) {
        const file = path.resolve(backupDir, name); if (file === databasePath) continue;
        try { opened.push({ name: file, db: new Database(file, { readonly: true, fileMustExist: true }) }); }
        catch (error) { errors.push({ source: file, error: error.message }); }
      }
    }
    const plan = planCurriculumRecovery(db, { studentNames, weekId, sources: opened });
    plan.database_path = databasePath; plan.generated_at = new Date().toISOString(); plan.source_errors.push(...errors);
    fs.writeFileSync(reportPath, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ mode: 'read-only', recoverable: plan.changes.length, unresolved: plan.unresolved.length,
      skipped_existing: plan.skipped_existing, source_errors: plan.source_errors.length, report: path.resolve(reportPath) }));
  }
} finally {
  for (const source of opened) source.db.close();
  db.close();
}
