# Task Progress: File inspection, parsing, and shared import mappings

Current status: completed locally on Linux; Windows rerun pending
Current phase: shared mapping rules, imports inspect/parse and guarded saved mappings implemented on Linux.

## Dependencies

[0015-cli-accounts](../0015-cli-accounts/progress.md), [0016-cli-catalog-settings](../0016-cli-catalog-settings/progress.md), [0017-cli-query](../0017-cli-query/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. (0015, 0016, 0017 completed locally on Linux; D1)
- [x] Review this contract, then implement its first complete operation path (shared mapping extraction, then `imports inspect`).

## Implementation checklist

- [x] Extract UI-only normalization/mapping authority into shared/core code with parity fixtures; keep UI behavior unchanged. (`shared/import-mapping.ts`; the dialog's 113 utils tests pass unchanged through the re-export)
- [x] Expose supported parser methods via API and add inspect/parse against selected account without mutation.
- [x] Add typed mapping tools through existing prefs with receipts; document supported formats without claiming institution-export compatibility.
- [x] Run section 12 checks, record limitations and evidence, and update dependent task readiness. (Linux; Windows open)

## Acceptance trace

| ID  | Required outcome                                                                                                           | Evidence                                                                                                                                                                                                                                                                                           | Status                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A1  | CSV debit/credit columns, negative card amounts, locale/date formats, encoding, and OFX/QFX IDs match UI parsing fixtures. | API `import file inspection and saved mappings` (debit/credit, flip, dd/mm, UTF-16LE and windows-1252 mock files, `credit-card.ofx` FITIDs); `shared/import-mapping.test.ts`; dialog `utils.test.ts` 113/113 on the shared module; packaged `imports.test.mjs` (semicolon CSV with comma decimals) | Met on Linux                                                                 |
| A2  | A saved CLI mapping is usable in the browser and vice versa; inspect/parse performs no ledger writes.                      | `browser-imports.test.mjs` (CLI save read by the browser with the dialog's keys; dialog-style save read and applied by the CLI); raw-state equality in `imports.test.mjs` and the API test                                                                                                         | Met on Linux (`verification-imports-linux.txt`)                              |
| A3  | Malformed/oversized/ambiguous input is rejected or explicitly partial; source hash changes invalidate a prepared import.   | Row-level errors and ambiguity warning (API, packaged); 10 MiB and type limits; SHA-256 changes with content (packaged). Invalidating a prepared import belongs to 0021's import preview, which must compare this hash (D5)                                                                        | Met on Linux for inspection; prepared-import invalidation moved to 0021 (D5) |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 01:31 PT: Shared `shared/import-mapping.ts`; core `server/transactions/import/inspect-file.ts` and `mapping-save.ts`; public `inspectImportFile`, `getImportMapping`, `previewImportMappingSave`, `applyImportMappingSave`; CLI `imports inspect|parse`, `imports mappings get|set|reset`. Decisions D1-D6.
- 2026-10-05 01:31 PT: Packaged `imports.test.mjs` and browser `browser-imports.test.mjs` pass on Linux (2/2). Completed locally on Linux; A3's prepared-import invalidation is a 0021 requirement (D5).
