# Task Progress: Allocations, carryover, templates, and reservations

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0018-cli-transactions](../0018-cli-transactions/progress.md), [0024-cli-schedules](../0024-cli-schedules/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Extend monthly budget DTOs and add multi-category allocation preview/apply via existing batch semantics, disclosing any non-atomic outcomes.
- [ ] Expose template inspect/validate/dry-run/apply through typed public API and receipt protocol.
- [ ] Expose budget/get-reservations as read-only API/CLI; test separation from planning targets and preserve experimental preference semantics.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                              | Evidence      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | An allocation transfer preserves total budgeted amount and survives reload/sync; insufficient-funding behavior is explicit.   | Not collected | Pending |
| A2  | Template preview and apply agree on supported fixed/scheduled/formula cases without writing during preview.                   | Not collected | Pending |
| A3  | Reservation breakdown agrees with the browser and updates after payment/undo; unsupported budget modes/features fail clearly. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
