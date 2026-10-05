# Task Progress: Cash-planning API, targets, goals, and scenarios

Current status: completed locally on Linux; Windows rerun pending
Current phase: inspect (summary, plan, projections, scenarios), guarded save/reset and target/goal helpers implemented and proven on Linux, including the browser round-trip. Open: Windows rerun.

## Dependencies

[0017-cli-query](../0017-cli-query/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (0014, 0016, 0017 completed locally on Linux; D1)
- [x] Review this contract, then implement its first complete operation path (`cash-planning inspect`).

## Implementation checklist

- [x] Add typed public summary/config/project methods and expose shared functions without copying formulas into CLI. (`inspectCashPlan`, `previewCashPlanSave`, `applyCashPlanSave`)
- [x] Add summary/get-plan/project/compare read paths with selected history and independent horizon. (one `inspect` read, D2)
- [x] Add target/reset/goal/save via preferences authority and receipts; prove UI/API/CLI parity and unreachable/already-reached/depletion states.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness. (Linux; Windows open)

## Acceptance trace

| ID  | Required outcome                                                                                                                                           | Evidence                                                                                                                                                                                                     | Status       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| A1  | 1000000 cash and -200000 card yields 800000; 1200000 income and 800000 outflows over two full months average 600000/400000.                                | `integration/cash-planning.test.mjs` (`verification-cash-planning-linux.txt`)                                                                                                                                | Met on Linux |
| A2  | 800000 starting cash and 2000000 goal at 200000 monthly surplus reaches the goal after six calendar forecast months; partial/leap months match UI.         | `cash-planning.test.mjs` (1200000 remaining at 200000 surplus lands six calendar months out, checked against an independent day-weighted month walk); shared `cash-planning.test.ts` partial/leap cases (D4) | Met on Linux |
| A3  | A target scenario changes only target projection; save/reset round-trips to the browser and changes no transactions, allocations, templates, or schedules. | `cash-planning.test.mjs` (scenario transient, ledger unchanged), `browser-cash-planning.test.mjs` (CLI to browser and back)                                                                                  | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 01:14 PT: Core `server/cash-planning/plan.ts` (`inspectCashPlan`, `prepareCashPlanSave`/`performCashPlanSave`), public `inspectCashPlan`, `previewCashPlanSave`, `applyCashPlanSave`; CLI `cash-planning inspect|save|reset|set-target|reset-target|set-goal`. API, packaged and browser proofs pass on Linux. Decisions D1-D7.
