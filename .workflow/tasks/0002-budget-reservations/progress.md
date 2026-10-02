# Task Progress: category reservation breakdown

Current status: complete
Current phase: R1–R3 and final review complete; committed with this record

## Human input required

- None. Duplicate-schedule behavior was decided on 2026-09-27: identical references to one schedule count once and stay ready; the same schedule with different `full`/adjustment modifiers is `duplicate-schedule`; a name matching several live schedules is `ambiguous-schedule` (plan §4, fixture F21).

## Agent next actions

None. The normal-user-agent cross-tab regression closes the earlier D9 verification gap for local tabs.

## Implementation checklist

- [x] Record pinned source/target diff, attribution and the plan §13 deviations. Event owners are fixed in plan §5 (`listenForSyncEvent` `applied`/`success`; `queryClient.clear()` on budget close); do not rediscover them. Attribution header in `reservations.ts`; deviations in `execution-decisions.md` D1.
- [x] Extract `parseTemplateNote` into `template-parser.ts`; reuse it from `template-notes.ts`; `template-notes.test.ts` unchanged and passing (51).
- [x] Add `getScheduleClaims` in `schedule-template.ts` (pre-resolve missing/ambiguous, stored next date, claim-or-fail); `schedule-template.test.ts` unchanged and passing (17).
- [x] Add `reservations.ts`, `types/models/reservations.ts`, `budget/get-reservations` (no `mutator`); respect the plan §2 import ban.
- [x] Pure fixtures F1–F4, F14–F16 in `reservations.test.ts`; handler fixtures F5–F13, F17–F22 and the no-write proof in `reservations.integration.test.ts`.
- [x] Add flag (`prefs.ts`, `useFeatureFlag.ts`, `Experimental.tsx`), `reservationQueries`, `useReservations` (enabled/masking), `ReservationBreakdown`, `BalanceMovementMenu` host; component and flag-off tests. **R1 checkpoint.**
- [x] `sync-events.ts` reset (D2), rollover timer/visibility cleanup, `EnvelopeBalanceMenuModal` `month` + host; hook sequence tests; desktop/mobile e2e. **R2 checkpoint.**
- [x] Docs page, experimental index link (sidebar, D10), release note; manual checks with artifacts in `evidence/` (two-tab check incomplete, D9); typecheck. **R3 checkpoint.**

## Acceptance trace

| Acceptance (plan §3)                                              | Planned proof                                                      | Evidence                                                                                                                                                                                                                                                                                                                                   | Status                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| F1–F4, F14–F16 reconcile exactly                                  | `reservations.test.ts`                                             | 15 passed                                                                                                                                                                                                                                                                                                                                  | Done                                             |
| F5–F13, F17–F22 through the handler                               | `reservations.integration.test.ts`                                 | 34 passed (includes no-write proof and its control)                                                                                                                                                                                                                                                                                        | Done                                             |
| No writes on read                                                 | Spies + database dump (plan §12)                                   | Zero `setBudget`/`setGoal`/`storeNoteTemplates`/`runSchedule` calls and zero sync-listener calls; dump unchanged. The control apply trips all three (D4)                                                                                                                                                                                   | Done                                             |
| Panel renders F1, F2, unavailable; masks loading/error            | `ReservationBreakdown.test.tsx`                                    | 9 passed                                                                                                                                                                                                                                                                                                                                   | Done                                             |
| No stale result after edit/undo/sync/budget switch/rollover       | Hook sequence, `sync-events.test.ts`, two-tab e2e                  | `useReservations.test.ts` 5 (steps 1, 5, 6, 7 + midnight timer) and `sync-events.test.ts` 10 (steps 2–4 + reset wiring) passed. The e2e "refreshes the open breakdown after a payment and undo" passed; the two-page e2e was replaced (D8). Manual rollover passed; local two-tab payment/undo regression passed 2026-10-02 (D9 follow-up) | Done; local two-tab regression passed 2026-10-02 |
| Flag off / non-current month / tracking: panel absent, no request | Component tests, e2e absent-text                                   | `BalanceMovementMenu.test.tsx` 2, `EnvelopeBalanceMenuModal.test.tsx` 2 and `ReservationBreakdown.test.tsx` passed; desktop and mobile flag-off e2e passed                                                                                                                                                                                 | Done                                             |
| Mobile modal shows desktop amounts                                | `EnvelopeBalanceMenuModal.test.tsx`, `reservations.mobile.test.ts` | Passed                                                                                                                                                                                                                                                                                                                                     | Done                                             |
| Docs match plan §4 tables                                         | Docs build                                                         | `yarn workspace docs build` succeeded, no broken-link warnings                                                                                                                                                                                                                                                                             | Done                                             |

## Verification (2026-09-27, final run)

