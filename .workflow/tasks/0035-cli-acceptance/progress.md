# Task Progress: Agent-only workflow acceptance and performance proof

Current status: completed locally on Linux; Windows rerun pending (functional Playwright 167/167 on Linux; VRT not run)
Current phase: three slices + Linux functional Playwright verified

## Dependencies

[0034-cli-distribution](../0034-cli-distribution/progress.md), [0032-cli-automation](../0032-cli-automation/progress.md), [0030-cli-bank-sync](../0030-cli-bank-sync/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan.
- [x] Review this contract, then implement its first complete operation path.

## Implementation checklist

- [x] Add packaged agent-only scenario scripts over disposable budgets and fix attributable integration defects within their owning tasks.
- [x] Run real server/browser round trips for undo, imports, allocations, settings, templates, reservations, cash planning, and concurrent sessions.
- [x] Run Linux functional Playwright (`E2E_USE_BUILD=1 yarn e2e`, VRT unset); fix Cash Flow vs Cash planning locator (D10).
- [x] Record performance measurements and repository-wide baseline failures separately; publish local evidence/capability matrix and explicit unresolved limits.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                                                                                   | Evidence                                                                                                                                       | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A1  | Run the six personal workflows on synthetic Chase/Capital One/Robinhood cash accounts with card/equity boundary fixtures; every outcome is traceable to receipts.                                                  | `integration/acceptance.test.mjs` A1 (`verification-acceptance-linux.txt`)                                                                     | Met on Linux |
| A2  | Root types, focused CLI/API/core/server suites, desktop/mobile browser tests, targeted lint/format, and CLI/API/server/browser builds pass or identify an attributable defect.                                     | Root types, CLI unit 333, packaged install (0034), browser interop 4/4; Linux functional Playwright **167/167** after Cash Flow locator fix (`verification-playwright-functional-linux.txt`, D10). VRT not run. | Met on Linux |
| A3  | Representative large synthetic history records command timings/memory, bounded output, query pagination, and two-client contention; optional MCP has its own parity report and does not block CLI core acceptance. | `acceptance.test.mjs` A3, `performance-baseline-linux.json`; MCP parity in 0033 (D8)                                                           | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 04:15 PT: Added agent-only acceptance (six personal workflows, large history, contention), browser interop evidence, capability matrix and evidence report. Fixed a 0031 workflow-finding de-duplication defect found by acceptance (D4). Acceptance 2/2, browser interop 4/4 on Linux. Decisions D1-D9.
- 2026-10-05 09:49 PT: Linux functional Playwright 167/167 after fixing `goToCashFlowPage` (`/^Cash/` → `/^Cash Flow/`). Initial run 152 passed / 1 failed / 14 skipped. VRT still not run. Decision D10.
