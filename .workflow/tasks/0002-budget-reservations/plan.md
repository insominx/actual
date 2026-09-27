Last Edited: 2026-09-27

# Plan: read-only category reservation breakdown

Verdict: **ready for review-plan**. Priority 1. Execution: AFK after review. Planning only; implementation unchecked in [progress.md](progress.md).

## 1. Current state

The envelope budget shows a category balance without explaining which existing templates claim it. Owners: `packages/loot-core/src/server/budget/{goal-template,category-template-context,schedule-template,app}.ts`; client `components/budget/envelope/{EnvelopeBudgetComponents,BalanceMenu}.tsx`, `components/modals/EnvelopeBalanceMenuModal.tsx`, and `components/mobile/budget/BalanceCell.tsx`. Paths for client owners are relative to `packages/desktop-client/src/`.

`CategoryTemplateContext` and `runSchedule` already calculate per-template contributions. Reuse their read-only evaluation paths, not a second template parser. Budget templates may come from notes or the automation UI. `useSchedules.ts` has an identity-stable subscription fix and unsubscribe behavior that must survive new readers.

Reference: [hubermjonathan calculation](https://github.com/hubermjonathan/actual/blob/5e939d427cb8ca347b3e526b4a230537e5e84668/packages/loot-core/src/server/budget/reservations.ts) and adjacent tests. Its guide disagrees with code about capping claims to available funds; the contract below follows full accrued claims. First confirm source/target diff and preserve copied-file attribution.

## 2. Target shape

Add core `server/budget/reservations.ts`, `reservations.test.ts`, and shared `types/models/reservations.ts`. Extend read-only claim extraction in `schedule-template.ts` and orchestration in `goal-template.ts`; register `budget/get-reservations` in `budget/app.ts`. Avoid invoking template application or persistence. Add `hooks/useReservations.ts`, tests, and a shared `components/budget/ReservationBreakdown.tsx`, consumed by desktop/mobile balance menus. Add a `budgetReservations` feature flag through `types/prefs.ts` and `components/settings/Experimental.tsx`.

V1 is opt-in, current-calendar-month, envelope-only. It displays Total balance, Reserved, Allowance remaining, and Spare in a details panel. Existing Balance cells, reports, budget allocations, and category transfer limits keep their meaning. No files are deleted, no database migration or new dependency is needed.

## 3. Contract

- A category's integer-unit total satisfies `balance = reserved + allowance + spare`, including when spare is negative. “Reserved” denotes an accrued obligation, not proof that sufficient cash exists.
- For each supported recurring schedule or repeating By template, accrue `clamp(target - monthlyRate * monthsRemaining, 0, target)`. Sum exact contributions before rounding the category total. Keep per-claim display rounding separate. `reserved` is not capped to balance.
- Supported simple fixed allowances contribute their monthly target. `allowance = min(max(0, balance - reserved), max(0, allowanceTotal))`; `spare = balance - reserved - allowance`; `shortfall = max(0, -spare)`. Underfunded allowances can show less remaining than their target; this is not evidence of spending by itself.
- Recurring bill cycles advance when the payment posts; repeating By targets advance when their target month passes. Resolve schedule identity by ID where available. Missing/deleted schedules, unsupported template kinds, or invalid templates produce a category-level unavailable explanation, never a misleading complete breakdown.
- Reads, disabling, switching budget/month, and opening menus cannot write amounts or transactions. Historical/future months and tracking mode show no reservation figures in v1.

Domain: canonical balance/template/schedule/category; Reserved, Allowance and Spare are new derived terms adopted from the source. Non-goals: balance replacement, transfer guards, automatic allocations, historical snapshots, public API/CLI, pay periods, one-off goal reservations, new template grammar, and partial results presented as complete.

| Acceptance                                                                                          | Evidence                                                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Balance 120000, reservation 60000, allowance target 50000 yields allowance 50000 and spare 10000    | Pure calculation test                                                 |
| Balance 40000 with same claims yields reservation 60000, allowance 0, spare -20000, shortfall 20000 | Deficit test; UI shows signed shortage                                |
| Bill paid / schedule renamed / repeating target rolls forward / unsupported target                  | Core integration fixtures through the handler                         |
| No writes and no stale result after edits, undo, sync or budget switch                              | Mutation spy/database comparison, hook lifecycle tests, two-tab smoke |
| Disabled/non-current/tracking behavior matches existing UI                                          | Desktop/mobile component and browser checks                           |

Risk: financial interpretation and stale state are higher risk than visual presentation. Checkpoint one complete read path before additional menus; keep generic refactoring separate and revert the last slice if its proof fails.

## 4. Data / API shape

Internal request `{ month: 'YYYY-MM' }`; validate a real calendar month and restrict to current month/envelope at the owner, including stale clients after midnight. Result `{ month, categories: [...] }`, keyed by stable category ID. Each row is either `{ categoryId, state: 'ready', balance, reserved, allowance, allowanceTotal, spare, shortfall, claims }` or `{ categoryId, state: 'unavailable', reason }`. Claims have stable schedule/template identity, label, next date, target and accrued amount. Use the budget currency's configured decimal places; do not assume all currencies have two decimals. No `committed` field is required; no external API compatibility promise.

## 5. Runtime / loader / UX behavior

Fetch one batch for the visible budget month at budget-page ownership, not one query/subscription per row. The hook uses TanStack Query and the app's existing budget/sync event wiring; key it by budget ID and month. Invalidate after transactions (including undo), schedules/rules, templates/notes, category/budget edits, and incoming sync. Clear old-budget data immediately; discard late responses. Recompute on month rollover/visibility resume and remove listeners/timers on unmount. Find and reuse actual existing event owners before wiring; record that map in implementation notes.

While loading or after an error show the canonical balance plus a localized loading/unavailable message; do not show old figures as current. No retry-on-render loop. Use shared components, translated labels, FinancialText and privacy masking. No hover-only access; keyboard and mobile menus expose the same details.

## 7. Authority and state ownership

Core `goal-template.ts` is the orchestration authority at the read-handler boundary; pure reservation math owns decomposition. Source: existing ledger, category balances, template definitions and schedule dates. Working state: claim extraction during a request. Derived/cache: response and budget-scoped query cache. Persisted: existing sources plus feature preference only. Client renders values; it never recalculates obligations or writes derived totals. Dependency direction is UI → core handler → existing template/schedule evaluation → pure math.

## 8. Proposed approach

1. **AFK: one category, complete read path.** Compare pinned source to current template/schedule owners and document supported types/identity mapping. Adapt pure math and add read-only extraction/typed handler. Wire the feature flag, one batch query and desktop balance-menu breakdown. Include core no-write/rounding/deficit cases and a component test from request to displayed amounts. Checkpoint: synthetic current-month category visibly reconciles to its canonical balance; flag off is unchanged.
2. **AFK: lifecycle and mobile parity.** Extend the shared panel to `EnvelopeBalanceMenuModal.tsx`; implement invalidation and midnight/budget-switch cleanup at hook ownership. Include paid/skipped/deleted schedule, edits/undo, two-budget and repeated-mount regression tests. Checkpoint: two tabs converge without growing subscriptions; unavailable rows remain explicit.
3. **AFK: rollout documentation.** Add `packages/docs/docs/experimental/reservations.md` and an upcoming release note explaining accrued obligations versus actual cash, supported templates, remaining allowance and current-month limitation. Capture desktop/mobile behavior and focused verification results. No API/CLI expansion in this task.

## 9. Migration

No data migration. Flag defaults off. Disabling removes the panel and subscriptions and leaves amounts, IDs, dates, transfer actions and old-client behavior unchanged. Old clients ignore the extra preference.

## 11. Edge cases and failure modes

Test zero/negative balances, no claims, fractional rates and 0/3-decimal currencies, duplicate schedule references (count once per authoritative template semantics, reject ambiguous duplicates), monthly/annual recurrence, due-now and overdue claims, skipped occurrences, month/year boundaries, deleted categories, and unsupported fixed/adjusted constructs. If current engine cannot supply a trustworthy claim, return unavailable for that category rather than infer missing semantics. Never mark a partial result safe to spend.

## 12. Verification plan

Run from repo root: `yarn workspace @actual-app/core run test src/server/budget/reservations.test.ts src/server/budget/schedule-template.test.ts src/server/budget/goal-template.test.ts`; `yarn workspace @actual-app/web run test src/hooks/useReservations.test.ts src/hooks/useSchedules.test.ts`; `yarn typecheck`. Add focused component/e2e tests for the new panel and run their explicit paths after creation. Do not update unrelated snapshots. Record commands, test counts and synthetic data examples in progress. Manual: two same-budget tabs, payment/edit/undo, mobile tap, privacy mode, midnight/resume and disabling. All feature checks are **planned**, not yet run.

## 14. Open questions / missing info

No user decision is needed to review this bounded first port. Full historical support and replacing Balance are deferred scope, not hidden implementation choices. If read-only extraction cannot match the contract without changing template semantics, stop that slice and revise this plan before implementing it.
