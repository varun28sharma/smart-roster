# Approach note: Smart Roster

## Short version (for the submission email)

I modelled each brand × process as its own "service" with an operating calendar and a minimum headcount, separate from each employee's schedule. A deterministic, most-constrained-first generator places holiday offs, weekly offs and cross-covers so that no service drops below its minimum. An independent validator re-checks the roster after every change and blocks publishing while any coverage, weekly-off or shift conflict remains. When leave or availability changes, the app shows the gap immediately and offers fixes it has already simulated (cover candidates, moved offs), and Claude can explain any conflict in plain English. The manager stays in control of every decision.

## Solution

- **Problem framing.** The hard part isn't the calendar; it's "can this person rest today without a client going uncovered?" Everything is built around that one question, answered by `RosterState.deficitsIfRemoved()`.
- **Data model.** Pods, employees, brands and processes are catalogs. The *service* (brand × process) carries the operating rules. *Assignments* (primary/backup) link people to services, many-to-many. Leave and holidays are data, and the roster stores only decisions (offs, manual pins, covers), so data changes are reflected without regenerating.
- **Generation.** Greedy and deterministic: fixed facts → public holidays → weekly offs, week by week, placing the least-flexible people first → covers when no day is safe (backup > same brand > same pod > lead, skill- and shift-checked, capped per day, fairness-weighted) → gap filling. Preferences only rank feasible options.
- **Validation.** A separate pass over any roster that produces errors, warnings and info items with plain-language reasons. Coverage is computed per service per day ("working / required").
- **Change handling.** Approving leave re-validates instantly. "Suggest fixes" simulates each option and shows its effect. Pending leave is previewed before approval. A publish snapshot tracks who is affected by later changes. Manual edits survive regeneration.

## Architecture

React (Vite) single-page app. The engine is plain JavaScript modules with no UI dependency, unit-tested with `node:test`. Persistence goes through an adapter: localStorage by default, or normalized Supabase/Postgres tables (`supabase/schema.sql`) with diff-sync. An optional Vercel serverless function calls Claude for conflict explanations, with a rule-based fallback. Deployed on Vercel.

## Key decisions and trade-offs

- **Deterministic greedy over a solver.** Explainable decisions (a log of each choice), fast (about 150 ms per month), easy to test. The trade-off is that it isn't globally optimal, so a CP-SAT solver is the first upgrade at larger scale, keeping the same validator.
- **Validator separate from generator.** The roster is trusted only after it is re-checked against current data, which is also what makes manual edits and late leave safe.
- **Coverage before preferences, and labour rules as errors.** A missing weekly off is never hidden. It is flagged with options.
- **AI for explanation, not decisions.** Rostering affects people and client contracts, so decisions stay deterministic and human-approved. Claude only turns structured conflicts into readable guidance.
- **Zero-setup demo.** It works fully in the browser with sample data, while the Supabase path shows the production data model.
