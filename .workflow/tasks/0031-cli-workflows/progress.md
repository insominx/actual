# Task Progress: Complete setup, intake, checkup, close, and goal workflows

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0010-cli-runtime](../0010-cli-runtime/progress.md), [0015-cli-accounts](../0015-cli-accounts/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0024-cli-schedules](../0024-cli-schedules/progress.md), [0025-cli-budgeting](../0025-cli-budgeting/progress.md), [0028-cli-data-quality](../0028-cli-data-quality/progress.md), [0029-cli-reversal](../0029-cli-reversal/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add bounded workflow schema/run store and implement intake using imports/transfers/checkup as the first complete slice.
- [ ] Add setup, weekly checkup, monthly close, and goal review with explicit completion criteria and backup artifact paths.
- [ ] Add resume/cancel and receipt links; document one-run versus per-operation authorization and preserve user instructions without redundant prompts.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                      | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Fresh headless setup, multi-file intake, and monthly close succeed using disposable budgets with no browser assistance.               | Not collected | Pending |
| A2  | A crash after import resumes at review/reconciliation instead of reimporting; cancellation preserves accurate partial outcomes.       | Not collected | Pending |
| A3  | Goal review and scenarios change no saved plan until save; incomplete reconciliation prevents a claim that monthly close is complete. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
