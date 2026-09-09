const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function taskListText(...values) {
  const preferred = values.length > 1 ? values[1] : null;
  if (preferred && typeof preferred === 'object' && preferred.Weekly != null) {
    return String(preferred.Weekly || '');
  }
  const lines = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const entries = value.Weekly != null
      ? [value.Weekly]
      : DAYS.map((day) => value?.[day]);
    for (const entry of entries) {
      for (const line of String(entry || '').split(/\r?\n/)) {
        const text = line.trim();
        if (text && !lines.includes(text)) lines.push(text);
      }
    }
  }
  return lines.join('\n');
}
