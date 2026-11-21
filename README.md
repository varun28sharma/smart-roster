# Smart Roster

A browser-based roster management tool for a multi-brand CX operations team. It plans monthly rosters across brands, processes and pods, checks every client's coverage rules, flags conflicts with reasons, and suggests fixes that it has already tested.

**Live app:** _add your Vercel URL here_ · **Demo video:** _add link_

The sample dataset has 32 employees, 4 pods, 24 brands, 4 processes, mixed operating calendars and December 2026 leave. The app opens on a generated roster for that month.

---

## What it does

| Need from the brief | Where |
|---|---|
| Central database of employees, brands, processes, pods, leads, assignments | **Setup** (add, edit and delete everything; no code changes) |
| Working-day rules and minimum coverage per brand/process | **Setup → Brands & processes**: calendar preset or custom days, holidays on/off, default minimum, per-weekday minimum, per-date minimum, shift |
| Availability, weekly offs, leave, comp-offs, public holidays | Employee weekly-off preferences and offs per week; **Leaves & changes**; **Setup → Public holidays** |
| Generate a monthly roster | **Roster → Generate / Regenerate (keeps manual edits)** |
| Company / pod / brand / process / employee views | **Roster** tabs, plus a **Day** view showing who is working on each brand |
| Detect conflicts and gaps before publishing | **Conflicts** page. Publishing is blocked while any error remains |
| Manual edits with validation | Click any cell: set work/off/holiday, add or remove covers. Each option shows its effect ("fixes 1 error") before you click |
| Handle changes without rebuilding | Approving leave re-validates instantly. **Suggest fixes** gives simulated options. Pending leave shows its impact before approval. **Changes since publish** lists who is affected |
| Optional extras | Fair weekend rotation, preference-based offs, backup recommendations, auto cross-cover, approval preview, change tracking, CSV export, AI conflict explanations, add brands/pods/processes/shifts dynamically, undo |

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 10 engine tests (node:test, no extra deps)
npm run build
```

No environment variables are needed. Without Supabase, data is saved in the browser (localStorage). Without an Anthropic key, "Explain" uses a rule-based explanation.

### Optional: Supabase persistence
1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. On first load the app seeds the sample data into the tables. After that, every change is diff-synced (only changed rows are upserted or deleted).

### Optional: AI explanations
Set `ANTHROPIC_API_KEY` as a server-side environment variable on Vercel. `api/explain.js` sends the structured conflict and the already-simulated fixes to Claude and returns a short plain-English explanation and recommendation. The AI explains; it never edits the roster.

### Deploy (Vercel)
Import the repo in Vercel. The framework is detected as Vite, and `api/explain.js` becomes a serverless function automatically. Add the env vars above if you want them.

---

## Architecture

```
src/
  engine/            pure JS, no React: runs in the browser and in Node tests
    dates.js         UTC date helpers, Monday-based month weeks
    model.js         indexes, operating-calendar and min-staff rules
    rosterState.js   status of a person on a day, coverage counts, cover candidates
    generator.js     monthly roster generation
    validator.js     independent constraint checker producing issues and coverage
    suggestions.js   fix options for an issue, each simulated and re-validated
    changes.js       publish snapshots, diff since publish, leave impact, CSV
  data/sampleData.js 32-employee sample dataset
  store/             React context + reducer, autosave to localStorage or Supabase
  components/        Roster views, inspector, conflicts, leaves & changes, setup
