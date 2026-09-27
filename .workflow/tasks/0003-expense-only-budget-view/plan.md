Last Edited: 2026-09-27

# Plan: expense-only budget display

Verdict: **ready for review-plan**. Priority 2. Execution: AFK after review; independent of reservations.

## 1. Current state

`packages/desktop-client/src/components/budget/index.tsx` reads synced `budgetType` to select envelope/tracking calculations. Mobile has `components/mobile/budget/BudgetPage.tsx`. Existing Spending and BudgetAnalysis reports cover related analysis but do not provide the proposed expandable category-by-day/year grid. Shared transaction queries and spending reports already encode budget-side inclusion rules.

Reference: [ejina21 expenseData.ts](https://github.com/ejina21/actualFinance/blob/85407067736c8bf2441ab8db4e863182522a15bf/packages/desktop-client/src/components/budget/expense-view/expenseData.ts) and adjacent tests/spec. Its Russian group-name exclusions and blanket transfer exclusion are deliberately not adopted. Recheck implementation against target before adapting.

## 2. Target shape

Add client `components/budget/expense-view/{expenseData.ts,expenseData.test.ts,ExpenseView.tsx,ExpenseView.test.tsx,useExpenseData.ts}`. Wire a Budget/Expenses view selector in desktop/mobile budget page owners without adding an engine type. Add typed LocalPrefs in `packages/loot-core/src/types/prefs.ts`: `budget.displayMode: 'budget' | 'expenses'` and `budget.expensePeriod: 'month' | 'year'`. They use existing budget-scoped `useLocalPref`; missing/invalid values fall back to budget/month.

Query source transactions through existing AQL/live-query machinery, normalized to date, integer amount, stable category ID and required account/transfer metadata. One range subscription feeds a pure aggregation function. No new DB tables, worker API, imported workbook, or dependency. Add focused desktop/mobile e2e files and docs/release note; delete nothing.

## 3. Contract

- Choosing Expenses changes presentation only. Budget mode, allocations, dates and ledger remain untouched; switching back preserves the selected budget month.
- Month view has one column per real calendar day; year view has twelve month columns. Groups expand into categories. Empty periods are zero. Totals include a clearly labeled uncategorized-outflow row.
- Net spending is negative transaction amount for expense-category leaf rows; refunds reduce it and can produce negative net spending. Include on-budget activity, including closed accounts' historical activity and hidden categories. Exclude income, tombstoned transactions, off-budget source accounts, split parents and on-budget-to-on-budget transfers. Categorized on-budget-to-off-budget transfers follow existing budget spending semantics and count once; do not blindly copy the fork's transfer filter.
- Category IDs and income flags determine inclusion; labels and locale never determine business rules. A missing/deleted category with an outflow goes to uncategorized; uncategorized inflows are excluded. Preserve ordinary hidden-category history instead of silently dropping it.
- Live edits, category changes, undo and sync update the same totals; switching budget/range cannot display stale data. The view supports keyboard use, privacy masking and narrow screens with a labeled horizontal scroll region.

Domain: expense means net budget outflow, not every negative bank transaction. Non-goals: new budgeting engine, automatic categorization, country-specific group rules, editable allocations, Excel import/export and replacement of existing reports.

| Acceptance                                                                                         | Evidence                                               |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Expense -10000 and refund +2500 produce spending 7500; split parent is never counted with children | Pure fixtures plus real AQL integration fixture        |
| On-budget internal transfer contributes 0; categorized off-budget transfer contributes once        | Parity fixture against budget/spending query semantics |
| Monthly and annual row/group/grand totals reconcile                                                | Leap February, empty month, year-boundary tests        |
| View switching changes no engine/ledger data                                                       | Preference/mutation assertions and e2e                 |
| Narrow screen, privacy and live updates remain usable                                              | Component/e2e and two-tab manual smoke                 |

First checkpoint is one complete month view, then year/mobile expansion. Revert only the failed slice; keep unrelated report refactors separate. Main risks: misleading transfer totals, double-counted splits, and loading every transaction unnecessarily.

## 4. Data / API shape

`buildExpenseSummary(rows, categoryGroups, period, anchor)` returns `{ columns, groups, uncategorized, total }`; every category/group carries stable ID, name, keyed integer totals and total. Validate anchor (`YYYY-MM` or `YYYY`) before querying. Range predicates are inclusive start/exclusive next period. Normalize AQL split/account metadata at the query boundary so the aggregator does not reimplement joins. Use existing calendar utilities; avoid UTC conversion of local date strings.

## 5. Runtime / loader / UX behavior

Keep one subscription per visible range, not per cell. Subscribe to category metadata too so recategorizing or renaming updates correctly. Filter date range in AQL, then aggregate in linear time over rows plus rendered cells. Use stable content keys and dispose listeners on range change/unmount; abort/discard responses for old budgets. Loading/error is explicit; do not substitute stale totals. Use existing Trans/i18n, currency formatting, FinancialText, theme tokens, privacy and disclosure components. Narrow layout scrolls the grid while retaining row labels; desktop and mobile share calculations.

## 7. Authority and state ownership

Ledger and category metadata remain authoritative; query normalization owns accounting inclusion at the input boundary, `expenseData.ts` owns the pure sum. Working state: current range/expansion. Derived/cache: rows and summary for that budget/range. Persisted state: two local display preferences only. No summary writes or new sync fields. Dependency direction: page → shared expense view/hook → existing AQL → authoritative ledger; renderer consumes pure output.

## 8. Proposed approach

1. **AFK: month display end to end.** Adapt the pinned pure function with current accounting semantics and ID-based grouping; test refunds, split leaves, transfers, closed/hidden history and uncategorized data. Build one range query and wire desktop view selector/month grid. Checkpoint: synthetic fixture sums match current budget activity, switching views writes only display preference.
2. **AFK: annual and mobile review.** Add year/month navigation and grouped expansion, reuse in mobile BudgetPage, and prove leap-year/empty-period totals, horizontal scrolling, keyboard and privacy behavior. Checkpoint: one-year and equivalent twelve-month sums agree; no horizontal page overflow outside the grid.
3. **AFK: live lifecycle and documentation.** Exercise edits/undo/incoming sync, range/budget switching and remount cleanup with hook/component tests and a two-tab browser run. Add user docs on inclusion rules and release note. Checkpoint: all acceptance rows have recorded evidence; existing reports and budget navigation continue working.

## 9. Migration

No ledger migration. Local preferences are budget-scoped and default to existing Budget view. Returning to Budget or removing local preferences restores the current UI. Old clients ignore these local keys. No change to the synced `budgetType` contract.

## 12. Verification plan

Root commands: `yarn workspace @actual-app/web run test src/components/budget/expense-view/expenseData.test.ts src/components/budget/expense-view/ExpenseView.test.tsx`; `yarn workspace @actual-app/web run playwright test expense-view.test.ts expense-view.mobile.test.ts --browser=chromium` after those tests are added; `yarn typecheck`. Include an AQL fixture exercising actual grouped/ungrouped split behavior, not only mocked rows. Synthetic large-range smoke must show one data subscription and no per-cell queries; record fixture size/runtime rather than inventing a performance target. All new checks remain planned.

## 14. Open questions / missing info

None blocking the bounded port. The selected accounting rules intentionally differ from the source's workbook-specific exclusions; review them before implementation. Custom excluded-category settings are deferred unless a concrete use case is later requested.
