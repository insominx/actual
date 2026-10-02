# Task Progress: transaction text-column resizing

Current status: complete
Current phase: implementation and final review complete; committed with this record
Execution path: AFK, batches C1 → C2 → C3 (one session)
Verdict: all plan §12 rows pass
Review pass: high-severity fix loop complete (2 iterations, 0 high open)

## Human input required

- None.

## Agent next actions

1. [x] C1: `columnWidths.ts`, `useTransactionColumnWidths`, props through `Account` → `TransactionList` → `TransactionsTable`, scroll shell, payee pointer handle, style at every payee site.
2. [x] C2: `useLocalStorage` persistence, the other four handles, keyboard, modal reset, `LocalPrefs` type.
3. [x] C3: lifecycle, recycle, narrow viewport, amount, mobile; manual X1–X3; docs and release note.
4. [x] Run the plan §12 commands and `yarn typecheck`; evidence below.

## Implementation checklist

- [x] Pure width model and tests (plan §4, §5 geometry).
- [x] Scroll shell in `TransactionTableInner`; `FixedSizeList` unchanged.
- [x] Payee pointer path with header/row/split/editor/new-row alignment.
- [x] Local persistence hook as sole reader/writer; other text handles.
- [x] Keyboard control and modal Reset column widths.
- [x] View-change, cancel and unmount cleanup; listener balance.
- [x] Mobile and `Calendar.tsx` unchanged.
- [x] Docs (`tour/accounts.md`, `getting-started/tips-tricks.md`) and release note (`upcoming-release-notes/transaction-column-resizing.md`).

## Acceptance trace

| Acceptance                                                            | Planned proof (plan §12) | Evidence                                               | Status |
| --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------ | ------ |
| Header/row/split/editor/new-row edges agree within 1 CSS px           | G1–G5                    | Playwright, 2 repeats                                  | Pass   |
| Pointer and keyboard do not sort/select/drag/edit                     | G6; K1–K6                | Playwright G6; Vitest K1–K6                            | Pass   |
| Reload/reorder/hide/show/view switch keep only the correct id's width | H1–H8; T2; P1–P3         | Vitest H1–H8, T2; Playwright P1–P3                     | Pass   |
| Malformed values, missing budget id and reset preserve defaults       | U1–U5; H2–H6             | Vitest                                                 | Pass   |
| No synced writes; only the width key changes                          | P4; M1–M2; S1            | Playwright P4; Vitest M1–M2; S1 search returns nothing | Pass   |
| Cancel, view switch, unmount, recycle clean up                        | T1, T4–T6; K4; G5        | Vitest T1, T4–T6, K4; Playwright G5                    | Pass   |
| Amount widths content-aware; narrow viewport scrolls without write    | G4; P5                   | Playwright                                             | Pass   |
| Mobile cards and `Calendar.tsx` tables have no handle                 | R1; T3                   | Playwright `accounts.mobile.test.ts`; Vitest T3        | Pass   |
| Manual: privacy mode, zoom, keyboard-only                             | X1–X3                    | Scripted browser session, screenshots in `evidence/`   | Pass   |

### Commands (repo root, 2026-09-27)

- Vitest, the six §12 files: 6 files, 95 passed, 1 skipped (pre-existing skip in `TransactionsTable.test.tsx`).
- Playwright `transaction-column-resizing.test.ts accounts.mobile.test.ts --browser=chromium`: 12 passed (9 column-resizing, 3 mobile). The column suite also passed twice with `--repeat-each=2` before the focus test (D5) was added.
- `yarn typecheck`: passed for all packages before the task 0002 reservations work landed in the tree. Re-run afterwards fails only in that work (`loot-core/src/server/budget/reservations.ts`, `useReservations.test.ts`, `ReservationBreakdown.test.tsx`, `BalanceMovementMenu.test.tsx`); `tsc-strict` for desktop-client reports only those 3 errors, none in this task's files.
- oxfmt and oxlint on changed files: clean apart from the accepted `jsx-a11y(prefer-tag-over-role)` warning on the focusable ARIA separator.

