# Task Progress: Schedules, upcoming bills, and posting controls

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Expose supported occurrence metadata/actions through API; add inspect/upcoming first.
- [ ] Wrap CRUD/reset with receipt protocol and account/category validation.
- [ ] Add post/skip with occurrence identity and duplicate protection; document that tools record bills and do not pay them.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                    | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Month-end, leap-year, irregular recurrence, transfer schedule, and next-date reset match engine fixtures.           | Not collected | Pending |
| A2  | Posting then importing a matching statement transaction uses existing matching and creates no duplicate occurrence. | Not collected | Pending |
| A3  | Editing/deleting a schedule does not alter already posted ledger records without an explicit transaction change.    | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
