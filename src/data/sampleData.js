// Fictional sample dataset: 32 employees, 4 pods, 24 brands, 4 processes.
//
// Staffing pattern (matches the brief):
//   - 20 of 24 brands (83%) have one dedicated employee doing every process.
//     Two of those employees each run two small brands.
//   - 4 brands have 2-3 employees:
//       Oatbloom  - 3 people, one per process (CS / ACC / NDR)
//       Brewnest  - 3 people, two SHARE CS (weekend minimum 2), one does ACC+NDR+RET
//       Loomkart  - 2 people, separate processes
//       Glowroot  - 2 people sharing both CS and ACC
//   - Pod leads have no brand of their own; they supervise and act as backups.
//   - Calendars mix 365-day, every-day-except-holidays, Mon-Sat and Mon-Fri.
//   - Two employees work a LATE shift, so the GEN-shift lead cannot cover them.

import { CALENDAR_PRESETS, DEFAULT_SETTINGS } from '../engine/model.js';

const cal = (preset) => ({ preset, ...structuredClone(CALENDAR_PRESETS[preset]) });

const processes = [
  { id: 'CS', code: 'CS', name: 'Customer Support' },
  { id: 'ACC', code: 'ACC', name: 'Abandoned Cart Conversion' },
  { id: 'NDR', code: 'NDR', name: 'Non-Delivery Report management' },
  { id: 'RET', code: 'RET', name: 'Retention' },
];

const shifts = [
  { id: 'GEN', name: 'General', start: '10:00', end: '19:00' },
  { id: 'LATE', name: 'Late', start: '14:00', end: '23:00' },
];

const pods = [
  { id: 'P1', name: 'Pod Aurora', leadId: 'E01' },
  { id: 'P2', name: 'Pod Banyan', leadId: 'E09' },
  { id: 'P3', name: 'Pod Cedar', leadId: 'E17' },
  { id: 'P4', name: 'Pod Delta', leadId: 'E25' },
];

const ALL = ['CS', 'ACC', 'NDR', 'RET'];

// [id, name, podId, skills, weeklyOffPref, extra]
const people = [
  ['E01', 'Ananya Iyer', 'P1', ALL, [0], { isLead: true, maxCoversPerDay: 2 }],
  ['E02', 'Aarav Mehta', 'P1', ['CS'], [3]],
  ['E03', 'Isha Kapoor', 'P1', ['CS', 'ACC'], [6]],
  ['E04', 'Kabir Nair', 'P1', ['NDR', 'CS'], [0]],
  ['E05', 'Diya Sharma', 'P1', ['CS', 'ACC'], [0]],
  ['E06', 'Arjun Rao', 'P1', ['CS', 'RET'], [0]],
  ['E07', 'Pooja Menon', 'P1', ['CS', 'NDR'], [0]],
  ['E08', 'Vikram Joshi', 'P1', ['CS', 'ACC'], [0]],
  ['E32', 'Omkar Patil', 'P1', ['CS', 'ACC'], [0]],

  ['E09', 'Rohit Verma', 'P2', ALL, [0], { isLead: true, maxCoversPerDay: 2 }],
  ['E10', 'Sneha Pillai', 'P2', ['CS'], [2]],
  ['E11', 'Karan Malhotra', 'P2', ['CS', 'ACC'], [4]],
  ['E12', 'Tanvi Desai', 'P2', ['CS', 'ACC', 'NDR', 'RET'], [0]],
  ['E13', 'Rhea Banerjee', 'P2', ['CS', 'ACC'], [0]],
  ['E14', 'Nikhil Gupta', 'P2', ['CS', 'ACC'], [1]],
  ['E15', 'Aditi Kulkarni', 'P2', ['CS', 'NDR'], [0]],
  ['E16', 'Manav Sethi', 'P2', ['CS', 'ACC'], [5]],

  ['E17', 'Meera Krishnan', 'P3', ALL, [0], { isLead: true, maxCoversPerDay: 2 }],
  ['E18', 'Yash Agarwal', 'P3', ['CS'], [0]],
  ['E19', 'Kavya Reddy', 'P3', ['ACC', 'NDR', 'CS'], [3]],
  ['E20', 'Rahul Bhatt', 'P3', ['CS', 'NDR'], [6]],
  ['E21', 'Simran Kaur', 'P3', ['CS', 'ACC'], [0]],
  ['E22', 'Neha Saxena', 'P3', ['CS', 'ACC'], [1], { shiftId: 'LATE', maxCoversPerDay: 2 }],
  ['E23', 'Dev Choudhary', 'P3', ['CS', 'ACC'], [4], { shiftId: 'LATE', maxCoversPerDay: 2 }],
  ['E24', 'Riya Jain', 'P3', ['CS', 'RET'], [0]],

  ['E25', 'Farhan Qureshi', 'P4', ALL, [0], { isLead: true, maxCoversPerDay: 2 }],
  ['E26', 'Ishaan Bose', 'P4', ['CS', 'ACC'], [1]],
  ['E27', 'Ankita Das', 'P4', ['CS', 'ACC'], [5]],
  ['E28', 'Sameer Khan', 'P4', ['CS', 'NDR'], [0]],
  ['E29', 'Priya Nambiar', 'P4', ['CS', 'ACC'], [2]],
  ['E30', 'Harsh Vardhan', 'P4', ['CS', 'ACC'], [0]],
  ['E31', 'Zoya Siddiqui', 'P4', ['CS', 'RET'], [6]],
];

