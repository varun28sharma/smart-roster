// Monthly roster generator: deterministic, greedy, constraint-first.
//
// Order of decisions (most constrained first):
//   0. Fixed facts: approved leave / comp-off / unavailability, manual pins,
//      days when none of an employee's processes operate (=> rest day).
//   1. Public holidays: give the holiday off to everyone whose processes stay
//      covered without them; the rest work it and earn a comp-off.
//   2. Weekly offs, week by week. Employees with the fewest feasible off-days
//      are placed first. A day is "feasible" if removing the person keeps every
//      process they run at or above its minimum. Among feasible days we score:
//      preferred day, spare capacity, spread within the pod, weekend fairness.
//      If no day is feasible (e.g. a single-resource 365-day brand) we pick the
//      day needing the fewest covers and assign covers (backup > same brand >
//      same pod > lead). If even that fails the off is NOT silently dropped:
//      it is logged and the validator raises a NO_WEEKLY_OFF error.
//   3. Gap filling: any remaining service-day below minimum (usually caused by
//      leave) gets auto-covers when a qualified person is free.
// Coverage is never traded away for a preference; preferences only rank options.

import { dow, dayLabel, monthWeeks } from './dates.js';
import { serviceLabel } from './model.js';
import { RosterState } from './rosterState.js';

export function offsRequired(emp, week, idx) {
  const perWeek = emp.offsPerWeek ?? idx.settings.offsPerWeek;
  return Math.round((perWeek * week.days.length) / 7);
}

/** Remaining weekly offs an employee still needs in a week. */
export function offsNeeded(st, emp, week) {
  const required = offsRequired(emp, week, st.idx);
  let offs = 0;
  let work = 0;
  for (const d of week.days) {
    const s = st.status(emp.id, d);
    if (s === 'OFF') offs++;
    else if (s === 'WORK') work++;
  }
  return Math.max(0, Math.min(required - offs, work));
}

