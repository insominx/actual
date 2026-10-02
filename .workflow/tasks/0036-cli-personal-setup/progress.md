# Task Progress: Personal account setup and institution-export validation

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0035-cli-acceptance](../0035-cli-acceptance/progress.md)

## Human input required

At personal adoption only: representative exports, statement dates/balances, and explicit real-budget selection. This does not block earlier tasks.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Request representative files and statement facts only when this task is reached; validate mappings and parser compatibility in a disposable clone.
- [ ] Prepare a concrete setup/import/reconciliation proposal and backup for the explicitly selected real budget.
- [ ] Apply within the user-authorized scope, reconcile against provided statements, and record private adoption results plus sanitized tooling defects.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                        | Evidence      | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Representative Chase/Capital One/Robinhood files match statement totals and dates or produce a documented format gap.                                   | Not collected | Pending |
| A2  | Transfer/card payments reconcile once; included account totals match verified signed balances and historical coverage is stated.                        | Not collected | Pending |
| A3  | A backup exists before personal mutations; final plan/reload/sync results and any limitations are recorded privately without committing financial data. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
