// Domain model helpers: indexes over the raw data and the rules that decide
// when a brand process operates and how many people it needs.
//
// Entities (see README "Data model"):
//   pods        { id, name, leadId }
//   employees   { id, name, podId, isLead, shiftId, skills[processId], weeklyOffPref[dow],
//                 offsPerWeek, maxCoversPerDay, compOffBalance, active }
//   processes   { id, code, name }
//   brands      { id, name, podId }
//   services    { id, brandId, processId, shiftId, minStaff, calendar{preset, days[dow], holidaysOff},
//                 dowOverrides{dow: n}, dateOverrides{date: n}, active }   ("brand process")
//   assignments { id, employeeId, serviceId, kind: 'primary' | 'backup' }
//   holidays    { id, date, name }
//   leaves      { id, employeeId, start, end, type: 'LEAVE'|'COMP'|'UNAV', status: 'approved'|'pending', note }
//   shifts      { id, name, start, end }
//   settings    { companyCalendar{days, holidaysOff}, offsPerWeek, maxCoversPerDay,
//                 maxConsecutiveWorkDays, autoCover }

import { dow, rangeDates } from './dates.js';

export const STATUS_META = {
  WORK: { code: 'W', label: 'Working' },
  OFF: { code: 'O', label: 'Weekly off' },
  HOL: { code: 'H', label: 'Public holiday' },
  LEAVE: { code: 'L', label: 'Leave' },
  COMP: { code: 'C', label: 'Comp-off' },
  UNAV: { code: 'U', label: 'Unavailable' },
};

export const ABSENCE_TYPES = ['LEAVE', 'COMP', 'UNAV'];

export const CALENDAR_PRESETS = {
  ALL_DAYS: { label: '365 days (incl. Sundays & holidays)', days: [0, 1, 2, 3, 4, 5, 6], holidaysOff: false },
  DAILY_NO_PH: { label: 'Every day, public holidays off', days: [0, 1, 2, 3, 4, 5, 6], holidaysOff: true },
  MON_SAT_NO_PH: { label: 'Mon–Sat, Sundays & holidays off', days: [1, 2, 3, 4, 5, 6], holidaysOff: true },
  MON_FRI_NO_PH: { label: 'Mon–Fri, weekends & holidays off', days: [1, 2, 3, 4, 5], holidaysOff: true },
};

export const DEFAULT_SETTINGS = {
  companyCalendar: { days: [1, 2, 3, 4, 5, 6], holidaysOff: true },
  offsPerWeek: 1,
  maxCoversPerDay: 1,
  maxConsecutiveWorkDays: 6,
  autoCover: true,
};

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

export function buildIndex(data) {
  const byId = (arr = []) => new Map(arr.map((x) => [x.id, x]));
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const empById = byId(data.employees);
  const serviceById = byId(data.services);
  const activeEmployees = (data.employees || []).filter((e) => e.active !== false);
  const activeServices = (data.services || []).filter((s) => s.active !== false && byId(data.brands).has(s.brandId));

  const primaryByEmp = new Map();
  const primaryByService = new Map();
  const backupsByService = new Map();
  for (const a of data.assignments || []) {
    const s = serviceById.get(a.serviceId);
    const e = empById.get(a.employeeId);
    if (!s || !e || s.active === false || e.active === false) continue;
    if (a.kind === 'backup') push(backupsByService, a.serviceId, a.employeeId);
    else {
      push(primaryByEmp, a.employeeId, a.serviceId);
      push(primaryByService, a.serviceId, a.employeeId);
    }
  }

  const holidays = new Map((data.holidays || []).map((h) => [h.date, h]));

  // Only approved absences affect the roster; pending ones are "what-if" requests.
  const absence = new Map();
  for (const l of data.leaves || []) {
    if (l.status !== 'approved') continue;
    for (const d of rangeDates(l.start, l.end)) absence.set(`${l.employeeId}|${d}`, l);
  }

  return {
    settings,
    empById,
    serviceById,
    brandById: byId(data.brands),
    processById: byId(data.processes),
    podById: byId(data.pods),
    shiftById: byId(data.shifts),
    activeEmployees,
    activeServices,
    primaryByEmp,
    primaryByService,
    backupsByService,
    holidays,
    absence,
  };
}

export function operates(service, date, idx) {
  if (!service || service.active === false) return false;
  const cal = service.calendar || CALENDAR_PRESETS.MON_SAT_NO_PH;
  if (cal.holidaysOff && idx.holidays.has(date)) return false;
  return (cal.days || []).includes(dow(date));
}

export function requiredStaff(service, date, idx) {
  if (!operates(service, date, idx)) return 0;
  const byDate = service.dateOverrides?.[date];
  if (byDate !== undefined && byDate !== null && byDate !== '') return Number(byDate);
  const byDow = service.dowOverrides?.[dow(date)];
  if (byDow !== undefined && byDow !== null && byDow !== '') return Number(byDow);
  return Number(service.minStaff ?? 1);
}

export function companyWorks(date, idx) {
  const cal = idx.settings.companyCalendar;
  if (cal.holidaysOff && idx.holidays.has(date)) return false;
  return cal.days.includes(dow(date));
}

export function serviceLabel(service, idx) {
  if (!service) return 'Unknown process';
  const b = idx.brandById.get(service.brandId);
  const p = idx.processById.get(service.processId);
  return `${b?.name ?? '?'} · ${p?.code ?? '?'}`;
}

export function empName(id, idx) {
  return idx.empById.get(id)?.name ?? 'Unknown';
}

export function shiftOf(entity) {
  return entity?.shiftId || 'GEN';
}
