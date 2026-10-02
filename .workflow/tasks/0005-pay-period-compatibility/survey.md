Last Edited: 2026-09-27

# Survey: pay-period consumers, owners and source delta

Scope: study step 1 of `plan.md` §8. All paths are relative to `packages/` unless absolute. "Local" = this repo at `9a71fd22`; "fork" = `code-with-jov/actual-pay-periods@62128aa6`. Hashes and fetch details: `probes/source-manifest.json`.

## Sources

| Source            | Reference                                                                                                                                                                    | Status    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Fork              | `62128aa6e24a957e1e85db2ebc7cd43fccfb995b`, fetched to `%TEMP%/pp-study/fork`                                                                                                | fetched   |
| Upstream baseline | merge base `62a18ba7` (2026-09-01, "fix release automation with branch protection (#8842)"); fork is 47 commits ahead, 116 files changed; local HEAD contains the merge base | computed  |
| ADR-0006          | `lefevreste/budget-fr@8e099312`, file last changed `4baa7dac` (2026-09-09)                                                                                                   | fetched   |
| Local             | HEAD `9a71fd22`, Node v26.3.0, root `date-fns` 4.4.0 (fork lockfile 4.4.0)                                                                                                   | recorded  |
| Task 0002 plan    | SHA-256 `A0B61A77…FEF6` at study start; changed to `710F34B6…383A` mid-study by other work (17:11); re-read, contract lines 54/97/143/150 unchanged                          | read-only |

## Fork delta (verified implementation, not docs claims)

Pay-period feature files (new): `loot-core/src/shared/pay-periods.ts` (pure period math), `shared/pay-period-config.ts` (module-singleton registry), `server/budget/pay-period-config.ts` (reads four prefs, rebuilds sheets), `desktop-client/.../settings/PayPeriodSettings.tsx`, `hooks/usePayPeriodConfig.ts`, `hooks/useTogglePayPeriods.ts`, `reports/BudgetDataUnavailable.tsx`, docs page `docs/experimental/pay-periods.md`, six server tests plus `shared/pay-periods.test.ts`, two Playwright suites.

Modified core (all verified in `git diff 62a18ba7 62128aa6`):

- `shared/months.ts` (+286): `_parse`, `nextMonth`, `prevMonth`, `addMonths`, `subMonths`, `bounds`, `_range`, `getYearStart/End`, `nameForMonth` dispatch on `isPayPeriod(id)` and throw via `requirePayPeriodConfig` when no config is active. New: `budgetMonthFromDate`, `currentBudgetMonth`, `resolveStartMonth`, `budgetColumnDayRange`, `budgetColumnDistance`, `budgetColumnForCalendarMonth`, `addMonthsToDay`. `isValidYearMonth` unchanged (still rejects MM > 12).
- `server/budget/actions.ts`: `setBudget` unchanged (same tables, `dbMonth` gives `202613`); new `hasBudgetedAmount` (direct table read, both modes); `getFirstActivityMonth` restricted by `month % 100 BETWEEN` to the active ID space.
- `server/budget/base.ts`: `getBudgetRange` and `getSumAmountsByMonth` gain period branches (day-grouped spend bucketed by `budgetMonthFromDate`); `handleTransactionChange` routes by `budgetMonthFromDate`; `createAllBudgets` uses `currentBudgetMonth`; `setType` split into `rebuildBudgets`.
- `server/budget/app.ts`: `isCategoryTransferRequired` → `hasBudgetedAmount`.
- `server/sync/index.ts`: `applyMessages` flags pay-period pref rows and calls `refreshPayPeriodConfig()` after commit and cache barrier.
- `server/preferences/app.ts`: `saveSyncedPrefs` calls `refreshPayPeriodConfig()` per saved pay-period pref id.
- `server/budgetfiles/app.ts`: `_loadBudget` sets the registry before sheets are built; `closeBudget` clears it.
- `server/api.ts`: `api/budget-set-amount` now calls `validateMonth`. Nothing else in the API changed.
- `server/undo.ts`: `preferences` undo writes `value = null` (no tombstone column); excluded from resurrection.
- `server/aql/compiler.ts`: multiple operators on one field are ANDed (for `{ $gte, $lte }` period date filters).
- `types/prefs.ts`: feature flag `payPeriodsEnabled`; synced prefs `showPayPeriods`, `payPeriodFrequency`, `payPeriodStartDate`.
- Reports: `budgetDataQuery.ts` and `budget-analysis-spreadsheet.ts` return early when `payPeriodsActive()`; UI renders `BudgetDataUnavailable`; Sankey falls back to Spent; Spending hides Budgeted.

