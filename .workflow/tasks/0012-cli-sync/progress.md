# Task Progress: Synchronization freshness, pending writes, and watch

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md), [0011-cli-budget-lifecycle](../0011-cli-budget-lifecycle/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Extend connection/cache result metadata and sync status around actual engine sync outcomes; add fresh-read tests.
- [ ] Add pending-write status and retry-only-sync paths; preserve encrypted key registration on reopen.
- [ ] Add cancellable watch and two-client/browser probes; document that CLI cache locks do not serialize remote browser clients.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                    | Evidence      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Two independent caches and a browser converge after import, edit, preference change, and undo.                                      | Not collected | Pending |
| A2  | A post-write network failure reports committed-local/pending-sync and a later sync sends the existing write without reexecuting it. | Not collected | Pending |
| A3  | Watch reconnects and exits on cancellation; cache age/identity remain correct across budget switching and encryption.               | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
