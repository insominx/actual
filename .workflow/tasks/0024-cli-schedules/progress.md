# Task Progress: Schedules, upcoming bills, and posting controls

Current status: completed locally on Linux; Windows rerun pending
Current phase: all three slices implemented and verified on Linux

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review the API Vitest recurrence discrepancy noted in implementation.md.

## Implementation checklist

- [x] Expose supported occurrence metadata/actions through API; add inspect/upcoming first.
- [x] Wrap CRUD/reset with receipt protocol and account/category validation.
- [x] Add post/skip with occurrence identity and duplicate protection; document that tools record bills and do not pay them.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                    | Evidence                                                                                          | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ |
| A1  | Month-end, leap-year, irregular recurrence, transfer schedule, and next-date reset match engine fixtures.           | `schedules-occurrences.test.mjs`, API `schedule occurrences` (`verification-schedules-linux.txt`) | Met on Linux |
| A2  | Posting then importing a matching statement transaction uses existing matching and creates no duplicate occurrence. | `schedules-occurrences.test.mjs`, API `schedule occurrences` (`verification-schedules-linux.txt`) | Met on Linux |
| A3  | Editing/deleting a schedule does not alter already posted ledger records without an explicit transaction change.    | `schedules-occurrences.test.mjs`, API `schedule occurrences` (`verification-schedules-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 02:20 PT: Implemented `schedules inspect|upcoming` and guarded `schedules.post|skip`; packaged `schedules-occurrences.test.mjs` 12/12 and API 1/1 on Linux. Decisions D1-D9. Completed locally on Linux.
