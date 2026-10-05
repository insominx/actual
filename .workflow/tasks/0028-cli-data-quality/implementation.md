# Implementation: 0028 cli-data-quality

## Slice 1: core checks

- Core `server/checkup/data-quality.ts`: `dataQualityCheckup({start, end, accountIds?, statements?, duplicateWindowDays?, limit?})` (D2-D4, D8). Handler `api/checkup-data-quality`; public `getDataQualityCheckup` and types `DataQualityRequest`, `DataQualityFinding`, `FindingCode`, `FindingSeverity`, `StatementEvidence`, `CoverageMonth`, `CoverageStatus`, `AccountCoverage`.

## Slice 2: statement evidence and coverage

- `packages/cli/src/statement-evidence.ts`: device-local store (D5, D9). CLI `checkup statement add|list|remove`.
- Coverage statuses and statement discrepancies computed in core from the evidence passed on each checkup (D6).

## Slice 3: remediation references

- Every finding carries `suggested` operations with example commands; report completeness already ships with 0027 (D8). CLI `checkup data-quality --from-month --to-month [--accounts] [--duplicate-window] [--limit]` (read operation).
- Docs: `cli.md` Checkup section, README row, `upcoming-release-notes/agent-cli-checkup.md`.

## Verification (Linux)

| Check    | Command                                                                    | Result                                      |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "data quality checkup"` | 1/1                                         |
| CLI unit | `yarn workspace @actual-app/cli test`                                      | 315/315                                     |
| Types    | loot-core, API and CLI `tsc`                                               | clean                                       |
| Packaged | `node --test integration/data-quality.test.mjs`                            | 3/3 (`verification-data-quality-linux.txt`) |

Acceptance mapping:

- A1: on the seeded fixture plus a same-amount pair one day apart, a same-day pair with two different bank IDs, an unlinked transfer-payee row and a wrong statement balance, the checkup returns exactly one `uncategorized` finding (the fixture's uncategorized row), one `duplicate-candidate` (the manual pair, not the bank pair), one `transfer-issue` (`unlinked-transfer-payee`) and one `statement-discrepancy` whose difference is the statement minus the ledger balance; errors sort first, `--limit 2` truncates with the same `totalFindings`, and an unknown account is `INVALID_INPUT`.
- A2: an account with no rows reports July to September as `unknown` with a `coverage-unknown` finding; a no-activity statement turns July into `statement-verified`, a matching balance verifies a month with rows, and a no-activity claim for a month with rows becomes a `discrepancy`. Duplicate evidence without `--replace` and evidence with neither a balance nor no-activity are refused.
- A3: two checkups return identical findings and leave the raw budget unchanged; nothing is repaired.

Limitations: Windows not run. Duplicate detection is a narrow heuristic (D3). Large-history performance was not measured; the transfer audit inspects every transfer row in the budget.

Decision audit: D1-D9 in execution-decisions.md.
