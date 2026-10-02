# Task Progress: Explicit budget sessions, profiles, and offline mode

Current status: completed locally
Current phase: implemented and verified on Windows; unpublished

## Dependencies

Prerequisites completed locally in order: 0007 contract, 0008 harness, then 0009 sessions. No Linux or final roadmap acceptance claim.

## Human input required

None. The user authorized implementation on 2026-10-02. Personal account/export validation remains 0036.

## Implementation checklist

- [x] Review plan and preserve finance authority, compatibility, and secret boundaries.
- [x] Implement the task's complete local operation paths.
- [x] Verify unit/API boundaries and packaged disposable processes as applicable.
- [x] Document commands, limits, material decisions, and continuation points.

## Acceptance trace

| ID  | Status           | Evidence                                                                                                                                                      | Limit                                                                  |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A1  | Verified locally | Two profiles and two budgets switch through the same cache directory without mixing account results; explicit local flag suppresses inherited sync selection. | Profile files are device-local and concurrent edits use last writer.   |
| A2  | Verified locally | Stopped-server offline read/edit/read; restarted online client retains edit; second client observes it; public API loads offline with CRDT logging.           | Explicit local-only budgets still require future publication support.  |
| A3  | Verified locally | Encrypted download and post-restart write; wrong key and wrong password fail with bounded child processes; lock recovery and shutdown checks.                 | Linux execution and browser-client interoperability remain unverified. |

## Artifacts

[Implementation](implementation.md), [plan review](plan.review.md), [decisions](execution-decisions.md), and verify.json retain the detailed proof and limits.

## Agent next actions

- Review 0010-cli-runtime and 0011-cli-budget-lifecycle using the new contract/session APIs.
- Keep all other tasks behind their declared prerequisites.
- Run Linux and browser interoperability checks before final roadmap acceptance.

## Execution log

- 2026-10-02: Created the sequenced task contract. No implementation was performed at creation.
- 2026-10-02: User authorized implementation. Delivered this local prerequisite slice; checks and limits are recorded in implementation.md. Changes remain uncommitted and unpublished.
