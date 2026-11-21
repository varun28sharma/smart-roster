// Validator: checks ANY roster (generated, hand-edited, or stale after a data
// change) against the current data. It never trusts the generator; the UI
// re-runs it after every edit, which is how manual changes are validated.
//
// Severity model:
//   error   - a mandatory constraint is broken (client coverage, labour rule, impossible assignment)
//   warning - allowed but risky (overload, long streaks, comp-off balance)
//   info    - soft preference not met, or something worth knowing (holiday worked)

import { dayLabel, dow, DOW, monthWeeks } from './dates.js';
import { STATUS_META, serviceLabel, shiftOf } from './model.js';
import { RosterState } from './rosterState.js';
import { offsRequired } from './generator.js';

const SEV_ORDER = { error: 0, warning: 1, info: 2 };

export function validateRoster(data, roster) {
  const st = new RosterState(data, roster);
  const { idx, days } = st;
  const issues = [];
  const add = (i) => {
    const id = [i.type, i.date, i.serviceId, i.employeeId].filter(Boolean).join('|');
    issues.push({ id, ...i });
  };
  const name = (id) => idx.empById.get(id)?.name ?? id;
  const svcName = (sid) => serviceLabel(idx.serviceById.get(sid), idx);

  // ---- Configuration checks -------------------------------------------------
  for (const s of idx.activeServices) {
    if (!(idx.primaryByService.get(s.id) || []).length) {
      add({
        type: 'UNSTAFFED',
        severity: 'error',
        serviceId: s.id,
        title: `${svcName(s.id)} has no assigned employee`,
        detail: 'This process is active but nobody is assigned to it, so it can never be covered.',
        hint: 'Assign at least one employee in Setup → Assignments, or deactivate the process.',
      });
    }
    for (const eid of idx.primaryByService.get(s.id) || []) {
      const e = idx.empById.get(eid);
      if (shiftOf(e) !== shiftOf(s)) {
        add({
          type: 'SHIFT_MISMATCH',
          severity: 'error',
          serviceId: s.id,
          employeeId: eid,
          title: `${e.name} is on ${shiftOf(e)} shift but ${svcName(s.id)} runs ${shiftOf(s)}`,
          detail: 'An employee cannot work two different shifts on the same day.',
          hint: "Change the employee's shift or reassign the process.",
        });
      }
    }
  }

  // ---- Coverage per brand process per day ----------------------------------
  const coverage = {};
  let reqDays = 0;
  let okDays = 0;
  const gapsByAbsentee = new Map(); // `${emp}|${date}` -> [serviceId]

  for (const s of idx.activeServices) {
    const row = (coverage[s.id] = {});
    const assigned = idx.primaryByService.get(s.id) || [];
    for (const d of days) {
      const req = st.required(s.id, d);
      const w = st.working(s.id, d);
      const absent = assigned.filter((e) => st.status(e, d) !== 'WORK').map((e) => ({ employeeId: e, status: st.status(e, d) }));
      row[d] = { required: req, primary: w.primary, covers: w.covers, absent, count: w.count };
      if (!req) continue;
      reqDays++;
      if (w.count >= req) { okDays++; continue; }
      if (!assigned.length) continue; // already reported as UNSTAFFED

      const why = absent.map((a) => `${name(a.employeeId)}: ${STATUS_META[a.status]?.label.toLowerCase() ?? a.status}`).join(', ');
      const sole = assigned.length === 1;
      add({
        type: 'GAP',
        severity: 'error',
        serviceId: s.id,
        date: d,
        title: `${svcName(s.id)} ${w.count === 0 ? 'uncovered' : 'under-staffed'} on ${dayLabel(d)} (${w.count}/${req})`,
        detail:
          `${sole ? 'Single-resource process. ' : ''}Needs ${req}, has ${w.count}.` +
          (why ? ` Unavailable: ${why}.` : '') +
          (req > assigned.length ? ` Requirement (${req}) exceeds the ${assigned.length} people assigned, so a cover is always needed.` : ''),
        hint: 'Open "Suggest fixes" to move a weekly off or assign a qualified cover.',
      });
      for (const a of absent) {
        const k = `${a.employeeId}|${d}`;
        if (!gapsByAbsentee.has(k)) gapsByAbsentee.set(k, []);
        gapsByAbsentee.get(k).push(s.id);
      }
    }
  }

  // One person's absence breaking several brands at once
  for (const [k, sids] of gapsByAbsentee) {
    const [eid, d] = k.split('|');
    const brands = [...new Set(sids.map((sid) => idx.serviceById.get(sid).brandId))];
    if (brands.length < 2) continue;
    add({
      type: 'MULTI_BRAND',
      severity: 'error',
      employeeId: eid,
      date: d,
      serviceIds: sids,
      title: `${name(eid)}'s absence on ${dayLabel(d)} leaves ${brands.length} brands short`,
      detail: `Affected: ${sids.map(svcName).join(', ')}.`,
      hint: 'Fix all at once with "Suggest fixes", or reconsider the leave/off on this day.',
    });
  }

  // ---- Employee-level rules -------------------------------------------------
  const maxStreak = idx.settings.maxConsecutiveWorkDays;
  for (const e of idx.activeEmployees) {
    // Weekly off
    for (const week of monthWeeks(roster.month)) {
      const required = offsRequired(e, week, idx);
      let offs = 0;
      let work = 0;
      const offDows = [];
      for (const d of week.days) {
        const s = st.status(e.id, d);
        if (s === 'OFF') { offs++; offDows.push(dow(d)); }
        else if (s === 'WORK') work++;
      }
      if (offs < required && work > 0) {
        add({
          type: 'NO_WEEKLY_OFF',
          severity: 'error',
          employeeId: e.id,
          date: week.days[0],
          weekDays: week.days,
          title: `${e.name} has no weekly off in the week of ${dayLabel(week.days[0])}`,
          detail: `Needs ${required} rest day(s), has ${offs}. Every day this week was needed for coverage and no qualified cover was free.`,
          hint: 'Suggest fixes lists days where a cover could be arranged.',
        });
      }
      const pref = e.weeklyOffPref || [];
      const prefInWeek = week.days.filter((d) => pref.includes(dow(d)));
      if (pref.length && offs > 0 && prefInWeek.length && !offDows.some((x) => pref.includes(x))) {
        add({
          type: 'PREFERENCE',
          severity: 'info',
          employeeId: e.id,
          date: week.days[0],
          title: `${e.name}'s preferred off (${pref.map((p) => DOW[p]).join('/')}) not given, week of ${dayLabel(week.days[0])}`,
          detail: 'Coverage requirements took priority over the preference.',
        });
      }
    }

    // Consecutive working days
    let streak = 0;
    let streakStart = null;
    for (const d of [...days, null]) {
      if (d && st.status(e.id, d) === 'WORK') {
        if (!streak) streakStart = d;
        streak++;
        continue;
      }
      if (streak > maxStreak) {
        add({
          type: 'LONG_STREAK',
          severity: 'warning',
          employeeId: e.id,
          date: streakStart,
          title: `${e.name} works ${streak} days in a row from ${dayLabel(streakStart)}`,
          detail: `Limit is ${maxStreak} consecutive days (Settings).`,
          hint: 'Move a weekly off into the streak.',
        });
      }
      streak = 0;
    }

    // Holidays worked => comp-off earned; comp-off balance
    let earned = 0;
    let used = 0;
    for (const d of days) {
      const s = st.status(e.id, d);
      if (s === 'COMP') used++;
      if (s === 'WORK' && idx.holidays.has(d)) {
        earned++;
        add({
          type: 'HOLIDAY_WORKED',
          severity: 'info',
          employeeId: e.id,
          date: d,
          title: `${e.name} works ${idx.holidays.get(d).name} (${dayLabel(d)}): comp-off earned`,
          detail: 'Their process operates on public holidays and no colleague could take the day.',
        });
      }
    }
    if (used > (e.compOffBalance || 0) + earned) {
      add({
        type: 'COMP_BALANCE',
        severity: 'warning',
        employeeId: e.id,
        title: `${e.name} uses ${used} comp-off(s) with a balance of ${(e.compOffBalance || 0) + earned}`,
        detail: 'Comp-offs taken exceed opening balance plus holidays worked this month.',
        hint: "Convert to regular leave or update the employee's comp-off balance.",
      });
    }
  }

  // ---- Cover sanity ---------------------------------------------------------
  const coverLoad = new Map();
  for (const c of roster.covers || []) {
    if (!st.daySet.has(c.date)) continue;
    const e = idx.empById.get(c.employeeId);
    const s = idx.serviceById.get(c.serviceId);
    if (!e || !s) continue;
    const base = { employeeId: c.employeeId, serviceId: c.serviceId, date: c.date, coverId: c.id };
    const status = st.status(c.employeeId, c.date);
    if (status !== 'WORK') {
      add({
        ...base,
        type: 'COVER_INVALID',
        severity: 'error',
        title: `${e.name} is assigned to cover ${svcName(s.id)} on ${dayLabel(c.date)} but is ${STATUS_META[status]?.label.toLowerCase()}`,
        detail: 'The cover no longer counts, usually because leave was approved after the roster was generated.',
        hint: 'Remove the cover and pick a replacement.',
      });
    }
    if (shiftOf(e) !== shiftOf(s)) {
      add({ ...base, type: 'COVER_INVALID', severity: 'error', title: `${e.name} (${shiftOf(e)}) cannot cover ${svcName(s.id)} (${shiftOf(s)} shift)`, detail: 'Incompatible shifts on the same day.', hint: 'Remove the cover.' });
    }
    if (!(e.skills || []).includes(s.processId)) {
      add({ ...base, type: 'COVER_SKILL', severity: 'warning', title: `${e.name} covers ${svcName(s.id)} without the ${s.processId} skill`, detail: 'Allowed, but quality risk.' });
    }
    const k = `${c.employeeId}|${c.date}`;
    coverLoad.set(k, (coverLoad.get(k) || 0) + 1);
  }
  for (const [k, n] of coverLoad) {
    const [eid, d] = k.split('|');
    const e = idx.empById.get(eid);
    const max = e.maxCoversPerDay ?? idx.settings.maxCoversPerDay;
    if (n > max) {
      add({ type: 'OVERLOAD', severity: 'warning', employeeId: eid, date: d, title: `${e.name} covers ${n} extra processes on ${dayLabel(d)} (limit ${max})`, detail: 'On top of their own processes.', hint: 'Move one cover to someone else.' });
    }
  }

  issues.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.date || '').localeCompare(b.date || ''));
  const count = (sev) => issues.filter((i) => i.severity === sev).length;
  return {
    issues,
    coverage,
    st,
    summary: {
      errors: count('error'),
      warnings: count('warning'),
      infos: count('info'),
      reqDays,
      okDays,
      coveragePct: reqDays ? Math.round((okDays / reqDays) * 1000) / 10 : 100,
      covers: (roster.covers || []).length,
    },
  };
}
