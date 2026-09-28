export const subjectText = (value) => value == null ? '' : String(value);

// Refresh clean fields, but retain unsaved edits and their original comparison base.
export function reconcileSubjectDrafts(records, drafts, baselines, keys) {
  const nextDrafts = {};
  const nextBaselines = {};
  for (const record of records) {
    const id = String(record.id);
    nextDrafts[id] = {};
    nextBaselines[id] = { ...record };
    for (const key of keys) {
      const dirty = drafts[id] && baselines[id]
        && subjectText(drafts[id][key]) !== subjectText(baselines[id][key]);
      nextDrafts[id][key] = dirty ? drafts[id][key] : record[key] ?? '';
      if (dirty) nextBaselines[id][key] = baselines[id][key];
    }
  }
  return { drafts: nextDrafts, baselines: nextBaselines };
}

// Capture each edit, serialize per record, and compare with the last acknowledged save.
export function createSubjectSaveQueue() {
  const pending = new Map();
  return (id, save) => {
    const previous = pending.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(save);
    pending.set(id, next);
    const cleanup = () => { if (pending.get(id) === next) pending.delete(id); };
    next.then(cleanup, cleanup);
    return next;
  };
}
