# Task Progress: category reservation breakdown

Current status: active
Current phase: planning complete — ready for review-plan; implementation not started

## Human input required

- None for the bounded current-month, read-only port.

## Agent next actions

- [ ] Review `plan.md` accounting and lifecycle contract before implementation.

## Implementation checklist

- [ ] Record pinned source/target diff, attribution, supported template map and read-only event owners.
- [ ] Add `reservations.ts`, shared result types and pure tests for full claims, allowance, negative spare, rounding and currencies.
- [ ] Adapt read-only schedule/template extraction and `budget/get-reservations`; verify no writes and category-level unavailable results.
- [ ] Add the disabled-by-default feature flag, budget-scoped batch hook and desktop balance-menu panel; prove complete first slice.
- [ ] Add mobile panel and invalidation for edits, undo, sync, month rollover and budget switches; prove no listener growth or stale response.
- [ ] Add user documentation/release note and run the focused core, hook, component/browser and type checks specified in the plan.

## Acceptance trace

| Acceptance                    | Planned proof                         | Evidence                                             | Status  |
| ----------------------------- | ------------------------------------- | ---------------------------------------------------- | ------- |
| Decomposition and deficits    | Pure fixtures from plan               | Pinned source/tests inspected                        | Pending |
| Correct cycle and no mutation | Core handler integration tests        | Current template owners inspected                    | Pending |
| Stable live updates           | Hook tests and two-tab smoke          | Existing schedule regression passes; new hook absent | Pending |
| Desktop/mobile and off switch | Component/e2e + manual privacy checks | Plan only                                            | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material implementation decisions or plan deviations. Otherwise record `Decision audit: none material` in implementation notes.

## Execution log

- 2026-09-27 — Created from fork assessment; pinned source and resolved documentation/code discrepancy in the planned contract. No feature code written.
