# Implementation: 0025 cli-budgeting

## Slice 1: allocation moves

- Core `server/budget/guarded-allocation.ts`: guarded `budgets.move` (D2, D3, D4). Types `BudgetMoveRequest`, `BudgetMoveCell`, `BudgetMoveProposal`, `BudgetMoveOutcome`; handlers `api/budget-preview-move`, `api/budget-move` (month validated against the budget bounds like `budgets.set-amount`); public `previewBudgetMove`, `applyBudgetMove`.
- CLI `budgets move --month --from --to --amount [--allow-overspend] --operation-id`, `changes preview budgets.move`.

## Slice 2: templates

- `goal-template.ts` exports `computeTemplates` and `getTemplateCategories`; `template-notes.ts` exports `getCategoriesWithTemplates`.
- Core `effectiveTemplates`, `inspectTemplates`, guarded `budgets.apply-templates` (D5, D6). Handlers `api/budget-templates`, `api/budget-preview-templates`, `api/budget-apply-templates`; public `inspectBudgetTemplates`, `previewTemplateApplication`, `applyTemplateApplication`.
- CLI `budgets templates` (read) and `budgets apply-templates --month [--force | --categories] --operation-id`.

## Slice 3: reservations

- Core `budgetReservations` over `getReservations` with the feature-flag gate (D7); handler `api/budget-reservations`; public `getBudgetReservations`; CLI `budgets reservations [--month]` (read).

Docs: `cli.md` Budgets section, README row, `upcoming-release-notes/agent-cli-budget-moves-templates.md`.

## Verification (Linux)

| Check    | Command                                                                | Result                                                                    |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| API      | `yarn workspace @actual-app/api exec vitest run -t "allocation moves"` | 1/1                                                                       |
| CLI unit | `yarn workspace @actual-app/cli test`                                  | 311/311                                                                   |
| Types    | loot-core, API and CLI `tsc`                                           | clean                                                                     |
| Packaged | `node --test integration/budgeting.test.mjs`                           | 8/8 (`verification-budgeting-linux.txt`, run together with the 0022 file) |

Acceptance mapping:

- A1: a 10000 move between categories keeps the month's total budgeted and To Budget; a move larger than the source balance and a move larger than To Budget are refused (`INVALID_INPUT`), `--allow-overspend` permits a negative source, moving from To Budget reports `totalBudgetedChange`; values survive `sync` and a fresh read; transactions and preferences are unchanged. Kill points before engine, after engine and before sync keep their outcome (guarded-kit).
- A2: fixed (`#template 120`) and schedule (`#template schedule Bill`) templates preview 12000 and 5000 without writing, and apply writes the same values; a second fill previews no rows; listed categories overwrite; invalid lines are reported by `budgets templates` and listed in the preview's `templateErrors`; a category without templates is refused.
- A3: reservations are refused without `flags.budgetReservations`, return the current month's rows with it, write nothing, and refuse other months.

Limitations: Windows not run. Formula templates and browser agreement for reservations are not re-proven (D8). Reservation updates after payment or undo rely on the engine's next-date behavior and are not separately fixtured. Tracking-budget refusals are covered by code paths, not by a packaged fixture.

Decision audit: D1-D8 in execution-decisions.md.
