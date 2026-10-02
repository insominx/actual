# Execution decisions: category reservation breakdown

Material deviations from `plan.md` made during implementation (2026-09-27). Source attribution: [hubermjonathan/actual `reservations.ts` at `5e939d427cb8ca347b3e526b4a230537e5e84668`](https://github.com/hubermjonathan/actual/blob/5e939d427cb8ca347b3e526b4a230537e5e84668/packages/loot-core/src/server/budget/reservations.ts), credited in the file header of `packages/loot-core/src/server/budget/reservations.ts`.

## D1. Pinned-fork deviations (plan §13)

All deviations planned in §13 landed as written:

- No `[fixed]` schedules or `label` grammar. Claim labels use the template `description`, then the schedule name, then the category name.
- `full` and adjusted schedule templates are `unsupported-template` instead of accruing.
- Missing, ambiguous, completed or errored schedules make the category unavailable instead of being skipped.
- By templates without a period (or with `from`, or `repeat every month`) are `unsupported-template`.
- No `status`, `onTrack`, `settledThisMonth` or `committed` fields.
- No Balance-column or Transfer changes. The panel is added above the existing menu items.

The pin's guide says claims fill in due-date order when the balance is short. Its code (and this port) sums full accrued claims and shows any deficit once as negative Spare.

## D2. Reservation cache is reset, not invalidated, on sync events

Plan §5 said `applied`/`success` invalidates `reservationQueries.all()`. A plain `invalidateQueries` during a first load that has no data yet joins the in-flight fetch in TanStack Query 5, so the outdated response stays in the cache. Hook step 2 failed with that approach. `sync-events.ts` now calls `resetQueries`, which cancels the in-flight fetch and refetches observed keys. Events in one tick share one `setTimeout(0)` reset (hook step 3), and unlisten clears a pending timer. The broad-refetch risk in `progress.md` is unchanged.

## D3. Pure helpers exported from `reservations.ts`

`accruedToDate`, `settleReservations`, `getByClaim` and `getAllowanceAmount` are exported so `reservations.test.ts` can test F1–F4 and F14–F16 without a database. They are server-only, and nothing outside the tests imports them.

## D4. No-write proof observes CRDT writes through `addSyncListener`

The global test setup loads `#server/db` before test mocks exist, so its `sendMessages` binding cannot be wrapped. The integration suite registers an `addSyncListener` callback and expects zero calls. A control test shows the listener, the `setBudget` spy and the database dump all detect a real template apply. `setBudget`, `setGoal`, `storeNoteTemplates` and `runSchedule` spies stay as planned, via partial `vi.mock` wrappers. To type the dump, `typings/window.ts` declares `getDatabaseDump`, and `src/mocks/setup.ts` gained an `as const` on the row tuple.

## D5. Reason mapping for engine failures

- `createScheduleList` throwing, or returning an entry with no next date, maps to `inactive-schedule`.
- A UI-sourced `goal_def` that fails to parse or validate, a parsed template of type `error`, and any exception while computing one category map to `invalid-template`. The exception is logged with `logger.error`, and the other categories still return.

## D6. Rollover landed in R1

The midnight timer and `visibilitychange` month check were implemented with `useReservations` in R1 rather than R2, because the hook's `month`/`enabled` logic needed them. Hook step 6 and the midnight test prove it.

## D7. Test layout

- The event-driven hook steps (2–4) live in `src/sync-events.test.ts` and drive the real `listenForSyncEvent`. They don't live in `useReservations.test.ts`, because the lint rules forbid the relative parent import `../sync-events` from `src/hooks`.
- Shared fixtures (`reservationsResult`, deferred server, store wrapper) are in `src/mocks/reservations.ts`.
- Hook step 7 asserts the `sync-event` listener count is unchanged across 100 cycles rather than equal to 1, since the hook adds no listener of its own; the single app listener belongs to `sync-events.ts`.
- `EnvelopeBalanceMenuModal.test.tsx` was added so the mobile modal's `month` pass-through and flag-off path have a unit test besides the e2e.

## D8. Two-page e2e replaced by a same-page payment/undo e2e

Under Playwright (`navigator.userAgent` contains `playwright`), `browser-preload.js` sets `forceDirectWorker`, so each page runs its own backend. Two pages on one budget then write the same database, and the run fails with "database disk image is malformed". `e2e/reservations.test.ts` instead posts the payment and undo through `$send` on the page that has the menu open, which goes through the same `applied` event path. See D9 for the manual two-tab attempt.

## D9. Manual checks run as a scripted browser session

The §12 manual checks ran as a throwaway Playwright script against the dev server. It used a real Chrome user agent, so the SharedWorker path and today's month (2026-09) applied, on a synthetic budget with the category funded at 1,000.00, `#template 50` and `#template 1200 by 2026-12 repeat every year`. The script was deleted afterwards.

- **Privacy:** passed; `privacy.png`. All four panel amounts are masked (text at opacity 0 under a `Redacted Script` overlay).
- **Midnight/resume:** passed; `rollover-before.png` → `rollover.png`. The clock was set to 2026-09-30 23:58 and fast-forwarded 3 minutes, then `visibilitychange` fired. The open September menu drops the panel and keeps its actions.
- **Two tabs:** not completed. Tab B loaded the budget and showed the panel (`two-tabs-before.png`). The first write from tab A then failed with "database disk image is malformed", so both tabs were running separate backends even with a real user agent. This is outside the feature. The cross-tab path is the same `applied` event proven by hook steps 2–4 and the same-page e2e.
- **Disabling:** covered by the e2e "removes the breakdown when the flag is turned off" and the flag-off component and modal tests. No `flag-off.png`: the scripted attempt timed out on the settings toggle, and turning the flag off from another tab needs the two-tab path.

## D10. Experimental index link is the docs sidebar

No docs page lists experimental features. The "Experimental" sidebar category in `docs-sidebar.js` is the index, and `experimental/reservations` was added after `experimental/monthly-cleanup`.