Not touched by the fork (verified by `git diff --name-only`): migrations, `server/sync/serialization.ts`, `server/cloud-storage.ts`, `server/importers/*`, `packages/api/*`, `packages/cli/*`, `server/transactions/*`.

## Owner tuple

| Field                      | Current owner (local, verified)                                                                                                                                                              | Fork owner                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Period identity            | `shared/months.ts` (`YYYY-MM`, `isValidYearMonth` rejects `2026-13`, `range`, `sheetForMonth`)                                                                                               | Same module, dispatching `MM ≥ 13` to `shared/pay-periods.ts` with the config from the `shared/pay-period-config.ts` registry. Identity is **ordinal within a calendar year** (`${year}-13` = first period starting in January), derived from four preference rows. |
| Assignment writer per mode | `actions.ts` `setBudget` → `zero_budgets` (envelope) / `reflect_budgets` (tracking), id `` `${dbMonth}-${category}` ``; `setBuffer` → `zero_budget_months.id` `YYYY-MM` text (envelope only) | Unchanged writer and tables. Calendar (`MM 01–12`) and period (`MM 13–99`) rows share the `month` column; no cadence stamp on rows.                                                                                                                                 |
| Bank-date spend            | `base.ts` `getSumAmountsByMonth` (`t.date / 100`), `handleTransactionChange` (`monthFromDate`)                                                                                               | Period branch groups by day and buckets by `budgetMonthFromDate`; transaction dates never written.                                                                                                                                                                  |
| Derived sheet              | `sheet.ts` `loadUserBudgets` paints `budget${month}` from the integer column; `base.ts` `handleBudgetChange` via `sheetForMonth`                                                             | Same; `rebuildBudgets` clears `createdMonths` and recomputes for the active mode only.                                                                                                                                                                              |
| Cadence/mode lifecycle     | `preferences` row `budgetType`, applied post-commit with sheet rebuild (`sync/index.ts` `applyMessages` → `setBudgetType`)                                                                   | Four independent `preferences` rows; `refreshPayPeriodConfig` post-commit (sync) or per saved id (local), rebuild when the validated config differs.                                                                                                                |

## Consumer map (plan §8 order; every path resolved in the local tree)

### 1. API/CLI contract

- `api/methods.ts`: `getBudgetMonths` (l.141), `getBudgetMonth` (l.145), `setBudgetAmount` (l.149), `setBudgetCarryover` (l.157), `exportBudget` (l.87), `importBudget` (l.61). Months are `YYYY-MM` strings; amounts are integer minor units.
- `loot-core/src/server/api.ts`: `validateMonth` (l.90) = regex `^\d{4}-\d{2}$` then membership in exclusive `monthUtils.range(start, end)`; skipped when `IMPORT_MODE`. `api/budget-months` (l.385) returns the exclusive range, omitting the last created month. `api/budget-month` validates; `api/budget-set-amount` (l.468) does **not** validate locally (the fork adds it).
- `cli/src/commands/budgets.ts`: `months` → `api.getBudgetMonths()`; `month <month>` documented as `YYYY-MM`.
- Current behavior: calendar-only. Fork behavior: while periods are on, the same methods return and accept period ids; calendar months are rejected by `validateMonth` except in `IMPORT_MODE`. Risk: scripts that format dates into `YYYY-MM` break (fork docs "Pay Periods and the API"). Preservation: callers must use `getBudgetMonths()` output; no public type distinguishes the two ID spaces.

### 2. Budget core, both modes

- `server/budget/{base,envelope,tracking,actions}.ts`, `shared/months.ts`, `server/sheet.ts` `loadUserBudgets` (l.200), `aql/schema/index.ts` (`reflect_budgets` l.185, `zero_budgets` l.194; `zero_budget_months` absent), `server/undo.ts` (datasets `zero_budget_months`, `zero_budgets`, `reflect_budgets` at l.187–189, l.249–251).
- Key encodings: category allocation `month` integer `YYYYMM`; envelope buffer id `YYYY-MM` text. Envelope `leftover`/`carryover`/`to-budget`/`buffered` static cells chain from `prevSheetName`; tracking `leftover` is dynamic from `prevSheetName!carryover`/`leftover` (`tracking.ts` l.23–43).
- Fork behavior: period sheets `budget202613` chain from `prevMonth` = previous period; the envelope blank sheet is reset on rebuild. Risk: the other mode's rows stay in the table but have no sheet (P06/P07). Preservation: rows are never deleted by a mode switch.

