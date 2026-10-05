# Task Progress: Data quality and history-coverage checks

Current status: completed locally on Linux; Windows rerun pending
Current phase: three slices implemented and verified on Linux

## Dependencies

[0021-cli-imports](../0021-cli-imports/progress.md), [0022-cli-reconciliation](../0022-cli-reconciliation/progress.md), [0023-cli-rules](../0023-cli-rules/progress.md), [0027-cli-reports](../0027-cli-reports/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (Linux acceptance; D1)
- [x] Review this contract, then implement its first complete operation path.
- [ ] Rerun the packaged proof on Windows.
- [ ] Michael: review D3 (duplicate heuristic), D5 (device-local statement evidence) and D7 (closed accounts skipped by default).

## Implementation checklist

- [x] Add core/API finding types and read-only checks over authoritative import, transfer, and reconciliation results.
- [x] Add device-local statement/coverage evidence metadata linked to import receipts without fabricating bank verification.
- [x] Add report completeness annotations and remediation references; test large histories, unavailable categories, and ambiguity. (Deleted categories and ambiguity tested; large histories not measured.)
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                       | Evidence                                                                                    | Status       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| A1  | Seeded duplicate candidates, uncategorized rows, orphan transfers, and statement discrepancies produce correct bounded findings.       | `data-quality.test.mjs`, API `data quality checkup` (`verification-data-quality-linux.txt`) | Met on Linux |
| A2  | A month with no transactions and no statement evidence reports unknown coverage; a verified no-activity statement can report coverage. | `data-quality.test.mjs`, API `data quality checkup` (`verification-data-quality-linux.txt`) | Met on Linux |
| A3  | Repeated checkups create no ledger/allocation/preference writes and never automatically repair ambiguous data.                         | `data-quality.test.mjs`, API `data quality checkup` (`verification-data-quality-linux.txt`) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 03:10 PT: Implemented the core data-quality checkup (findings with codes, severity, evidence, uncertainty and suggested operations; month coverage), device-local statement evidence and CLI `checkup data-quality|statement`. Packaged `data-quality.test.mjs` 3/3 and API 1/1 on Linux. Decisions D1-D9. Completed locally on Linux.
