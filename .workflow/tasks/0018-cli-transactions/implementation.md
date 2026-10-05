# Implementation: 0018 cli-transactions

## Slice 1: guarded batch categorization (A2)

- Core `packages/loot-core/src/server/transactions/guarded-categorize.ts` (`prepareTransactionCategorization`, `performTransactionCategorization`) writes through `batchUpdateTransactions` and verifies every frozen row.
- Types `TransactionCategorizationRequest|Proposal` in `types/change-proposals.ts`; handlers `api/transactions-preview-categorization` and `api/transactions-apply-categorization`.
- Public `previewTransactionCategorization`, `applyTransactionCategorization` in `packages/api/methods.ts`.
- CLI `transactions categorize --ids --category [--allow-reconciled] --operation-id`, `changes preview transactions.categorize`, payload schema in `json-schema.ts`, generic `executeScopedChange`.

## Slice 2: guarded duplicate merge (A3)

- Core `packages/loot-core/src/server/transactions/guarded-merge.ts` (`prepareTransactionMerge`, `performTransactionMerge`), `determineKeepDrop` exported from `merge.ts`.
- Types `TransactionMergeRequest|Proposal|Outcome`; handlers `api/transactions-preview-merge` and `api/transactions-apply-merge`; public `previewTransactionMerge`, `applyTransactionMerge`.
- CLI `transactions merge --ids a,b [--allow-reconciled] --operation-id`; journal outcome union includes `TransactionMergeOutcome`.
- API `guarded duplicate merge` 1/1; packaged `guarded-transaction-merge.test.mjs` 6/6.

## Slice 3: guarded split edits (A1) and transaction get

- Core `packages/loot-core/src/server/transactions/guarded-split.ts` (`prepareTransactionSplit`, `performTransactionSplit`) writes through `shared/transactions.ts` `updateTransaction` and `batchUpdateTransactions`, then verifies the live children against the plan.
- Types `TransactionSplitRequest|Proposal|Outcome`; handlers `api/transactions-preview-split` and `api/transactions-apply-split`; public `previewTransactionSplit`, `applyTransactionSplit`.
- CLI `transactions split <id> --data|--file [--allow-reconciled] --operation-id`; read-only `transactions get <id>` (split children, balance, transfer counterparts) via public `aqlQuery`.
- API `guarded split edits` 1/1; packaged `guarded-transaction-split.test.mjs` 6/6.

## Verification (Linux)

| Check    | Command                                                                            | Result                                      |
| -------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "guarded batch categorization"` | 1/1                                         |
| CLI unit | `yarn workspace @actual-app/cli test`                                              | 293/293                                     |
| Types    | `npx tsc -b packages/loot-core`, API and CLI `tsc`                                 | clean                                       |
| Packaged | `node --test integration/guarded-transaction-categorize.test.mjs`                  | 6/6 (`verification-transactions-linux.txt`) |

Fix during verification: the core proposal first normalized `allowReconciled: false` into the request, so a direct retry with the same operation ID looked like a different request. The proposal now keeps the request verbatim.

Limitations: Windows not run; no browser check.

Decision audit: D1-D5 in execution-decisions.md.