### 3. Templates

- `server/budget/category-template-context.ts` (`runSimple` returns `template.monthly` per column, fork l.711–723), `schedule-template.ts` (`runSchedule`), `goal-template.ts` (`applyTemplate`, `applyMultipleCategoryTemplates`, writes via `setBudget`).
- Fork behavior: windows ("by", limits, schedules) converted to columns via `budgetColumnDistance` / `budgetColumnForCalendarMonth`; plain fixed amounts are per column. Evidence in `compatibility.md` P08.

### 4. UI and reports

- `desktop-client/src/components/budget/index.tsx`: `currentMonth()` (l.40), local pref `budget.startMonth` (l.46). Fork: `currentBudgetMonth()` + `resolveStartMonth` sanitizes a stale stored month.
- `components/mobile/budget/BudgetPage.tsx`: `currentMonth()` (l.89), `budget.startMonth` (l.90–91). Fork changes the same way.
- `reports/spreadsheets/budgetDataQuery.ts`: `rangeInclusive` of calendar months (l.210), `envelope-budget-month` / `tracking-budget-month` (l.218–219). `budget-analysis-spreadsheet.ts`: calendar `rangeInclusive` (l.296) and hardcoded `envelope-budget-month` (l.309, l.331); the hardcoding lives in the spreadsheet, not `BudgetAnalysis.tsx`. Fork: both return early while periods are on and show `BudgetDataUnavailable`.
- `reports/graphs/SpendingGraph.tsx` (`selection: 'budget'`, l.50, l.114), `reports/ReportOptions.ts` (Budgeted balance type l.52–54), `reports/reports/Sankey.tsx` (`GraphMode 'budgeted'`, l.83–104): budget comparisons. Fork: disabled or fallback to Spent.
- `reports/reports/BalanceForecast.tsx`: schedule-based forecast (`useBalanceForecast`, `countForecastScheduledOccurrences`); no budget-month dependency. Fork: untouched.
- `server/transactions/transaction-rules.ts` `case 'month'` (l.593): string bounds `value.date + '-00'..'-99'`; a `2026-13` value would match no date. Fork: untouched (rules stay calendar).
- `types/prefs.ts` `SyncedPrefs`: fork adds three ids + one flag.

### 5. Sync/import/export

- `server/sync/index.ts` `applyMessages`/`compareMessages` (l.294, l.445): per-cell LWW; a message is old when `messages_crdt` holds a `timestamp >=` for that `(dataset, row, column)`. `budgetType` applied post-commit.
- `server/sync/serialization.ts`: tags `0:` / `N:` / `S:` (l.28–32); `202613` is an ordinary `N:` value. `serialization.test.ts`, `sync.property.test.ts` (fixture has no budget tables), `deferred.test.ts` exist.
- `server/budgetfiles/app.ts` (load/close), `server/importers/index.ts`, `server/importers/actual.ts` `importActual` (closes budget, `importBuffer`, deletes kvcache, `load-budget`), `server/cloud-storage.ts` `exportBuffer` (l.145: zips `db.sqlite` minus kvcache + `metadata.json`).
- Fork: none of these files changed except `sync/index.ts` and `budgetfiles/app.ts`. Export carries both modes' rows and all four pref rows inside `db.sqlite`.

## Task 0002 contract comparison (`source-backed analysis`)

Task 0002's plan (hashes above; re-read after the mid-study change) is a read-only reservation breakdown: opt-in flag, **envelope only, current calendar month**, handler rejects unless `month === monthUtils.currentMonth()` and `!isTrackingBudget()` (plan l.54, l.143, l.150); pay periods are an explicit non-goal (l.97). `server/budget/reservations.ts` does not exist. Under the fork, `currentMonth()` remains calendar while budget columns are periods, so a 0002 panel keyed by column month would never match and would stay hidden — fail-closed, no period ids enter reservation math. No reservation probe was written. The 0002 folder was not edited.

## ADR-0006 relation

ADR-0006 assigns **transactions** to a budget month via `manual_budget_period` (`INTEGER YYYYMM`) and a single-cell `rule_assignment` composite; its validator rejects months outside `01`–`12`. It is a calendar-month reassignment design, not a paycheck-column model. Relevant as evidence: it rejects "three independent columns" because independent LWW cells converge to torn tuples, which is the same structure as the fork's four independent cadence preference rows (P09 variant), and it lists "old client receiving an unknown column" and mixed-client compatibility as critical open gates.
