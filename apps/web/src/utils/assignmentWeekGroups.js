const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() : null;
}

function scheduledDay(item, week, fallback) {
  const month = Number(item?.session_month);
  const day = Number(item?.session_day);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = dateOnly(week?.start_date) ?? dateOnly(week?.end_date) ?? fallback;
  const end = Math.max(start, dateOnly(week?.end_date) ?? start);
  const year = new Date(start).getUTCFullYear();
  // Month/day values have no year; choose the valid date nearest the selected round.
  const candidates = [year, year - 1, year + 1]
    .map(candidateYear => dateOnly(`${candidateYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`))
    .filter(value => value !== null);
  const distance = value => value < start ? start - value : value > end ? value - end : 0;
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates[0] ?? null;
}

function rangeLabel(start) {
  const label = value => {
    const date = new Date(value);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  };
  return `${label(start)} ~ ${label(start + 6 * DAY_MS)}`;
}

export function groupAssignmentsByWeek(items, week, now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const monday = today - ((kst.getUTCDay() + 6) % 7) * DAY_MS;
  const nextMonday = monday + 7 * DAY_MS;
  const groups = [
    { key: 'current', label: '이번 주', range: rangeLabel(monday), tone: 'border-blue-200 bg-blue-50 text-blue-700', items: [] },
    { key: 'next', label: '다음 주', range: rangeLabel(nextMonday), tone: 'border-violet-200 bg-violet-50 text-violet-700', items: [] },
    { key: 'previous', label: '지난 일정', items: [] },
    { key: 'later', label: '다음 주 이후', items: [] },
    { key: 'unscheduled', label: '날짜 미정', items: [] }
  ];
  for (const item of items) {
    const date = scheduledDay(item, week, today);
    const index = date === null ? 4 : date < monday ? 2 : date < nextMonday ? 0 : date < nextMonday + 7 * DAY_MS ? 1 : 3;
    groups[index].items.push(item);
  }
  return groups.filter(group => group.items.length);
}
