# Task Progress: Account management, groups, and balance inspection

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0011-cli-budget-lifecycle](../0011-cli-budget-lifecycle/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Extend account inspect/balance output with engine-owned balance definitions and groups commands.
- [ ] Wrap create/opening-balance/update in changes protocol; reject invalid account references and ambiguous names.
- [ ] Add receipt-backed close/reopen/delete and off-budget changes; prove consequences in disposable budgets.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                        | Evidence      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | 1000000 cash and -200000 card produce 800000 signed total; future transactions and off-budget equity are distinguished. | Not collected | Pending |
| A2  | Opening balance, zero-balance closure, nonzero closure, reopen, and account-group edits survive reload/sync.            | Not collected | Pending |
| A3  | Duplicate account names fail ambiguous resolution; delete preview shows impacted ledger rows before apply.              | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
