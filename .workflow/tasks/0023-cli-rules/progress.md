# Task Progress: Rule testing, previews, and controlled application

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md), [0021-cli-imports](../0021-cli-imports/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Expose isolated rule test/evaluation via core/API and add test command before historical bulk apply.
- [ ] Extend CRUD and order handling with schema validation/receipts and feature-capability metadata.
- [ ] Add historical preview/apply over frozen IDs; prove parity with imports and no dry-run side effects.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                              | Evidence      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Sample merchant categorization test matches import execution without creating payees or modifying rule learning.              | Not collected | Pending |
| A2  | Ordered overlapping rules and split/formula/delete actions preview the same result as apply.                                  | Not collected | Pending |
| A3  | Invalid definitions, stale rule versions, reconciled candidates, and unavailable experimental features return precise errors. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
