# Implementation: 0021 cli-imports

## Slice 1 and 2: preview and hash-bound guarded apply

- Core `server/transactions/import/guarded-file-import.ts`: `prepareFileImport`/`performFileImport` for the guarded operation `imports.file`. Prepare parses with `inspectImportFile` (0020), rejects invalid rows unless `invalidRows: skip`, resolves category names as the dialog does, plans through `planTransactionImport` (exported from `guarded-import.ts`) and classifies each row with a read-only `matchTransactions` run. Perform delegates to `performTransactionImport`, which verifies the committed rows against the plan.
- Types `ImportFileRequest`, `ImportFileRowOutcome`, `ImportFileProposal`, `ImportFileOutcome` in `change-proposals.ts`; handlers `api/import-file-preview` and `api/import-file-apply`; public `previewFileImport` and `applyFileImport`.
- CLI `imports preview <file>` (read-only), `imports apply <file> --operation-id` (guarded, optional `--expect-sha256`), `imports history` (device-local journal); `imports.file` is a payload-scoped guarded operation with a `changes preview` schema.

## Slice 3: multi-file intake

- CLI `imports batch <manifest>`: one guarded `imports.file` per file (`<id>-N`), in order, stopping at the first failure with `PARTIAL_COMPLETION`; transfer candidates for the imported date range of each account afterwards; `--dry-run` previews and lists cross-file overlaps.

## Verification (Linux)

| Check    | Command                                                                   | Result                                    |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "guarded file import"` | 1/1                                       |
| CLI unit | `yarn workspace @actual-app/cli test`                                     | 304/304                                   |
| Types    | loot-core, API and CLI `tsc`                                              | clean                                     |
| Packaged | `node --test integration/file-imports.test.mjs`                           | see `verification-file-imports-linux.txt` |

Acceptance mapping:

- A1: reimport of the same OFX matches every row by `imported_id` and adds nothing; the first import's matched row carries `payee_date_amount` evidence (packaged test 1, API test).
- A2: preview leaves raw tables unchanged (raw sqlite comparison); a rule's `notes` result in the preview equals the committed row; the commit is verified against the plan.
- A3: deleted-row policy (`--no-reimport-deleted` reports `deleted`; the account default reimports), invalid rows rejected or skipped explicitly, cross-file overlap (batch), changed file and changed saved mapping (`STALE_PREVIEW`), `--expect-sha256` mismatch, and kills before engine, after engine and before sync (guarded-kit) retain their exact outcome without replay.

Limitations: Windows not run. A split- or transfer-creating rule is covered by the shared `transactions.import` acknowledgement check, not by a dedicated file-import fixture. The browser import dialog has no history of CLI imports and `imports history` does not see browser imports.

Decision audit: D1-D9 in execution-decisions.md.
