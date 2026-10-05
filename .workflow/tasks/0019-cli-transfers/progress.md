# Task Progress: Transfer candidate discovery, matching, and repair

Current status: completed locally on Linux; Windows rerun pending
Current phase: transfer candidates, inspection and audit plus guarded match, unmatch and repair implemented and proven on Linux. Open: Windows rerun.

## Dependencies

[0018-cli-transactions](../0018-cli-transactions/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (0018 completed locally on Linux; D1)
- [x] Review this contract, then implement its first complete operation path (`transfers candidates`).

## Implementation checklist

- [x] Add public transfer inspection/candidate metadata over existing engine matching logic.
- [x] Add match/create preview/apply with both-leg preconditions and receipts. (create is guarded `transactions add` with a transfer payee, D3)
- [x] Add unmatch/repair with explicit reconciled handling; test ambiguous and boundary cases with cash-planning parity. (cash-planning parity: D6)
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness. (Linux; Windows open)

## Acceptance trace

| ID  | Required outcome                                                                                                                                              | Evidence                                                                                                                                                                                     | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A1  | Checking-to-savings and a card payment change neither net cash nor recorded category spending.                                                                | `integration/transfers.test.mjs` (on-budget totals and category groups unchanged after matching), API `guarded transfer match`                                                               | Met on Linux |
| A2  | Cash-to-equity reduces accessible cash once; matching imported opposite entries creates no duplicate money movement.                                          | `transfers.test.mjs` (budget-boundary match, totals unchanged), API test (imported pair linked, row count and total unchanged)                                                               | Met on Linux |
| A3  | Multiple same-amount candidates, split transfers, missing counterparts, reconciled entries, and unmatch/repair yield documented results without orphan links. | `transfers.test.mjs` (ambiguity, double link refused, reconciled gate, unmatch, check clean), API tests (missing counterpart unlink, amount drift resync, relink, split rows refused per D4) | Met on Linux |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 01:20 PT: Core `server/transfers/inspect.ts` (candidates, inspect, audit) and `server/transfers/guarded.ts` (match, unmatch, repair); public `findTransferCandidates`, `inspectTransfer`, `auditTransfers`, `previewTransfer*`/`applyTransfer*`; CLI `transfers candidates|inspect|check|match|unmatch|repair`. Decisions D1-D7.
