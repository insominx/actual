# Task Progress: Headless runtime bootstrap and server management

Current status: active
Current phase: planned; ready for review-plan after local prerequisite acceptance

## Dependencies

[0009-cli-sessions](../0009-cli-sessions/progress.md)

## Human input required

None. The user authorized implementation on 2026-10-02. Local prerequisites now pass. Reread the delivered schemas, profiles, and offline API before reviewing this plan.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add supported first-run password bootstrap at the server account boundary, reusing password hashing and validation; do not write account DB files from CLI.
- [ ] Add server lifecycle commands that invoke the packaged server, track process identity and health, and reuse OS-native hidden process behavior on Windows.
- [ ] Add doctor/connection tests and installation instructions for managed versus external services; never install Docker or a global service implicitly.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                 | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------- |
| A1  | Fresh setup starts, authenticates, reports health, restarts, and stops on Windows and Linux.                                                     | Not collected | Pending |
| A2  | An occupied port, stale PID, changed executable, or failed health check produces an actionable structured error without killing another process. | Not collected | Pending |
| A3  | Doctor distinguishes missing package/native module, wrong credentials, encryption failure, and server incompatibility while redacting secrets.   | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
