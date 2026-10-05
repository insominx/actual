# Task Progress: Shared reconciliation authority and statement workflows

Current status: completed locally on Linux; Windows rerun pending
Current phase: all three slices implemented and verified on Linux

## Dependencies

[0021-cli-imports](../0021-cli-imports/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review D2 (UI still uses its own helper; switching it to the core read is open).

## Implementation checklist

- [x] Move existing helpers into core/API with UI parity tests; preserve current UI date behavior while adding explicit statement cutoff to new API.
- [x] Add prepare/status/clear and zero-difference finish with engine preconditions and receipts.
- [x] Add explicit adjustment/unlock and statement result export; test stale candidates, future dates, closed accounts, and browser parity.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                        | Evidence                                                                                  | Status       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------ |
| A1  | CLI and existing UI current-balance reconciliation produce identical cleared balances/locks for splits and transfers.                   | `reconciliation.test.mjs`, API `reconciliation` (`verification-reconciliation-linux.txt`) | Met on Linux |
| A2  | Statement-date cutoff excludes later entries; nonzero difference and stale proposed transaction set cannot finish.                      | `reconciliation.test.mjs`, API `reconciliation` (`verification-reconciliation-linux.txt`) | Met on Linux |
| A3  | Adjustment receipt, explicit unlock, cancellation, and last_reconciled metadata survive reload/sync without changing unrelated records. | `reconciliation.test.mjs`, API `reconciliation` (`verification-reconciliation-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 02:47 PT: Implemented `reconcile status` with statement cutoff, guarded `reconcile.finish` over the frozen candidate set and guarded `reconcile.adjust`; packaged `reconciliation.test.mjs` 7/7 and API 1/1 on Linux. Decisions D1-D7. Completed locally on Linux.
