const DAY_MS = 86400000;

function weekDates(now) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const nextMonday = today + (7 - (kst.getUTCDay() + 6) % 7) * DAY_MS;
  return {
    today: new Date(today).toISOString().slice(0, 10),
    nextMonday: new Date(nextMonday).toISOString().slice(0, 10)
  };
}

export function relativeWeekLabel(week, now = new Date()) {
  const start = String(week?.start_date || '').slice(0, 10);
  const end = String(week?.end_date || '').slice(0, 10);
  if (!start || !end) return '';
  const { today, nextMonday } = weekDates(now);
  if (start <= today && today <= end) return '이번 주';
  if (start <= nextMonday && nextMonday <= end) return '다음 주';
  return '';
}

export function recentWeekOptions(weeks, now = new Date()) {
  const rank = week => ({ '이번 주': 0, '다음 주': 1 }[relativeWeekLabel(week, now)] ?? 2);
  return [...(weeks || [])].sort((a, b) => (
    rank(a) - rank(b)
    || String(b.start_date || '').localeCompare(String(a.start_date || ''))
    || Number(b.id || 0) - Number(a.id || 0)
  )).slice(0, 10);
}

export function weekOptionLabel(week, label, now = new Date()) {
  const relative = relativeWeekLabel(week, now);
  return relative ? `[${relative}] ${label}` : label;
}

export function preferredWeekId(weeks, requestedId, now = new Date()) {
  const options = recentWeekOptions(weeks, now);
  return String(options.find(week => String(week.id) === String(requestedId))?.id || options[0]?.id || '');
}
