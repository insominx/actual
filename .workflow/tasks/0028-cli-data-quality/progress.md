# Task Progress: Data quality and history-coverage checks

Current status: active
Current phase: planned; prerequisite hold

## Dependencies

[0021-cli-imports](../0021-cli-imports/progress.md), [0022-cli-reconciliation](../0022-cli-reconciliation/progress.md), [0023-cli-rules](../0023-cli-rules/progress.md), [0027-cli-reports](../0027-cli-reports/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [ ] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [ ] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [ ] Add core/API finding types and read-only checks over authoritative import, transfer, and reconciliation results.
- [ ] Add device-local statement/coverage evidence metadata linked to import receipts without fabricating bank verification.
- [ ] Add report completeness annotations and remediation references; test large histories, unavailable categories, and ambiguity.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                       | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Seeded duplicate candidates, uncategorized rows, orphan transfers, and statement discrepancies produce correct bounded findings.       | Not collected | Pending |
| A2  | A month with no transactions and no statement evidence reports unknown coverage; a verified no-activity statement can report coverage. | Not collected | Pending |
| A3  | Repeated checkups create no ledger/allocation/preference writes and never automatically repair ambiguous data.                         | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
