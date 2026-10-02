Last Edited: 2026-10-01

# Plan: expense-only budget display

Verdict: **implemented (uncommitted)**; see `implementation.md` and `progress.md` for evidence, D5/D6's local cross-tab/handover fixes and remaining baseline-lint/remote-sync limits. Priority 2. Execution: AFK; independent of reservations.

## 0. Constraint card

| Constraint           | Decision                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistence          | Two budget-scoped local prefs only (`budget.displayMode`, `budget.expensePeriod`). No tables, synced prefs, worker API, or summary writes. |
| Lifecycle volatility | Expense anchor, expansion, rows and summary are view working state; they die on unmount, budget change, or range change.                   |
| Operator scope       | Display-only. Never writes `budgetType`, allocations, ledger rows, or `budget.startMonth`.                                                 |
| Performance stance   | One `liveQuery` per visible range; linear aggregation; no per-cell queries. No numeric target; record fixture size/runtime only.           |
| Authority            | Ledger + category metadata are authoritative. `packages/loot-core/src/shared/expense-range-query.ts` is the only inclusion owner.          |
| Gate policy          | Each batch (E1–E3) ends with named commands that must exit 0 before the next batch starts.                                                 |

## 1. Current state

`packages/desktop-client/src/components/budget/index.tsx` reads synced `budgetType` to select envelope/tracking providers. It calls hooks, returns `null` until `prewarmAllMonths` sets `initialized` (~line 178), and passes `onMonthSelect` (which calls `setStartMonthPref`) into the table. Mobile `components/mobile/budget/BudgetPage.tsx` does the same with `prewarmMonth`; it shows a spinner while `!categoryGroups || !initialized` (~line 540), and its header `MonthSelector` is wired to `onPrevMonth` / `onNextMonth` / `onCurrentMonth`, all of which call `setStartMonthPref`.

Existing queries that look related but must not be reused as the expense contract:

- `createCategory` / `getSumAmountsByMonth` in `packages/loot-core/src/server/budget/base.ts` (budget "spent"): requires a non-null category, filters `a.offbudget = 0`, has no transfer filter. It includes categorized on-budget transfers and drops uncategorized outflows.
- `categoryBalance` in `packages/desktop-client/src/spreadsheet/bindings.ts`: one category/month per binding; no off-budget filter.
- Report `makeQuery` in `components/reports/spreadsheets/makeQuery.ts`: splits `amount > 0` / `amount < 0` branches and groups in SQL; the debt branch alone drops refunds.

`#hooks/useQuery` keeps previous `data` across query changes, `onError` leaves `data` and `isLoading` untouched, and a later `onData` does not clear `error`. `liveQuery.fetchData` drops late successes after `unsubscribe` but still calls `onError` for a late failure. Category metadata comes from TanStack `useCategories` (`#hooks/useCategories` → `categoryQueries.list()`), which includes hidden categories/groups and is invalidated on category sync events; it is not a `liveQuery`.

