# Task Progress: Categories, payees, tags, notes, and preference tools

Current status: partial; active
Current phase: notes (get/set), typed synced preferences (inspect/set/reset) and catalog inspection (categories/payees) implemented on Linux; packaged proofs in verification-catalog-settings-linux.txt. Open: guarded category moves between groups, a browser check for A1, and a Windows rerun.

## Dependencies

[0014-cli-mutations](../0014-cli-mutations/progress.md)

## Human input required

None to review this planned contract. This request creates tasks only; implementation starts when the user requests execution. During execution, follow the authorized scope without redundant approval prompts.

## Agent next actions

- [x] Confirm prerequisite acceptance and reread produced APIs/schemas before review-plan. 0014 is completed locally on Linux with a Windows rerun pending (D1).
- [x] Review this contract, then implement its first complete operation path (notes.set).

## Implementation checklist

- [ ] Extend existing catalog commands with inspect/move/merge consequences and preview/apply receipts. Inspect done; merge and retirement reuse 0014 guarded adapters (D10); guarded move pending.
- [x] Add notes commands and typed preference metadata/allowlist through public API, returning scope explicitly.
- [ ] Test hidden/deleted references, migration destinations, and cross-client changes; document each preference authority.
- [ ] Run section 12 checks, record limitations and evidence, and update dependent task readiness.

## Acceptance trace

| ID  | Required outcome                                                                                                                                               | Evidence      | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| A1  | Payee merge and category retirement preserve transaction totals and update references in CLI and browser.                                                      | Not collected | Pending |
| A2  | Hidden/deleted categories remain discoverable where needed; duplicate names are explicit.                                                                      | Not collected | Pending |
| A3  | Notes and allowed synced preferences survive reload/sync; invalid keys fail, missing reads do not write defaults, and cashPlanning uses its typed domain tool. | Not collected | Pending |

## Execution decision ledger

Create `execution-decisions.md` only for material choices/departures during implementation. Otherwise record `Decision audit: none material` in `implementation.md`.

## Execution log

- 2026-10-02: Created the sequenced task contract. No production implementation or feature verification performed.
- 2026-10-05 00:06 PT: Slices for notes, preferences and catalog inspection. Core `server/notes/guarded.ts` resolves note IDs to live targets and plans `notes.set`; `server/preferences/catalog.ts` holds the typed synced-preference catalog and plans `preferences.set`; `server/catalog-inspect.ts` reports duplicates, deleted merge targets and resolved counts. Public API: `getNoteTarget`, `previewNoteSet`/`applyNoteSet`, `inspectPreferences`, `previewPreferenceSet`/`applyPreferenceSet`, `inspectCatalog`. CLI: `notes get|set`, `preferences inspect|set|reset`, `categories inspect`, `payees inspect`. Decisions D1-D10. Evidence: CLI unit 289/289, api/core/CLI types clean, oxlint clean; API and packaged results recorded below when captured.