- Core: `yarn workspace @actual-app/core run test:node src/server/budget/template-parser.test.ts src/server/budget/template-notes.test.ts src/server/budget/reservations.test.ts src/server/budget/reservations.integration.test.ts src/server/budget/schedule-template.test.ts src/server/budget/goal-template.test.ts`: 6 files, 143 tests passed. The existing parser (51), `runSchedule` (17) and goal (12) suites are unchanged.
- Client: `yarn workspace @actual-app/web run test src/hooks/useReservations.test.ts src/hooks/useSchedules.test.ts src/sync-events.test.ts src/components/budget/ReservationBreakdown.test.tsx src/components/budget/envelope/BalanceMovementMenu.test.tsx src/components/modals/EnvelopeBalanceMenuModal.test.tsx`: 6 files, 35 tests passed.
- E2E: `yarn workspace @actual-app/web run playwright test reservations.test.ts reservations.mobile.test.ts --browser=chromium`: 5 passed. An earlier run with `--repeat-each=3` passed 15/15.
- `yarn typecheck`: success.
- `yarn oxfmt --check` on the task files: clean. `yarn oxlint --type-aware`: no errors; two warnings. One is the `children` prop in `src/mocks/reservations.ts`. The other is the `as Error` in `template-parser.ts`, moved verbatim from `template-notes.ts`.
- Manual checks (D9), in [`evidence/`](evidence/):
  - privacy: [`privacy.png`](evidence/privacy.png);
  - midnight/resume: [`rollover-before.png`](evidence/rollover-before.png) → [`rollover.png`](evidence/rollover.png);
  - panel reference: [`breakdown.png`](evidence/breakdown.png);
  - two tabs: only [`two-tabs-before.png`](evidence/two-tabs-before.png); the tab-A write failed with a database error outside this feature;
  - disabling: covered by e2e, no screenshot.

## Accepted risks and deferred items

- Broad invalidation on every `applied`/`success` refetches while the budget page observer is mounted, including after unrelated account sync. Accepted for v1; do not replace it with a partial table list. Revisit if profiling shows visible cost.
- Reads are not serialized with `runMutator`, so a read can overlap a write. Mitigation is masking plus refetch on the following `applied` event. Revisit only if a test shows inconsistent rows within one response.
- Broad invalidation is implemented as a coalesced `resetQueries` (D2); the cost profile is the same.
- `undo()` refreshing through `applied` is proven by hook step 4 and the same-page undo e2e. The `undo-event` fallback in `global-events.ts` was not needed.
- The earlier two-tab check (D9) could not complete. The 2026-10-02 normal-user-agent browser regression verifies local two-tab payment/undo refresh. Remote-server synchronization remains unverified.
- Plan section numbers 6 and 10 are intentionally unused; renumbering was dropped to keep existing section references stable.

## Execution decision ledger

See [`execution-decisions.md`](execution-decisions.md) (D1–D10).

## Execution log

- 2026-10-02 — Reviewed handler, parser, schedule claims, query lifecycle and desktop/mobile hosts. Fixed an unsupported fractional monthly repeat that could leave date advancement stuck; rejected date overflow. Added six pure regression cases (21 tests total). Core budget/schedule/parser and expense/coordinator checks passed after the fix (224 distinct tests; the reservation subset reran 55/55). Client feature checks passed (151 tests, one existing skip across reservations, resizing and expenses). Browser/docs builds and targeted source lint/format passed. Normal-user-agent shared-budget payment and follower undo now update both panels; four reservation desktop checks repeated three times passed 12/12 without retries. The combined 22-test browser run had 21 first-pass successes and one initial-menu failure that passed on retry. Historical D9 remains below; its local cross-tab gap is now resolved. Remote-server synchronization remains unverified; broad formatting cleanup is outside this task.

- 2026-09-27 — Created from fork assessment; pinned source and resolved documentation/code discrepancy in the planned contract. No feature code written.
- 2026-09-27 — Expanded implementation plan: template support, pure note parsing, base schedule accrual, query/modal wiring, R1–R3 checkpoints.
- 2026-09-27 — Expanded four-lens plan review (contract, architecture, evidence, verification). Verdict: revise before implementation.
- 2026-09-27 — `review-plan-fix-high-severity-loop`, 2 iterations. Iteration 1 fixed 7 high-severity items: funding-vs-accrual reuse (§1), read owner moved to `reservations.ts` with import ban (§2, §7), accrual inputs/rounding/cycle rules plus fixtures F1–F22 (§3), duplicate and reason-code mapping (§4), R1 pass condition (§12), non-filtering core test command replaced with `test:node` (verified on `template-notes.test.ts`: 51 passed), and the stored-next-date requirement (new finding: `createScheduleList`'s date ignores payments/skips). Iteration 2: no high-severity items; fixture wording tightened. Medium items absorbed: menu hosts, `useFeatureFlag.ts`, cache lifecycle, label deviation, manual-check protocol, §14 stop triggers.
- 2026-09-27 — Harmonization pass. Deleted review workshop files after absorption into `plan.md`: absorbed from `plan.review.consolidated.md`: unified edits 1–8 and deferred items; absorbed from `plan.review.md`: duplicate rule, accrual definitions, R1 scope, display bindings, §14 triggers; absorbed from `architecture.md`: read-authority boundary, claim-or-fail helper, invalidation owners, rejected interface options; absorbed from `plan.review.evidence.md`: code anchors, weekly/daily exclusion, flag default, currency and test-clock facts, pin `label`/`fixed` deviation; absorbed from `plan.review.verification.md`: fixtures, no-write spies and dump tables, hook sequence, e2e and manual protocols.
- 2026-09-27 — Implemented R1–R3 (uncommitted).
  - R1: template-parser extraction, `getScheduleClaims`, `reservations.ts`, handler, flag, query, hook, panel and desktop host.
  - R2: sync reset, rollover, mobile modal host, hook, event and modal tests, desktop and mobile e2e.
  - R3: docs page, sidebar link, release note, manual evidence.
  - Decisions D1–D10 are in `execution-decisions.md`. Final verification is above.
