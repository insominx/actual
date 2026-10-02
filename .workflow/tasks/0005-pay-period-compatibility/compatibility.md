Last Edited: 2026-09-27

# Compatibility: pay periods against the calendar budget core

Study deliverable for `plan.md` §2. Evidence labels follow `plan.md` §12: `reproduced` (vendored pure code vs a fixed oracle, P01–P04 only), `source-backed analysis` (quoted source/test), `model-evidence` (P09 only), `unknown`. "Fork" = `code-with-jov/actual-pay-periods@62128aa6`; "local"/"old client" = this repo at `9a71fd22` (upstream code without pay periods). Anchors: `survey.md`; hashes: `probes/source-manifest.json`.

**Bottom line:** the fork's period math is sound (P01–P04 reproduced). Its storage identity is not: allocations are keyed by an ordinal period number within a calendar year, with no cadence stamp. Their date range therefore changes under a cadence change (P05, P06) and under concurrent sync (P09), and old clients silently lose sight of them (P10). **Full port: defer.** A read-only paycheck planning view is the only option that adds paycheck visibility while all four invariants hold; no-port remains valid.

## Evidence records

Shared fields for P01–P04 and P09: `command` = `node --test ".workflow/tasks/0005-pay-period-compatibility/probes/*.test.mjs"` (from repo root; the glob must be quoted in PowerShell), `exit_code` = 0 (9/9 tests pass, first run), `node_version` = v26.3.0, `harness_error` = empty. The only stderr is Node's `MODULE_TYPELESS_PACKAGE_JSON` warning for the vendored `.ts` (ESM syntax detection). That warning is a load diagnostic, not a failure. Parent `TZ` was unchanged before and after P04.

Ledger-only records (P05–P08, P10) use `command: n/a (source reading)`, and the quoted anchors take the place of `exit_code`.

### P01 — weekly anchor 2026-01-02

- `evidence_label`: **reproduced**
- `expected` (oracle fixed before first run): the period containing 2026-01-02 is `2026-13` (2026-01-02..01-08); the period containing 2025-12-31 is `2025-64` (2025-12-26..2026-01-01). Every date from 2025-12-20 to 2026-02-10 has a start equal to the UTC 7-day lattice start and an end at start + 6. The ids run `2025-63, 2025-64, 2026-13…2026-18` with no gaps. 2025 and 2026 each have 52 periods.
- `actual`: identical (test `P01 …` passes).
- `compatibility_note`: none for date math. Ids are **year-scoped ordinals**: the same weekly cadence names the 2025-12-26 week `2025-64`, and a period can span the year boundary. This matters for P05, P06 and P09.

### P02 — biweekly anchor 2026-01-02, all of 2026

- `evidence_label`: **reproduced**
- `expected`: 26 starts (01-02, 01-16, 01-30, … 12-04, 12-18) with ids `2026-13…2026-38`. Each period is 14 days with no reset at month boundaries, and the last one ends 2026-12-31. Three-paycheck months are `2026-01` and `2026-07`.
- `actual`: identical.
- `compatibility_note`: 26 columns per year feed the P08 annual totals.

### P03 — monthly anchor Jan 31 (2027, 2028)

- `evidence_label`: **reproduced**
- `expected`: 2027 starts Jan 31, Feb 28, Mar 31, Apr 30 … Dec 31. 2028 starts Feb 29 (leap year), then Mar 31. `2027-14` covers 2027-02-28..03-30 and `2028-14` covers 2028-02-29..03-30. 2027-01-15 falls in `2026-24` (2026-12-31..2027-01-30). Anchors 2027-01-31 and 2028-01-31 give the same 2028 periods.
- `actual`: identical.
- `compatibility_note`: a "monthly" period is not a calendar month. Every January date before the anchor day belongs to the previous year's id, so `2026-24` ≠ calendar `2026-12`.

### P04 — DST windows, two time zones

- `evidence_label`: **reproduced**
- `expected`: for weekly and biweekly cadences with anchor 2026-01-02, over 2026-03-01..03-15 and 2026-10-25..11-08, at local hour 0 and hour 12, each date maps to the same `yyyy-MM-dd` period start as the UTC lattice. The two child processes (`TZ=UTC` and `TZ=America/Los_Angeles`) must produce identical maps. Each child must also prove its time zone took effect: UTC offsets `[0,0,0,0]`, LA offsets `[480,420,420,480]`.
- `actual`: identical maps, offsets as expected, and the parent `TZ` was unchanged.
- `compatibility_note`: none. Local-noon construction plus `differenceInCalendarDays` holds up under DST even when dates are built at local midnight.

