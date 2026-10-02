# Task Progress: Shared reconciliation authority and statement workflows

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0021-cli-imports](../0021-cli-imports/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Move existing helpers into core/API with UI parity tests; preserve current UI date behavior while adding explicit statement cutoff to new API.
- [ ] Add prepare/status/clear and zero-difference finish with engine preconditions and receipts.
- [ ] Add explicit adjustment/unlock and statement result export; test stale candidates, future dates, closed accounts, and browser parity.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                        | Evidence      | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | CLI and existing UI current-balance reconciliation produce identical cleared balances/locks for splits and transfers.                   | Not collected | Pending |
| A2  | Statement-date cutoff excludes later entries; nonzero difference and stale proposed transaction set cannot finish.                      | Not collected | Pending |
| A3  | Adjustment receipt, explicit unlock, cancellation, and last_reconciled metadata survive reload/sync without changing unrelated records. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
