# Implementation: 0020 cli-file-parsing

## Slice 1: shared mapping rules

- `packages/loot-core/src/shared/import-mapping.ts`: date formats and `parseDate`, `applyFieldMappings`, `parseAmountFields`, `parseCategoryFields`, `filterByStartDate`, `stripCsvImportTransaction`, `getFileType`, `getInitialDateFormat`, `getInitialMappings`, moved unchanged from the import dialog.
- `packages/desktop-client/src/components/modals/ImportTransactionsModal/utils.ts` re-exports them; the modal imports the detection helpers from there.
- `packages/loot-core/src/shared/import-mapping.test.ts` (debit/credit, flip, in/out, multiplier, day/month order).

## Slice 2: inspection and saved mappings

- Core `server/transactions/import/inspect-file.ts` (`inspectImportFile`, `savedImportSettings`, `importPreferenceKeys`, `validateImportSettings`) and `mapping-save.ts` (`prepareImportMappingSave`/`performImportMappingSave`).
- Handlers `api/import-file-inspect`, `api/import-mapping-get`, `api/import-mapping-preview-save`, `api/import-mapping-apply-save`; public `inspectImportFile`, `getImportMapping`, `previewImportMappingSave`, `applyImportMappingSave`.
- CLI `packages/cli/src/commands/imports.ts`: `imports inspect|parse <file>` (path resolved from the current directory), `imports mappings get|set|reset`; `imports.mapping-save` payload-scoped guarded operation.
- Docs: `cli.md` Imports section, README row, `upcoming-release-notes/agent-cli-imports-inspect.md`.

## Verification (Linux)

| Check    | Command                                                                                        | Result                                 |
| -------- | ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| Shared   | `yarn workspace @actual-app/core exec vitest run src/shared/import-mapping.test.ts`            | 3/3                                    |
| Dialog   | `yarn workspace @actual-app/web exec vitest run src/components/modals/ImportTransactionsModal` | 113/113                                |
| API      | `yarn workspace @actual-app/api exec vitest run -t "import file inspection"`                   | 1/1                                    |
| CLI unit | `yarn workspace @actual-app/cli test`                                                          | 303/303                                |
| Types    | loot-core, desktop-client, API and CLI `tsc`                                                   | clean                                  |
| Packaged | `node --test integration/imports.test.mjs integration/browser-imports.test.mjs`                | 2/2 (`verification-imports-linux.txt`) |

Limitations: Windows not run. The browser proof covers the shared preferences; it does not drive the file picker in the import dialog.

Decision audit: D1-D6 in execution-decisions.md.