const employees = people.map(([id, name, podId, skills, weeklyOffPref, extra = {}]) => ({
  id,
  name,
  podId,
  isLead: false,
  shiftId: 'GEN',
  skills,
  weeklyOffPref,
  offsPerWeek: 1,
  maxCoversPerDay: 1,
  compOffBalance: 0,
  active: true,
  ...extra,
}));

// [brandId, name, podId, [[processId, preset, minStaff, extra, employeeIds]]]
const brandDefs = [
  ['B01', 'Oatbloom', 'P1', [
    ['CS', 'ALL_DAYS', 1, {}, ['E02']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E03']],
    ['NDR', 'MON_SAT_NO_PH', 1, {}, ['E04']],
  ]],
  ['B02', 'Mittiware', 'P1', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E05']],
    ['ACC', 'MON_SAT_NO_PH', 1, {}, ['E05']],
  ]],
  ['B03', 'Saffron Lane', 'P1', [
    ['CS', 'ALL_DAYS', 1, {}, ['E06']],
    ['RET', 'MON_FRI_NO_PH', 1, {}, ['E06']],
  ]],
  ['B04', 'Hearthly', 'P1', [
    ['CS', 'DAILY_NO_PH', 1, {}, ['E07']],
    ['NDR', 'MON_SAT_NO_PH', 1, {}, ['E07']],
  ]],
  ['B05', 'Velvet Moss', 'P1', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E08']],
    ['ACC', 'MON_SAT_NO_PH', 1, {}, ['E08']],
  ]],
  ['B06', 'Lumen Candles', 'P1', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E32']],
    ['ACC', 'MON_FRI_NO_PH', 1, {}, ['E32']],
  ]],

  ['B07', 'Brewnest', 'P2', [
    ['CS', 'ALL_DAYS', 1, { dowOverrides: { 0: 2, 6: 2 }, dateOverrides: { '2026-12-26': 3 } }, ['E10', 'E11']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E12']],
    ['NDR', 'MON_SAT_NO_PH', 1, {}, ['E12']],
    ['RET', 'MON_FRI_NO_PH', 1, {}, ['E12']],
  ]],
  ['B08', 'Tidal Socks', 'P2', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E13']],
  ]],
  ['B09', 'Kora Bags', 'P2', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E13']],
    ['ACC', 'MON_SAT_NO_PH', 1, {}, ['E13']],
  ]],
  ['B10', 'Kettlecraft', 'P2', [
    ['CS', 'ALL_DAYS', 1, {}, ['E14']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E14']],
  ]],
  ['B11', 'Pebble Pets', 'P2', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E15']],
    ['NDR', 'MON_SAT_NO_PH', 1, {}, ['E15']],
  ]],
  ['B12', 'Zestly', 'P2', [
    ['CS', 'DAILY_NO_PH', 1, {}, ['E16']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E16']],
  ]],

  ['B13', 'Loomkart', 'P3', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E18']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E19']],
    ['NDR', 'DAILY_NO_PH', 1, {}, ['E19']],
  ]],
  ['B14', 'Nimbu Pantry', 'P3', [
    ['CS', 'ALL_DAYS', 1, {}, ['E20']],
    ['NDR', 'MON_SAT_NO_PH', 1, {}, ['E20']],
  ]],
  ['B15', 'Kesar Kitchen', 'P3', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E21']],
    ['ACC', 'MON_SAT_NO_PH', 1, {}, ['E21']],
  ]],
  ['B16', 'Drift Audio', 'P3', [
    ['CS', 'DAILY_NO_PH', 1, { shiftId: 'LATE' }, ['E22']],
    ['ACC', 'DAILY_NO_PH', 1, { shiftId: 'LATE' }, ['E22']],
  ]],
  ['B17', 'Zuri Fit', 'P3', [
    ['CS', 'ALL_DAYS', 1, { shiftId: 'LATE' }, ['E23']],
  ]],
  ['B18', 'Pinecone Kids', 'P3', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E24']],
    ['RET', 'MON_FRI_NO_PH', 1, {}, ['E24']],
  ]],

  ['B19', 'Glowroot', 'P4', [
    ['CS', 'ALL_DAYS', 1, { dateOverrides: { '2026-12-31': 2 } }, ['E26', 'E27']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E26', 'E27']],
  ]],
  ['B20', 'Fernway', 'P4', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E28']],
  ]],
  ['B21', 'Haldi Home', 'P4', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E28']],
    ['NDR', 'MON_SAT_NO_PH', 1, {}, ['E28']],
  ]],
  ['B22', 'Monsoon Mats', 'P4', [
    ['CS', 'ALL_DAYS', 1, {}, ['E29']],
    ['ACC', 'DAILY_NO_PH', 1, {}, ['E29']],
  ]],
  ['B23', 'Copperleaf', 'P4', [
    ['CS', 'MON_SAT_NO_PH', 1, {}, ['E30']],
    ['ACC', 'MON_SAT_NO_PH', 1, {}, ['E30']],
  ]],
  ['B24', 'Bindu Beauty', 'P4', [
    ['CS', 'DAILY_NO_PH', 1, {}, ['E31']],
    ['RET', 'MON_FRI_NO_PH', 1, {}, ['E31']],
  ]],
];