### P05 — cadence switch weekly → monthly

- `evidence_label`: **source-backed analysis**
- `command`: n/a (source reading). The date ranges come from the vendored `fixture ranges` test (exit 0).
- `expected` ledger fields: {category, stored key, amount, range before, range after}.
- `actual`:

| category | stored key                                        | amount | range before (weekly)           | range after (monthly, same anchor) |
| -------- | ------------------------------------------------- | ------ | ------------------------------- | ---------------------------------- |
| food     | `zero_budgets` id `202613-food`, `month = 202613` | 10000  | 2026-01-02..2026-01-08 (7 days) | 2026-01-02..2026-02-01 (31 days)   |

- Anchors: `actions.ts` `setBudget` / `dbMonth` (unchanged in the fork; key has no cadence); `server/budget/pay-period-config.ts` `refreshPayPeriodConfig` → `rebuildBudgets` (sheets only, rows untouched); `sheet.ts` `loadUserBudgets` repaints `budget202613` from the same row. Fork docs, "Changing the Cadence Rebuilds Your Columns": "The stored amounts keep their period numbers, but those numbers now describe different date ranges … expect to budget again."
- `compatibility_note`: **fails adoption.** The ranges differ. The only disclosure is in the docs: `PayPeriodSettings.tsx` saves the frequency on change and shows only "Rebuilding your budget…", with no warning or confirmation. At the moment of change, the user sees a silent reinterpretation, which violates invariant "allocations never silently change date-range meaning". A 7-day allocation now funds a 31-day column. Transaction dates are unchanged.

### P06 — highest weekly ordinal, switch to monthly and back

- `evidence_label`: **source-backed analysis**
- `actual`:

| key                                                       | amount | row present?                                                                   | visible under monthly?                                                                                                                                                                                                                                 | visible after switch back?                                                                                    |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `202664-food` (weekly 2026-12-25..12-31, the 52nd period) | 10000  | yes, before and after every step (no fork code deletes or updates budget rows) | **no**: monthly 2026 has only `2026-13…2026-24`; `getPayPeriodBounds('2026-64')` throws "does not exist for the monthly cadence" (fixture test); `getBudgetRange`/`createAllBudgets` never create sheet `budget202664`; `resolveStartMonth` rejects it | yes, same range, provided `payPeriodStartDate` is unchanged (the weekly lattice is recomputed from the prefs) |

- Anchors: `shared/months.ts` `resolveStartMonth` doc comment ("'2026-40' is period 28 of a weekly year, and a monthly cadence only reaches '2026-24'"); `actions.ts` `hasBudgetedAmount` (still counts the row, so a category delete prompts a transfer); fork docs: "amounts in periods past the new schedule's count … stop being shown at all".
- `compatibility_note`: **fails adoption** (present but invisible; disclosed only in docs). Inference: envelope `to-budget` is computed from created sheets only, so while the cadence is monthly the 10000 is not deducted and looks available. Budgeting it again and then switching back would double-allocate. This is marked as inference because no fork test covers it.

### P07 — calendar + period allocations, disable/re-enable, export → import

- `evidence_label`: **source-backed analysis**
- Fixture: calendar row `202601-food` = 5000; period row `202613-food` = 10000 (weekly); one transaction dated 2026-01-05, −2500, on-budget account.

| step                                   | calendar rows | period rows | transaction dates | account totals | visible mode                                                                                                                                  |
| -------------------------------------- | ------------- | ----------- | ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| periods on                             | 1 (5000)      | 1 (10000)   | 2026-01-05        | −2500          | periods: `2026-13` shows 10000                                                                                                                |
| disable (`showPayPeriods = 'false'`)   | 1 (5000)      | 1 (10000)   | unchanged         | unchanged      | calendar: `2026-01` shows 5000; period row invisible                                                                                          |
| re-enable                              | 1             | 1           | unchanged         | unchanged      | periods again, same range if cadence prefs unchanged                                                                                          |
| `exportBudget` → `importBudget` (fork) | 1             | 1           | unchanged         | unchanged      | mode restored: the four pref rows are inside `db.sqlite`; `_loadBudget` calls `setPayPeriodConfig(loadPayPeriodConfig())` before sheets build |
| same export imported by an old client  | 1             | 1           | unchanged         | unchanged      | calendar only; period rows are orphan cells (see P10)                                                                                         |