api/explain.js       Vercel function -> Claude (optional)
supabase/schema.sql  normalized Postgres schema
tests/engine.test.js scenario tests from the brief
```

The scheduling engine is separate from the UI. Every rule can be tested in Node, and validation reruns on every change in about 20 ms.

---

## Tell us how you think

### 1. How did you model employees, brands, processes, pods and their relationships?

- **Pod** `{name, leadId}`. **Employee** `{podId, isLead, shiftId, skills[], weeklyOffPref[], offsPerWeek, maxCoversPerDay, compOffBalance, active}`.
- **Brand** `{name, podId}` and **Process** `{code, name}` are catalogs.
- **Service** ("brand process") is the unit that needs coverage: `brand × process` with its own **operating calendar** (`days[]`, `holidaysOff`), `minStaff`, `dowOverrides`, `dateOverrides` and `shiftId`. This is what makes rules like "Brewnest CS runs 365 days and needs 2 on weekends, while Brewnest RET is Mon–Fri" possible.
- **Assignment** `{employeeId, serviceId, kind: primary|backup}` is the many-to-many link. One person can run several brands (Rhea runs Tidal Socks and Kora Bags). Several people can share one process (Glowroot CS). A brand can split processes across people (Oatbloom).
- **Leave** `{employeeId, start, end, type: LEAVE|COMP|UNAV, status: approved|pending}` and **Holiday** `{date, name}`.
- A **Roster** stores only decisions: generator-chosen offs (`cells`), manual edits (`pins`) and `covers`. Leave, holidays and calendars are always read live. That is why a change in data shows up in validation immediately, with no regeneration.

The brand's operating calendar and the employee's schedule are separate. An employee is needed on a day only if one of their services operates that day. A day when none operate is a natural rest day.

### 2. How does the system generate a roster and check it satisfies the constraints?

**Generation** (`generator.js`) is deterministic and greedy, most-constrained first:
1. Fixed facts: approved leave/comp-off/unavailability, manual pins, closed days.
2. Public holidays: give the day off to anyone whose services stay at minimum without them. Others work it and earn a comp-off.
3. Weekly offs, week by week. Employees with the fewest *feasible* off-days go first. A day is feasible if removing the person keeps every service they run at or above its minimum. Feasible days are scored on preference (+20), spare capacity, spread within the pod, weekend fairness and rest spacing (heavy penalty if the working streak would exceed the limit).
4. If no day is feasible, pick the day needing the fewest covers and assign covers (see Q3). If even that fails, the off is **not** silently dropped: it is logged and becomes an error.
5. Gap filling: any service-day still under its minimum (usually from leave) gets a cover if someone qualified is free.

**Validation** (`validator.js`) is independent of the generator and runs on any roster: generated, hand-edited, or stale after a data change. It produces:
- **Errors (block publishing):** coverage gap per service-day, multi-brand impact (one absence breaking 2+ brands), missing weekly off, unstaffed service, shift mismatch, invalid cover (coverer on leave or wrong shift).
- **Warnings:** cover overload, working streak over the limit, comp-off balance exceeded, cover without the skill.
- **Info:** preference not honoured, holiday worked (comp-off earned).

Ten tests in `tests/engine.test.js` cover the scenarios from the brief (100% coverage on the sample, weekly offs, calendars and overrides, single-resource absence, multi-brand absence, a shared process staying covered, impossible requirements being reported, pins surviving regeneration, pending-leave preview and publish diff).

### 3. How did you handle single-resource brands vs. brands with multiple employees?

The same rule handles both: *can this person be removed today without a service falling below minimum?*
- **Multi-employee brands** usually have slack, so offs are placed on days a colleague covers. Brewnest's two CS agents need 2 on weekends, so their offs naturally fall on weekdays.
- **Single-resource brands** on 7-day calendars never have slack. The generator then picks the day needing the fewest covers and finds a cover. For example, Arjun runs Saffron Lane CS (365 days) and RET (Mon–Fri). He gets his preferred Sunday off because only CS runs that day, so one cover from a Pod Aurora colleague who works Sundays is enough. Candidates must be working that day, have the process skill, work the same shift, and be under their daily cover limit. They are ranked: **designated backup > already works on the same brand > same pod > pod lead**, minus their own workload that day and the covers they've already done this month (fairness).
- Single-resource brands that are closed on Sundays need nothing special: Sunday is their weekly off.

### 4. What happens when the only employee for a brand is unavailable on a required day?

As soon as the leave is approved, validation shows **"Kesar Kitchen · CS uncovered on Wed 16 Dec (0/1). Single-resource process. Unavailable: Simran Kaur: leave."** If that person runs several brands, a **multi-brand** error groups the damage too. **Suggest fixes** lists:
- moving a colleague's weekly off (only for shared processes),
- named cover candidates with reasons ("designated backup · same pod · no own process that day"),
- for multi-brand cases, a one-click "cover all affected processes".

Each option is simulated first and labelled with its effect ("fixes 1 error, +0 warnings, coverage 100%"). If the leave is still pending, the manager sees this impact *before* approving it.

### 5. How does the system handle conflicting requirements or insufficient staffing?

Mandatory constraints (client coverage, weekly off, shift compatibility) always beat preferences: a preferred off day is used only if it is feasible, otherwise it is reported as info. When mandatory constraints themselves conflict (e.g. a 365-day single-resource brand with no qualified backup, or a date override needing 3 people when only 2 can work that shift), the generator keeps coverage, logs why, and the validator raises an explicit error. If the suggestion engine finds no internal fix, it says so and names the manager's real options: approve overtime, raise a cover limit, add a backup assignment, or agree reduced coverage with the client. An invalid roster cannot be published.

### 6. What did you automate, and what is left under human control?

**Automated:** reading every calendar and rule, placing weekly offs and holiday offs, choosing routine covers, re-validating after every change, ranking cover candidates, simulating fixes, previewing pending leave, tracking changes since publish.

**Human:** approving or rejecting leave, applying fixes (nothing is changed without a click), editing cells (kept when regenerating), turning auto-cover off (Settings), publishing, and asking people to work a public holiday. These decisions involve people and client relationships, and the manager knows things the data doesn't. The system's job is to make the consequences visible before the decision. AI is used only to *explain* conflicts, never to make roster decisions, so the roster stays deterministic and auditable.

### 7. If the team and brand count doubled, what would you change?

At 64 employees and 50 brands the greedy engine still runs well under a second, so performance isn't the first problem. I would:
- move from greedy placement to a constraint solver (CP-SAT / ILP) for weekly offs and covers, keeping the same validator as the source of truth, to find globally better plans and offer real alternative plans side by side;
- move generation and validation server-side (Supabase Edge Function or a worker) with proper auth and role-based access (ops manager vs. pod lead), and replace the demo RLS policy;
- add approval workflows per pod lead and notifications (n8n or webhook) when a published roster changes;
- shard views by pod and virtualize the grid.

### 8. With one more week, what would I improve first?

1. **Alternative plans:** generate 3 rosters with different weightings (fairness vs. preferences vs. fewest covers) and compare them.
2. **Partial regeneration:** "re-plan only the affected week" after a leave change, which disturbs fewer people than a full regenerate.
3. **Real auth and roles** (Supabase Auth), with an approval flow where pod leads propose and the ops manager publishes.
4. **Notifications** to affected employees on re-publish, and Google Sheets export.
5. **Cross-month continuity:** carry working streaks and comp-off balances across month boundaries.

---

## Assumptions

- One shift per person per day. Covering means handling an extra brand process within your own shift. Services and employees carry a shift; a cover must match it.
- Weekly offs are counted per Monday–Sunday week. Partial weeks at month edges are pro-rated (4 or more days means 1 off).
- A day when none of your processes operate counts as your weekly off. A public-holiday off does not.
- Leave and comp-off don't replace the weekly off.
- Pod leads have no brand of their own. They work the company calendar (Mon–Sat, holidays off) and can cover up to 2 processes a day.
- Working a public holiday earns one comp-off. Comp-offs used beyond balance + earned raise a warning.
- Max 6 consecutive working days (configurable).
- Streaks and balances don't carry across months (see Q8).
- All names, brands and holidays are fictional or illustrative.

## Known limitations

- The Supabase adapter and the Claude endpoint are implemented but were only exercised through the code paths that don't need credentials. Local mode and the rule-based explanation fallback are what was tested end to end.
- The demo RLS policy lets the anon key read and write everything. That's fine for a public demo, not for production.
