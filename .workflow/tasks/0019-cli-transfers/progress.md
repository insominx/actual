# Task Progress: Transfer candidate discovery, matching, and repair

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add public transfer inspection/candidate metadata over existing engine matching logic.
- [ ] Add match/create preview/apply with both-leg preconditions and receipts.
- [ ] Add unmatch/repair with explicit reconciled handling; test ambiguous and boundary cases with cash-planning parity.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                              | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Checking-to-savings and a card payment change neither net cash nor recorded category spending.                                                                | Not collected | Pending |
| A2  | Cash-to-equity reduces accessible cash once; matching imported opposite entries creates no duplicate money movement.                                          | Not collected | Pending |
| A3  | Multiple same-amount candidates, split transfers, missing counterparts, reconciled entries, and unmatch/repair yield documented results without orphan links. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
