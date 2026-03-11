import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function isRenderRuntime() {
  return Boolean(
    process.env.RENDER ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_INSTANCE_ID
  );
}

function normalizeTimestamp(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function parseArgs(argv) {
  const out = {
    since: '',
    cutoff: '',
    top: 3,
    limitPerTable: 500,
    outPath: '',
    rootDir: '',
    onlyCandidate: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--since' && next) {
      out.since = normalizeTimestamp(next);
      i += 1;
      continue;
    }
    if (a === '--cutoff' && next) {
      out.cutoff = normalizeTimestamp(next);
      i += 1;
      continue;
    }
    if (a === '--top' && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.top = Math.floor(n);
      i += 1;
      continue;
    }
    if (a === '--limit' && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) out.limitPerTable = Math.floor(n);
      i += 1;
      continue;
    }
    if (a === '--out' && next) {
      out.outPath = next;
      i += 1;
      continue;
    }
    if (a === '--root' && next) {
      out.rootDir = next;
      i += 1;
      continue;
    }
    if (a === '--candidate' && next) {
      out.onlyCandidate = next;
      i += 1;
      continue;
    }
  }

  return out;
}

function quoteIdent(name) {
  return `"${String(name || '').replace(/"/g, '""')}"`;
}

function resolvePersistentRoot(opts) {
  if (opts.rootDir) {
    return path.isAbsolute(opts.rootDir) ? opts.rootDir : path.resolve(process.cwd(), opts.rootDir);
  }
  const explicit = String(process.env.RENDER_DISK_PATH || process.env.PERSISTENT_DATA_DIR || '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  if (isRenderRuntime()) return '/var/data';
  const cwdData = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(cwdData)) return cwdData;
  const monorepoServerData = path.resolve(process.cwd(), 'apps/server/data');
  if (fs.existsSync(monorepoServerData)) return monorepoServerData;
  return cwdData;
}

function resolvePrimaryDbPath(persistentRoot) {
  const explicit = String(process.env.DB_PATH || '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  return path.join(persistentRoot, 'db.sqlite');
}

function resolveBackupDir(primaryDbPath) {
  const explicit = String(process.env.BACKUP_DIR || '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
  return path.join(path.dirname(primaryDbPath), 'backups');
}

function collectCandidatePaths({ persistentRoot, primaryDbPath, backupDir, onlyCandidate }) {
  if (onlyCandidate) {
    const one = path.isAbsolute(onlyCandidate) ? onlyCandidate : path.resolve(process.cwd(), onlyCandidate);
    return [one];
  }

  const candidates = new Set();
  const add = (p) => {
    const target = String(p || '').trim();
    if (!target) return;
    try {
      if (!fs.existsSync(target)) return;
      const stat = fs.statSync(target);
      if (!stat.isFile()) return;
      const lower = path.basename(target).toLowerCase();
      if (!lower.endsWith('.sqlite') && !lower.endsWith('.db')) return;
      candidates.add(target);
    } catch {}
  };

  add(primaryDbPath);
  add(path.join(path.dirname(primaryDbPath), 'app.db'));
  add(path.join(path.dirname(primaryDbPath), 'db.recovered.sqlite'));

  if (fs.existsSync(backupDir)) {
    try {
      for (const name of fs.readdirSync(backupDir)) add(path.join(backupDir, name));
    } catch {}
  }

  // Broad scan for nested/renamed files in persistent disk.
  const maxDepth = Math.max(1, Number(process.env.DB_DISCOVERY_MAX_DEPTH || 5));
  const maxFiles = Math.max(50, Number(process.env.DB_DISCOVERY_MAX_FILES || 1000));
  const queue = [{ dir: persistentRoot, depth: 0 }];
  let seen = 0;
  while (queue.length && seen < maxFiles) {
    const { dir, depth } = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('-wal') || lower.endsWith('-shm') || lower.endsWith('-journal')) continue;
      add(full);
      seen += 1;
      if (seen >= maxFiles) break;
    }
  }

  return Array.from(candidates);
}

function getTableNames(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name || ''))
  );
}

function getColumns(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => String(c.name || '')));
  } catch {
    return new Set();
  }
}

function getMaxTs(db, table, column) {
  try {
    const row = db.prepare(`SELECT MAX(${quoteIdent(column)}) AS v FROM ${quoteIdent(table)}`).get();
    return normalizeTimestamp(row?.v);
  } catch {
    return '';
  }
}

