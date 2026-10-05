# Task Progress: Transaction inspection, batch edits, splits, and duplicate merges

Current status: partially implemented
Current phase: batch categorization (A2) and duplicate merge implemented on Linux; get and guarded split edits open

## Dependencies

[0014-cli-mutations](../0014-cli-mutations/progress.md), [0015-cli-accounts](../0015-cli-accounts/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0017-cli-query](../0017-cli-query/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (0014, 0015, 0017 completed locally on Linux; 0016 partial with only the browser check open. ASSUMPTION for Michael to review: sufficient to start, D1.)
- [x] Review this contract, then implement its first complete operation path (`transactions.categorize`).

## Implementation checklist

- [ ] Expose any missing batch/split/merge methods through public API with strict shared types.
- [ ] Add get/search and receipt-backed batch categorization as one complete slice. (categorization done; search is `query run` from 0017, D2; `transactions get` open)
- [ ] Add splits, duplicate merge, explicit clearing/unlocking, and delete; prove engine invariants and publish supported reversals.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                 | Evidence                                                                                  | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------ |
| A1  | Split edits preserve parent amount and category totals after reload; invalid split sums fail before writes.                                      | Not collected                                                                             | Pending      |
| A2  | A batch categorization changes only frozen IDs and rejects stale affected records.                                                               | `integration/guarded-transaction-categorize.test.mjs`, API `guarded batch categorization` | Met on Linux |
| A3  | Merge/delete preserve transfer integrity and reconciled restrictions; manual add and import remain distinct and retries follow operation status. | Not collected                                                                             | Pending      |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 00:40 PT: guarded `transactions.categorize` (core `server/transactions/guarded-categorize.ts`, public preview/apply, CLI `transactions categorize`, changes payload schema). Decisions D1-D5.
- 2026-10-05 00:49 PT: guarded `transactions.merge` (core `server/transactions/guarded-merge.ts`, public preview/apply, CLI `transactions merge`). Packaged 6/6. Decisions D6-D7.
