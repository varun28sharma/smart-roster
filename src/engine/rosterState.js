// RosterState wraps (data + roster) and answers the questions both the
// generator and the validator ask: "what is X doing on day D?", "who covers
// process P on day D?", "what breaks if X is taken off day D?".
//
// A roster stores only *decisions*, never derived facts:
//   cells[empId][date] = 'OFF' | 'HOL'   generator-assigned rest days
//   pins['emp|date']   = status          manual overrides (survive regeneration)
//   covers[]           = { id, employeeId, serviceId, date, source: 'auto'|'manual', reason }
// Leaves, holidays and brand calendars are read live from data, so a change in
// data shows up in validation immediately without regenerating.

import { monthDays } from './dates.js';
import { buildIndex, operates, requiredStaff, companyWorks, shiftOf } from './model.js';

export function emptyRoster(month) {
  return { month, cells: {}, pins: {}, covers: [], log: [], generatedAt: null, version: 0, published: null };
}

let coverSeq = 0;
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(coverSeq++).toString(36)}`;

export class RosterState {
  constructor(data, roster, idx) {
    this.data = data;
    this.roster = roster;
    this.idx = idx || buildIndex(data);
    this.days = monthDays(roster.month);
    this.daySet = new Set(this.days);
    this.reindexCovers();
  }

  reindexCovers() {
    this.coversBySvcDay = new Map();
    this.coversByEmpDay = new Map();
    this.coversByEmp = new Map();
    for (const c of this.roster.covers || []) this.#indexCover(c);
  }

  #indexCover(c) {
    const add = (m, k) => (m.get(k) || m.set(k, []).get(k)).push(c);
    add(this.coversBySvcDay, `${c.serviceId}|${c.date}`);
    add(this.coversByEmpDay, `${c.employeeId}|${c.date}`);
    add(this.coversByEmp, c.employeeId);
  }

  baseStatus(empId, date) {
    const svcs = this.idx.primaryByEmp.get(empId) || [];
    const works = svcs.length
      ? svcs.some((s) => operates(this.idx.serviceById.get(s), date, this.idx))
      : companyWorks(date, this.idx);
    if (works) return 'WORK';
    return this.idx.holidays.has(date) ? 'HOL' : 'OFF';
  }

  status(empId, date) {
    const a = this.idx.absence.get(`${empId}|${date}`);
    if (a) return a.type;
    const pin = this.roster.pins?.[`${empId}|${date}`];
    if (pin) return pin;
    const c = this.roster.cells?.[empId]?.[date];
    if (c) return c;
    return this.baseStatus(empId, date);
  }

  isPinned(empId, date) {
    return Boolean(this.roster.pins?.[`${empId}|${date}`]);
  }

  setCell(empId, date, status) {
    const cells = this.roster.cells;
    (cells[empId] ||= {})[date] = status;
  }

  addCover(c) {
    const cover = { id: newId('C'), ...c };
    this.roster.covers.push(cover);
    this.#indexCover(cover);
    return cover;
  }

  coversFor(serviceId, date) {
    return this.coversBySvcDay.get(`${serviceId}|${date}`) || [];
  }

  coversBy(empId, date) {
    return this.coversByEmpDay.get(`${empId}|${date}`) || [];
  }

  coverCountMonth(empId) {
    return (this.coversByEmp.get(empId) || []).length;
  }

  required(serviceId, date) {
    return requiredStaff(this.idx.serviceById.get(serviceId), date, this.idx);
  }

  /** Who is actually delivering a service on a day. */
  working(serviceId, date) {
    const primary = (this.idx.primaryByService.get(serviceId) || []).filter((e) => this.status(e, date) === 'WORK');
    const covers = this.coversFor(serviceId, date)
      .filter((c) => this.status(c.employeeId, date) === 'WORK')
      .map((c) => c.employeeId);
    return { primary, covers, count: primary.length + covers.length };
  }

  count(serviceId, date) {
    return this.working(serviceId, date).count;
  }

  /** Services (own + covers) that would drop below minimum if empId stopped working on date. */
  deficitsIfRemoved(empId, date) {
    if (this.status(empId, date) !== 'WORK') return [];
    const out = [];
    const ids = new Set([
      ...(this.idx.primaryByEmp.get(empId) || []),
      ...this.coversBy(empId, date).map((c) => c.serviceId),
    ]);
    for (const sid of ids) {
      const req = this.required(sid, date);
      if (!req) continue;
      const after = this.count(sid, date) - 1;
      if (after < req) out.push({ serviceId: sid, short: req - after });
    }
    return out;
  }

  /**
   * Ranked list of people who could cover `serviceId` on `date`.
   * Hard filters: working that day, has the process skill, same shift, below cover cap.
   * Soft ranking: designated backup > already works on that brand > same pod > lead,
   * minus own workload that day and covers already done this month (fairness).
   */
  coverCandidates(serviceId, date, { exclude = [], extraLoad } = {}) {
    const { idx } = this;
    const svc = idx.serviceById.get(serviceId);
    if (!svc) return [];
    const brand = idx.brandById.get(svc.brandId);
    const primaries = new Set(idx.primaryByService.get(serviceId) || []);
    const backups = new Set(idx.backupsByService.get(serviceId) || []);
    const already = new Set(this.coversFor(serviceId, date).map((c) => c.employeeId));
    const out = [];
    for (const e of idx.activeEmployees) {
      if (exclude.includes(e.id) || primaries.has(e.id) || already.has(e.id)) continue;
      if (this.status(e.id, date) !== 'WORK') continue;
      if (!(e.skills || []).includes(svc.processId)) continue;
      if (shiftOf(e) !== shiftOf(svc)) continue;
      const load = this.coversBy(e.id, date).length + (extraLoad?.get(e.id) || 0);
      const max = e.maxCoversPerDay ?? idx.settings.maxCoversPerDay;
      if (load >= max) continue;

      const own = (idx.primaryByEmp.get(e.id) || []).filter((sid) => this.required(sid, date) > 0);
      const reasons = [];
      let score = 0;
      if (backups.has(e.id)) { score += 40; reasons.push('designated backup'); }
      if (own.some((sid) => idx.serviceById.get(sid)?.brandId === svc.brandId)) {
        score += 30;
        reasons.push(`already works on ${brand?.name}`);
      }
      if (e.podId === brand?.podId) { score += 15; reasons.push('same pod'); }
      if (e.isLead) { score += 5; reasons.push('pod lead'); }
      score -= own.length * 4;
      reasons.push(own.length ? `${own.length} own process${own.length > 1 ? 'es' : ''} that day` : 'no own process that day');
      const monthCovers = this.coverCountMonth(e.id);
      score -= monthCovers * 2;
      if (monthCovers) reasons.push(`${monthCovers} cover${monthCovers > 1 ? 's' : ''} this month`);
      out.push({ employee: e, score, reasons });
    }
    return out.sort((a, b) => b.score - a.score || a.employee.name.localeCompare(b.employee.name));
  }

  /** Pick covers for every deficit, or null if any one cannot be filled. */
  planCovers(deficits, date, excludeEmpId) {
    const chosen = [];
    const extraLoad = new Map();
    for (const def of deficits) {
      const usedHere = new Set();
      for (let i = 0; i < def.short; i++) {
        const c = this.coverCandidates(def.serviceId, date, {
          exclude: [excludeEmpId, ...usedHere],
          extraLoad,
        })[0];
        if (!c) return null;
        usedHere.add(c.employee.id);
        extraLoad.set(c.employee.id, (extraLoad.get(c.employee.id) || 0) + 1);
        chosen.push({ employeeId: c.employee.id, serviceId: def.serviceId, date });
      }
    }
    return chosen;
  }
}

/** Apply manual edit actions immutably. */
export function applyActions(roster, actions) {
  const next = {
    ...roster,
    pins: { ...(roster.pins || {}) },
    covers: [...(roster.covers || [])],
  };
  for (const a of actions) {
    if (a.type === 'PIN') {
      const k = `${a.employeeId}|${a.date}`;
      if (a.status) next.pins[k] = a.status;
      else delete next.pins[k];
    } else if (a.type === 'ADD_COVER') {
      next.covers.push({
        id: newId('C'),
        employeeId: a.employeeId,
        serviceId: a.serviceId,
        date: a.date,
        source: 'manual',
        reason: a.reason || 'manual cover',
      });
    } else if (a.type === 'REMOVE_COVER') {
      next.covers = next.covers.filter((c) => c.id !== a.id);
    }
  }
  return next;
}
