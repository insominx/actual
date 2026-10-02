# Implementation Record

Last Edited: 2026-10-01

## Contract as Executed

Follow-ups after the user's continuations: D5 fixes cross-tab budget registration; D6 fixes request handling during handover. Local edit/undo and immediate read/write on promotion are verified. Remote-server sync remains unverified. Interrupted, previously dispatched writes return explicit unknown-outcome errors and are never replayed automatically.

- Spec source: `plan.md`, §§2–5 and the golden fixture in §12.
- Delivered: desktop/mobile read-only monthly and annual net-spending grids, category disclosure, uncategorized outflows, privacy overlays, locale-aware headings, sticky row labels and horizontal scrolling.
- Only two budget-scoped local display prefs are written. Budget engine, allocations, ledger and calendar month remain unchanged by display/navigation controls.
- One live query per visible budget/period/range; old generations, errors and category placeholders expose no amounts. Retry disposes the old subscription. Current payloads recover from errors.
- No migration, worker API, third engine, report rewrite, custom exclusion list, or new dependency.

## Execution Decision Audit

- Ledger: `execution-decisions.md`, D1–D6; independent review pending.
- Layout and loader details implement the planned invariants. Production-bundle verification closes local cross-tab and handover blockers via D5/D6. Repository-wide lint retains pre-existing baseline failures.

## Authority and Change Map

- `packages/loot-core/src/shared/expense-range-query.ts`: sole inclusion authority, explicit aliased AQL fields and `normalizeExpenseLeaves`.
- `packages/desktop-client/src/components/budget/expense-view/expenseData.ts`: range validation, pref validation and linear integer aggregation.
- `useExpenseData.ts` in that directory: subscription/status authority, budget/range/retry key masking and generation cleanup.
- `ExpenseView.tsx`: volatile month anchor, display-period preference, independent navigation; `ExpenseTable.tsx`: keyed grid lifetime, disclosure, headings and rendering.
- `BudgetDisplayModeSelector.tsx` and mobile `BudgetPageMenuModal.tsx`: local display-mode writers.
- Desktop `budget/index.tsx`, mobile `BudgetPage.tsx`: mount expenses before calendar initialization; existing calendar setters and engines untouched.
- `loot-core/src/types/prefs.ts`: two LocalPrefs keys. Desktop package manifest adds only the `.ts` alias.
- Tests: core AQL fixture, three client suites, desktop/mobile e2e and `e2e/expense-view-smoke.mjs`.
- Docs: `packages/docs/docs/tour/budget.md`, release note and task/queue records.

## Acceptance and Evidence

| Check                                                                                    | Status       | Evidence / Gap                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact seven leaves, 20100 total; transfers, splits, hidden/closed history and tombstones | Verified     | Core fixture asserts exact IDs and per-leaf values, not only total. Database snapshots including CRDT messages are unchanged.                                                    |
| Refund-only, deleted category, reverse boundary, uncategorized directionality            | Verified     | Core edge fixtures; pure client fixture reconciliation.                                                                                                                          |
| Real days, leap February, year boundaries and annual = sum of months                     | Verified     | `expenseData.test.ts`, all row/group/column/grand totals.                                                                                                                        |
| No stale budget/range, one subscription, metadata wait, disposal, error recovery, retry  | Verified     | `useExpenseData.test.ts`, 5 tests.                                                                                                                                               |
| Read-only navigation/prefs, keyboard, privacy, headers, scroll                           | Verified     | `ExpenseView.test.tsx`, 4 tests; desktop/mobile e2e. Mobile row-label position stays within 1px after horizontal scroll.                                                         |
| Actual edit and undo without remounting                                                  | Verified     | Desktop e2e posts ledger additions/updates and invokes backend undo; total changes and returns.                                                                                  |
| Local two-tab write delivery                                                             | Verified     | Normal-UA shared-worker smoke and browser regression deliver edits and undo to both tabs (D5).                                                                                   |
| Handover queueing, rejection and cancellation                                            | Verified     | 64 coordinator tests; normal-UA e2e and smoke issue immediate read/write during promotion. Previously dispatched writes are never replayed.                                      |
| Remote-server sync                                                                       | Not verified | No sync server was configured for this verification.                                                                                                                             |
| Year performance                                                                         | Verified     | 3007 leaves, 6 table rows, 73ms on the final bundle (78ms previously) from Year press to reconciled 320100 total, no numeric performance requirement. Screenshot in `evidence/`. |

## Verification Record

- Core task suite: 5 tests passed; adjacent AQL `exec.test.ts`: 5 passed in the broader run. The initial no-write dump over all tables failed on tables without an `id` column; the final snapshot explicitly covers the relevant ledger, metadata, budget, notes and CRDT tables.
- Client: 3 files, 23 tests passed. Golden core tests were first observed failing before the implementation and caught wrong AQL alias/range syntax during development.
- Playwright against the built bundle: 3 passed, including mobile layout and real ledger edit/undo.
- `yarn typecheck`: passed for all packages. Targeted oxlint: no errors. Targeted oxfmt and `git diff --check`: clean after final formatting.
- `yarn workspace @actual-app/web build:browser`: passed. `yarn workspace docs build`: passed, no broken-link failures; only release-note link and environment update-check warnings.
- Root `yarn lint`: failed on pre-existing repository formatting; root oxlint separately reports existing parent imports/task 0005 probe errors. Those unrelated files are unchanged by this task.
- Initial scripted smoke was blocked (D4). After the separate coordinator fix (D5), the exact reproduction passes and writes explicit JSON evidence; any blocked result now exits nonzero.

## Change Control