### Manual checks

- X1 privacy mode — Pass. Payee resized to 240 and notes narrowed; header and five rows share edges; redacted amounts stay inside their cells. `evidence/x1-privacy.png`.
- X2 zoom 150% — Pass. Payee header and rows at 240 with identical edges; payment column 100 before and after. `evidence/x2-zoom150.png`.
- X3 keyboard-only — Pass after fix D5. Tab from the Date header reaches the Payee handle; 3× ArrowRight widens by 30 with an inset focus ring and no re-sort; Reset column widths works from the keyboard. With payee at 1200, Tab from the date cell to Deposit scrolls the shell (`scrollLeft` 649) and the input is fully visible. Before D5 the input stayed off-screen. `evidence/x3-keyboard-focus.png`, `evidence/x3-keyboard-scroll.png`.

## Execution decision ledger

See `execution-decisions.md` (D1–D6).

## Execution log

- 2026-10-02 — Reviewed per-budget/view persistence, draft ownership, table geometry, capture cancellation, keyboard focus and reset behavior. All resizing client tests passed as part of a 151-test client run (one existing skip). All nine resizing browser checks and three mobile account checks passed. Current browser/docs builds, targeted source lint/format and root typecheck passed. The earlier reservation-related typecheck errors recorded below are resolved. No blocking review findings remain.

- 2026-09-27 — Planned adaptation of resizing only; current order/visibility and automatic amount widths preserved.
- 2026-09-27 — Expanded plan review, parallel workers. Verdict: revise before implementation.
- 2026-09-27 — High-severity fix loop, iteration 1: fixed four high items in `plan.md` (horizontal scroll shell in §5; view-id cancel for account-to-account in §5; pinned geometry protocol in §12; observable proofs for synced-pref isolation, listener balance, `setItem` counts and mobile in §12). Also landed gate-required medium edits: raw stored map and sole-writer rule (§4), Home keyup/blur commit and modal reset wiring (§2, §5), batch-tagged §12 rows and full Vitest/Playwright commands.
- 2026-09-27 — Iteration 2: 0 high. Fixed batch/acceptance cross-references; added constraint card, C1 in-memory hook stand-in, scroll-shell fallback rule, keyboard off-screen focus check.
- 2026-09-27 — Harmonization: absorbed from `plan.review.consolidated.md`: merged findings, conflicts, deferred items (plan §5, §12, §14). Absorbed from `architecture.md`: scroll-shell option, raw-map storage rule, view-id lifetime, fallback (plan §4, §5, §8). Absorbed from `plan.review.evidence.md`: repo facts and anchors (plan §1, §2). Absorbed from `plan.review.verification.md`: proof protocols and commands (plan §12). Absorbed from `plan.review.md`: Home timing, sole writer, clamp/rounding, column scope (plan §2, §4, §5). All five deleted.
- 2026-09-27 — Implemented C1–C3 in one session. New: `table/columnWidths.ts`, `table/ColumnResizeHandle.tsx`, `hooks/useTransactionColumnWidths.ts`, their tests, `TransactionTableColumnsModal.test.tsx`, `e2e/transaction-column-resizing.test.ts`. Changed: `TransactionsTable.tsx`, `TransactionList.tsx`, `Account.tsx`, `TransactionTableColumnsModal.tsx`, `modalsSlice.ts`, `loot-core/src/types/prefs.ts`, `desktop-client/package.json` (import alias), `e2e/accounts.mobile.test.ts`, docs, release note.
- 2026-09-27 — Playwright fixes: re-measure the header after opening the editor (the shell can scroll); integer drag coordinates with a ±1px poll; G3 and G5 use the All accounts view, find split rows by amount because scheduled previews come first, and poll recycled rows until rendered. G3 split placeholder assertion changed per D4.
- 2026-09-27 — X3 found off-screen focus within a row; fixed by D5 with a new Playwright test. All §12 rows re-run and pass.
