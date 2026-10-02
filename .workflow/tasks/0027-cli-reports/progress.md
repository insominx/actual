# Task Progress: Explainable financial reports and exports

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0017-cli-query](../0017-cli-query/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md), [0026-cli-cash-planning](../0026-cli-cash-planning/progress.md), [0025-cli-budgeting](../0025-cli-budgeting/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Inventory report calculation owners and extract only UI-owned calculations needed by named report types into core/API with parity tests.
- [ ] Add reports and drill-down DTOs over core queries, preserving bounded paging and scope declarations.
- [ ] Add comparison and JSON/CSV/HTML artifact export; defer PDF to external rendering rather than add a heavy renderer dependency.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                     | Evidence      | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Monthly income/spending/cash-flow reconcile to ledger fixtures and drill-down totals including refunds and deleted categories.                       | Not collected | Pending |
| A2  | Net worth includes requested tracking accounts while net cash excludes them; future-dated behavior is explicit.                                      | Not collected | Pending |
| A3  | CSV/HTML export preserves cents/date conventions, escapes notes/payees, handles spreadsheet formula-like text safely, and labels incomplete history. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
