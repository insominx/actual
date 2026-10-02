# Task Progress: Receipt-based reversal and recovery workflows

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md), [0021-cli-imports](../0021-cli-imports/progress.md), [0022-cli-reconciliation](../0022-cli-reconciliation/progress.md), [0025-cli-budgeting](../0025-cli-budgeting/progress.md), [0026-cli-cash-planning](../0026-cli-cash-planning/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Define per-operation inverse capability in registry and add inverse preview for supported field updates.
- [ ] Add core/API postcondition checks and compensating application with fresh receipt identity.
- [ ] Add recovery diagnostic paths for uncertain operations and isolated backup comparison; document retained-history limits.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                     | Evidence      | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Categorization, allocation, and cash-target reversals restore supported fields without touching later unrelated edits.                               | Not collected | Pending |
| A2  | Concurrent changes, modified transfer legs, and reconciliation locks reject unsafe inverses.                                                         | Not collected | Pending |
| A3  | Restart/retry preserves reversal identity; unsupported merge/import recovery never claims universal undo or silently restores an entire live budget. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
