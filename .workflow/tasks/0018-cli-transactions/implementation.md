# Implementation: 0018 cli-transactions

## Slice 1: guarded batch categorization (A2)

- Core `packages/loot-core/src/server/transactions/guarded-categorize.ts` (`prepareTransactionCategorization`, `performTransactionCategorization`) writes through `batchUpdateTransactions` and verifies every frozen row.
- Types `TransactionCategorizationRequest|Proposal` in `types/change-proposals.ts`; handlers `api/transactions-preview-categorization` and `api/transactions-apply-categorization`.
- Public `previewTransactionCategorization`, `applyTransactionCategorization` in `packages/api/methods.ts`.
- CLI `transactions categorize --ids --category [--allow-reconciled] --operation-id`, `changes preview transactions.categorize`, payload schema in `json-schema.ts`, generic `executeScopedChange`.

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