export function generateRoster(data, month, prev) {
  const keepPins = {};
  for (const [k, v] of Object.entries(prev?.pins || {})) if (k.split('|')[1]?.startsWith(month)) keepPins[k] = v;
  const roster = {
    month,
    cells: {},
    pins: keepPins,
    covers: (prev?.covers || []).filter((c) => c.source === 'manual' && c.date.startsWith(month)),
    log: [],
    generatedAt: new Date().toISOString(),
    version: (prev?.version || 0) + 1,
    published: prev?.published || null,
  };
  const st = new RosterState(data, roster);
  const { idx, days } = st;
  const emps = [...idx.activeEmployees].sort((a, b) => a.id.localeCompare(b.id));
  const log = (msg, extra = {}) => roster.log.push({ msg, level: 'info', ...extra });

  // 1. Public holidays
  for (const d of days.filter((x) => idx.holidays.has(x))) {
    const h = idx.holidays.get(d);
    for (const e of emps) {
      if (st.status(e.id, d) !== 'WORK' || st.isPinned(e.id, d)) continue;
      if (st.deficitsIfRemoved(e.id, d).length === 0) {
        st.setCell(e.id, d, 'HOL');
      } else {
        log(`${e.name} works ${h.name} (${dayLabel(d)}) because their process needs holiday coverage; earns a comp-off.`, {
          kind: 'holiday',
          employeeId: e.id,
          date: d,
        });
      }
    }
  }

  // 2. Weekly offs
  const weekendOffs = new Map(emps.map((e) => [e.id, 0]));
  const podOffs = new Map(); // `${podId}|${date}` -> count of assigned offs
  const isCandidate = (e, d) => st.status(e.id, d) === 'WORK' && !st.isPinned(e.id, d) && st.coversBy(e.id, d).length === 0;

  for (const week of monthWeeks(month)) {
    const plans = emps
      .map((e) => ({ e, need: offsNeeded(st, e, week) }))
      .filter((p) => p.need > 0);
    for (const p of plans) {
      p.flex = week.days.filter((d) => isCandidate(p.e, d) && st.deficitsIfRemoved(p.e.id, d).length === 0).length;
    }
    plans.sort((a, b) => a.flex - b.flex || b.need - a.need || a.e.id.localeCompare(b.e.id));

    for (const { e, need } of plans) {
      for (let k = 0; k < need; k++) {
        const options = week.days
          .filter((d) => isCandidate(e, d))
          .map((d) => {
            const deficits = st.deficitsIfRemoved(e.id, d);
            const coverPlan = deficits.length && idx.settings.autoCover ? st.planCovers(deficits, d, e.id) : null;
            return { d, deficits, coverPlan, score: scoreOffDay(st, e, d, weekendOffs, podOffs) };
          });
        const feasible = options.filter((o) => o.deficits.length === 0).sort((a, b) => b.score - a.score);
        let pick = feasible[0];
        if (!pick) {
          // Each extra cover costs 15 points: fewer covers preferred, but not at
          // the price of a >max working streak.
          const cost = (o) => o.score - 15 * o.coverPlan.length;
          pick = options.filter((o) => o.coverPlan).sort((a, b) => cost(b) - cost(a))[0];
        }
        if (!pick) {
          log(
            `Could not give ${e.name} a weekly off in the week of ${dayLabel(week.days[0])}: every working day is needed and no qualified backup is free.`,
            { level: 'warn', kind: 'warn', employeeId: e.id, date: week.days[0] },
          );
          break;
        }
        st.setCell(e.id, pick.d, 'OFF');
        const k2 = `${e.podId}|${pick.d}`;
        podOffs.set(k2, (podOffs.get(k2) || 0) + 1);
        if ([0, 6].includes(dow(pick.d))) weekendOffs.set(e.id, weekendOffs.get(e.id) + 1);
        for (const c of pick.coverPlan || []) {
          st.addCover({ ...c, source: 'auto', reason: `weekly off of ${e.name}` });
          log(
            `${idx.empById.get(c.employeeId).name} covers ${serviceLabel(idx.serviceById.get(c.serviceId), idx)} on ${dayLabel(pick.d)} (weekly off of ${e.name}).`,
            { kind: 'offCover', employeeId: c.employeeId, date: pick.d },
          );
        }
      }
    }
  }

  // 3. Gap filling for remaining shortfalls (leave, overrides, holidays)
  if (idx.settings.autoCover) {
    for (const d of days) {
      for (const s of idx.activeServices) {
        let short = st.required(s.id, d) - st.count(s.id, d);
        while (short > 0) {
          const c = st.coverCandidates(s.id, d)[0];
          if (!c) {
            log(`No one available to cover ${serviceLabel(s, idx)} on ${dayLabel(d)}.`, { level: 'warn', kind: 'warn', date: d, serviceId: s.id });
            break;
          }
          st.addCover({ employeeId: c.employee.id, serviceId: s.id, date: d, source: 'auto', reason: 'coverage gap' });
          log(`${c.employee.name} covers ${serviceLabel(s, idx)} on ${dayLabel(d)} (gap: ${c.reasons[0]}).`, {
            kind: 'gapCover',
            employeeId: c.employee.id,
            date: d,
          });
          short--;
        }
      }
    }
  }

  return roster;
}

function scoreOffDay(st, e, d, weekendOffs, podOffs) {
  let score = 0;
  const wd = dow(d);
  if ((e.weeklyOffPref || []).includes(wd)) score += 20;

  // Spare capacity: prefer days where the person's processes have the most slack.
  let minSlack = 3;
  for (const sid of st.idx.primaryByEmp.get(e.id) || []) {
    const req = st.required(sid, d);
    if (!req) continue;
    minSlack = Math.min(minSlack, st.count(sid, d) - 1 - req);
  }
  score += Math.max(-3, minSlack) * 2;

  // Spread rest days across the pod so leads aren't short-staffed on one day.
  score -= 3 * (podOffs.get(`${e.podId}|${d}`) || 0);

  // Weekend fairness: weekends are popular; rotate them.
  if (wd === 0 || wd === 6) score += 4 - 3 * (weekendOffs.get(e.id) || 0);

  // Rest spacing: never let the run of working days before this off exceed the
  // limit, and mildly prefer a regular ~6-day rhythm.
  const max = st.idx.settings.maxConsecutiveWorkDays;
  const run = workRunBefore(st, e.id, d);
  if (run > max) score -= 40;
  score -= Math.abs(run - (max - 1)) * 0.5;

  return score;
}

/** Consecutive WORK days immediately before `date` (within the month). */
function workRunBefore(st, empId, date) {
  let i = st.days.indexOf(date) - 1;
  let n = 0;
  while (i >= 0 && st.status(empId, st.days[i]) === 'WORK') { n++; i--; }
  return n;
}
