Last Edited: 2026-09-27

# Plan: read-only category reservation breakdown

Verdict: **ready to implement**. Priority 1. Execution: AFK. Revised by `review-plan-fix-high-severity-loop` (2 iterations) from the expanded four-lens review; implementation unchecked in [progress.md](progress.md).

## 1. Current state

The envelope budget shows a category balance without explaining which existing templates claim it. Existing owners: `packages/loot-core/src/server/budget/{template-notes,schedule-template,app,actions}.ts`; client `packages/desktop-client/src/components/budget/envelope/{EnvelopeBudgetComponents,BalanceMovementMenu,BalanceMenu}.tsx`, `components/modals/EnvelopeBalanceMenuModal.tsx`, and `components/mobile/budget/ExpenseCategoryListItem.tsx`.

**Funding numbers are not reservations.** `CategoryTemplateContext` (`perTemplateContribution`, `runBy`'s `toBudget`) and `runSchedule` (`perScheduleMonthly`) compute _this month's funding_, which depends on balance, last month's goal and remainder distribution. None of them may become `reserved`. `dryRunCategoryTemplate` and `getTemplates` are read-shaped but return that funding projection or stale `goal_def` data. The reusable pieces are lower level: the note grammar (`goal-template.pegjs` `parse`, driven by the private loop in `template-notes.ts` `getCategoriesWithTemplates`), schedule target resolution inside `createScheduleList`, and `getMonthlyBaseContribution` (both private in `schedule-template.ts`). Keep `runSchedule` behavior unchanged.

Two `createScheduleList` behaviors matter here. It destructures the schedule lookup result, so a missing schedule throws. It also resolves a name reference with `db.first`, silently taking the first of several trimmed-name matches. Its `next_date_string` is re-derived from the rule's recurrence starting on the first of the budget month, so it **does not move when a bill is paid or skipped**. Payments and skips advance only the stored schedule next date (`setNextDate` → `schedules_next_date`, surfaced as `next_date` on the `schedules` AQL view).

`useSchedules.ts` has an identity-stable subscription and unsubscribe behavior. Reservations do not call it (schedules are read on the server), and its existing test must keep passing.

Reference: [hubermjonathan calculation](https://github.com/hubermjonathan/actual/blob/5e939d427cb8ca347b3e526b4a230537e5e84668/packages/loot-core/src/server/budget/reservations.ts) (`accruedToDate`, `settleReservations`, `getByReservationClaims`) and its `schedule-template.ts` `getScheduleReservationClaims`, which reads the stored next date. At that pin the guide says claims are filled in due-date order when the balance is short, while the code sums full accrued claims and lets spare go negative. This plan follows the code. Preserve copied-file attribution and record the deviations listed in §13.

## 2. Target shape

### File and symbol changes

All paths are repository-relative. These are required implementation deltas, not completed work.

| File                                                                             | Delta / owner                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/loot-core/src/server/budget/template-parser.ts` (new)                  | Pure `parseTemplateNote(note): Template[]` extracted from the `getCategoriesWithTemplates` loop (descriptions, adjustment validation, `error` directives). No DB import                                                                                                                                        |
| `packages/loot-core/src/server/budget/template-notes.ts`                         | Call `parseTemplateNote` from the existing storage/check flow. Writes stay in `storeNoteTemplates` only                                                                                                                                                                                                        |
| `packages/loot-core/src/server/budget/schedule-template.ts`                      | Add exported `getScheduleClaims(templates, month, category, currency)` returning `{ ok: true, claims } \| { ok: false, reason }`. Internally pre-resolves schedules, then uses `createScheduleList` + `getMonthlyBaseContribution`. Do not export `createScheduleList`, `runSchedule`'s map, or a partial list |
| `packages/loot-core/src/server/budget/reservations.ts` (new)                     | **Read authority.** `getReservations({ month })`: validation, category load, source selection, parsing, claim extraction, pure decomposition (unexported `accruedToDate` / `settle`). Import ban below                                                                                                         |
| `packages/loot-core/src/server/budget/reservations.test.ts` (new)                | Pure math fixtures                                                                                                                                                                                                                                                                                             |
| `packages/loot-core/src/server/budget/reservations.integration.test.ts` (new)    | Handler fixtures on a real test database                                                                                                                                                                                                                                                                       |
| `packages/loot-core/src/server/budget/template-parser.test.ts` (new)             | Parser cases moved or duplicated from `template-notes.test.ts`                                                                                                                                                                                                                                                 |
| `packages/loot-core/src/types/models/reservations.ts` (new)                      | Shared request/result/reason types (types only)                                                                                                                                                                                                                                                                |
| `packages/loot-core/src/server/budget/app.ts`                                    | Add `'budget/get-reservations'` to `BudgetHandlers` and `app.method(...)` **without** `mutator` / `undoable`                                                                                                                                                                                                   |
| `packages/loot-core/src/types/prefs.ts`                                          | Add `'budgetReservations'` to `FeatureFlag`                                                                                                                                                                                                                                                                    |
| `packages/desktop-client/src/hooks/useFeatureFlag.ts`                            | `DEFAULT_FEATURE_FLAG_STATE.budgetReservations: false`                                                                                                                                                                                                                                                         |
| `packages/desktop-client/src/components/settings/Experimental.tsx`               | `FeatureToggle` for the flag                                                                                                                                                                                                                                                                                   |
| `packages/desktop-client/src/budget/queries.ts`, `budget/index.ts`               | `reservationQueries` keyed `['reservations', budgetId, month]`; export via the index                                                                                                                                                                                                                           |
| `packages/desktop-client/src/sync-events.ts`                                     | Invalidate the `['reservations']` prefix in the existing `listenForSyncEvent` `applied` / `success` branch                                                                                                                                                                                                     |
| `packages/desktop-client/src/hooks/useReservations.ts` (new)                     | Cache adapter: enabled state, masking while fetching, month rollover. No sync listener, no `useSchedules`                                                                                                                                                                                                      |
| `packages/desktop-client/src/components/budget/ReservationBreakdown.tsx` (new)   | Renders one result row. No arithmetic beyond formatting                                                                                                                                                                                                                                                        |
| `packages/desktop-client/src/components/budget/envelope/BalanceMovementMenu.tsx` | Desktop host (R1): render `ReservationBreakdown` above `BalanceMenu`                                                                                                                                                                                                                                           |
| `packages/desktop-client/src/components/modals/EnvelopeBalanceMenuModal.tsx`     | Mobile host (R2): stop `Omit`-ing `month`, render `ReservationBreakdown` above `BalanceMenu`                                                                                                                                                                                                                   |

Not changed: `goal-template.ts` (no reservation symbol), `category-template-context.ts`, `envelope/BalanceMenu.tsx` (a `Menu` item list shared by both hosts), `mobile/budget/BalanceCell.tsx` (press target only), and `budget/mutations.ts`.

**Import ban for `reservations.ts` and `getScheduleClaims`:** do not import or call `goal-template.ts`, `CategoryTemplateContext`, `runSchedule`, `computeTemplates`, `dryRunCategoryTemplate`, `getTemplates`, `processTemplate`, `storeNoteTemplates`, `getCategoriesWithTemplateNotes`, `setBudget`, or `setGoal`. Pure decomposition stays server-only (not in `shared/`), so the client cannot recompute.

Preserved invariants: no writes on read; integer-unit reconciliation; existing Balance/transfer semantics; one budget's derived data never appears in another; one calculation owner shared by both menus. No files deleted, no database migration, no new dependency.

## 3. Contract

V1 is opt-in (`budgetReservations`, default off), current calendar month, envelope budget, expense categories only. The panel shows **Total balance** (`balance`), **Reserved** (`reserved`), **Allowance remaining** (`allowance`, never `allowanceTotal`) and **Spare** (`spare`, rendered signed, e.g. `-200.00`; no separate shortfall row). Existing Balance cells, reports, budget allocations and category transfer limits keep their meaning.

### Money rules

- All amounts are integers in the budget currency's minor units (`amountToInteger(amount, currency.decimalPlaces)`, currency from the `defaultCurrencyCode` preference, as `CategoryTemplateContext` does). Shipped currencies have 0 or 2 decimal places; 3 is covered only as a synthetic test input.
- `balance` is the worker sheet value `getSheetValue(sheetForMonth(month), 'leftover-<categoryId>')`.
- Per claim: `accrued = min(target, max(0, target - monthlyRate * monthsRemaining))`, kept exact (unrounded).
- **Schedule claim:** `target` is `createScheduleList`'s resolved positive amount for that schedule (after rule actions and split handling). `monthlyRate = getMonthlyBaseContribution(schedule)` (monthly: `target / interval`; yearly: `target / interval / 12`). `nextDate` is the **stored** schedule next date (the `schedules` view `next_date`), falling back to `next_date_string` only if no stored row exists. `monthsRemaining = max(0, differenceInCalendarMonths(nextDate, month))`.
- **By claim:** `target = amountToInteger(amount, decimalPlaces)`; `period = annual ? (repeat || 1) * 12 : repeat` (same expression as `runBy`); `monthlyRate = target / period`. Roll `targetMonth` forward by `period` while it is before `month`. `monthsRemaining = differenceInCalendarMonths(targetMonth, month)`; `nextDate = targetMonth-01`.
- Due now (`monthsRemaining = 0`) reserves the full target. Overdue (stored next date before `month`, bill not yet paid) is clamped to 0 and reserves one full target; missed older occurrences are **not** stacked.
- **Cycle advance:** a schedule claim resets when its stored next date advances. This happens after a linked payment (`setNextDate({ advance: true })` from the schedule service) and after **Skip next date** (`skipNextDate`); both are the same observable event, so a skipped occurrence behaves like a paid one. A By claim advances when its target month passes; spending does not advance it.
- **Category totals:** `reserved = Math.round(sum of exact accrued)`; rounding happens once, per category. `allowanceTotal` = sum of supported simple `monthly` amounts. `allowance = min(max(0, balance - reserved), max(0, allowanceTotal))`; `spare = balance - reserved - allowance`; `shortfall = max(0, -spare)`. Because `allowance` and `spare` derive from the rounded `reserved`, `balance = reserved + allowance + spare` holds exactly, including negative spare. `reserved` is never capped to balance. Per-claim `accrued` is display-rounded separately, and its displayed sum may differ from `reserved` by rounding.
- "Reserved" is an accrued obligation, not proof that cash exists. Never present any figure as unconditionally "safe to spend".

### Worked fixtures (the test oracle)

Unless stated: 2-decimal currency; `global.currentMonth = '2026-09'`. **Insurance** is a yearly expense schedule of -1200.00 on 15 March with stored next date 2027-03-15. **Rent** is a monthly (interval 1) expense schedule of -1500.00 on day 5. Category notes are `#template schedule Insurance` plus `#template 500` unless stated.

| ID                       | Setup                                                                                                                                                                                 | Expected                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 surplus               | balance 120000                                                                                                                                                                        | claim target 120000, rate 10000, months 6, accrued 60000; reserved 60000, allowanceTotal 50000, allowance 50000, spare 10000, shortfall 0               |
| F2 deficit               | balance 40000                                                                                                                                                                         | reserved 60000, allowance 0, spare -20000, shortfall 20000; panel shows Spare `-200.00`                                                                 |
| F3 zero                  | balance 0                                                                                                                                                                             | reserved 60000, allowance 0, spare -60000, shortfall 60000                                                                                              |
| F4 negative              | balance -10000                                                                                                                                                                        | reserved 60000, allowance 0, spare -70000, shortfall 70000                                                                                              |
| F5 due now               | Insurance stored next date 2026-09-15                                                                                                                                                 | months 0, accrued 120000                                                                                                                                |
| F6 Rent due              | notes `#template schedule Rent`; stored next date 2026-09-05; balance 150000                                                                                                          | rate 150000, months 0, reserved 150000, spare 0                                                                                                         |
| F7 Rent paid             | F6, then a -1500.00 transaction in the category linked to Rent, then `setNextDate({ id, advance: true })`                                                                             | stored next date 2026-10-05, months 1; balance 0, reserved 0, allowance 0, spare 0                                                                      |
| F8 Rent skipped          | F6, then `skipNextDate({ id })` (no transaction)                                                                                                                                      | nextDate 2026-10-05; balance 150000, reserved 0, spare 150000                                                                                           |
| F9 Rent overdue          | stored next date left at 2026-08-05 (missed, not auto-posting)                                                                                                                        | months clamp 0, reserved 150000 (one occurrence)                                                                                                        |
| F10 rename, UI source    | F1 with `template_settings.source = 'ui'` and `scheduleId`; rename Insurance → "Car insurance"                                                                                        | same claim key (schedule ID), label "Car insurance", accrued 60000                                                                                      |
| F11 rename, notes source | F1 notes (name reference); same rename                                                                                                                                                | category `unavailable`, reason `missing-schedule`, no amounts                                                                                           |
| F12 By rollover          | notes `#template 600 by 2026-08 repeat every year`; month 2026-08 then 2026-09                                                                                                        | 2026-08: target 60000, rate 5000, months 0, accrued 60000, nextDate 2026-08-01. 2026-09: nextDate 2027-08-01, months 11, accrued 5000                   |
| F13 year boundary        | notes `#template 1200 by 2027-01 repeat every year`; months 2026-12, 2027-01, 2027-02                                                                                                 | accrued 110000, then 120000, then 10000 (nextDate 2028-01-01)                                                                                           |
| F14 sum-then-round       | two yearly schedules A and B, -10.00 each, stored next date 2027-04-10; balance 1000; no simple template                                                                              | each exact accrued 416.667 (rate 83.333, months 7); reserved 833 (round-then-sum would give 834); per-claim display 417 and 417; allowance 0, spare 167 |
| F15 0-decimal            | currency JPY; notes `#template 5000` and `#template 12000 by 2026-12 repeat every year`; balance 20000                                                                                | target 12000, rate 1000, months 3; reserved 9000, allowanceTotal 5000, allowance 5000, spare 6000                                                       |
| F16 synthetic 3-decimal  | `decimalPlaces: 3`; notes `#template 12.345 by 2026-12 repeat every year`; balance 10000                                                                                              | target 12345, rate 1028.75, exact accrued 9258.75; reserved 9259, allowance 0, spare 741                                                                |
| F17 no templates         | category note without directives; balance 3000                                                                                                                                        | ready; claims [], reserved 0, allowanceTotal 0, allowance 0, spare 3000; panel not rendered                                                             |
| F18 stale `goal_def`     | notes-source category, note without directives, `goal_def` = `[simple 500]`                                                                                                           | same as F17 (stored def ignored)                                                                                                                        |
| F19 UI-source parity     | F1 definitions stored as `goal_def` with source `ui`                                                                                                                                  | row identical to F1                                                                                                                                     |
| F20 isolation            | category X notes `#template remainder` beside the F1 category                                                                                                                         | X `unavailable` / `unsupported-template`; F1 category ready as F1; request succeeds                                                                     |
| F21 duplicates           | (a) `#template schedule Insurance` twice + `#template 500`; (b) Insurance once plain and once `full`; (c) two live schedules whose trimmed names are both "Insurance", name reference | (a) ready, one claim, reserved 60000 (not 120000), otherwise F1; (b) `duplicate-schedule`; (c) `ambiguous-schedule`                                     |
| F22 rejected input       | month `2026-13`; month `2026-08` while current is 2026-09; tracking budget                                                                                                            | each call rejects with an input error; no rows                                                                                                          |

Domain: canonical balance/template/schedule/category. Reserved, Allowance and Spare are new derived terms adopted from the source. Non-goals: balance replacement, transfer guards, automatic allocations, historical snapshots, public API/CLI, pay periods, one-off goal reservations, new template grammar, fork `[fixed]` / `label` grammar, and partial results presented as complete.

| Acceptance                                                                   | Evidence                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| F1–F4, F14–F16 reconcile exactly                                             | `reservations.test.ts`                                        |
| F5–F13, F17–F22 through the handler                                          | `reservations.integration.test.ts`                            |
| No writes on read                                                            | Same suite: spies plus database dump (§12)                    |
| Panel renders F1, F2 and an unavailable row; masks while loading/error       | `ReservationBreakdown.test.tsx`                               |
| No stale result after edit, undo, sync, budget switch or rollover            | `useReservations.test.ts`, `sync-events.test.ts`, two-tab e2e |
| Flag off, non-current month, tracking mode: panel absent, handler not called | Component tests and e2e absent-text assertions                |

Risk: financial interpretation and stale state are higher risk than visual presentation. Checkpoint one complete read path before the mobile menu; keep generic refactoring separate and revert the last slice if its proof fails.

## 4. Data / API shape

### Category universe and template source

Load all non-deleted, non-income categories directly (not `getTemplates`, not `getCategoriesWithTemplateNotes`). Per category: if `template_settings.source === 'ui'`, read and validate `goal_def`; otherwise parse the current note in memory with `parseTemplateNote`. Notes-source categories never read `goal_def` (F18). `useBudgetAutomations` and `budget/store-note-templates` persist parsed definitions and must not be called. Template `priority` is ignored.

### Supported input

| Input                                                                                                                                                                     | V1 behavior                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `simple` with finite nonnegative `monthly`, no `limit`                                                                                                                    | Allowance of `monthly`                 |
| `schedule` without `full`, `adjustment` or `adjustmentType`, resolving to one live, non-completed schedule with monthly or yearly recurrence and positive interval/target | Schedule claim (§3)                    |
| `by` with no `from`, positive amount, and a non-null period (`annual`, or numeric `repeat`)                                                                               | By claim (§3)                          |
| No templates                                                                                                                                                              | Ready zero-claim row; panel suppressed |
| Anything else                                                                                                                                                             | Category `unavailable` (below)         |

### Unavailable reasons

Each unavailable category reports exactly one reason. When several apply, the first in this list wins.

| Reason                 | Input                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid-template`     | Note line that parses to an `error` directive; `goal_def` that is not valid JSON or not an array; UI-source entry that fails template validation                                                                                                                                                                                                                                                                    |
| `missing-schedule`     | `scheduleId` or name that matches no live (`tombstone = 0`) schedule, including notes-source references after a rename (F11)                                                                                                                                                                                                                                                                                        |
| `ambiguous-schedule`   | Name reference (no `scheduleId`) matching more than one live schedule by trimmed name                                                                                                                                                                                                                                                                                                                               |
| `inactive-schedule`    | Completed schedule, or one `createScheduleList` reports as past / not active in the month                                                                                                                                                                                                                                                                                                                           |
| `duplicate-schedule`   | Two templates in one category resolve to the same schedule ID with different `full`, `adjustment` or `adjustmentType`. Identical references count once and stay ready (F21a)                                                                                                                                                                                                                                        |
| `unsupported-template` | Any other type (`remainder`, `average`, `percentage`, `periodic`, `spend`, `copy`, `refill`, `limit`, `goal` directives); simple with `limit` or without `monthly`; schedule with `full`/adjustment; weekly, daily or non-repeating schedules; By with `from`, or with no period (including `repeat every month`, which parses to `{ annual: false }` with no count and which `runBy` also treats as non-repeating) |

`getScheduleClaims` checks existence and ambiguity **before** calling `createScheduleList` (which throws on a missing row and silently takes the first name match). Any string in its `errors` output fails the category. It never returns a partial claim list.

### Request and result

Internal request `{ month: 'YYYY-MM' }`. The handler validates a real calendar month, requires `month === monthUtils.currentMonth()` and `!isTrackingBudget()`, and otherwise throws the existing `APIError` input error (F22). The client's month is not the authority, so a stale client after midnight is rejected. A bad category never fails the batch.

Result `{ month, categories: ReservationRow[] }`, one row per category in the universe. `ReservationRow` is `{ categoryId, state: 'ready', balance, reserved, allowance, allowanceTotal, spare, shortfall, claims }` or `{ categoryId, state: 'unavailable', reason }`. A claim is `{ key, kind: 'schedule' | 'by', label, nextDate, target, accrued }`, where `accrued` is that claim's display-rounded integer. `key` is the schedule ID for schedule claims, and `<categoryId>:<templateIndex>` for By claims (request-local UI key, not a sync identity). `label` is the template `description`, else the schedule name, else the category name. No `committed`, `status` or `onTrack` field; no external API compatibility promise. Reason codes are translated in the client.

## 5. Runtime / loader / UX behavior

- **Query:** one batch per budget and month via `reservationQueries`, key `['reservations', budgetId, month]`, `queryFn` passing the TanStack `signal`, `staleTime: Infinity`, no `placeholderData`. Both hosts observe the same key; the mobile modal lives in `components/Modals.tsx` outside the budget page, so do not rely on page-only React context.
- **Enabled:** flag on (`useFeatureFlag('budgetReservations')`), envelope budget (`budgetType` pref), and `month === currentMonth()`. When not enabled the panel is not rendered and no request is sent.
- **Freshness owner:** `listenForSyncEvent` in `sync-events.ts` invalidates the `['reservations']` prefix on every `applied` and `success` event. Local writes and `undo()` both reach the UI as `applied` (`sendMessages` → `applyMessages`). No listener in the hook or per row, and not in `budget/mutations.ts`. If the R2 undo test shows no refetch, add the invalidation to the existing `undo-event` handler in `global-events.ts`, not to a new listener. Broad invalidation is deliberate for v1; inactive queries stay stale without background refetch.
- **Budget switch:** `closeBudget` / `closeBudgetUI` in `budgetfiles/budgetfilesSlice.ts` already call `queryClient.clear()`. The budget ID in the key isolates late responses.
- **Masking:** render figures only when the query has data and is not fetching. While loading, refetching or after an error, show the canonical balance plus a translated loading/unavailable message and never the previous figures. No retry-on-render loop.
- **Rollover:** the hook schedules one timer to the next local midnight and one `visibilitychange` listener that re-checks `currentMonth()`; a changed month changes the key. Both are removed on unmount.
- **UI:** shared components, translated labels, `FinancialText`, privacy masking. Keyboard and mobile expose the same details; no hover-only access. Test id `reservation-breakdown` on the panel.

## 7. Authority and state ownership

`server/budget/reservations.ts` is the single read authority: validation, source selection, claim extraction orchestration and decomposition. `schedule-template.ts` owns schedule I/O behind `getScheduleClaims`. `goal-template.ts` remains the apply/store authority and gains nothing. Source of truth: ledger, sheet balances, notes / `goal_def`, schedules and stored next dates. Derived/cache: handler response and the budget-scoped query cache. Persisted: existing sources plus the feature preference only. The client renders rows and never recalculates obligations or writes derived totals. Dependency direction: UI `send` → `budget/get-reservations` → parser / `getScheduleClaims` / sheet reads → pure decomposition.

## 8. Proposed approach

1. **R1 (AFK): core read path and desktop menu.** Diff the pinned source against current template/schedule owners and record attribution and deviations. Extract `parseTemplateNote`; add `getScheduleClaims`, `reservations.ts`, types and handler registration; add the flag, `reservationQueries`, `useReservations` (enabled/masking only), `ReservationBreakdown` and the `BalanceMovementMenu` host. Checkpoint: every §3 fixture passes, the no-write proof passes, the component renders F1/F2/unavailable, and flag off leaves the desktop menu unchanged. R1 may merge with the flag off.
2. **R2 (AFK): lifecycle and mobile.** `sync-events.ts` invalidation, rollover timer/visibility, `EnvelopeBalanceMenuModal` month and host, hook sequence tests, e2e desktop and mobile. Checkpoint: §12 R2 pass condition.
3. **R3 (AFK): rollout docs.** `packages/docs/docs/experimental/reservations.md`, experimental index link, `upcoming-release-notes/category-reservations.md`. Record focused verification results and manual evidence in `progress.md`. No API/CLI expansion.

## 9. Migration

No data migration. `flags.budgetReservations` is one synced preference string under the existing `flags.*` pattern; default off comes from `useFeatureFlag.ts`. Disabling removes the panel and its query observers and leaves amounts, IDs, dates, transfer actions and old-client behavior unchanged. Old clients ignore the extra preference.

## 11. Edge cases and failure modes

Covered by fixtures: zero/negative balance (F3, F4), no claims (F17), fractional rates and rounding (F14, F16), 0/3-decimal (F15, F16), duplicates (F21), monthly/yearly, due-now, overdue, paid and skipped (F5–F9), year boundary (F13), rename (F10, F11), bad-beside-good (F20), rejected input (F22). Deleted categories are excluded from the universe; income categories are excluded. If the current engine cannot supply a trustworthy claim, return unavailable for that category rather than infer missing semantics. Never mark a partial result safe to spend.

## 12. Verification plan

All checks are **planned**, not yet run.

### Checkpoints

| Checkpoint | Files                                                                                                                                                                                                                                                                        | Pass condition                                                                                                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1         | core: `template-parser.test.ts`, `template-notes.test.ts`, `reservations.test.ts`, `reservations.integration.test.ts`, existing `schedule-template.test.ts`, `goal-template.test.ts`; client: `ReservationBreakdown.test.tsx`, `envelope/BalanceMovementMenu.test.tsx` (new) | F1–F22 exact values; no-write proof; existing parser, `runSchedule` and goal suites unchanged; panel shows F1 amounts, F2 Spare `-200.00`, an unavailable reason string, a loading state with no figures; flag off / tracking / non-current month render no `reservation-breakdown` and never call `budget/get-reservations` |
| R2         | `useReservations.test.ts`, `sync-events.test.ts` (new), `e2e/reservations.test.ts`, `e2e/reservations.mobile.test.ts`                                                                                                                                                        | Hook sequence below; modal receives `month` and shows the same ready amounts as desktop; e2e expectations below                                                                                                                                                                                                              |
| R3         | Focused suites re-run, typecheck, docs                                                                                                                                                                                                                                       | All acceptance evidence recorded in `progress.md`; docs match the §4 tables                                                                                                                                                                                                                                                  |

### No-write proof (R1)

In `reservations.integration.test.ts`, around every handler call: spy on sync `sendMessages` (the funnel for all CRDT writes), `setBudget`, `setGoal`, `storeNoteTemplates` and `runSchedule`, and expect zero calls. Also compare `global.getDatabaseDump(['categories', 'notes', 'zero_budgets', 'schedules', 'schedules_next_date', 'transactions', 'preferences'])` before and after. Use `global.emptyDatabase()` and set months with `global.currentMonth` (faking `Date` does not change `currentMonth()` under test). If an ESM export cannot be spied directly, use a partial `vi.mock` of its module that wraps the real function; the dump comparison stays mandatory either way.

### Hook sequence (R2, `useReservations.test.ts` / `sync-events.test.ts`)

1. First mount fetches once; while fetching, no figures render.
2. An `applied` event during an in-flight read causes exactly one follow-up fetch, and the rendered row is the later response.
3. Three events in one tick produce one refetch.
4. An undo (`applied`) replaces the post-edit row with the pre-edit row; the post-edit amount is absent while refetching.
5. Changing budget ID after `queryClient.clear()` never renders the first budget's row, even if its response resolves late.
6. Advancing `global.currentMonth` and firing `visibilitychange` fetches the new month's key; the old month's row is not rendered.
7. 100 mount/unmount cycles return `document` `visibilitychange` listeners and pending timers to the pre-mount baseline; the `sync-event` listener count stays 1.

### E2E expectations (R2)

Playwright runs with `currentMonth() = '2017-01'`. Enable the flag through the experimental settings page model; build the category with a synthetic budget via `createTestFile()`. Desktop: opening the balance menu shows Reserved/Allowance remaining/Spare matching a fixed setup; turning the flag off removes `reservation-breakdown`. Two pages on one budget: after a payment and after undo in page A, page B shows the same amounts. Mobile: tapping the balance opens the modal with the same values. Failure artifacts use the existing screenshot-on-failure and trace-on-retry settings.

### Commands (run from repo root)

- `yarn workspace @actual-app/core run test:node src/server/budget/template-parser.test.ts src/server/budget/template-notes.test.ts src/server/budget/reservations.test.ts src/server/budget/reservations.integration.test.ts src/server/budget/schedule-template.test.ts src/server/budget/goal-template.test.ts` (the `test` script does not filter files; `test:node` does)
- `yarn workspace @actual-app/web run test src/hooks/useReservations.test.ts src/hooks/useSchedules.test.ts src/sync-events.test.ts src/components/budget/ReservationBreakdown.test.tsx src/components/budget/envelope/BalanceMovementMenu.test.tsx`
- `yarn workspace @actual-app/web run playwright test reservations.test.ts reservations.mobile.test.ts --browser=chromium`
- `yarn typecheck`

Synthetic budgets only; never run a production budget through template application to create fixtures. Do not update unrelated snapshots.

### Manual checks (R3)

Save artifacts under `.workflow/tasks/0002-budget-reservations/evidence/` and link them from `progress.md`.

| Check           | Setup / steps                                                                             | Expected                                                      | Failure signal                     | Artifact            |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- | ------------------- |
| Two tabs        | Flag on, F1-like category; open budget in two tabs; post Rent payment in tab A, then undo | Tab B updates to the paid amounts, then back                  | Tab B keeps old figures after sync | `two-tabs.png` pair |
| Privacy         | Enable privacy mode; open panel                                                           | All four amounts masked                                       | Any figure readable                | `privacy.png`       |
| Midnight/resume | Leave panel's budget open across a month change (or change system date), resume tab       | Panel refetches for the new month; no old-month figures       | Old month's figures shown          | `rollover.png`      |
| Disabling       | Turn the flag off with a menu open                                                        | Panel disappears; balance menu identical to flag-off baseline | Panel or request persists          | `flag-off.png`      |

Rollback: R1 can ship disabled. If R2 fails, keep the flag off and revert R2; no stored ledger data changes. Do not call R1 complete until its no-write proof passes.

## 13. Documentation notes

Add `packages/docs/docs/experimental/reservations.md` and `upcoming-release-notes/category-reservations.md`, and link from the experimental feature index. Document the §4 supported-input and unavailable tables, negative Spare, and that reservations are accrued obligations for supported templates only, not unrecorded obligations. Avoid an unconditional "safe to spend".

Deliberate deviations from the pinned fork, to record in implementation notes with source attribution: no `[fixed]` schedules or `label` grammar (the pin has optional `label` on simple/by/spend and `fixed` on schedule templates; this repo's grammar has neither, so labels use `description` or names); `full` and adjusted schedules are unavailable instead of accruing; missing or errored schedules make the category unavailable instead of being skipped; By templates without a period are unavailable instead of silently skipped; no `status`, `onTrack`, `settledThisMonth` or `committed`; no Balance-column or Transfer changes.

Task files: `plan.md` (canonical) and `progress.md` (checklist, evidence and log). Review workshop files were absorbed and removed during the fix loop.

## 14. Open questions / missing info

None blocking. Duplicate-schedule behavior was decided by the user on 2026-09-27 (§4). Stop R1 and revise this plan only if one of these proofs fails and cannot be fixed without changing template semantics: existing `template-notes.test.ts` parser results change; existing `schedule-template.test.ts` (`runSchedule`) results change; or the no-write proof records any write. The full-accrual formula stays the contract either way.
