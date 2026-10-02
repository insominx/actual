Last Edited: 2026-10-02

# Plan Review: CLI schemas, discovery, and compatibility

## Result

- Status: completed
- Phase: review-plan
- Verdict: proceed after minor edits
- Reviewed artifact: plan.md
- Human action needed: none
- Review provenance: coordinator self-review; no independent review claimed.

## Restated contract

- Behavior: Unauthenticated discovery, command/payload schemas, safe integer/date validation, and version 2 result/error envelopes. Legacy commands retain default raw output.
- Non-goals: no real personal budgets, no direct ledger access, no previews or receipts before 0014.
- Risk profile: public CLI compatibility, session selection, filesystem lifecycle, and synchronization.
- Preserved invariants: integer cents; finance authority stays in core; legacy output remains the default; secret references stay device-local.

## Acceptance / evidence

Checks A1-A3 map to the existing plan and the implementation record. Evidence uses focused CLI/API tests and packaged disposable child processes.

## Findings

### Blockers

None for local implementation.

### Major

Offline writes must enter the core sync log. A ledger-only write is insufficient proof. The session test checks another client's result after reconnect.

### Minor

Linux execution requires a separate platform. Record this gap beside local completion and retain it for 0034/0035.

## Suggested plan edits

Use Commander declarations as discovery authority. Keep expression semantics in the engine. Buffer output until execution/cleanup completes. Defer enriched domain output and receipts to their declared tasks.

## Change-window assessment

Complete discovery/validation first, then real process fixtures, then offline/encrypted profiles. Share API/type edits sequentially. Preserve prior uncommitted cash-planning work.

## Verification outline

CLI unit tests, full API tests for the load option, root types, targeted lint/format, uncached packaged builds, and real integration tests. No personal exports or Linux proof.

## Risks / unresolved

Operational metadata is not a durable mutation receipt. Reversal and exactly-once delivery are not claimed.
