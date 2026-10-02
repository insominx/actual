# Task Progress: Saved jobs, file intake, and unattended execution

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0031-cli-workflows](../0031-cli-workflows/progress.md), [0030-cli-bank-sync](../0030-cli-bank-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add typed saved-job config and bounded run-once CLI entry over workflow runner.
- [ ] Add stable-file watch, overlap locks, hash checks, and explicit inbox/processed/error path boundaries.
- [ ] Add scheduler integration examples and local result artifacts; require separate user configuration for external notifications.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                 | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------- |
| A1  | Repeated and partially written files import once or remain pending; same file deliberately targeted to another account requires explicit policy. | Not collected | Pending |
| A2  | Two simultaneous job invocations produce one active run; crashes resume without replaying committed steps.                                       | Not collected | Pending |
| A3  | Dry-run jobs show effects; disable cancels future runs; Windows/Linux scheduler examples pass disposable execution checks.                       | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