- Anchors: `base.ts` `rebuildBudgets` (clears `createdMonths` and sheet cells, not DB rows); fork test `pay-period-config.test.ts` "deactivates and rebuilds calendar sheets when prefs turn pay periods off"; `cloud-storage.ts` `exportBuffer` (zips `db.sqlite` minus kvcache) and `importers/actual.ts` `importActual` (both untouched by the fork); fork diff contains no budget-row delete/update and no transaction write (period `date` terms in `spreadsheet/bindings.ts` are read filters).
- §11 undo: the fork's `undo.ts` undoes a first-time preference write as `value = null`, which `loadPayPeriodConfig` treats as disabled; undoing a cadence edit restores the previous value.
- `compatibility_note`: **passes** for fork-only clients: no count, amount or date changes, and the visibility change on disable is disclosed ("Pay Period and Calendar Month Budgets Are Kept Separately"). Mixed-client restore fails under P10. Invariant "existing monthly data remains recoverable" holds: calendar rows are never touched. No fork test performs an actual export/import round trip; that would need integration evidence.

### P08 — templates under a biweekly cadence

- `evidence_label`: **source-backed analysis**

| template                            | calendar reference / yr | fork per column                                                   | fork / yr (26 columns, P02) | source                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------- | ----------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fixed `#template 50` (5000/month)   | 60000                   | 5000                                                              | **130000**                  | `category-template-context.ts` `runSimple` returns `template.monthly` per column (fork l.711–723); docs: "`#template 50` budgets $50 into every budget column … about $108 a month on a two-week cycle"                                                                      |
| rent schedule 120000/month          | 1440000                 | 120000 in the one period containing the due date, 0 in the others | 1440000                     | `schedule-template.pay-periods.test.ts` "funds a monthly schedule once across the pay periods of a calendar month" (weekly config): `expect(budgeted).toEqual([0, 0, 10000, 0])`. The biweekly case uses the same `runSchedule` path; it is inferred and not directly tested |
| `up to 600` monthly limit (context) | 60000 cap               | 13799 on a weekly column (600 × 7 / 30.4375)                      | ≈ monthly cap               | same test file, "pro-rates a monthly limit to the column"                                                                                                                                                                                                                    |

- §11: carryover chains column to column (`prevMonth` = previous period); cross-month bills are funded wholly in their containing period (docs "Monthly Schedule Templates Fund the Bill in One Period").
- `compatibility_note`: the fixed template's annual total ≠ reference (130000 vs 60000), disclosed in the docs only; this **fails adoption unless it is surfaced in-app**. The schedule's annual total matches the reference, but the timing is lumpy (disclosed).

### P09 — concurrent cadence change vs allocation write (model)

- `evidence_label`: **model-evidence** (never sync proof)
- `command`: shared (`sync-order.test.mjs`, 4 tests pass).
- Model: per-cell LWW, taken from `sync/index.ts` `compareMessages`, where a message is old when `messages_crdt` has `timestamp >=` for the cell. Client B (weekly) writes 10000 on K = `202614-food`, meaning 2026-01-09..01-15. Client A, concurrently, sets `payPeriodFrequency = monthly`.
- `expected`: the converged state keeps the range K denoted when B wrote, or surfaces a conflict.
- `actual`: A→B, B→A and a duplicated/reversed replay all converge to identical cells (frequency `monthly`, K = 10000). K then means **2026-02-02..03-01**, and no conflict exists: the only merge outputs are cell values. Reversing the timestamp order (B written after A) gives the same result. Variant: A sets frequency=monthly while B sets startDate=2026-01-09. They merge to {monthly, 2026-01-09}, a cadence neither client chose (torn tuple).
- `compatibility_note`: **fails** the P09 bar. Convergence holds; meaning does not. ADR-0006 rejects independent LWW cells for exactly this tearing. Real sync-engine evidence would be needed before any claim about a redesign.

### P10 — old readers and old clients meet `2026-13`

- `evidence_label`: **source-backed analysis**

