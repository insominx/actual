# Task Progress: Personal account setup and institution-export validation

Current status: blocked on HITL (no real budget or personal exports; fixture-only checklist delivered)
Current phase: checklist delivered; waiting on Michael for representative exports and budget selection

## Dependencies

[0035-cli-acceptance](../0035-cli-acceptance/progress.md)

## Human input required

At personal adoption only: representative exports, statement dates/balances, and explicit real-budget selection. This does not block earlier tasks.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then deliver the personal setup checklist (HITL blocked).

## Implementation checklist

- [ ] Request representative files and statement facts only when this task is reached; validate mappings and parser compatibility in a disposable clone.
- [ ] Prepare a concrete setup/import/reconciliation proposal and backup for the explicitly selected real budget.
- [ ] Apply within the user-authorized scope, reconcile against provided statements, and record private adoption results plus sanitized tooling defects.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                        | Evidence                                                                                 | Status         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------- |
| A1  | Representative Chase/Capital One/Robinhood files match statement totals and dates or produce a documented format gap.                                   | Blocked: representative exports not supplied. Fixture-only path is 0035 A1.              | Blocked (HITL) |
| A2  | Transfer/card payments reconcile once; included account totals match verified signed balances and historical coverage is stated.                        | Blocked: no personal clone or statement evidence. Recipe in personal-setup-checklist.md. | Blocked (HITL) |
| A3  | A backup exists before personal mutations; final plan/reload/sync results and any limitations are recorded privately without committing financial data. | Blocked: no personal mutations. Backup and private-evidence rules documented.            | Blocked (HITL) |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 04:17 PT: Delivered personal-setup-checklist.md and blocked the task on HITL. No real budget opened; fixture-only validation points at 0035. Decisions D1-D5.
