Last Edited: 2026-09-27

# Plan: pay-period compatibility study before a port

Verdict: **study executed 2026-09-27; awaiting HITL direction** (results in `compatibility.md`: full port defer; read-only view or no port). Priority 4. AFK research/probes, then HITL product decision before any production redesign. This task does not authorize a production port, and its probes cannot produce a full-port go (see §8 decision rule). Sections 4, 5, 9 and 10 are intentionally unused; citations to §11–§14 are stable.

## 1. Current state

Current `packages/loot-core/src/shared/months.ts`, `server/budget/{base,envelope,tracking,actions}.ts`, template/schedule evaluation, API budget methods, and desktop/mobile budget navigation share calendar-month assumptions. `BalanceForecast` already offers schedule-based projections. `BudgetAnalysis` and spending comparisons consume budget amounts. No pay-period symbols exist under `packages/loot-core/src`.

[Pinned pay-period guide](https://github.com/code-with-jov/actual-pay-periods/blob/62128aa6e24a957e1e85db2ebc7cd43fccfb995b/packages/docs/docs/experimental/pay-periods.md) documents: separate calendar/period allocations; identifiers `YYYY-MM` with MM 13–99 (e.g. `2026-13`); allocations reinterpreted when cadence changes; unavailable budget-based reports (Budget Analysis, custom-report Budgeted, Spending Budgeted comparison, Sankey Budgeted; transaction reports stay); plain fixed templates becoming per-period while limits and "save by month" are scaled; monthly bills funded wholly in their containing period. These are known limitations, not hypothetical objections.

The research also points to [layered budget assignment ADR-0006](https://github.com/lefevreste/budget-fr/blob/master/docs/budget-fr/adr/0006-layered-budget-period-assignment.md) (accepted 2026-09-02, amended 2026-09-09, read from unpinned `master`). It assigns _transactions_ to a budget period via `manual_budget_period` / `rule_assignment`, distinct from bank `date`; it does not define paycheck columns or `2026-13`. Pin its commit SHA when the study reads it; do not describe it as the paycheck model.

### Verified current-tree facts (record in `survey.md`, re-verify at study time)

- Category allocations: `actions.ts` `setBudget` writes `zero_budgets` (envelope) or `reflect_budgets` (tracking), selected by `getBudgetTable` from the `preferences` row `budgetType`. Key is integer `YYYYMM` via `dbMonth` (`parseInt(month.replace('-', ''))`), row id `` `${dbMonth(month)}-${category}` ``. Carryover (`setCarryover`) shares that encoding.
- Envelope buffer: `setBuffer` stores `zero_budget_months.id` as the `YYYY-MM` string — a second key encoding. Tracking has no buffer table. `zero_budget_months` is absent from `aql/schema/index.ts` but referenced by `undo.ts`.
- Derived sheet: `sheet.ts` `loadUserBudgets` paints `budget${month}` cells from the integer column; `base.ts` `handleBudgetChange` maps synced rows with `sheetForMonth`. The sheet is a reloadable projection; the mode-selected tables are the assignment record.
- Bank-date spend: `base.ts` `getSumAmountsByMonth` groups `t.date / 100`; spend follows the transaction date, independent of allocation keys.
- Month-13 gates: `isValidYearMonth('2026-13')` is false; `api.ts` `validateMonth` checks `/^\d{4}-\d{2}$/` then membership in exclusive `monthUtils.range`, and `IMPORT_MODE` skips the range check; `_parse('2026-13')` overflows to January 2027; `dbMonth('2026-13')` is `202613`; `api/budget-set-amount` does not call `validateMonth`. `api/budget-months` returns exclusive `monthUtils.range(start, end)`, omitting the last created month.
- Sync: `serialization.ts` tags `0:` / `N:` / `S:` and defers only unknown prefixes or missing tables/columns (`sync/index.ts` `apply`). An integer `202613` in an existing `month` column or a new `preferences` id is an **ordinary cell** that old clients apply — not unknown-format deferral. `budgetType` is applied post-commit because the mode switch rebuilds the sheet outside rollback.
- Export: `packages/api/methods.ts` `exportBudget` → `cloud-storage.ts` `exportBuffer` zips `db.sqlite` + `metadata.json` (after deleting `kvcache`); `importers/actual.ts` `importActual` writes that sqlite back. YNAB importers call `api/budget-set-amount`.
- Task 0002 (`.workflow/tasks/0002-budget-reservations/plan.md`, uncommitted, SHA-256 `A0B61A77…FEF6` at 2026-09-27) is a plan for a read-only, envelope-only, current-calendar-month reservation breakdown keyed by budget id + `YYYY-MM`; pay periods are a non-goal. `packages/loot-core/src/server/budget/reservations.ts` does not exist.

## 2. Target shape

### Deliverable files and completion criteria

| Artifact                      | Required contents                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `survey.md`                   | Source SHAs (fork, ADR, local HEAD), changed-file inventory, owner tuple (§7), consumer map with file/symbol references verified against source                             |
| `probes/source-manifest.json` | Fork SHA, upstream baseline, per file: path, SHA-256 of pinned bytes, SHA-256 of probe bytes, `transformation` (`none` or `type-strip`), `pure: true/false`, license note   |
| `probes/vendor/`              | Pinned `shared/pay-periods.ts` (plus any pure `shared/` files it imports) per the extraction rule below; nothing from `server/`, sync, API or reports                       |
| `probes/date-ranges.test.mjs` | P01–P04 against oracles written before the probe first runs; P04 via child processes                                                                                        |
| `probes/sync-order.test.mjs`  | P09 pure operation-order model with no vendored or server imports; every result labeled `model-evidence`                                                                    |
| `compatibility.md`            | Per-scenario evidence records (§12), filled P05–P10 ledgers, option matrix (full port / read-only view / no port), cadence lifecycle class, recommendation, next-task scope |

**Extraction rule (the only allowed path from fork code into a probe).**

1. Preferred: copy pinned `packages/loot-core/src/shared/pay-periods.ts` byte-identical into `probes/vendor/` and import it from `.test.mjs` using Node's built-in type stripping (Node ≥ 22.18; local is v26.3.0). Manifest records equal pinned/probe hashes and `transformation: none`. `date-fns` resolves from the repo root `node_modules` (local 4.4.0); record the fork's `date-fns` version and note any mismatch.
2. Fallback if (1) fails on non-erasable TypeScript syntax: a copy with **only** type annotations / `import type` removed, `transformation: type-strip`, and the diff stored beside it. No other edits.
3. Transitive imports: a relative import into another pure `shared/` file may be vendored the same way and recorded. Any import of `#server`, `#platform`, `#shared` aliases, `server/budget/pay-period-config.ts`, migrations, serialization, sync, API or report modules is forbidden in the probe process; those files are survey-only.
4. If the import fails, record stderr as `harness_error`, label P01–P04 `unknown`, and do not rewrite period math in the probe. Merging the fork, adding a runtime, or editing expected values to make the source pass adoption criteria are forbidden.

If a behavior cannot be exercised by that rule without flattening its storage/sync behavior, it is `source-backed analysis` or `unknown`, never a simulated pass. The study may recommend no port while completing all deliverables. Preserve the production tree; fetch source into a disposable location outside the repo and record references instead of merging branches.

**Current invariants (must hold during the study and in any recommendation):** transaction bank dates unchanged; allocations never silently change date-range meaning; existing monthly data remains recoverable; the calendar budget core remains the sole production authority.

**Full-port constraints (inferred; apply only to a future port design):** exactly one period-identity authority and one assignment writer; claimed sync correctness requires real sync-engine evidence, not a model.

Produce `survey.md`, `compatibility.md` and reproducible synthetic probes under this task's `probes/` only. Amend this task's progress with results and a go/no-go recommendation. Do not change production code, schemas, preferences, saved budgets, public APIs, or the task 0002 folder; do not create a speculative migration for live data.

Evaluate three options: selective full pay-period port with explicit period identity and allocation preservation; a read-only paycheck planning view retaining calendar budget authority (adds no amount writer, leaves `setBudget` on calendar keys); existing forecast/settings with no port. The read-only alternative is an option to assess, not an authorized replacement implementation.

## 3. Contract

- Every identified consumer has current calendar behavior, source-fork behavior, risk and preservation strategy recorded, with file/symbol evidence and the owner tuple (§7).
- P01–P04 are `reproduced` against fixed oracles, or `unknown` with a recorded harness error, without changing transaction bank dates.
- Cadence switch, disable/re-enable, export/restore and old-client behavior (P05–P07, P10) each get a filled ledger labeled `source-backed analysis` or `unknown`; P09 is `model-evidence`. None of these labels proves a production design safe; do not call a design safe merely because amounts still exist in a table.
- Reports, templates, reservations and public API compatibility have explicit supported/unsupported outcomes and examples. A reproduced unavailable budget report **completes** that scenario and **fails** the full-port adoption bar unless `compatibility.md` names the disclosed outcome and a rollback that keeps existing monthly reports recoverable. A silent blank result fails adoption; it does not fail study delivery.
- Deliver a decision with maintenance scope and rollback cost. The full-port outcome of this study is **defer**; the study may still recommend read-only view or no port on evidence.

Domain: distinguish bank date, calendar budget month, period date range, period ID, cadence configuration and allocation assignment. New period semantics are inferred until adopted. Non-goals: payroll prediction, automatic income detection, transaction date rewriting, live budget conversion, MCP or new financial advice features.

| Acceptance                                        | Evidence                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Complete consumer map                             | `survey.md` owner tuple and paths/symbols for core, UI, reports, templates, API/CLI/import/export/sync |
| Date and cadence cases reproducible               | `node --test` command, evidence records and expected/actual tables for P01–P04                         |
| Allocation/sync/disable consequences demonstrated | Filled P05–P10 ledgers with labels; P09 model fixtures in both delivery orders plus replay             |
| Actionable comparison and recommendation          | `compatibility.md` option matrix, rejected designs, remaining decisions and next task scope            |
| Evidence-label discipline                         | Every P01–P10 record carries exactly one §12 label; no `model-evidence`/`unknown` feeds a go           |

Batch limit: steps and probe families run as one sequence (§12). Study artifacts can be reverted independently; no production rollback needed.

## 6. Dependencies and constraints

Source fork `code-with-jov/actual-pay-periods@62128aa6e24a957e1e85db2ebc7cd43fccfb995b`. Inspect before making correctness claims: `shared/pay-periods.ts`, `shared/pay-period-config.ts`, `server/budget/pay-period-config.ts` (watches prefs `flags.payPeriodsEnabled`, `showPayPeriods`, `payPeriodFrequency`, `payPeriodStartDate`, then calls `rebuildBudgets` — four independent preference rows, not one composite cell), migration/serialization paths, and pinned tests `server/budget/pay-periods.test.ts`, `pay-period-config.test.ts`, `pay-period-drilldown.test.ts`, `category-template-context.pay-periods.test.ts`, `goal-template.pay-periods.test.ts`, `schedule-template.pay-periods.test.ts`. Refresh source/target overlap. Use the ADR as competing design evidence, not proof of compatibility.

If the fork pin or ADR cannot be fetched, record the URL, the failure, and `unknown` for every claim that depended on it, and continue the in-repo consumer map. Do not invent fork behavior. Use existing tooling and sanitized fixtures; do not access the user's budget files. No installation of alternative runtimes.

## 7. Authority and state ownership

Current calendar budget core remains the sole production authority. `survey.md` must record the current **owner tuple**, one named owner per field:

| Field                      | Current owner                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Period identity            | `shared/months.ts` (`YYYY-MM`, `isValidYearMonth`, `range`, `sheetForMonth`)                                                            |
| Assignment writer per mode | `actions.ts` `setBudget` → `zero_budgets` (envelope) / `reflect_budgets` (tracking); `setBuffer` → `zero_budget_months` (envelope only) |
| Bank-date spend            | `base.ts` `getSumAmountsByMonth`, `handleTransactionChange`                                                                             |
| Derived sheet              | `sheet.ts` `loadUserBudgets`, `base.ts` `handleBudgetChange` (projection, reloadable)                                                   |
| Cadence/mode lifecycle     | `preferences` row `budgetType`, applied post-commit with sheet rebuild (`sync/index.ts`)                                                |

`compatibility.md` must classify any proposed cadence setting as a **plain `preferences` row** (old clients apply and store it) or a **post-commit sheet switch** (same lifecycle as `budgetType`), and state apply-versus-defer behavior for that class. A full-port sketch names exactly one period-identity authority and one assignment writer; a read-only view names no new writer. Source state: synthetic inputs and source code. Working state: isolated probe inputs. Derived state: comparison output. Persisted production state: unchanged. User selects whether paycheck cadence warrants the maintenance after the study produces evidence.

## 8. Proposed approach

### Consumer investigation order

1. **API/CLI contract.** `packages/api/methods.ts` (`getBudgetMonths`, `getBudgetMonth`, `setBudgetAmount`, `exportBudget`, `importBudget`), `packages/api/methods.test.ts`, `server/api.ts` (`validateMonth`, `api/budget-months`, `api/budget-month`, `api/budget-set-amount`), `packages/cli/src/commands/budgets.ts`. Record month format, integer amount units, exclusive month range, and which paths skip validation.
2. **Budget core, both modes.** `server/budget/{base,envelope,tracking,actions}.ts`, `shared/months.ts`, `sheet.ts` `loadUserBudgets`, `aql/schema/index.ts` (`zero_budgets`, `reflect_budgets`). Record both key encodings (integer `YYYYMM` category key vs `YYYY-MM` buffer id), envelope vs tracking leftover formulas and tables, and `undo.ts` datasets.
3. **Templates.** `category-template-context.ts`, `schedule-template.ts`, `goal-template.ts` (`applyTemplate`, `applyMultipleCategoryTemplates`, `setBudgets` via `setBudget`). Trace fixed amounts, limits, due dates and per-schedule contributions.
4. **UI and reports.** `components/budget/index.tsx`, mobile `BudgetPage.tsx`, `reports/spreadsheets/budgetDataQuery.ts` (`rangeInclusive` calendar months), `budget-analysis-spreadsheet.ts` and `reports/reports/BudgetAnalysis.tsx` (hardcoded `envelope-budget-month`), `reports/graphs/SpendingGraph.tsx`, `reports/ReportOptions.ts`, `reports/reports/Sankey.tsx`, `reports/reports/BalanceForecast.tsx`, `transactions/transaction-rules.ts` (`month` condition), `types/prefs.ts` `SyncedPrefs`.
5. **Sync/import/export.** `server/sync/index.ts` (`apply`, `_applyMessages`), `serialization.ts`, `serialization.test.ts`, `sync.property.test.ts` (fixture has no budget tables), `deferred.test.ts`, `budgetfiles/app.ts`, `importers/index.ts`, `importers/actual.ts`, `cloud-storage.ts`. Treat old-client apply of an integer `month` or new preference id as ordinary cell apply (§1).

After the pin and manifest exist, read-only inspection of different consumer areas may proceed in parallel. Probe files are authored by one writer per family, in §12 order.

### Fixed scenario matrix (the complete completion set)

P01–P10 are the only completion gates. Oracles for P01–P04 must be committed to the test file before the vendored source is first executed. For P05–P10 the ledger **fields** are fixed below; values come from the pinned fork (quoted test assertion or source line with path and name) or are `unknown`. A task-local reimplementation is never `reproduced`.

| ID  | Synthetic input                                                                                  | Fixed oracle / ledger                                                                                                                                                                                                                        | Allowed labels                      |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P01 | Weekly anchor 2026-01-02, dates 2025-12-20..2026-02-10                                           | Period containing 2026-01-02 starts 2026-01-02; period containing 2025-12-31 starts 2025-12-26; every date in exactly one contiguous 7-day period; record fork period ids for those two periods                                              | `reproduced`, `unknown`             |
| P02 | Biweekly anchor 2026-01-02 through 2026-12-31                                                    | January starts 2026-01-02, 2026-01-16, 2026-01-30; contiguous 14-day periods, no month reset; three-paycheck months (≥3 starts) listed — expect 2026-01 and 2026-07                                                                          | `reproduced`, `unknown`             |
| P03 | Monthly anchor Jan 31, 2027 and 2028                                                             | Feb periods start 2027-02-28 and 2028-02-29; March periods start 2027-03-31 and 2028-03-31                                                                                                                                                   | `reproduced`, `unknown`             |
| P04 | P01/P02 cadences over 2026-03-01..03-15 and 2026-10-25..11-08 (DST 03-08, 11-01)                 | `yyyy-MM-dd` → period-start map identical in child processes with `TZ=UTC` and `TZ=America/Los_Angeles`                                                                                                                                      | `reproduced`, `unknown`             |
| P05 | 10000 units on the weekly period containing 2026-01-02, switch to monthly                        | {category, stored key, amount, date range before switch, date range after switch}; adoption fails if ranges differ without disclosure                                                                                                        | `source-backed analysis`, `unknown` |
| P06 | Allocation on the highest weekly ordinal of a year, switch to monthly, then back                 | {key, amount, row present?, visible under monthly? (UI source), visible after switch back?}; adoption fails if present-but-invisible without disclosure                                                                                      | `source-backed analysis`, `unknown` |
| P07 | Calendar + period allocations, disable/re-enable, `exportBudget` → `importBudget`                | {calendar rows, period rows, transaction dates, account totals} before/after each step; adoption fails on any count/amount/date change or undisclosed visibility change                                                                      | `source-backed analysis`, `unknown` |
| P08 | Fixed 5000/month template; 120000/month rent schedule; biweekly cadence                          | Calendar reference: 60000/yr and 1440000/yr. Record fork per-period and annual amounts from pinned template tests; adoption fails if annual ≠ reference without disclosure                                                                   | `source-backed analysis`, `unknown` |
| P09 | Client A: `payPeriodFrequency` weekly→monthly; client B: 10000 on key K; orders A→B, B→A, replay | Intended meaning = range K denoted when B wrote. Converged state must keep that range or surface a conflict; equal serialized values alone fail                                                                                              | `model-evidence` only               |
| P10 | Old monthly API reader and old client encounter `2026-13`; report readers                        | Record each §1 month-13 gate with anchor; old-client sync = ordinary cell apply; `budgetDataQuery` / Budget Analysis iterate calendar months so a `202613` row is silently omitted; adoption fails on any silent `Date` parse or silent zero | `source-backed analysis`, `unknown` |

Each probe asserts the observed source behavior, including known incompatibilities, so a documented limitation is a passing assertion; `compatibility.md` separately rates that behavior against adoption. Do not modify expected values to make the source pass adoption criteria.

**Task 0002** is a plan-contract comparison only, labeled `source-backed analysis`: record in `survey.md` that its plan (hash in §1) is envelope-only, current-calendar-month keyed, and excludes pay periods. Leave that folder unedited. Do not write a reservation probe while `reservations.ts` is absent, and never feed period ids into reservation math. If the 0002 plan hash changes during the study, re-read and note it.

### Decision rule and next-plan boundary

Go for a full production port is **unreachable in this study**: allocation identity, export/restore, sync and old-client evidence can only be `source-backed analysis`, `model-evidence` or `unknown`, and none of those satisfies go. The full-port result is **defer**, with `compatibility.md` listing each redesign requirement, affected owners, cost, and the integration evidence a later task would need (e.g. named Vitest files in a disposable fork checkout). A read-only planning view is eligible only as an explicitly different product option whose future plan preserves calendar-budget authority. No-port is eligible. Task 0002 remains calendar-only and must not acquire period identifiers.

1. **AFK: map one full monthly-to-pay-period read/write path.** Pin fork and ADR, write `source-manifest.json`, inspect the feature delta and target counterparts, trace an allocation from UI through storage, export/API and reports. Write `survey.md` with the owner tuple and current baseline behavior. Checkpoint: every §8 investigation path resolves; docs claims separated from verified implementation.
2. **AFK: date and allocation scenarios.** Vendor per the extraction rule; run P01–P04; then fill P05–P08 ledgers (P02 covers three-paycheck months). Record the task 0002 contract comparison. Checkpoint: each scenario has an evidence record.
3. **AFK: sync and alternatives comparison.** Build the P09 model and fill the P10 ledger. Compare full port, read-only planning and no-port forecasting against each invariant, including the cadence lifecycle class. Deliver `compatibility.md`.
4. **HITL: decision after evidence.** Present tradeoffs. A production port plan is a future task after a direction is selected. The study completes with any honest verdict.

## 11. Edge cases and failure modes

Not completion gates. Record in `compatibility.md` if encountered, attached to the nearest scenario: fake month strings accepted as dates (P10); imports that bypass validation via `IMPORT_MODE` or `api/budget-set-amount` (P10); cadence changes reducing period count and allocations beyond the new count (P05/P06); category carryover across a period boundary and cross-month bill funding (P08); offline toggles and old clients syncing unknown preference ids (P09/P10); undo of a cadence change (P07). Any required new schema or assignment authority must have an explicit compatibility/rollback design in the recommendation.

## 12. Verification plan

**Execution order (single sequence):** manifest + `survey.md` with resolved paths → P01–P04 → record → P05–P08 → record → P09–P10 → `compatibility.md`.

**Commands (from repo root):**

- `node --version` and `git status --short` (must show only `.workflow/` changes) before and after the study.
- `node --test .workflow/tasks/0005-pay-period-compatibility/probes/*.test.mjs`.
- P04 runs inside `date-ranges.test.mjs` by spawning two children (`process.execPath` with `env: { ...process.env, TZ: 'UTC' }` and `TZ: 'America/Los_Angeles'`) that print the membership map as JSON. The parent records `process.env.TZ` before and after and asserts it unchanged; a mismatch or child crash stops the log before P05.
- Optional current-tree baseline (shows monthly behavior untouched; does not prove pay-period behavior): `yarn workspace @actual-app/api run test methods.test.ts`.

**Evidence labels (exactly one per scenario):**

- `reproduced` — executed vendored pure code, asserted against an oracle fixed before first run. Only P01–P04. P05–P08 and P10 are ledgers in `compatibility.md` (template and storage code is `server/`, outside the extraction rule).
- `source-backed analysis` — reading pinned or local source/tests, with quoted path, symbol and assertion. Not a green test.
- `model-evidence` — pure model output (P09 only). Never sync proof.
- `unknown` — not observable within this plan, including harness failure.

**Evidence record per scenario** (in `compatibility.md`): `id`, `command`, `exit_code`, `node_version`, `evidence_label`, `actual`, `expected` (from an oracle not printed by the function under test), `harness_error` (empty or stderr), `compatibility_note` (the invariant violated, written while the probe still exits 0). Ledger-only scenarios record `command: n/a (source reading)` and the quoted source anchors in place of `exit_code`. `node --test` exits non-zero for both assertion and load failures; classify each as unexpected source behavior or `harness_error` — they never share a label. Manifest hash mismatch, unresolved survey paths and a non-restored `TZ` are logged separately, not as scenario outcomes.

Completion: all ten scenarios have an evidence record. `unknown` or `model-evidence` on allocation, sync, export/restore or old-client behavior completes the study and forces defer full port. No human approval is needed to finish the study or recommend deferral. No full monorepo or snapshot-update command is needed. A production port would need a new reviewed verification plan.

## 13. Documentation notes

Kept task files: `plan.md` (canonical), `progress.md` (status/log), and the §2 study deliverables `survey.md`, `compatibility.md`, `probes/` (created 2026-09-27). Plan-review workshop artifacts were absorbed into this plan and `progress.md` on 2026-09-27 and deleted. Keep study findings inside this task. `compatibility.md` must distinguish source-fork behavior, vendored adaptation, and unsupported assumptions. Only a selected and implemented product direction should later update end-user documentation. Do not advertise pay-period support from the study alone.

## 14. Open questions / missing info

No input blocks the study. Actual pay cadence and preference for true per-paycheck allocations versus a read-only planning view are needed only before product selection. Stable period identity, cadence migration and old-client authority are questions the study documents with evidence labels, not assumptions implementation may guess.