| gate                                   | anchor (local unless noted)                                                                        | behavior with `2026-13` / `202613`                                                                                                                                                         | silent?                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `isValidYearMonth`                     | `shared/months.ts` l.93–98 (fork l.152–157 unchanged)                                              | false                                                                                                                                                                                      | no (rejects)                                                                                                |
| `validateMonth`                        | `server/api.ts` l.90                                                                               | regex passes; range check → `APIError('No budget exists for month')`                                                                                                                       | no, except under `IMPORT_MODE`, which skips the range check and lets the write through                      |
| `api/budget-set-amount`                | `server/api.ts` l.468 (no `validateMonth`)                                                         | old client writes row `202613-<cat>` into an uncreated sheet cell                                                                                                                          | **yes** (the fork fixes this for fork clients only)                                                         |
| `_parse` / `nameForMonth`              | `shared/months.ts` l.12–75, l.438                                                                  | Jan 2027 / "January '27"                                                                                                                                                                   | **yes**, latent: no call on the old-client sync apply path was found; reachable from direct `months.ts` use |
| old-client sync apply                  | `sync/index.ts` `applyMessages`; `serialization.ts` `N:`                                           | `zero_budgets` rows applied as ordinary cells; `handleBudgetChange` sets `budget202613!budget-<cat>` with no created sheet; the four pref rows are stored and ignored; nothing is deferred | **yes**: period allocations invisible, no notice                                                            |
| old-client category delete             | `server/budget/app.ts` `isCategoryTransferRequired` l.505 (walks `createdMonths`)                  | no transfer prompt when the money exists only in period rows; after tombstoning, `loadUserBudgets` drops those rows                                                                        | **yes**: silent loss of period allocations                                                                  |
| old `getFirstActivityMonth`            | `actions.ts` l.455–483 (unrestricted `MIN(month)`)                                                 | a prior-year `2025-13…` row can become the MIN; it is compared as a string only, never parsed                                                                                              | benign                                                                                                      |
| reports (old client)                   | `budgetDataQuery.ts` l.210, `budget-analysis-spreadsheet.ts` l.296–331                             | iterate calendar months, so `202613` rows are omitted; Budgeted totals exclude period allocations                                                                                          | **yes** (silent omission)                                                                                   |
| reports (fork client)                  | fork `budgetDataQuery.ts`, `budget-analysis-spreadsheet.ts` early return + `BudgetDataUnavailable` | disclosed "Budget reports aren't available…"                                                                                                                                               | no (disclosed; the study's report rule is met)                                                              |
| old `@actual-app/api` / YNAB importers | `api/methods.ts` `getBudgetMonths`, `setBudgetAmount`                                              | open a pay-period file in calendar mode and write calendar rows invisible to fork clients                                                                                                  | **yes** (divergence)                                                                                        |
| `api/budget-months` range              | `server/api.ts` l.385; fork `_range` slices the last period                                        | omits the last created column in both modes                                                                                                                                                | pre-existing                                                                                                |
| rule `month` condition                 | `transaction-rules.ts` l.593                                                                       | `2026-13-00..99` bounds match no date                                                                                                                                                      | yes, but only if a period id were ever stored in a rule (the fork never does)                               |

- `compatibility_note`: **fails adoption**. Mixed-client use produces silent omission (reports), silent invisibility (sync apply), silent writes (`budget-set-amount`, `IMPORT_MODE`) and silent loss (category delete). Fork-only use meets the report rule.

## Cadence lifecycle class

- **Fork cadence setting:** four plain `preferences` rows. On **old clients** they are applied and stored as ordinary cells, never deferred, with no effect. On **fork clients** they are a **post-commit sheet switch**, the same lifecycle as `budgetType`: `applyMessages` refreshes after commit, and `saveSyncedPrefs` refreshes per saved id. Because the rows are separate LWW cells, the cadence can tear (P09 variant).
- **Read-only view cadence setting (proposed):** one plain `preferences` row holding a single composite value (for example `biweekly|2026-01-02`). It is applied and stored by every client, never deferred, with no sheet switch, so tearing is impossible and old clients ignore it harmlessly.

## Option matrix

Invariants: **I1** bank dates unchanged · **I2** allocations never silently change date-range meaning · **I3** existing monthly data recoverable · **I4** calendar core remains the sole production authority.

| option                                                       | I1          | I2                                                                                                      | I3                                                             | I4                  | paycheck value                                                                              | maintenance scope                                                                                          | rollback cost                                                                                           |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Full port of the fork as-is                                  | holds (P07) | **fails** (P05, P06, P09)                                                                               | holds on fork clients; **fails** with old clients (P10 delete) | **fails** by design | true per-paycheck allocations                                                               | 116 files; `months.ts` dispatch under ~145 call sites; templates; reports; ongoing rebase against upstream | per user: toggle off, rows kept (P07); per codebase: orphan `MM ≥ 13` rows persist in every synced file |
| Selective full port with explicit period identity (redesign) | holds       | could hold only with date-anchored or cadence-stamped keys plus a confirmed migration on cadence change | requires old-client gating                                     | fails by design     | true per-paycheck allocations                                                               | above plus migration, sync gating, report aggregation rule, API type split                                 | new schema: needs a reviewed rollback design                                                            |
| Read-only paycheck planning view                             | holds       | holds (no allocation writer)                                                                            | holds                                                          | holds               | per-paycheck visibility of calendar budget, schedules and spend; no per-paycheck allocation | one pure helper (from `pay-periods.ts`, MIT), one composite pref, one view; no core changes                | remove the view and the pref; no data to migrate                                                        |
| No port (existing `BalanceForecast`, schedules)              | holds       | holds                                                                                                   | holds                                                          | holds               | schedule-based balance projection only                                                      | none                                                                                                       | none                                                                                                    |

## Rejected designs

- Year-scoped ordinal period ids stored in the calendar `month` column without a cadence stamp: P05, P06 and P09 show the meaning drifts.
- Cadence as independent preference rows: P09 variant, and ADR-0006's own rejection of independent-cell tuples.
- Silent re-keying or conversion of allocations on a cadence change: violates I2 without explicit user confirmation.
- Rewriting transaction dates to fit periods: plan non-goal; violates I1.
- A fork sync harness inside this task: out of scope (`plan.md` §2 extraction rule); listed below as future evidence.

## Recommendation

1. **Full port: defer** (required outcome of this study). Redesign requirements, affected owners and the evidence a later task would need:

| requirement                                                                                           | owners affected                                                               | cost   | integration evidence needed                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Period identity that encodes its range (e.g. start-date key or cadence id) rather than a year ordinal | `shared/months.ts`, `actions.ts` `setBudget`/`dbMonth`, `sheet.ts`, `base.ts` | high   | P05/P06 re-run as Vitest in a disposable fork checkout (`server/budget/pay-periods.test.ts` extended with a cadence-switch preservation case) |
| Single composite cadence cell with an explicit, confirmed migration of allocations                    | `server/budget/pay-period-config.ts`, `preferences/app.ts`, `sync/index.ts`   | high   | two-client sync test built from `sync.property.test.ts` with budget tables added                                                              |
| Old-client gating (refuse to open, or a sync-format/version guard)                                    | `sync/index.ts`, `serialization.ts`, `budgetfiles/app.ts`                     | high   | `deferred.test.ts`-style old-client apply test; manual mixed-version check                                                                    |
| Report aggregation rule for periods that straddle a month                                             | `budgetDataQuery.ts`, `budget-analysis-spreadsheet.ts`, Spending, Sankey      | medium | report unit tests with straddling periods                                                                                                     |
| API type distinguishing calendar months from periods                                                  | `api/methods.ts`, `server/api.ts`, `cli`                                      | medium | `packages/api/methods.test.ts` cases for both spaces                                                                                          |
| In-app disclosure for fixed templates and cadence changes                                             | `PayPeriodSettings.tsx`, template UI                                          | low    | component test                                                                                                                                |

2. **Product choice (HITL):** choose the **read-only paycheck planning view** if per-paycheck visibility is wanted. It is the only option that adds that value with all four invariants holding, and its period math is already reproduced (P01–P04). Otherwise choose **no port**. The evidence does not favor either on correctness; the choice depends on whether paycheck visibility is worth one new view.

## Next-task scope (only if the read-only view is selected)

A new planned task, not this one. It would add: a pure period helper derived from pinned `shared/pay-periods.ts` (MIT attribution), with P01–P04 promoted to Vitest; one synced composite pref; a view listing, for each paycheck window that overlaps the selected calendar month, the schedules due, spending by bank date, and the calendar budget, with an apportioning rule decided in that plan. It would have no `setBudget`, `setGoal` or template writes, and would carry a no-write proof in the style of task 0002 (DB dump before/after). Task 0002 stays calendar-only and never receives period ids.

## Remaining decisions

Resolved on 2026-10-02: the user selected **no port**. No cadence or anchor is needed, and no production task is queued. The questions below apply only if the user reopens paycheck planning later.

- Direction: read-only view or no port (full port deferred).
- The user's actual pay cadence and anchor date (these determine the three-paycheck months; for biweekly anchored 2026-01-02 they are January and July 2026).
- Whether true per-paycheck allocations are a hard requirement. If yes, that reopens the deferred redesign above as its own task.