function getCount(db, table) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)}`).get();
    return Number(row?.cnt || 0);
  } catch {
    return null;
  }
}

function analyzeCandidate(filePath) {
  const result = {
    path: filePath,
    openError: '',
    schemaKnown: false,
    hasRecoverableTables: false,
    marker: '',
    fileMtime: '',
    tableMarkers: {},
    tableCounts: {}
  };

  try {
    result.fileMtime = normalizeTimestamp(fs.statSync(filePath).mtime.toISOString());
  } catch {}

  let db = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const tables = getTableNames(db);
    result.schemaKnown = tables.has('users') && tables.has('students') && tables.has('weeks');
    result.hasRecoverableTables =
      tables.has('week_records') ||
      tables.has('subject_records') ||
      tables.has('feeds') ||
      tables.has('penalties') ||
      tables.has('students');

    const tableTsColumns = {
      mentor_assignments: ['assigned_at', 'created_at', 'updated_at'],
      problem_uploads: ['uploaded_at', 'created_at', 'updated_at'],
      week_records: ['updated_at', 'created_at'],
      subject_records: ['updated_at', 'created_at'],
      feeds: ['created_at'],
      penalties: ['created_at', 'updated_at'],
      students: ['updated_at', 'created_at'],
      users: ['updated_at', 'created_at'],
      weeks: ['updated_at', 'created_at']
    };

    let best = '';
    for (const [table, candidates] of Object.entries(tableTsColumns)) {
      if (!tables.has(table)) continue;
      const cols = getColumns(db, table);
      result.tableCounts[table] = getCount(db, table);
      for (const col of candidates) {
        if (!cols.has(col)) continue;
        const ts = getMaxTs(db, table, col);
        if (!ts) continue;
        const key = `${table}.${col}`;
        result.tableMarkers[key] = ts;
        if (ts > best) best = ts;
      }
    }

    result.marker = best || result.fileMtime || '';
  } catch (e) {
    result.openError = String(e?.code || e?.message || e);
  } finally {
    try { db?.close(); } catch {}
  }

  return result;
}

function chooseTsColumn(db, table, candidates) {
  const cols = getColumns(db, table);
  for (const c of candidates) {
    if (cols.has(c)) return c;
  }
  return '';
}

function extractRowsForCandidate(filePath, { since, cutoff, limitPerTable }) {
  const out = {
    path: filePath,
    extractedAt: new Date().toISOString(),
    tables: {}
  };

  let db = null;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const tables = getTableNames(db);
    const tableTsColumns = {
      mentor_assignments: ['assigned_at', 'created_at', 'updated_at'],
      problem_uploads: ['uploaded_at', 'created_at', 'updated_at'],
      week_records: ['updated_at', 'created_at'],
      subject_records: ['updated_at', 'created_at'],
      feeds: ['created_at'],
      penalties: ['created_at', 'updated_at']
    };

    for (const [table, candidates] of Object.entries(tableTsColumns)) {
      if (!tables.has(table)) continue;
      const tsCol = chooseTsColumn(db, table, candidates);
      if (!tsCol) continue;

      const where = [];
      const params = { limit: limitPerTable };
      if (since) {
        where.push(`${quoteIdent(tsCol)} >= @since`);
        params.since = since;
      }
      if (cutoff) {
        where.push(`${quoteIdent(tsCol)} <= @cutoff`);
        params.cutoff = cutoff;
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const sql = `
        SELECT *
        FROM ${quoteIdent(table)}
        ${whereSql}
        ORDER BY ${quoteIdent(tsCol)} DESC
        LIMIT @limit
      `;
      const rows = db.prepare(sql).all(params);
      out.tables[table] = {
        timestampColumn: tsCol,
        rowCount: rows.length,
        rows
      };
    }
  } catch (e) {
    out.error = String(e?.code || e?.message || e);
  } finally {
    try { db?.close(); } catch {}
  }

  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const persistentRoot = resolvePersistentRoot(opts);
  const primaryDbPath = resolvePrimaryDbPath(persistentRoot);
  const backupDir = resolveBackupDir(primaryDbPath);
  const candidates = collectCandidatePaths({
    persistentRoot,
    primaryDbPath,
    backupDir,
    onlyCandidate: opts.onlyCandidate
  });

  const analyzed = candidates.map(analyzeCandidate);
  analyzed.sort((a, b) => {
    if (a.openError && !b.openError) return 1;
    if (!a.openError && b.openError) return -1;
    if ((a.marker || '') !== (b.marker || '')) return (b.marker || '').localeCompare(a.marker || '');
    return (b.fileMtime || '').localeCompare(a.fileMtime || '');
  });

  const healthy = analyzed.filter((x) => !x.openError && (x.schemaKnown || x.hasRecoverableTables));
  const top = healthy.slice(0, Math.max(1, opts.top));
  const extracts = top.map((x) => extractRowsForCandidate(x.path, opts));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOutDir = path.join(persistentRoot, 'forensics');
  const outputPath = opts.outPath
    ? (path.isAbsolute(opts.outPath) ? opts.outPath : path.resolve(process.cwd(), opts.outPath))
    : path.join(defaultOutDir, `forensic-${stamp}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    params: {
      since: opts.since || null,
      cutoff: opts.cutoff || null,
      top: opts.top,
      limitPerTable: opts.limitPerTable,
      rootDir: persistentRoot,
      primaryDbPath,
      backupDir
    },
    candidateCount: analyzed.length,
    candidates: analyzed,
    topCandidates: top.map((x) => ({ path: x.path, marker: x.marker, fileMtime: x.fileMtime })),
    extracts
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  // Console summary for quick triage in Render logs/shell.
  console.log(`[forensic] wrote report: ${outputPath}`);
  console.log(`[forensic] candidates scanned: ${analyzed.length}`);
  if (!top.length) {
    console.log('[forensic] no healthy schema-known candidate found.');
  } else {
    for (const c of top) {
      console.log(`[forensic] top candidate: ${c.path} marker=${c.marker || 'unknown'}`);
    }
  }
}

main();
