# Implementation Record

Last Edited: 2026-10-02

## Contract as-executed

Delivered `server init/start/status/stop/logs/bootstrap`, `doctor`, and `connection test` through version 2 discovery and output. Bootstrap uses the existing server account endpoint. Managed servers bind to loopback and run in hidden Windows processes. Linux execution remains unverified.

## Execution decision audit

See [execution-decisions.md](execution-decisions.md). Material choices include a private supervisor control endpoint, executable hashing, instance-specific health checks, bounded redacted lifecycle logs, and uncertain shutdown outcomes. Windows verification does not establish Linux acceptance.

## Authority and change map

- Server account handlers own password bootstrap; the CLI does not write account databases.
- `packages/cli/src/server-runtime.ts`, `runtime-state.ts`, and `server-runner.ts` own device-local process management and identity validation.
- `packages/sync-server/src/app.ts` adds an optional managed instance identifier to health responses.
- `commands/diagnostics.ts` and `server-http.ts` implement bounded diagnostics and redacted failures.
- Command registration, discovery, package entry points, docs, and release notes describe the delivered interface.
- Disposable integration fixtures and focused diagnostic tests prove the process boundaries. No personal budget was used.

## Acceptance / evidence

| Check | Status                            | Evidence                                                                                                                                                | Gap                                          |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A1    | Verified on Windows               | Packaged fresh bootstrap/authentication and managed start/restart/stop tests pass.                                                                      | Linux is not verified.                       |
| A2    | Verified on Windows               | Occupied port, tampered token/PID, changed executable, and failing startup tests pass. Foreign services remain running.                                 | Other operating systems are not verified.    |
| A3    | Verified for exercised boundaries | Real wrong-password and encryption failures; focused incompatible-server/native-module tests; missing package handling. Outputs exclude tested secrets. | A broken Node launcher cannot emit CLI JSON. |

## Verification record

`workflow-verify --task 0010-cli-runtime --json` passed all seven checks on 2026-10-02:

- CLI unit tests: 204 tests across 14 files.
- Root type checking.
- Uncached CLI/API/core build and sync-server build.
- Five packaged integration tests, including bootstrap and managed lifecycle.
- Targeted lint and formatting.

Earlier failures in changed code were fixed. Broad CLI formatting also found an untouched baseline failure in `packages/cli/tsconfig.json`; final formatting targets delivered files. The installed cosmiconfig source-map warning remains. Browser interoperability and repository-wide tests were not run for this slice.

## Change control record

Initial bootstrap acceptance failed with an unknown command, then passed after implementation. Disabling native-module classification made its diagnostic test fail; restoring classification passed. Health checks now correlate the managed server instance, preventing a competing Actual server from being mistaken for the owned child. Generated build artifacts are not edited or committed.

Earlier checkpoints are committed as `68ffdbe3b` (cash planning) and `74cc213b3` (CLI discovery/sessions). This runtime slice is locally verified and remains uncommitted at this record.

## Discovered risks / debt

- Run Linux lifecycle acceptance before cross-platform release.
- Stop managed servers before replacing their configured executable. Hash mismatches deliberately prevent control actions.
- Managed mode requires a sync-server build with the instance identifier in `/health`.
- An unconfirmed shutdown reports partial completion. Inspect status before retrying.
- Device-local ownership files rely on the operating system user boundary; this is not a distributed service manager.

## Resume anchors

Next prerequisite: [0011 budget lifecycle](../0011-cli-budget-lifecycle/plan.md). The managed runtime is usable for disposable Windows development. Final packaging and browser interoperability remain in downstream acceptance tasks.
