# Task Progress: Read-only query metadata, search, paging, and aggregation

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Expose read-only schema metadata through the public API and replace TABLE_SCHEMA consumers.
- [ ] Add bounded query execution, stable sorting/paging, and context-aware entity lookup with ambiguity results.
- [ ] Add documented aggregate recipes and tests; explicitly reject SQL writes and avoid deriving cash-planning formulas here.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                       | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------- |
| A1  | All exposed fields/operators validate against core schema; unsupported expressions return structured errors.                                           | Not collected | Pending |
| A2  | Pagination with equal dates has deterministic ID tie-breaking and discloses concurrent snapshot changes.                                               | Not collected | Pending |
| A3  | A split, refund, uncategorized transaction, opening balance, and transfer aggregate matches engine fixtures; query execution creates no ledger writes. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
