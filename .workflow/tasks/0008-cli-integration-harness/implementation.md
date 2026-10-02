# Implementation Record

Last Edited: 2026-10-02

## Contract as-executed

- Spec source: plan.md and the user's authorization to implement the sequenced roadmap.
- Behavior delivered: A real packaged CLI, temporary server, synthetic budgets, two cache directories, restart hooks, and killed-reader lock fixtures.
- Non-goals honored: no real account setup, no direct SQL tooling, no bank linking, no previews or reversal.
- Completion scope: implemented and verified locally on Windows. This is a prerequisite slice, not completion of the 30-task roadmap.

## Execution decision audit

See [execution-decisions.md](execution-decisions.md). Material choices retain pending independent review status. No independent agent review was requested or performed.

## Authority and change map (as-built)

- Owner: Test-only child-process harness; production API/core/server remain authoritative.
- Decision point: input validation before connecting; budget selection before ledger access; sync-mode changes at the core API load boundary.
- Files changed: `packages/cli/integration/harness.mjs`, `seed.mjs`, `hold-lock.mjs`, `cli.test.mjs`, `packages/cli/package.json`.
- Source state: engine ledger/preferences. Working state: one command invocation. Derived state: cache/freshness metadata. Persisted tool state: device-local profile file.
- Shared docs: packages/cli/README.md, packages/docs/docs/api/cli.md, API reference, and upcoming-release-notes/agent-cli-foundation.md.

## Acceptance / evidence

| check | status           | evidence                                                                                                                                                           | gap                                             |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| A1    | Verified locally | Packaged CLI lists signed account balances and imports normalized JSON through the running server.                                                                 | Institution exports are not covered.            |
| A2    | Verified locally | Independent caches exchange edits; stopped/restarted server retains data; killed shared reader releases contention; fixture cleanup removes temporary directories. | No browser-client or Linux process proof.       |
| A3    | Verified locally | Harness strips all inherited ACTUAL_* variables, uses private temporary directories and explicit disposable credentials; discovery does not load config.           | Dependency source-map warnings remain baseline. |

## Verification record

- CLI unit suite: 203 tests, 13 files passed on 2026-10-02.
- API suite: 29 tests passed after the explicit offline-load change.
- Root yarn typecheck passed across affected packages.
- Uncached CLI/core/API build and sync-server build passed.
- Packaged integration suite: 3 tests passed, including wrong-password handling and separate real servers for encrypted and unencrypted budgets.
- workflow-verify for 0009 with profile delivery passed all five checks: uncached CLI/core/API build, server build, packaged integration, targeted lint, and targeted formatting on 155 files.
- Final verification used Windows, Node v26.3.0, and Yarn 4.17.1. Diff whitespace checks passed.
- workflow-status found no folder conflicts or unnumbered tasks. Its three closeout warnings identify these completed local tasks awaiting later distillation; no task folders were moved.
- Dependency source-map warnings for installed cosmiconfig/chevrotain are baseline and do not fail tests.
- No repository-wide full test suite, Linux execution, browser-client interoperability, or personal-data validation claimed. Browser UI was not changed by this CLI slice.

## Change control record

- Checkpoints: red discovery module test; passing local contract; passing real import/restart; failing offline reconnect; core fix and passing API regression; final packaged session proof.
- Feature/refactor combination: entrypoint extraction was required for declaration-driven discovery. Debug-only SQL probes were removed.
- Diff reviewability: prior cash-planning edits remain separate and unchanged by this work.
- Publication: uncommitted; no PR or deployment.

## Discovered risks / debt

| finding                                                                                        | severity             | recommendation                                                                                        |
| ---------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| A successful local mutation can precede a failed push.                                         | material             | Exit 6 requires sync recovery, not mutation replay; finish receipt protocol in 0014.                  |
| Profile writes do not serialize across processes.                                              | limited              | Keep last-writer behavior documented; add profile locking if concurrent management becomes necessary. |
| Cross-platform process behavior is not yet proven.                                             | material for release | Run Linux checks in 0034/0035.                                                                        |
| CLI-wide capability metadata describes possible command behavior, not each option combination. | limited              | Refine option-specific sync capabilities in 0012.                                                     |

## Resume anchors

- packages/cli/src/program.ts and agent-contract.ts define discovery.
- packages/cli/integration/cli.test.mjs proves engine/server behavior.
- packages/cli/README.md documents exact invocation and build order.
- 0010-cli-runtime and 0011-cli-budget-lifecycle may now be reviewed for local implementation. Remaining tasks retain their prerequisites.
