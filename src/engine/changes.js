// Change handling: published snapshots, diffs, leave-impact previews, CSV export.

import { dayLabel } from './dates.js';
import { STATUS_META, serviceLabel } from './model.js';
import { RosterState } from './rosterState.js';
import { validateRoster } from './validator.js';

/** Freeze the effective roster (including leaves) at publish time. */
export function snapshot(data, roster) {
  const st = new RosterState(data, roster);
  const statuses = {};
  for (const e of st.idx.activeEmployees) {
    statuses[e.id] = {};
    for (const d of st.days) statuses[e.id][d] = st.status(e.id, d);
  }
  const covers = (roster.covers || []).map((c) => `${c.employeeId}|${c.serviceId}|${c.date}`);
  return { at: new Date().toISOString(), statuses, covers };
}

/** What changed for people since the roster was published. */
export function diffSincePublish(data, roster) {
  const pub = roster.published;
  if (!pub) return [];
  const now = snapshot(data, roster);
  const st = new RosterState(data, roster);
  const { idx } = st;
  const changes = [];
  for (const [eid, days] of Object.entries(now.statuses)) {
    for (const [d, s] of Object.entries(days)) {
      const was = pub.statuses?.[eid]?.[d];
      if (was && was !== s) {
        changes.push({
          employeeId: eid,
          date: d,
          text: `${idx.empById.get(eid)?.name}: ${dayLabel(d)} changed from ${STATUS_META[was]?.label} to ${STATUS_META[s]?.label}`,
        });
      }
    }
  }
  const before = new Set(pub.covers || []);
  const after = new Set(now.covers);
  const coverText = (k) => {
    const [eid, sid, d] = k.split('|');
    return { employeeId: eid, date: d, name: idx.empById.get(eid)?.name, svc: serviceLabel(idx.serviceById.get(sid), idx) };
  };
  for (const k of after) if (!before.has(k)) { const c = coverText(k); changes.push({ ...c, text: `${c.name} now covers ${c.svc} on ${dayLabel(c.date)}` }); }
  for (const k of before) if (!after.has(k)) { const c = coverText(k); changes.push({ ...c, text: `${c.name} no longer covers ${c.svc} on ${dayLabel(c.date)}` }); }
  return changes.sort((a, b) => a.date.localeCompare(b.date));
}

/** Preview what approving a pending leave would break. */
export function leaveImpact(data, roster, leave) {
  const before = validateRoster(data, roster);
  const approved = { ...data, leaves: data.leaves.map((l) => (l.id === leave.id ? { ...l, status: 'approved' } : l)) };
  const after = validateRoster(approved, roster);
  const known = new Set(before.issues.map((i) => i.id));
  const newIssues = after.issues.filter((i) => !known.has(i.id) && i.severity !== 'info');
  return { newIssues, before: before.summary, after: after.summary };
}

export function rosterToCSV(data, roster) {
  const st = new RosterState(data, roster);
  const { idx, days } = st;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Employee', 'Pod', 'Brands', ...days.map(dayLabel)]];
  for (const e of idx.activeEmployees) {
    const brands = [...new Set((idx.primaryByEmp.get(e.id) || []).map((sid) => idx.brandById.get(idx.serviceById.get(sid).brandId)?.name))];
    rows.push([
      e.name,
      idx.podById.get(e.podId)?.name,
      brands.join(' / ') || (e.isLead ? 'Pod lead' : ''),
      ...days.map((d) => {
        const s = st.status(e.id, d);
        const covers = st.coversBy(e.id, d).map((c) => serviceLabel(idx.serviceById.get(c.serviceId), idx));
        return STATUS_META[s].code + (covers.length && s === 'WORK' ? ` +${covers.join(', ')}` : '');
      }),
    ]);
  }
  rows.push([]);
  rows.push(['Coverage (working / required)', '', '', ...days.map(() => '')]);
  for (const s of idx.activeServices) {
    rows.push([
      serviceLabel(s, idx),
      idx.podById.get(idx.brandById.get(s.brandId)?.podId)?.name,
      '',
      ...days.map((d) => {
        const req = st.required(s.id, d);
        return req ? `${st.count(s.id, d)}/${req}` : '-';
      }),
    ]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
