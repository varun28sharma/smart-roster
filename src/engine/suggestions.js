// Fix suggestions for an issue. Every suggestion is a list of roster actions
// (PIN / ADD_COVER / REMOVE_COVER). Each one is simulated and re-validated, so
// the manager sees "fixes 1 error, adds 0" before clicking Apply.

import { dayLabel } from './dates.js';
import { serviceLabel } from './model.js';
import { RosterState, applyActions } from './rosterState.js';
import { validateRoster } from './validator.js';

export function suggestFixes(data, roster, issue, baseline) {
  const st = new RosterState(data, roster);
  const { idx } = st;
  const name = (id) => idx.empById.get(id)?.name ?? id;
  const svc = (sid) => serviceLabel(idx.serviceById.get(sid), idx);
  const out = [];

  const gapFixes = (sid, d) => {
    const fixes = [];
    for (const eid of idx.primaryByService.get(sid) || []) {
      const s = st.status(eid, d);
      if (s === 'OFF' && !st.isPinned(eid, d)) {
        // Move the weekly off to another day of the same week that stays covered.
        const trial = applyActions(roster, [{ type: 'PIN', employeeId: eid, date: d, status: 'WORK' }]);
        const tst = new RosterState(data, trial, idx);
        const weekDays = sameWeek(st.days, d);
        for (const d2 of weekDays) {
          if (d2 === d || tst.status(eid, d2) !== 'WORK' || tst.coversBy(eid, d2).length) continue;
          if (tst.deficitsIfRemoved(eid, d2).length) continue;
          fixes.push({
            label: `Move ${name(eid)}'s weekly off from ${dayLabel(d)} to ${dayLabel(d2)}`,
            detail: `${dayLabel(d2)} stays fully covered without them.`,
            actions: [
              { type: 'PIN', employeeId: eid, date: d, status: 'WORK' },
              { type: 'PIN', employeeId: eid, date: d2, status: 'OFF' },
            ],
          });
          if (fixes.length >= 2) break;
        }
      }
      if (s === 'HOL') {
        fixes.push({
          label: `Ask ${name(eid)} to work ${idx.holidays.get(d)?.name ?? 'the holiday'} (earns a comp-off)`,
          detail: 'Holiday work is voluntary; confirm with the employee.',
          actions: [{ type: 'PIN', employeeId: eid, date: d, status: 'WORK' }],
        });
      }
    }
    for (const c of st.coverCandidates(sid, d).slice(0, 4)) {
      fixes.push({
        label: `${c.employee.name} covers ${svc(sid)} on ${dayLabel(d)}`,
        detail: c.reasons.join(' · '),
        actions: [{ type: 'ADD_COVER', employeeId: c.employee.id, serviceId: sid, date: d }],
      });
    }
    return fixes;
  };

  switch (issue.type) {
    case 'GAP':
      out.push(...gapFixes(issue.serviceId, issue.date));
      break;
    case 'MULTI_BRAND': {
      // Combined fix: best cover for each affected process.
      const actions = [];
      const parts = [];
      const extraLoad = new Map();
      for (const sid of issue.serviceIds) {
        const c = st.coverCandidates(sid, issue.date, { extraLoad })[0];
        if (!c) continue;
        extraLoad.set(c.employee.id, (extraLoad.get(c.employee.id) || 0) + 1);
        actions.push({ type: 'ADD_COVER', employeeId: c.employee.id, serviceId: sid, date: issue.date });
        parts.push(`${c.employee.name} → ${svc(sid)}`);
      }
      if (actions.length) out.push({ label: `Cover all affected processes (${actions.length})`, detail: parts.join(' · '), actions });
      for (const sid of issue.serviceIds) out.push(...gapFixes(sid, issue.date).slice(0, 2));
      break;
    }
    case 'NO_WEEKLY_OFF': {
      const options = [];
      for (const d of issue.weekDays || []) {
        if (st.status(issue.employeeId, d) !== 'WORK' || st.coversBy(issue.employeeId, d).length) continue;
        const deficits = st.deficitsIfRemoved(issue.employeeId, d);
        const plan = deficits.length ? st.planCovers(deficits, d, issue.employeeId) : [];
        if (!plan) continue;
        options.push({
          label: `Give ${name(issue.employeeId)} ${dayLabel(d)} off` + (plan.length ? ` with ${plan.length} cover(s)` : ''),
          detail: plan.length ? plan.map((p) => `${name(p.employeeId)} → ${svc(p.serviceId)}`).join(' · ') : 'No cover needed.',
          actions: [{ type: 'PIN', employeeId: issue.employeeId, date: d, status: 'OFF' }, ...plan.map((p) => ({ type: 'ADD_COVER', ...p }))],
          n: plan.length,
        });
      }
      out.push(...options.sort((a, b) => a.n - b.n).slice(0, 4));
      break;
    }
    case 'COVER_INVALID':
    case 'COVER_SKILL':
      if (issue.coverId) {
        const without = applyActions(roster, [{ type: 'REMOVE_COVER', id: issue.coverId }]);
        const st2 = new RosterState(data, without, idx);
        const repl = st2.coverCandidates(issue.serviceId, issue.date, { exclude: [issue.employeeId] })[0];
        if (repl) {
          out.push({
            label: `Replace with ${repl.employee.name}`,
            detail: repl.reasons.join(' · '),
            actions: [
              { type: 'REMOVE_COVER', id: issue.coverId },
              { type: 'ADD_COVER', employeeId: repl.employee.id, serviceId: issue.serviceId, date: issue.date },
            ],
          });
        }
        out.push({ label: 'Remove this cover', detail: 'May re-open a coverage gap.', actions: [{ type: 'REMOVE_COVER', id: issue.coverId }] });
      }
      break;
    case 'OVERLOAD': {
      const mine = (roster.covers || []).filter((c) => c.employeeId === issue.employeeId && c.date === issue.date);
      const last = mine[mine.length - 1];
      if (last) {
        const without = applyActions(roster, [{ type: 'REMOVE_COVER', id: last.id }]);
        const repl = new RosterState(data, without, idx).coverCandidates(last.serviceId, last.date, { exclude: [issue.employeeId] })[0];
        if (repl) {
          out.push({
            label: `Hand ${svc(last.serviceId)} to ${repl.employee.name}`,
            detail: repl.reasons.join(' · '),
            actions: [{ type: 'REMOVE_COVER', id: last.id }, { type: 'ADD_COVER', employeeId: repl.employee.id, serviceId: last.serviceId, date: last.date }],
          });
        }
      }
      break;
    }
    default:
      break;
  }

  // Simulate every suggestion and attach its impact.
  const before = baseline || validateRoster(data, roster).summary;
  return out.map((s, i) => {
    const after = validateRoster(data, applyActions(roster, s.actions)).summary;
    return {
      ...s,
      id: `${issue.id}#${i}`,
      impact: {
        errors: after.errors - before.errors,
        warnings: after.warnings - before.warnings,
        coveragePct: after.coveragePct,
      },
    };
  });
}

function sameWeek(days, d) {
  const i = days.indexOf(d);
  const out = [];
  // walk back to Monday and forward to Sunday within the month
  let start = i;
  while (start > 0 && new Date(days[start] + 'T00:00:00Z').getUTCDay() !== 1) start--;
  for (let j = start; j < days.length; j++) {
    if (j > start && new Date(days[j] + 'T00:00:00Z').getUTCDay() === 1) break;
    out.push(days[j]);
  }
  return out;
}