- E1 gate passed before year/mobile work. E2 gates passed before docs/smokes. E3 completed with D3/D4 verification limits.
- Existing unrelated uncommitted reservations, column resizing and study work was preserved. No commits or branches created.
- Rollback: remove expense mounts/menu/selector and leave the two local keys unread; no ledger migration to undo.

## Cross-Tab Diagnosis and Follow-Up

- Symptom / reproduction: `node packages/desktop-client/e2e/expense-view-smoke.mjs` against the production bundle at port 3010, normal Chromium user agent. Both tabs initially read 20100; the first edit throws `database disk image is malformed`. Reproduced twice on continuation before production edits.
- Confirmed cause: a lobby leader creates a budget without an explicit `load-budget` request. `load-prefs` group reconciliation was restricted to `__creating-`, leaving the creator registered as `__lobby`. Opening that real ID in another tab elected a second backend for the same database. Existing leaders replacing a budget had the same registry mismatch.
- Proving observation: four failing-first coordinator cases retained the stale lobby/original ID; 44 original cases still passed. Removing the prefix restriction and notifying renamed ports makes all four pass. The exact production reproduction then shows one real-budget group, one leader and one follower, with 20100 → 21100 → 20100 in both tabs.
- Hypotheses: an expense inclusion or aggregation error was rejected because both initial values were correct and the failure occurred on a ledger write; metadata registration was confirmed by the tests and before/after worker logs. SQLite changes, worker opt-out and artificial tab delays were not used.
- Owner / files: `platform/client/browser-server/coordinator.ts` owns registration via `handleBudgetLoaded`; its existing test file adds creation/import/replacement and idempotent metadata cases. `e2e/multi-tab-budget.test.ts` runs real shared-worker routing with a normal user agent, checks edits initiated by either tab, undo, and edits after leadership transfer completes.
- Preserved invariants: one backend per registered budget, independent budget groups, no new persistence/API, unchanged expense accounting. Rollback is the coordinator-only diff plus its regression test/release note; no migration to reverse.
- Verification: coordinator 49 tests and expense core 5 pass; all-package typecheck passes. Browser build passes. Four desktop/mobile/multi-tab browser tests pass; the normal-UA multi-tab regression also passes three consecutive repeats. Targeted lint and formatting are checked separately from known root baseline failures.
- Evidence: `evidence/two-tab-verification.json`, `two-tabs-updated.png`; the smoke writes explicit pass/block results and exits nonzero on a blocked two-tab check. Year smoke reconciles 3007 leaves to 320100 (88ms latest observation after D6).
- Historical D5 probe: issuing a request while the backend restarted timed out even though restoration succeeded. This motivated the separately verified D6 slice below. No existing corrupted database was opened or repaired; only disposable synthetic budgets were used.

## Handover Diagnosis and Follow-Up

- Reproduction: the normal-UA multi-tab browser test closes the leader, waits only for the follower's LEADER role, then submits `load-prefs`. Before D6, it times out despite successful backend restoration. The passing D5 version waited for reconnection and therefore did not cover this window.
- Root cause / proof: coordinator messages were forwarded with `backendConnected === false`; the replacement backend registers handlers asynchronously. Nine failing-first port tests reproduced early forwarding, silently dropped outstanding routes and incorrect success on failed restore. A separate red eviction test proved queued writes could outlive their budget association.
- Contract / preserved invariants: new requests during handover execute once in FIFO order after successful connection and restore. Previously dispatched, unacknowledged requests reject with unknown outcome, never replay. Closed/detached/evicted tabs cannot commit queued work. Failed restore does not publish a successful connection. Other budget groups remain responsive. Expense inclusion, allocations and persistence stay unchanged.
- As built: `forwardToWorker` owns forwarding/queueing, `broadcastConnect` drains the group FIFO with membership checks, `rejectRequests` settles outstanding replies at election, and `failBackend` settles queued work on initialization/restore failure. `forgetRequest` releases payload/routing metadata on completion or disposal. Error envelopes reuse the existing `postErrorReply` authority.
- Hypotheses / rejected patches: a slow database alone was rejected because restoration completed while the original promise remained unsettled; delaying test actions or automatically retrying mutations would hide the lifecycle error. Buffering new unsent messages is safe; replaying already-dispatched writes is not.
- Regression coverage: coordinator 64 tests, adjacent response serialization 6, expense core 5 — all 75 passed. Four browser tests passed; the strengthened multi-tab test also passed three consecutive repeats. It issues a read and write immediately on promotion, asserts completion/total, then verifies a subsequent edit. The smoke captures 20100 → 21100 → 20100 in two tabs, then 22100 on the promoted tab, in JSON and screenshot evidence. Browser build, all-package typecheck and targeted lint pass.
- Risk boundary / rollback: no exactly-once protocol or corrupted-file repair is claimed. An interrupted write may already have committed; inspect its ledger outcome before retrying. Backend restore failure returns explicit errors rather than silently reconnecting without a budget. Roll back the D6 coordinator changes and strengthened regression together, preserving D5's registration fix.

## Risks and Resume Anchors

- Re-run `node packages/desktop-client/e2e/expense-view-smoke.mjs` against the production bundle at `EXPENSE_SMOKE_URL` (default `http://localhost:3010`); local edit/undo and handover requests are verified. Remote-server sync remains a separate check. Reconcile the actual outcome of an interrupted write before retrying; no mutation replay is attempted.
- Broader lint needs a separate baseline-cleanup task, not a feature patch.
- Privacy intentionally inherits the existing PrivacyFilter behavior (desktop shoulder-surfing masking; mobile currently bypasses it).
- `progress.md` is the command/checkpoint record; `evidence/two-tabs-before.png` and `evidence/year-performance.png` contain synthetic data only.
