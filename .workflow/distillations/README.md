# Distillation Catalog

Last synthesized: 2026-09-27

Inventory snapshot: 0 task-era distillation files, excluding this README.

Cross-checked against the codebase: bootstrap inventory from directory listing on 2026-09-27; no full historical audit

## How to use this catalog

Use this README as navigation metadata before opening historical distillations. It helps agents avoid bulk-reading stale task-era prose and points to the best current authority for a concern.

Authority ladder for this project:

1. code/data
2. probes/tests
3. stable docs/ADRs
4. distillations
5. open task artifacts

Project-specific authority details may vary. When this ladder conflicts with repo-local instructions or stable project docs, prefer the more local authority and update this catalog note.

Do not treat this catalog as parser, runtime, or docs authority. It only indexes status, concern tags, supersession links, inventory rows, and maintenance notes.

## Status semantics

| status           | meaning                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- |
| current          | Still useful as task-era context; current authority is named in the row.                    |
| superseded       | A later distillation, stable doc, ADR, or open task replaces or contradicts the key claims. |
| promoted-to-docs | Durable content was moved to stable docs or ADRs; keep the distillation for provenance.     |
| historical-only  | Useful only as history; do not plan from it without checking current authority.             |

Partial staleness, such as module path drift or renamed commands, belongs in `notes`, not in a new status.

## Concern index

| concern    | open first | notes                                                                              |
| ---------- | ---------- | ---------------------------------------------------------------------------------- |
| _none yet_ | -          | Add rows only when a concern has a better entry point than scanning the inventory. |

Starter concern tags: `workflow-meta`, `architecture`, `cli`, `browser-ui`, `llm`, `grammar`, `data`, `docs`, `testing`, `security`, `performance`.

## Supersession graph

| older           | newer / authority | why                                                                          |
| --------------- | ----------------- | ---------------------------------------------------------------------------- |
| _none recorded_ | -                 | Add edges when a distillation replaces, contradicts, or promotes prior work. |

When an older distillation is likely to mislead before this catalog is read, add a short warning banner at the top of that older file.

## Full inventory

One row per task-era distillation file. Preserve exact basenames, including legacy id formats and duplicate prefixes. Do not add this README as an inventory row.

| distillation | status | concerns[] | superseded-by | current-authority | last-verified | open-first | notes |
| ------------ | ------ | ---------- | ------------- | ----------------- | ------------- | ---------- | ----- |
| _none yet_   | -      | -          | -             | -                 | -             | -          | -     |

## Verification log

| date       | method              | scope                                            | result                                           |
| ---------- | ------------------- | ------------------------------------------------ | ------------------------------------------------ |
| 2026-09-27 | bootstrap inventory | `.workflow/distillations/*.md` directory listing | Seeded inventory rows; no full historical audit. |

Example verification methods: `task closeout`, `static catalog audit`, `scripted check`, `manual-live check`.

## Maintenance rules

- Bootstrap this README when a task folder is created and `.workflow/distillations/README.md` is missing.
- Update this README on every distill or task finish in the same changeset as the new distillation and task-folder deletion when practical.
- Add or replace the inventory row for the exact `<basename>.md`.
- Refresh `Last synthesized`, `Inventory snapshot`, and `Cross-checked against the codebase`.
- Update the supersession graph when a distillation replaces, contradicts, or promotes prior work.
- Add top-of-file warning banners to high-conflict superseded distillations when old claims are likely to mislead.
- Update concern-index `open first` pointers only when the task changes the best entry point for that concern.
- Do not require a full retroactive audit on bootstrap or every distill; update affected rows and supersession neighbors.
- Do not overwrite an existing catalog during setup or resync.

## Related tasks / files to open first

Project-specific maintainers may add pointers here, such as a stable docs index, ADR index, or a workflow-meta distillation that explains this catalog.

Example only: a project might list a local validation command here, such as `npm test`; do not assume that command exists in every repo.
