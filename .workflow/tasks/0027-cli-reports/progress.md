# Task Progress: Explainable financial reports and exports

Current status: completed locally on Linux; Windows rerun pending
Current phase: three slices implemented and verified on Linux

## Dependencies

[0017-cli-query](../0017-cli-query/progress.md), [0019-cli-transfers](../0019-cli-transfers/progress.md), [0026-cli-cash-planning](../0026-cli-cash-planning/progress.md), [0025-cli-budgeting](../0025-cli-budgeting/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review D2 (core definitions, client reports not switched), D3 (no payee/compare operations) and D7 (two decimal places).

## Implementation checklist

- [x] Inventory report calculation owners and extract only UI-owned calculations needed by named report types into core/API with parity tests.
- [x] Add reports and drill-down DTOs over core queries, preserving bounded paging and scope declarations.
- [x] Add comparison and JSON/CSV/HTML artifact export; defer PDF to external rendering rather than add a heavy renderer dependency. (Comparison is two calls, D3.)
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                     | Evidence                                                                    | Status       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------ |
| A1  | Monthly income/spending/cash-flow reconcile to ledger fixtures and drill-down totals including refunds and deleted categories.                       | `reports.test.mjs`, API `ledger reports` (`verification-reports-linux.txt`) | Met on Linux |
| A2  | Net worth includes requested tracking accounts while net cash excludes them; future-dated behavior is explicit.                                      | `reports.test.mjs`, API `ledger reports` (`verification-reports-linux.txt`) | Met on Linux |
| A3  | CSV/HTML export preserves cents/date conventions, escapes notes/payees, handles spreadsheet formula-like text safely, and labels incomplete history. | `reports.test.mjs`, API `ledger reports` (`verification-reports-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 03:02 PT: Implemented core cash flow, category and net worth reports with scope, completeness and contributing IDs; CLI `reports cash-flow|categories|net-worth` with CSV/HTML export. Packaged `reports.test.mjs` 3/3 and API 1/1 on Linux. Decisions D1-D10. Completed locally on Linux.
