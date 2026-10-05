Last Edited: 2026-10-03

# Plan Review: Preview, apply, receipts, and safe retry protocol

## Result

- Status: completed.
- Phase: review-plan.
- Verdict: proceed after minor edits. The implementation addendum in plan.md resolves the concrete boundary and journal choices before code starts.
- Scope: task 0014 only; no production changes in this review.

## Contract / scope

- Typed domain previews identify the exact budget, affected records, before/after values, side effects, and operation ID.
- Apply refreshes online state and checks preconditions inside the core mutation boundary.
- Device-local receipts distinguish prepared, committed-local, synced, failed-before-commit, and uncertain outcomes. Repeated uncertain IDs never replay writes automatically.
- First prove transaction update and allocation change. Then retrofit version 2 lifecycle and existing writes without changing legacy behavior.
- Non-goals: distributed exactly-once execution, browser locks, universal undo, and arbitrary atomic API batches.
- Risk: financial data writes, linked/split transactions, refresh races, private journal contents, process death, and post-commit sync failure.

## Acceptance / evidence

| Check                   | Status  | Required proof                                                                                                                                                                                                     | Gap                                                                         |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| A1                      | Planned | A real browser writes between preview and apply; refresh rejects the affected proposal. Another selected budget rejects the same token.                                                                            | No new mutation tests or handlers yet.                                      |
| A2                      | Planned | Deterministic child-process termination before engine call, after local commit, and before synchronization. Inspect journal and independent ledger after restart; repeat the same ID and prove no duplicate write. | Must capture the exact phase before killing; do not use timing alone.       |
| A3                      | Planned | Transaction update and allocation change through supported APIs and packaged CLI. Compare ledger, allocations, templates, and schedules before/after preview.                                                      | Need declared side effects and affected fingerprints from engine authority. |
| Lifecycle compatibility | Planned | Version 2 create/publish/rename/archive/clone/restore and existing mutation adapters receive receipts; legacy output stays compatible.                                                                             | This remains explicit task scope after the first proof.                     |

## Findings

### Blockers

None after the implementation addendum is applied. Prerequisite 0013 now has all ten Windows regression checks and A1-A3 acceptance evidence. User authorization covers synthetic implementation.

### Major

1. runMutator is sequential, not an arbitrary database transaction. api.ts withMutation calls runMutator, while batchMessages commits gathered CRDT messages through the existing sync owner. A guarded API wrapper must not call another withMutation wrapper from inside runMutator: that can queue behind itself. Reuse an owned implementation function within one wrapper.
2. Transaction updates read grouped rows and use updateTransaction/ungroupTransactions before transactions-batch-update. A fingerprint of one field would miss linked or split effects. Preview must capture the canonical affected closure and reference/configuration preconditions required by the existing owner. No CLI reconstruction of split or transfer business rules.
3. A receipt written after an engine reply cannot prove what happened if the process dies before that write. Persist uncertain apply intent before issuing the call. Preserve uncertain state after an interrupted call; matching after-values alone do not prove this operation caused a write. Do not add a competing ledger persistence path to make an unsupported guarantee.
4. withConnection pushes automatically after its callback and currently exposes context but no journal phase callbacks. The executor must persist the local outcome before sync and persist sync outcome afterward. Keep the existing session lock through shutdown; do not place a second API lifecycle inside the executor.

### Minor

Journal retention must preserve unresolved receipts and document private before/after values. An inventory or receipt list must expose truncation. --no-lock cannot provide the protocol's same-cache serialization; reject it for protected version 2 execution rather than claim the lock is active.

### Nits

The previous progress text said implementation needed new authorization. The active CLI goal already authorizes it.

## Suggested plan edits

Add the explicit mutation-boundary, uncertainty, phase-checkpoint, journal-retention, and version 2 compatibility details below section 8. These refine the existing contract and preserve all A1-A3 requirements and lifecycle adapters.

## Change-window assessment

Implement one typed transaction path with core preconditions and CLI journal together, then verify before allocation and lifecycle adapters. Keep unrelated refactoring separate. The repo already contains an uncommitted foundation batch; use focused owner checks and durable evidence rather than resetting it.

## Verification outline

- Core/API tests: stale and wrong budget, malformed proposal, split/linked closure, mutation rejection, no-op, and owner-calculated effects.
- CLI unit tests: journal schema, exact operation identity, collision, atomic durable writes, stale preview, unresolved retention, and bounded list/status.
- Packaged integration: preview preservation, apply/repeat, restart, local commit then sync failure, and deterministic killed-process cases.
- Browser integration: stale preview after a real browser edit and refresh; test the unchanged/unrelated record case as applicable.
- Root typecheck, focused lint/format, rebuild dependencies/server/browser in the correct order, then packaged acceptance.
- Evidence: record IDs, phases, journal states, independent ledger values, and exact terminal process results. No real personal budget data.

## Risks / unresolved

Remote edits arriving after refresh cannot be globally serialized by the CLI lock. Explicitly report observed preconditions rather than a distributed transaction. Linux acceptance remains later roadmap work. No implementation or feature verification is claimed by this review.

## Next best action

Implement and verify the typed transaction update proposal and durable journal as the first slice. Keep preview/receipt capabilities unavailable for unsupported operations.

## Resume anchors

plan.md section 8; core api.ts withMutation and api/transaction-update; server/mutators.ts runMutator; sync/index.ts batchMessages/_sendMessages; public methods.ts; CLI connection.ts; browser-sync.test.mjs and disposable harness.
