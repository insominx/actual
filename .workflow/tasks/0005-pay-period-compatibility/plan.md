Last Edited: 2026-09-27

# Plan: pay-period compatibility study before a port

Verdict: **ready for implement — study only**. Priority 4. AFK research/probes, then HITL product decision before any production redesign. No production pay-period implementation is in this task.

## 1. Current state

Current `packages/loot-core/src/shared/months.ts`, `server/budget/{base,envelope,tracking,actions}.ts`, template/schedule evaluation, API budget methods, and desktop/mobile budget navigation share calendar-month assumptions. `BalanceForecast` already offers schedule-based projections. `BudgetAnalysis` and spending comparisons consume budget amounts.

[Pinned pay-period guide](https://github.com/code-with-jov/actual-pay-periods/blob/62128aa6e24a957e1e85db2ebc7cd43fccfb995b/packages/docs/docs/experimental/pay-periods.md) documents: separate calendar/period allocations; identifiers such as `2026-13`; allocations reinterpreted when cadence changes; unavailable budget-based reports; fixed templates becoming per-period; monthly bills funded wholly in their containing period. These are known limitations, not hypothetical objections. The research also points to [layered budget assignment ADR-0006](https://github.com/lefevreste/budget-fr/blob/master/docs/budget-fr/adr/0006-layered-budget-period-assignment.md); fetch and pin its revision during the study before relying on it.

## 2. Target shape

Produce `survey.md` mapping all affected owners, `compatibility.md` with demonstrated cases and candidate designs, and reproducible synthetic probes under this task's `probes/` only. Amend this task's progress with results and a go/no-go recommendation. Do not change production code, schemas, preferences, saved budgets, or public APIs; do not create a speculative migration for live data.

Evaluate three options: selective full pay-period port with explicit period identity and allocation preservation; a read-only paycheck planning view retaining calendar budget authority; existing forecast/settings with no port. The read-only alternative is an option to assess, not an authorized replacement implementation.

## 3. Contract

- Every identified consumer has current calendar behavior, source-fork behavior, risk and preservation strategy recorded, with file/symbol evidence.
- Probes demonstrate coverage/no-overlap for weekly/biweekly/monthly anchors, year boundaries and short months, without changing transaction bank dates.
- Switching cadence or disabling cannot silently reinterpret, hide without disclosure, duplicate or lose funded amounts in any recommended production design. Prove export/restore and old-client behavior; do not call a design safe merely because amounts still exist in a table.
- Reports, templates, reservations and public API compatibility have explicit supported/unsupported outcomes and examples. Existing budget reports becoming blank is not an acceptable invisible side effect.
- Deliver a decision with maintenance scope and rollback cost. If no safe bounded design meets these constraints, recommend deferring the port instead of inventing an implementation-ready verdict.

Domain: distinguish bank date, calendar budget month, period date range, period ID, cadence configuration and allocation assignment. New period semantics are inferred until adopted. Non-goals: payroll prediction, automatic income detection, transaction date rewriting, live budget conversion, MCP or new financial advice features.

| Acceptance                                        | Evidence                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Complete consumer map                             | `survey.md` paths/symbols for core, UI, reports, templates, API/import/export/sync          |
| Date and cadence cases reproducible               | Probe command/results and table of expected/actual periods                                  |
| Allocation/sync/disable consequences demonstrated | Synthetic before/after ledgers and two-client operation-order fixtures                      |
| Actionable comparison and recommendation          | `compatibility.md` option matrix, rejected designs, remaining decisions and next task scope |

Unverified batch limit: finish one scenario family and record results before the next. Study artifacts can be reverted independently; no production rollback needed.

## 6. Dependencies and constraints

Source fork `code-with-jov/actual-pay-periods@62128aa6e24a957e1e85db2ebc7cd43fccfb995b`; inspect `shared/pay-periods.ts`, `server/budget/pay-period-config.ts`, migration/serialization paths and tests before making correctness claims. Refresh source/target overlap. Use the layered-assignment ADR as competing design evidence, not proof of compatibility. Use existing tooling and sanitized fixtures; do not access the user's budget files. No installation of alternative runtimes is assumed.

## 7. Authority and state ownership

Current calendar budget core remains the sole production authority. The study's decision point is `compatibility.md`; it must propose exactly one authority for budget period/assignment if recommending a full port. Source state: synthetic transactions/allocations and source code. Working state: isolated probe inputs. Derived state: comparison output. Persisted production state: unchanged. User selects whether paycheck cadence warrants the maintenance and any explicitly described behavior tradeoffs after the study produces concrete evidence.

## 8. Proposed approach

1. **AFK: map one full monthly-to-pay-period read/write path.** Pin source and ADR, inspect full feature delta and target counterparts, trace an allocation from UI through storage, export/API and reports. Write `survey.md`, including the current baseline regression behavior. Checkpoint: each source of truth and consumer is named; docs claims separated from verified implementation.
2. **AFK: prove calendar and allocation scenarios.** Build task-local synthetic probes from inspected source logic, retaining attribution. Cover weekly/14-day anchors, 28th–31st monthly anchors, leap day, December/January, DST-local dates, three-paycheck months, changing cadence after allocations, disabling/re-enabling, and legacy `YYYY-MM` API callers. Include fixed/schedule templates and compatibility with task 0002's calendar-only reservation contract. Checkpoint: failures and expected deltas are reproducible, not simply descriptions of source tests.
3. **AFK: sync and alternatives comparison.** Exercise concurrent cadence/allocation edits with both application orders and a stale/old client model; identify torn configuration tuples and incompatible period IDs. Compare full port, read-only planning and no-port forecasting against each invariant. Deliver `compatibility.md` with recommendation, implementation slices only if justified, and clearly identified remaining product/architecture decisions.
4. **HITL: decision after evidence.** Present the concrete tradeoffs, including preserving calendar allocations/reporting and cadence edit behavior. Create/update a production port plan only after a direction is selected; this is a future task, not permission needed to perform the study. The study itself can complete with a no-port verdict.

## 11. Edge cases and failure modes

Do not accept fake month strings as ordinary dates. Test cadence changes that reduce period count, allocations beyond the new count, imports that bypass validation, date-string timezone conversions, category carryover, cross-month bill funding, offline toggles, old clients syncing unknown configuration, and undo/export/restore. Any required new schema or assignment authority must have an explicit compatibility/rollback design in the recommendation.

## 12. Verification plan

`survey.md` references must resolve against inspected source revisions. Document the exact root command for each task-local probe; prefer Node's built-in runner for `.test.mjs` probes (`node --test .workflow/tasks/0005-pay-period-compatibility/probes/*.test.mjs`) if suitable after source inspection. Capture counts, actual/expected results and intentionally failing compatibility cases separately from harness errors. No full monorepo or snapshot-update command is needed for the study. No probes have run yet. A production port would need a new reviewed verification plan.

## 14. Open questions / missing info

No input blocks the study. Actual pay cadence and preference for true per-paycheck allocations versus a read-only planning view are needed only before product selection. Stable period identity, cadence migration and old-client authority are questions the study must resolve, not assumptions implementation may guess.
