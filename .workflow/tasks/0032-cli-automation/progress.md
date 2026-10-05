# Task Progress: Saved jobs, file intake, and unattended execution

Current status: completed on Linux; Windows Task Scheduler dry-run done on liftoff (recipe only, no /Create)
Current phase: three slices implemented and verified on Linux

## Dependencies

[0031-cli-workflows](../0031-cli-workflows/progress.md), [0030-cli-bank-sync](../0030-cli-bank-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Add typed saved-job config and bounded run-once CLI entry over workflow runner.
- [x] Add stable-file watch, overlap locks, hash checks, and explicit inbox/processed/error path boundaries.
- [x] Add scheduler integration examples and local result artifacts; require separate user configuration for external notifications.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                 | Evidence                                                                  | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------ |
| A1  | Repeated and partially written files import once or remain pending; same file deliberately targeted to another account requires explicit policy. | `jobs.test.mjs`, `src/jobs.test.ts` (`verification-automation-linux.txt`) | Met on Linux |
| A2  | Two simultaneous job invocations produce one active run; crashes resume without replaying committed steps.                                       | `jobs.test.mjs`, `src/jobs.test.ts` (`verification-automation-linux.txt`) | Met on Linux |
| A3  | Dry-run jobs show effects; disable cancels future runs; Windows/Linux scheduler examples pass disposable execution checks.                       | `jobs.test.mjs`, `src/jobs.test.ts` (`verification-automation-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 03:54 PT: Implemented `jobs create|list|status|run|disable|enable|schedule` over the 0031 intake workflow with stable-file intake, hash/account/settings dedupe, declared-directory moves, overlap lock, resume, dry run and local results. Packaged `jobs.test.mjs` 1/1 and unit 2/2 (CLI unit 327) on Linux; Windows Task Scheduler execution pending. Decisions D1-D11. Completed locally on Linux.
- 2026-10-05 09:55 PT: Windows `jobs schedule` dry-run on liftoff — schtasks recipe printed; `/Create` not executed; task absent (`verification-scheduler-windows.txt`).
