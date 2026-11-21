// Date helpers. All dates are ISO 'YYYY-MM-DD' strings handled in UTC so that
// day-of-week maths never shifts with the viewer's timezone.

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

export function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmt(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function dow(date) {
  return parse(date).getUTCDay(); // 0 = Sunday
}

export function addDays(date, n) {
  const dt = parse(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
}

/** Monday of the week containing `date`. */
export function weekStart(date) {
  return addDays(date, -((dow(date) + 6) % 7));
}

/** Month split into Monday-started weeks (first/last may be partial). */
export function monthWeeks(month) {
  const weeks = [];
  for (const d of monthDays(month)) {
    const key = weekStart(d);
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== key) weeks.push((w = { key, days: [] }));
    w.days.push(d);
  }
  return weeks;
}

export function rangeDates(start, end) {
  const out = [];
  if (!start) return out;
  const last = end && end >= start ? end : start;
  for (let d = start; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dayLabel(date) {
  const dt = parse(date);
  return `${DOW[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
}

export function monthOf(date) {
  return date.slice(0, 7);
}
