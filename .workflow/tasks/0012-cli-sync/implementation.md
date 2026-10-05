# Synchronization implementation record

Last Edited: 2026-10-03

Status: completed locally on Windows. The full CLI goal remains open. Linux package/signal coverage remains final acceptance work.

## Final synchronization acceptance — 2026-10-03

A1 now passes with a production browser build served by a disposable sync server. UI login and budget selection open the actual browser backend. A CLI import reaches the browser and another CLI cache. Browser transaction edits, preference changes, and undo converge in both caches. The final imported transaction remains unique. The initial browser probe failed on the preference assertion because it sent the wrong handler input; using the existing id/value contract and checking the browser preference before sync resolved the fixture error.

A3 now includes profile switching while watch is live. The active watch retains its original resolved budget while a separate command selects and refreshes another budget in the same cache directory. Both offline statuses retain distinct identities, zero pending messages, and their own observed timestamps. An invalid sync ID now returns a permanent context error instead of retrying. The first invalid-ID probe timed out under retry before this worker classification fix.

Evidence: verification-acceptance-2026-10-03.json passed CLI units, root typecheck, CLI/API/server/browser builds, 15 packaged integration tests, browser convergence, and formatting. That run failed lint only on missing loop braces in the new browser test. Braces and browser cleanup were fixed; verification-acceptance-fixes-2026-10-03.json then passed browser convergence, lint, and formatting. The dependency lock change adds the already-installed Playwright test version to CLI development dependencies; no production dependency changed.

All A1-A3 have Windows proofs. Decisions remain pending independent review. No personal adoption or Linux execution is claimed. The next task is backup/restore.

Final watch verification passed all seven checks: 211 CLI tests, root typecheck, CLI/API dependency build, packaged server build, 14 integration tests, targeted lint, and formatting. Evidence: verification-watch-final-2026-10-03.json. git diff --check passed. API/server/browser source was unchanged in this checkpoint; their earlier unit and browser build evidence remains separate.

## Watch and post-write failure checkpoint — 2026-10-03

Added sync watch with bounded polling, capped retry backoff, stable identity checks, worker deadlines, Ctrl+C/SIGTERM listeners, and cancellation via a stdin line. Progress events go to stderr; one bounded version 2 result contains observations. Each worker uses the existing public API and connection path. Resolved credentials cross stdin, not argv. Dead shared reader markers are recovered by the existing writer lock owner after forced worker termination.

Failed pushes now invalidate the cache checkpoint and report unknown freshness while retaining committed-local. The proxy detects outgoing CRDT message envelopes and rejects writes after an online local commit. Plaintext and encrypted fixtures both retain pending writes, then refresh them without replaying the account creation. An independent cache observes exactly one new account.

Real watch probes passed encrypted server restart/reconnect, cancellation between polls, timeout while a sync request stalls, cancellation during an active stalled request, and successful subsequent writer acquisition. Assertion inversion made both new watch tests fail at their observed cancellation/timeout checks. Restored assertions before final verification. A watch-schema validation test initially failed because configuration was resolved before invalid counts were checked; validation now precedes configuration access.

The first watch verifier passed all 14 packaged tests but failed typecheck and lint. Duplicate numeric bounds, missing braces, import aliases, and empty cancellation callbacks were corrected. Its report remains historical evidence at verification-watch-2026-10-03.json. The final rerun is verification-watch-final-2026-10-03.json.

Task A2 has real online post-write failure and retry proof, including encryption. Task A3 has worker/reconnect/cancellation proof; expanded budget-switch coverage remains. A1 still needs actual browser import/edit/preference/undo convergence. Linux signal behavior and packaging remain final acceptance. This was an earlier checkpoint; final local acceptance is recorded above. The full CLI goal remains open.

## Contract and authority

Source: plan.md. The first checkpoint exposes getSyncStatus through the public API and engine handler. Core sync owns message counts and checkpoint interpretation. The CLI reads this result without accessing SQLite directly.

Offline sync status reports identities, message candidates after lastSyncedTimestamp, deferred received schema gaps, and unknown remote freshness. Online sync refresh synchronizes existing writes. Required-fresh reads force synchronization before returning results and reject offline mode. No mutation is replayed by refresh.

Connection cache locks now remain held through shutdown. These locks are device-local, not distributed. Existing legacy sync/cache commands retain their names and output defaults. New sync operations use version 2 output.

## Decision audit

See execution-decisions.md for checkpoint ownership, explicit offline inspection, and shutdown lock lifetime. These choices await independent review.

## Evidence and verification

Final sequential verification passed all ten checks. Evidence: verification-2026-10-03.json. Totals: 37 API tests, 210 CLI tests, 74 focused server tests, and ten packaged integration tests. Root typecheck, CLI/API/server/browser builds, targeted lint, and formatting passed. Required-fresh remote reads observe another client's rename and fail when the server is unavailable. git diff --check passed.

- Public API test was red before getSyncStatus existed. All 37 API tests then passed, including read-only unpublished status and unchanged balances.
- Both packaged status/refresh tests passed with a stopped server, offline rename, stable pending counts, server restart, and an independent remote reader. Plaintext and encrypted sessions passed.
- Inverting the initial pending-count assertion to -1 made both tests fail at the assertion. Restored the expected zero before final checks.
- 208 CLI tests, root typecheck, and rebuilt CLI/API passed before adding the required-fresh flag and shutdown lock fix. The final verifier reruns affected checks sequentially.
- First direct integration attempt failed because root typecheck had emitted nonbundled server files into build/. Rebuilding the server with Vite restored packaged execution. The verifier builds after typecheck.
- Required-fresh tests now check unavailable-server failure and observation of an independent client's newer rename.

## Acceptance limits

| Check | State               | Remaining evidence                                                                               |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------ |
| A1    | Verified on Windows | Production browser plus two CLI caches converge after import/edit/preferences/undo               |
| A2    | Verified on Windows | Plaintext/encrypted post-write faults preserve pending writes; refresh yields one remote account |
| A3    | Verified on Windows | Encrypted reconnect/cancellation/timeout and distinct identities across live profile switching   |

## Resume

Local synchronization acceptance is complete. Continue in task 0013 with isolated backup validation and restore. Linux packaging/signal behavior remains final CLI acceptance. No personal budgets are used.
