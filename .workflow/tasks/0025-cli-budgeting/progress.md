# Task Progress: Allocations, carryover, templates, and reservations

Current status: completed locally on Linux; Windows rerun pending
Current phase: all three slices implemented and verified on Linux

## Dependencies

[0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0018-cli-transactions](../0018-cli-transactions/progress.md), [0024-cli-schedules](../0024-cli-schedules/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review D3 (insufficient-funds refusal) and D6 (skipped invalid templates are listed, not blocking).

## Implementation checklist

- [x] Extend monthly budget DTOs and add multi-category allocation preview/apply via existing batch semantics, disclosing any non-atomic outcomes.
- [x] Expose template inspect/validate/dry-run/apply through typed public API and receipt protocol.
- [x] Expose budget/get-reservations as read-only API/CLI; test separation from planning targets and preserve experimental preference semantics.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                              | Evidence                                                                          | Status       |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ |
| A1  | An allocation transfer preserves total budgeted amount and survives reload/sync; insufficient-funding behavior is explicit.   | `budgeting.test.mjs`, API `allocation moves` (`verification-budgeting-linux.txt`) | Met on Linux |
| A2  | Template preview and apply agree on supported fixed/scheduled/formula cases without writing during preview.                   | `budgeting.test.mjs`, API `allocation moves` (`verification-budgeting-linux.txt`) | Met on Linux |
| A3  | Reservation breakdown agrees with the browser and updates after payment/undo; unsupported budget modes/features fail clearly. | `budgeting.test.mjs`, API `allocation moves` (`verification-budgeting-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 02:47 PT: Implemented guarded `budgets.move` and `budgets.apply-templates`, `budgets templates` and `budgets reservations`; packaged `budgeting.test.mjs` 8/8 and API 1/1 on Linux. Decisions D1-D8. Completed locally on Linux.
