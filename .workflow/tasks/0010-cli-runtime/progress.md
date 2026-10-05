# Task Progress: Headless runtime bootstrap and server management

Current status: completed-locally (Windows; Linux acceptance pending)
Current phase: implementation and local verification complete

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md)

## Human input required

None. The user authorized implementation on 2026-10-02. Local prerequisites now pass. Reread the delivered schemas, profiles, and offline API before reviewing this plan.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Add supported first-run password bootstrap at the server account boundary, reusing password hashing and validation; do not write account DB files from CLI.
- [x] Add server lifecycle commands that invoke the packaged server, track process identity and health, and reuse OS-native hidden process behavior on Windows.
- [x] Add doctor/connection tests and installation instructions for managed versus external services; never install Docker or a global service implicitly.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                 | Evidence                               | Status                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------- |
| A1  | Fresh setup starts, authenticates, reports health, restarts, and stops on Windows and Linux.                                                     | [implementation.md](implementation.md) | Windows verified; Linux pending |
| A2  | An occupied port, stale PID, changed executable, or failed health check produces an actionable structured error without killing another process. | [implementation.md](implementation.md) | Verified locally                |
| A3  | Doctor distinguishes missing package/native module, wrong credentials, encryption failure, and server incompatibility while redacting secrets.   | [implementation.md](implementation.md) | Verified locally                |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.

- 2026-10-02: Delivered managed lifecycle, bootstrap, and diagnostics. Seven verification commands passed. See implementation.md for Linux and browser limits.
