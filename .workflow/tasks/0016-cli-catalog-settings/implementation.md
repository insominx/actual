# Implementation: 0016 cli-catalog-settings

## Slice 1: notes (A3)

- Core `packages/loot-core/src/server/notes/guarded.ts`: resolves a note ID to a live account, category, group, budget month or category month, and plans `notes.set`. Public `getNoteTarget`, `previewNoteSet`, `applyNoteSet`.
- CLI `notes get|set`; reads never create a note.

## Slice 2: typed synced preferences (A3)

- Core `packages/loot-core/src/server/preferences/catalog.ts`: typed catalog with scope, type and owning tool; domain-owned keys such as cash planning are rejected and routed. Public `inspectPreferences`, `previewPreferenceSet`, `applyPreferenceSet`.
- CLI `preferences inspect|set|reset`.

## Slice 3: catalog inspection and moves (A1, A2)

- Core `packages/loot-core/src/server/catalog-inspect.ts` (duplicates, hidden and deleted rows, merge targets, counts through the alive view). Public `inspectCatalog`.
- CLI `categories inspect`, `payees inspect`, and `categories update --group-id` through the existing guarded category update adapter.

## Verification (Linux)

| Check    | Command                                                                                                                        | Result                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| CLI unit | `yarn workspace @actual-app/cli test`                                                                                          | 292/292                                                                             |
| API unit | `yarn workspace @actual-app/api test`                                                                                          | 123/123 before the account slice; focused notes, preferences and catalog cases pass |
| Types    | `npx tsc -b packages/loot-core`, API and CLI `tsc`                                                                             | clean                                                                               |
| Packaged | `node --test integration/catalog-inspect.test.mjs integration/guarded-notes.test.mjs integration/guarded-preferences.test.mjs` | 10/10 (`verification-catalog-settings-linux.txt`)                                   |

| Browser  | `node --test integration/browser-catalog.test.mjs`                                                                             | 1/1 (`verification-catalog-browser-linux.txt`)                                      |

Limitations: Windows not run.

Decision audit: D1-D10 in execution-decisions.md.
