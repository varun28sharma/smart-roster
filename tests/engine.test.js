import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSampleData, SAMPLE_MONTH } from '../src/data/sampleData.js';
import { generateRoster } from '../src/engine/generator.js';
import { validateRoster } from '../src/engine/validator.js';
import { suggestFixes } from '../src/engine/suggestions.js';
import { RosterState, applyActions } from '../src/engine/rosterState.js';
import { leaveImpact, snapshot, diffSincePublish } from '../src/engine/changes.js';
import { monthWeeks } from '../src/engine/dates.js';

const M = SAMPLE_MONTH;

test('sample data matches the staffing pattern in the brief', () => {
  const data = createSampleData();
  assert.ok(data.employees.length >= 30);
  const perBrand = new Map();
  for (const a of data.assignments.filter((x) => x.kind === 'primary')) {
    const b = data.services.find((s) => s.id === a.serviceId).brandId;
    (perBrand.get(b) || perBrand.set(b, new Set()).get(b)).add(a.employeeId);
  }
  const single = [...perBrand.values()].filter((s) => s.size === 1).length;
  assert.ok(single / perBrand.size >= 0.75 && single / perBrand.size <= 0.85, `single-resource share ${single}/${perBrand.size}`);
  assert.ok([...perBrand.values()].some((s) => s.size === 3));
});

test('generated roster has full coverage and no errors', () => {
  const data = createSampleData();
  const r = generateRoster(data, M);
  const v = validateRoster(data, r);
  assert.equal(v.summary.errors, 0, v.issues.filter((i) => i.severity === 'error').map((i) => i.title).join('\n'));
  assert.equal(v.summary.coveragePct, 100);
});

test('every employee gets their weekly off and is never rostered on approved leave', () => {
  const data = createSampleData();
  const r = generateRoster(data, M);
  const st = new RosterState(data, r);
  for (const e of st.idx.activeEmployees) {
    for (const w of monthWeeks(M)) {
      if (w.days.length < 4) continue;
      const offs = w.days.filter((d) => st.status(e.id, d) === 'OFF').length;
      const working = w.days.some((d) => st.status(e.id, d) === 'WORK');
      if (working) assert.ok(offs >= 1, `${e.name} week ${w.key}`);
    }
  }
  for (const l of data.leaves.filter((x) => x.status === 'approved')) {
    assert.notEqual(st.status(l.employeeId, l.start), 'WORK');
  }
  for (const c of r.covers) assert.equal(st.status(c.employeeId, c.date), 'WORK', 'cover by someone not working');
});

test('brand calendars are respected: Mon-Sat brands are closed on Sunday and on holidays', () => {
  const data = createSampleData();
  const r = generateRoster(data, M);
  const v = validateRoster(data, r);
  assert.equal(v.coverage['B02-CS']['2026-12-06'].required, 0); // Sunday
  assert.equal(v.coverage['B02-CS']['2026-12-25'].required, 0); // Christmas
  assert.equal(v.coverage['B03-CS']['2026-12-25'].required, 1); // 365-day line
  assert.equal(v.coverage['B07-CS']['2026-12-26'].required, 3); // date override
  assert.equal(v.coverage['B07-CS']['2026-12-27'].required, 2); // Sunday override
});

test('change after generation: single-resource employee unavailable => gap flagged with a resolving suggestion', () => {
  const data = createSampleData();
  const r = generateRoster(data, M);
  const st = new RosterState(data, r);
  const day = ['2026-12-16', '2026-12-17', '2026-12-18'].find((d) => st.status('E21', d) === 'WORK');
  data.leaves.push({ id: 'X1', employeeId: 'E21', start: day, end: day, type: 'LEAVE', status: 'approved' });
  const v = validateRoster(data, r);
  const gaps = v.issues.filter((i) => i.type === 'GAP' && i.date === day && i.serviceId.startsWith('B15'));
  assert.ok(gaps.length >= 1, 'gap not flagged');
  assert.match(gaps[0].detail, /Single-resource/);
  const fixes = suggestFixes(data, r, gaps[0], v.summary);
  assert.ok(fixes.length > 0);
  const best = fixes.find((f) => f.impact.errors < 0);
  assert.ok(best, 'no suggestion reduces errors');
  const v2 = validateRoster(data, applyActions(r, best.actions));
  assert.ok(v2.summary.errors < v.summary.errors);
});

test('one employee across two brands: absence raises a multi-brand impact error', () => {
  const data = createSampleData();
  const r = generateRoster(data, M);
  const st = new RosterState(data, r);
  const day = ['2026-12-15', '2026-12-16', '2026-12-17'].find((d) => st.status('E13', d) === 'WORK');
  data.leaves.push({ id: 'X2', employeeId: 'E13', start: day, end: day, type: 'LEAVE', status: 'approved' });
  const v = validateRoster(data, r);
  const multi = v.issues.find((i) => i.type === 'MULTI_BRAND' && i.employeeId === 'E13');
  assert.ok(multi);
  const fixes = suggestFixes(data, r, multi, v.summary);
  assert.ok(fixes[0].actions.length >= 2);
});

test('one of several on a shared process unavailable: remaining staff evaluated, not auto-flagged', () => {
  const data = createSampleData();
  const r = generateRoster(data, M);
  const st = new RosterState(data, r);
  // Glowroot CS needs 1 and has two people. If one is out on a normal day, the other covers it.
  const day = ['2026-12-08', '2026-12-09', '2026-12-10'].find((d) => st.status('E26', d) === 'WORK' && st.status('E27', d) === 'WORK');
  data.leaves.push({ id: 'X3', employeeId: 'E26', start: day, end: day, type: 'LEAVE', status: 'approved' });
  const v = validateRoster(data, r);
  assert.ok(!v.issues.some((i) => i.type === 'GAP' && i.serviceId === 'B19-CS' && i.date === day));
});

test('impossible requirements are reported, never silently dropped', () => {
  const data = createSampleData();
  data.services.find((s) => s.id === 'B17-CS').minStaff = 4; // LATE shift, only 2 LATE people exist
  const r = generateRoster(data, M);
  const v = validateRoster(data, r);
  assert.ok(v.issues.some((i) => i.type === 'GAP' && i.serviceId === 'B17-CS'));
  assert.ok(r.log.some((l) => l.level === 'warn'));
});

test('manual pins survive regeneration', () => {
  const data = createSampleData();
  const r1 = generateRoster(data, M);
  const pinned = applyActions(r1, [{ type: 'PIN', employeeId: 'E05', date: '2026-12-09', status: 'OFF' }]);
  const r2 = generateRoster(data, M, pinned);
  assert.equal(new RosterState(data, r2).status('E05', '2026-12-09'), 'OFF');
});

test('pending leave impact preview and publish diff', () => {
  const data = createSampleData();
  let r = generateRoster(data, M);
  r = { ...r, published: snapshot(data, r) };
  const pending = data.leaves.find((l) => l.id === 'L5');
  const impact = leaveImpact(data, r, pending);
  assert.ok(impact.after.errors >= impact.before.errors);
  data.leaves = data.leaves.map((l) => (l.id === 'L5' ? { ...l, status: 'approved' } : l));
  const diff = diffSincePublish(data, r);
  assert.ok(diff.some((c) => c.employeeId === 'E02'));
});
