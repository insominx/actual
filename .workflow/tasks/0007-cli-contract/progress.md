# Task Progress: CLI schemas, discovery, and compatibility

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

| ID  | Status           | Evidence                                                                                                                                                             | Limit                                                               |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A1  | Verified locally | 203 CLI tests include existing command tests and raw query output; packaged legacy card balance equals {id, balance: -200000}.                                       | Not an exhaustive golden snapshot of every command.                 |
| A2  | Verified locally | program.test.ts enumerates all registered leaves without an API initialization; packaged capabilities returns schemas without configuration.                         | Rule value expressions and query expressions remain core-validated. |
| A3  | Verified locally | Single-document integration output; invalid input exit 2; authentication/lock failure exit 5; serialization checks exit 4/6; failed push unit test proves no replay. | Stale-preview is reserved; no preview operation exists yet.         |

## Artifacts

[Implementation](implementation.md), [plan review](plan.review.md), [decisions](execution-decisions.md), and verify.json retain the detailed proof and limits.

## Agent next actions

- Review 0010-cli-runtime and 0011-cli-budget-lifecycle using the new contract/session APIs.
- Keep all other tasks behind their declared prerequisites.
- Run Linux and browser interoperability checks before final roadmap acceptance.

## Execution log

- 2026-10-02: Created the sequenced task contract. No implementation was performed at creation.
- 2026-10-02: User authorized implementation. Delivered this local prerequisite slice; checks and limits are recorded in implementation.md. Changes remain uncommitted and unpublished.