const brands = [];
const services = [];
const assignments = [];
let a = 0;
for (const [brandId, name, podId, procs] of brandDefs) {
  brands.push({ id: brandId, name, podId });
  for (const [processId, preset, minStaff, extra, emps] of procs) {
    const id = `${brandId}-${processId}`;
    services.push({
      id,
      brandId,
      processId,
      shiftId: 'GEN',
      minStaff,
      calendar: cal(preset),
      dowOverrides: {},
      dateOverrides: {},
      active: true,
      ...extra,
    });
    for (const employeeId of emps) assignments.push({ id: `A${++a}`, employeeId, serviceId: id, kind: 'primary' });
  }
}

// Designated backups: the pod lead backs up every 365-day CS line in their pod,
// and the two LATE-shift agents back each other up.
const backup = (employeeId, serviceId) => assignments.push({ id: `A${++a}`, employeeId, serviceId, kind: 'backup' });
backup('E01', 'B03-CS');
backup('E09', 'B10-CS');
backup('E17', 'B14-CS');
backup('E25', 'B22-CS');
backup('E23', 'B16-CS');
backup('E22', 'B17-CS');

const holidays = [
  { id: 'H1', date: '2026-01-26', name: 'Republic Day' },
  { id: 'H2', date: '2026-03-04', name: 'Holi' },
  { id: 'H3', date: '2026-08-15', name: 'Independence Day' },
  { id: 'H4', date: '2026-10-02', name: 'Gandhi Jayanti' },
  { id: 'H5', date: '2026-11-08', name: 'Diwali' },
  { id: 'H6', date: '2026-12-25', name: 'Christmas' },
  { id: 'H7', date: '2027-01-26', name: 'Republic Day' },
];

const leaves = [
  { id: 'L1', employeeId: 'E29', start: '2026-12-14', end: '2026-12-15', type: 'LEAVE', status: 'approved', note: 'Family function' },
  { id: 'L2', employeeId: 'E11', start: '2026-12-21', end: '2026-12-21', type: 'LEAVE', status: 'approved', note: 'Medical appointment' },
  { id: 'L3', employeeId: 'E19', start: '2026-12-10', end: '2026-12-10', type: 'COMP', status: 'approved', note: 'Comp-off for Diwali shift' },
  { id: 'L4', employeeId: 'E23', start: '2026-12-05', end: '2026-12-05', type: 'UNAV', status: 'approved', note: 'Training' },
  { id: 'L5', employeeId: 'E02', start: '2026-12-18', end: '2026-12-19', type: 'LEAVE', status: 'pending', note: 'Requested - awaiting approval' },
  { id: 'L6', employeeId: 'E13', start: '2026-12-23', end: '2026-12-23', type: 'LEAVE', status: 'pending', note: 'Requested - awaiting approval' },
];

employees.find((e) => e.id === 'E19').compOffBalance = 1;

export function createSampleData() {
  return structuredClone({
    processes,
    shifts,
    pods,
    employees,
    brands,
    services,
    assignments,
    holidays,
    leaves,
    settings: DEFAULT_SETTINGS,
  });
}

export const SAMPLE_MONTH = '2026-12';
