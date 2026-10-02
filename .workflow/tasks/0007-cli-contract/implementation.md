# Implementation Record

Last Edited: 2026-10-02

## Contract as-executed

- Spec source: plan.md and the user's authorization to implement the sequenced roadmap.
- Behavior delivered: Unauthenticated discovery, command/payload schemas, safe integer/date validation, and version 2 result/error envelopes. Legacy commands retain default raw output.
- Non-goals honored: no real account setup, no direct SQL tooling, no bank linking, no previews or reversal.
- Completion scope: implemented and verified locally on Windows. This is a prerequisite slice, not completion of the 30-task roadmap.

## Execution decision audit

See [execution-decisions.md](execution-decisions.md). Material choices retain pending independent review status. No independent agent review was requested or performed.

## Authority and change map (as-built)

- Owner: Commander declarations and CLI validation/output adapters.
- Decision point: input validation before connecting; budget selection before ledger access; sync-mode changes at the core API load boundary.
- Files changed: `packages/cli/src/program.ts`, `agent-contract.ts`, `json-schema.ts`, `agent-output.ts`, `index.ts`, `input.ts`, `output.ts`, `utils.ts`.
- Source state: engine ledger/preferences. Working state: one command invocation. Derived state: cache/freshness metadata. Persisted tool state: device-local profile file.
- Shared docs: packages/cli/README.md, packages/docs/docs/api/cli.md, API reference, and upcoming-release-notes/agent-cli-foundation.md.

## Acceptance / evidence

| check | status           | evidence                                                                                                                                                             | gap                                                                 |
| ----- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A1    | Verified locally | 203 CLI tests include existing command tests and raw query output; packaged legacy card balance equals {id, balance: -200000}.                                       | Not an exhaustive golden snapshot of every command.                 |
| A2    | Verified locally | program.test.ts enumerates all registered leaves without an API initialization; packaged capabilities returns schemas without configuration.                         | Rule value expressions and query expressions remain core-validated. |
| A3    | Verified locally | Single-document integration output; invalid input exit 2; authentication/lock failure exit 5; serialization checks exit 4/6; failed push unit test proves no replay. | Stale-preview is reserved; no preview operation exists yet.         |

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
