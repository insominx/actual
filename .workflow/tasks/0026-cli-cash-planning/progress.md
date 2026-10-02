# Task Progress: Cash-planning API, targets, goals, and scenarios

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0017-cli-query](../0017-cli-query/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add typed public summary/config/project methods and expose shared functions without copying formulas into CLI.
- [ ] Add summary/get-plan/project/compare read paths with selected history and independent horizon.
- [ ] Add target/reset/goal/save via preferences authority and receipts; prove UI/API/CLI parity and unreachable/already-reached/depletion states.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                           | Evidence      | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | 1000000 cash and -200000 card yields 800000; 1200000 income and 800000 outflows over two full months average 600000/400000.                                | Not collected | Pending |
| A2  | 800000 starting cash and 2000000 goal at 200000 monthly surplus reaches the goal after six calendar forecast months; partial/leap months match UI.         | Not collected | Pending |
| A3  | A target scenario changes only target projection; save/reset round-trips to the browser and changes no transactions, allocations, templates, or schedules. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
