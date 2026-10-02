# Task Progress: Preview, apply, receipts, and safe retry protocol

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0007-cli-contract](../0007-cli-contract/progress.md), [0008-cli-integration-harness](../0008-cli-integration-harness/progress.md), [0012-cli-sync](../0012-cli-sync/progress.md), [0013-cli-backups](../0013-cli-backups/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add typed changes protocol and device-local journal with bounded retention; preview/apply an existing transaction update as the first slice.
- [ ] Expose engine precondition checks and mutation outcome capture through supported API handlers; add local commit identity evidence rather than assuming UI undo or distributed atomicity.
- [ ] Add operation-status recovery after restart and post-commit sync failure; retrofit version 2 budget create/publish/rename/archive and restore/clone writes plus existing mutation adapters before dependent tools, without breaking legacy writes.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                                                      | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | A browser edit between preview and apply rejects the stale proposal after refresh; a different budget can never apply the token.                                                      | Not collected | Pending |
| A2  | Killed processes before commit, after local commit, and before sync produce recoverable receipts or an explicit uncertain state, without automatic duplicate writes.                  | Not collected | Pending |
| A3  | One existing transaction update and one allocation change pass through the protocol; preview produces no ledger/allocation/template writes and local journal retention is documented. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