Reference: [ejina21 expenseData.ts](https://github.com/ejina21/actualFinance/blob/85407067736c8bf2441ab8db4e863182522a15bf/packages/desktop-client/src/components/budget/expense-view/expenseData.ts) and adjacent tests/spec. Its Russian group-name exclusions and blanket transfer exclusion are deliberately not adopted. Recheck the implementation against this plan before adapting.

## 2. Target shape

### Concrete integration seams

| Owner                                                                                            | Planned delta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/loot-core/src/shared/expense-range-query.ts` (new)                                     | **Sole inclusion owner.** Exports `buildExpenseRangeQuery(range)` and `normalizeExpenseLeaves(rows)` plus the `ExpenseLeaf` type. No React. Imported by the client as `@actual-app/core/shared/expense-range-query` and by the core test as `#shared/expense-range-query`.                                                                                                                                                                                                                                                                                                             |
| `packages/desktop-client/src/components/budget/expense-view/expenseData.ts` (new)                | Pure `buildExpenseSummary(leaves, categoryGroups, period, anchor)`, anchor/range helpers, and `parseDisplayMode` / `parseExpensePeriod` pref validators. No inclusion rules.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/desktop-client/src/components/budget/expense-view/useExpenseData.ts` (new)             | Sole subscription/status owner. Calls `liveQuery` directly (not `useQuery`); returns `{ status: 'loading' \| 'error' \| 'ready', summary: ExpenseSummary \| null, retry }`. Never exposes raw rows.                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/desktop-client/src/components/budget/expense-view/ExpenseView.tsx` (new)               | Owns anchor, period toggle, its own prev/next/current controls, expansion state, and grid rendering. Receives `initialMonth: string`, never a `budget.startMonth` setter.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/desktop-client/src/components/budget/expense-view/BudgetDisplayModeSelector.tsx` (new) | Small Budget/Expenses segmented control (`Trans` labels) that reads/writes `budget.displayMode` only. Desktop only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/desktop-client/src/components/budget/index.tsx`                                        | Hooks stay unconditional. After all hooks and **before** the `initialized` gate, when display mode is `expenses` return the existing page `View` (same `styles.page` wrapper, no `SheetNameProvider`) containing the selector row and `<ExpenseView key={budgetId} initialMonth={startMonth} />`. Budget mode keeps the `initialized` gate and renders the selector row above the existing `{table}`. `onMonthSelect` / `setStartMonthPref` stay on the calendar path only.                                                                                                            |
| `packages/desktop-client/src/components/mobile/budget/BudgetPage.tsx`                            | Before the `!categoryGroups \|\| !initialized` spinner, when display mode is `expenses` (and `categoryGroups` loaded) return a `Page` whose `MobilePageHeader` keeps the existing left menu button, uses a static "Expenses" title, omits `MonthSelector` and the Today button, and whose body is `<ExpenseView key={budgetId} initialMonth={startMonth} />`. The anchor and its controls stay inside `ExpenseView` (rendered as a control row in the body); the anchor is never lifted into `BudgetPage`. `onPrevMonth` / `onNextMonth` / `onCurrentMonth` stay on the calendar path. |
| `packages/desktop-client/src/components/modals/BudgetPageMenuModal.tsx`                          | Add one menu item that toggles `budget.displayMode` ("Show expenses" / "Show budget"). This is the mobile selector.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/loot-core/src/types/prefs.ts`                                                          | Add `'budget.displayMode': 'budget' \| 'expenses'` and `'budget.expensePeriod': 'month' \| 'year'` to `LocalPrefs`. No third engine value.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Production files added: `loot-core/src/shared/expense-range-query.ts`, and under `desktop-client/src/components/budget/expense-view/`: `expenseData.ts`, `useExpenseData.ts`, `ExpenseView.tsx`, `BudgetDisplayModeSelector.tsx`. Modified: `budget/index.tsx`, `mobile/budget/BudgetPage.tsx`, `modals/BudgetPageMenuModal.tsx`, `types/prefs.ts`. Test, e2e and docs paths are in §12 and §13. No new DB tables, worker API, imported workbook, or dependency; delete nothing.

Preserved invariants: engine/ledger untouched by view changes; each transaction leaf counted at most once; inclusion decided by IDs and flags, never labels or locale; integer sums; no values from a previous budget/range are ever rendered.

## 3. Contract

- Choosing Expenses changes presentation only. Budget mode, allocations, dates and ledger remain untouched. **Switching back to Budget leaves `budget.startMonth` unchanged** (Budget shows the same month it showed before Expenses was opened).
- The expense anchor is seeded from `budget.startMonth` when `ExpenseView` mounts. An Expenses → Budget → Expenses round-trip re-seeds it from `budget.startMonth`. Month → year → month inside Expenses restores the anchor month.
- Month view has one column per real calendar day of the anchor month; year view has twelve month columns for the anchor's calendar year. Groups expand into categories. Empty periods are zero. Totals include a clearly labeled uncategorized-outflow row.
- **Net spending** of an included leaf = −amount. Refunds reduce spending and can make a row or total negative.
- **Inclusion rule** (one rule, implemented only in `normalizeExpenseLeaves` plus the query filters):
  1. Source account must be on-budget. Closed accounts are included. Off-budget source rows (including the off-budget leg of a boundary transfer) are excluded.
  2. Split parents and tombstoned rows (including children of tombstoned parents) are excluded; split children are leaves.
  3. **On-budget-to-on-budget transfers**: both legs are excluded, regardless of category.
  4. Income-category rows are excluded.
  5. Expense-category rows (hidden categories and hidden groups included) are included under net spending. This covers the on-budget leg of a **boundary transfer** (on-budget ↔ off-budget) in either direction: an expense-categorized outflow to off-budget adds spending; an expense-categorized inflow from off-budget subtracts it.
  6. Rows with no category (null, or a deleted category that AQL resolves to null) are included in the uncategorized row only when amount < 0, including an uncategorized on-budget leg of a boundary transfer. Uncategorized inflows are excluded.
- The oracle for these rules is this contract and the §12 golden fixture. `getSumAmountsByMonth`, the Spending report, `makeQuery`, `categoryBalance`, and the fork's transfer filter are **not** oracles and are not called.
- Category IDs and income flags determine inclusion; labels, locale and `budget.showHiddenCategories` never do. Hidden-category history is shown, not dropped.
- Live edits, category changes, undo and sync update the same totals; switching budget/range never renders stale values; loading and error states render no amounts. The view supports keyboard disclosure, privacy masking, and narrow screens via a labeled horizontal scroll region that keeps row labels visible.
- Missing or invalid `budget.displayMode` renders Budget; missing or invalid `budget.expensePeriod` renders month. Neither case writes any pref.

Domain: expense means net budget outflow, not every negative bank transaction. Non-goals: new budgeting engine, automatic categorization, country-specific group rules, editable allocations, Excel import/export, replacement of existing reports, custom excluded-category settings.

| Acceptance                                                                                                                       | Evidence (§12)                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Golden month: Food 10500, Fees 8000, Old Hobby 900, uncategorized 700, total 20100; included leaf IDs exactly the seven listed   | Core AQL fixture (leaf IDs + spending) and client pure fixture (rows/groups/total)                                                             |
| Internal transfer excluded: uncategorized stays 700 (not 4700); `t-xfer-out`/`t-xfer-in` absent                                  | Same fixtures                                                                                                                                  |
| Split parent never counted: `t-split-parent` absent even though its amount equals its children                                   | Same fixtures                                                                                                                                  |
| Boundary transfer: on-budget leg counts once (Fees includes 6000); off-budget leg absent; reverse direction month = −1500        | Same fixtures + reverse-boundary month                                                                                                         |
| Refund-only month = −2500; deleted-category outflow month uncategorized = 400                                                    | Edge-month fixtures                                                                                                                            |
| Monthly/annual row, group and grand totals reconcile; leap February has 29 columns; year boundary lands in the right column      | Pure fixtures                                                                                                                                  |
| View switching and expense navigation write only the two display prefs; `budget.startMonth`, `budgetType`, allocations unchanged | `ExpenseView.test.tsx` (controls call no `budget.startMonth` setter) + desktop/mobile e2e (month header, budget type, budgeted cell unchanged) |
| Invalid/missing prefs fall back to Budget/month without writes                                                                   | `expenseData.test.ts` validators; both pages read prefs only through `parseDisplayMode` / `parseExpensePeriod`                                 |
| No stale values; exactly one `liveQuery` per range; zero after unmount; refresh error then next payload returns to values        | `useExpenseData.test.ts`                                                                                                                       |
| Privacy, keyboard disclosure, table headers, narrow scroll, two-tab live update                                                  | `ExpenseView.test.tsx`, e2e, manual smoke with recorded result                                                                                 |

## 4. Data / API shape

### Query (`buildExpenseRangeQuery`)

`buildExpenseRangeQuery({ start, endExclusive })` returns a `q('transactions')` query with `.options({ splits: 'inline' })` and filters `date >= start`, `date < endExclusive`, `account.offbudget: false`, `is_parent: false` (redundant with the inline executor's own `is_parent = 0`, kept for explicitness). The default alive view already excludes tombstoned rows and children of tombstoned parents; do not use `withDead` and do not switch to grouped splits. Do not filter closed accounts or hidden categories.

Select with explicit aliases: `id`, `date`, `amount`, `category` (ID; AQL `validateRefs` yields null for a deleted category), `category.is_income`, `payee.transfer_acct` (ID), `payee.transfer_acct.offbudget`. Joined fields are nullable (no payee, non-transfer payee, deleted category); tests cover each null.

### Normalization (`normalizeExpenseLeaves`)

`normalizeExpenseLeaves(rows): ExpenseLeaf[]` applies §3 rules 3–6 in that order and returns `{ id, date, categoryId: string | null, spending: IntegerAmount }` with `spending = -amount` and `categoryId = null` meaning the uncategorized row. It never reads names, locale, or `budget.showHiddenCategories`. Rules 1–2 live in the query filters above. Nothing else in the codebase re-implements these rules.

### Summary (`buildExpenseSummary`)

`buildExpenseSummary(leaves, categoryGroups, period, anchor)` returns `{ columns, groups, uncategorized, total }`; every category/group carries stable ID, name, keyed integer column totals and total. `categoryGroups` comes from `useCategories` (hidden included). A leaf whose `categoryId` is missing from the current list (transient sync race) is added to the uncategorized row so totals still reconcile, and self-corrects on the next category refresh. The summary is recomputed whenever leaves or category metadata change; category IDs are never cached beside leaves.

Anchor is `YYYY-MM` (month) or `YYYY` (year), validated before querying. Range is inclusive start / exclusive next period (`YYYY-MM-01` → first day of next month; `YYYY-01-01` → next year). Column assignment reads the AQL `YYYY-MM-DD` string with existing `#shared/months` helpers or string slicing; never construct a `Date` from the string (UTC shift).

### Anchor and preferences

`ExpenseView` keeps the anchor in local state seeded from its `initialMonth` prop. Its own controls change only that state. Later `budget.startMonth` changes while Expenses is mounted do not move the anchor. Period toggle keeps the anchor month and uses its year for year view. Only `budget.displayMode` and `budget.expensePeriod` are persisted, read through `useLocalPref` and validated at the page reader by `parseDisplayMode` / `parseExpensePeriod` (do not add schema logic to `useLocalPref`).

## 5. Runtime / loader / UX behavior

`useExpenseData({ budgetId, period, anchor })`:

- Calls `liveQuery(buildExpenseRangeQuery(range), { onData, onError })` once per `(budgetId, period, anchor)`. Each subscription gets a generation number; callbacks whose generation is not current, or that arrive after dispose, are ignored (this covers `liveQuery`'s unguarded late `onError`).
- Status machine: new generation → `loading`, `summary: null`. Current-generation `onData` → `ready` and clears any error. Current-generation `onError` → `error`, `summary: null`. A later current-generation `onData` (sync, undo, or edit refetch on the same subscription) returns to `ready` without remounting. `retry()` disposes the subscription and starts a new generation.
- `summary` is non-null only when `status === 'ready'`; raw rows are never returned. `useQuery.ts` is not changed.
- Category metadata comes from the existing `useCategories` hook, read inside `useExpenseData`; it is not a second `liveQuery`. Status stays `loading` until both leaves and categories are available, and the summary is rebuilt when either changes. Expected cardinality: exactly one active `liveQuery` per mounted `ExpenseView`, zero per cell, zero after unmount.

Rendering: `ExpenseView` is keyed by `budgetId` (resets anchor and expansion on in-tree budget change); the data-owning child is keyed by `budgetId`, period and anchor. Loading shows a labeled loading state; error shows a message with a Retry button; neither renders amounts. Use existing `Trans`, currency formatting, `FinancialText`, `PrivacyFilter`, and theme tokens. There is no Disclosure component: group toggles are `<button aria-expanded>` controls modeled on the `SidebarGroup` toggle, with in-memory expansion (not `budget.collapsed`). Day/month headers are table column headers with accessible names. The grid sits in a `role="region"` with an `aria-label` that scrolls horizontally while row labels stay visible; the page itself does not overflow horizontally. Desktop and mobile share `ExpenseView` and all calculations.

Optional: skip the parent `prewarmMonth` / `prewarmAllMonths` effect while display mode is `expenses` (without conditional hooks). Not required for correctness.

## 7. Authority and state ownership

- Ledger and category metadata: authoritative.
- `expense-range-query.ts`: sole owner of inclusion (query filters + normalization).
- `expenseData.ts`: sole owner of aggregation and pref validation.
- `useExpenseData.ts`: sole owner of subscription lifecycle and status.
- `ExpenseView.tsx`: owns anchor, period toggle, expansion (working state).
- Calendar body in `index.tsx` / `BudgetPage.tsx`: sole writer of `budget.startMonth`.
- `BudgetDisplayModeSelector` (desktop) and the `BudgetPageMenuModal` item (mobile): only writers of `budget.displayMode`; `ExpenseView`'s period toggle is the only writer of `budget.expensePeriod`.
- Persisted: two local display prefs. No summary writes, no new sync fields.

Dependency direction: page → `ExpenseView` → `useExpenseData` → shared query/normalize (`loot-core/shared`) → existing AQL → ledger. `loot-core` never imports `desktop-client`.

## 8. Proposed approach

### Ordered implementation batches

| Batch | Files and complete behavior                                                                                                                                                                                                              | Gate (must exit 0 / hold before next batch)                                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1    | `prefs.ts` keys; `expense-range-query.ts` + core fixture test; `expenseData.ts` + tests; `useExpenseData.ts` + lifecycle test; `BudgetDisplayModeSelector` and month-view `ExpenseView` mounted on desktop before the `initialized` gate | `yarn workspace @actual-app/core run test:node src/server/aql/expense-view-query.test.ts`; `yarn workspace @actual-app/web run test src/components/budget/expense-view/expenseData.test.ts src/components/budget/expense-view/useExpenseData.test.ts`; `yarn typecheck` |
| E2    | Year view, period toggle, group expansion, keyboard/privacy/headers/scroll, mobile mounting (expenses-mode header without `MonthSelector`, `BudgetPageMenuModal` toggle), desktop + mobile e2e                                           | E1 commands plus `yarn workspace @actual-app/web run test src/components/budget/expense-view/ExpenseView.test.tsx` and `yarn workspace @actual-app/web run playwright test e2e/expense-view.test.ts e2e/expense-view.mobile.test.ts --browser=chromium`                 |
| E3    | Remaining lifecycle cases (budget switch, undo), two-tab manual smoke, docs and release note                                                                                                                                             | All E2 commands; manual smoke recorded in `progress.md`; `yarn lint`                                                                                                                                                                                                    |

Notes:

- Do not start an E2/E3 file until the previous gate passes; revert only the failed slice. Keep unrelated report refactors separate.
- Extract only enough of each page body to mount one view at a time; allocation mutations, `onMonthSelect`, and prewarm stay with the existing budget implementation.
- Initial selector labels are Budget and Expenses, independent of envelope/tracking labels. The engine is still chosen through its existing setting.
- Adapt the pinned fork function for aggregation shape only; take inclusion rules from §3.

## 9. Migration

No ledger migration. Local prefs are budget-scoped (`${budgetId}-${prefName}`) and default to the existing Budget view. Returning to Budget or clearing the prefs restores the current UI. Old clients never read these keys. No change to the synced `budgetType` contract. Reverting the UI mount leaves the two keys in `localStorage` unread and harmless.

## 12. Verification plan

### Golden synthetic fixture (month 2025-03)

Setup: accounts `A1` Checking (on-budget, open), `A2` Old Card (on-budget, `closed = 1`, history retained), `A3` Brokerage (off-budget). Groups `Everyday` (Food, Fees) and hidden group `Archive` (hidden expense category Old Hobby). Income group with Salary.

| ID                      | Account | Amount      | Category / payee                                                       | Expected                      |
| ----------------------- | ------- | ----------- | ---------------------------------------------------------------------- | ----------------------------- |
| `t-expense`             | A1      | −10000      | Food                                                                   | included, spending 10000      |
| `t-refund`              | A1      | +2500       | Food                                                                   | included, spending −2500      |
| `t-split-parent`        | A1      | −5000       | split parent                                                           | **absent**                    |
| `t-split-food`          | A1      | −3000       | Food (child)                                                           | included, 3000                |
| `t-split-fees`          | A1      | −2000       | Fees (child)                                                           | included, 2000                |
| `t-xfer-out`            | A1      | −4000       | uncategorized, transfer → A2                                           | **absent**                    |
| `t-xfer-in`             | A2      | +4000       | uncategorized, transfer → A1                                           | **absent**                    |
| `t-boundary-on`         | A1      | −6000       | Fees, transfer → A3                                                    | included, 6000                |
| `t-boundary-off`        | A3      | +6000       | transfer → A1                                                          | **absent**                    |
| `t-uncat-out`           | A1      | −700        | none                                                                   | included (uncategorized), 700 |
| `t-uncat-in`            | A1      | +800        | none                                                                   | **absent**                    |
| `t-income`              | A1      | +20000      | Salary                                                                 | **absent**                    |
| `t-hidden`              | A2      | −900        | Old Hobby                                                              | included, 900                 |
| `t-dead`                | A1      | −300        | Food, tombstoned                                                       | **absent**                    |
| `t-dead-parent`         | A1      | −1200       | split parent, tombstoned                                               | **absent**                    |
| `t-dead-child-1` / `-2` | A1      | −700 / −500 | Food / Fees, children of tombstoned parent (not themselves tombstoned) | **absent**                    |

Expected: Food 10500, Fees 8000, Old Hobby 900 (Everyday 18500, Archive 900), uncategorized 700, total **20100**. Included leaf IDs are exactly `t-expense, t-refund, t-split-food, t-split-fees, t-boundary-on, t-uncat-out, t-hidden`.

Why this fails closed: counting `t-xfer-out` makes uncategorized 4700; counting the parent puts `t-split-parent` in the ID set (and uncategorized 5700); dropping the boundary on-leg makes Fees 2000 and total 14100; counting the off-budget leg, income, or tombstoned rows puts their IDs in the set. The 20100 total alone is not evidence for transfers or splits; the ID set and per-row values are.

Edge months: 2025-04 only `+2500` Food → total **−2500**. 2025-05 only `−400` on a tombstoned category → uncategorized **400**. 2025-06 only `+1500` Fees on A1 transferred from A3 → Fees and total **−1500**. 2024-02 anchor → 29 day columns; 2025-02 → 28. `−100` Food on 2024-12-31 and `−200` Food on 2025-01-01: year 2024 December column 100; year 2025 January column 200; month 2024-12 day-31 column 100. Year 2025 annual row/group/grand totals equal the sum of the twelve monthly summaries built from the same leaves. An empty month renders every column as 0.

### Test files and what each proves

- `packages/loot-core/src/server/aql/expense-view-query.test.ts`: uses `global.emptyDatabase()` and the existing AQL test patterns (`exec.test.ts`), inserts the golden and edge fixtures, runs `buildExpenseRangeQuery` imported from `#shared/expense-range-query`, passes rows to `normalizeExpenseLeaves`, and asserts the exact leaf ID set and spending values above plus null-join cases. It never restates filters.
- `packages/desktop-client/src/components/budget/expense-view/expenseData.test.ts`: feeds the expected leaf vectors (data, not rules) and category groups to `buildExpenseSummary`; asserts every row, group, uncategorized and total value, leap/boundary columns, annual = Σ monthly, missing-category fallback, and `parseDisplayMode('bogus') === 'budget'`, `parseExpensePeriod('week') === 'month'`, `undefined` → defaults.
- `packages/desktop-client/src/components/budget/expense-view/useExpenseData.test.ts`: spies on `#queries/liveQuery` with a controllable fake. Asserts: one `liveQuery` call per key (month and year keys alike) and none added by rerender; status stays `loading` while categories are unavailable even if leaves arrived; key change unsubscribes the old one before data arrives and status is `loading` with `summary === null` (no previous values); a late `onData` or `onError` from an old generation or after unmount is ignored; current `onError` → `error`, `summary === null`; next `onData` on the same subscription → `ready` with values; `retry()` creates a new subscription; after unmount zero subscriptions are active.
- `packages/desktop-client/src/components/budget/expense-view/ExpenseView.test.tsx`: privacy on → amount text masked, off → visible; Tab reaches a group toggle, Enter/Space flips `aria-expanded` and shows category rows; day/month column headers have accessible names; scroll region has a label; loading/error render no amounts; own month controls change the anchor and call no `budget.startMonth` setter.
- `packages/desktop-client/e2e/expense-view.test.ts` (desktop): note Budget's month header, budget type and one budgeted cell; switch to Expenses; navigate back to January and to year view; switch to Budget; assert the same month header, budget type and budgeted value. Screenshot on failure (Playwright default).
- `packages/desktop-client/e2e/expense-view.mobile.test.ts`: sets viewport 350×600 in the test (as `budget.mobile.test.ts` does; there is no mobile project). Note the header month; open the budget page menu and choose Show expenses; assert the header has no month selector; use the expense view's own month controls; assert the grid region's `scrollWidth > clientWidth` while the document's `scrollWidth <= clientWidth`; switch back and assert Budget's month is unchanged.

### Manual two-tab smoke (E3)

Setup: `yarn start:server-dev`, one synced budget with the golden month, two browser sessions on Expenses/2025-03. Steps: in session A change `t-expense` from −10000 to −11000. Expected: session B total becomes 21100 without reload. Failure signal: B still shows 20100, shows a blank grid, or shows another budget's values. Artifact: note both totals and time in the `progress.md` execution log (screenshot optional). Repeat with undo in A; B returns to 20100.

### Performance smoke

Cardinality is proven in `useExpenseData.test.ts` (year key → one `liveQuery` call regardless of column count). In the browser, seed a synthetic year with a few thousand transactions, open year view, and record row count and time-to-render in `progress.md`. No numeric target.

### Command summary

- `yarn workspace @actual-app/core run test:node src/server/aql/expense-view-query.test.ts` (core `test` is `npm-run-all` and cannot select a file)
- `yarn workspace @actual-app/web run test src/components/budget/expense-view/expenseData.test.ts src/components/budget/expense-view/useExpenseData.test.ts src/components/budget/expense-view/ExpenseView.test.tsx`
- `yarn workspace @actual-app/web run playwright test e2e/expense-view.test.ts e2e/expense-view.mobile.test.ts --browser=chromium`
- `yarn typecheck`, `yarn lint`

Checks are implemented; see `implementation.md` and `progress.md` for results, D5's cross-tab follow-up and remaining verification limits.

## 13. Documentation notes

Add a display-mode section to `packages/docs/docs/tour/budget.md` and `upcoming-release-notes/expense-budget-view.md`. Explain net refunds, transfers across the budget boundary, hidden/closed-account history and display-only behavior. Keep the plain Budget label independent of envelope/tracking mode translations.

Task-folder docs: `plan.md` (this file, canonical) and `progress.md` (status, acceptance trace, defer register, execution log). The review-panel artifacts were absorbed into this plan during the 2026-09-27 fix loop and deleted; see the `progress.md` execution log.

## 14. Open questions / deferred items

None blocking. Deferred with rationale:

- Custom excluded-category settings: no concrete use case.
- Hidden **income** category overlap: income flag excludes it regardless of hidden state (rule 4); no fixture row, since rule order already decides it.
- Automated rollback test (revert mount with prefs set): prefs are only read by the new code; §9 states the outcome and a revert is trivially observable.
- Skipping spreadsheet prewarm in Expenses mode: optional optimization (§5).
