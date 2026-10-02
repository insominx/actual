# Task Progress: expense-only budget view

Current status: implemented (uncommitted), with verification gaps
Current phase: E1–E3 and cross-tab/handover follow-ups complete; review pending
Execution path: AFK, batches E1 → E2 → E3 (plan §8)
Verdict: feature, local cross-tab and handover lifecycle implemented; baseline lint and remote-sync verification limits remain

## Human input required

- None for the implementation. Shared query placement is adopted; the local cross-tab edit/undo blocker is resolved (D5). Remote-server sync needs a separately configured sync server.

## Agent next actions

1. Review the task diff and execution decisions D1–D6; no commit or branch was created.
2. Review D5/D6's coordinator follow-ups and normal-UA browser regression. Remote-server sync still needs a separate configured-server check; interrupted writes must be reconciled before retrying because their prior outcome can be unknown.
3. Resolve repository-wide lint failures separately; do not mix baseline cleanup into this feature.

## Implementation checklist

- [x] Compare the pinned fork `expenseData.ts` for aggregation shape only; inclusion rules come from plan §3.
- [x] Shared query + normalization with exact leaf IDs and read-only database snapshots.
- [x] Pure summary + validators with golden, edge-month, leap and year-boundary tests.
- [x] `useExpenseData` on one `liveQuery` with generation guard, metadata loading and lifecycle tests.
- [x] Desktop selector + month view (E1 gate passed before E2).
- [x] Year view, expansion, a11y, privacy, mobile, e2e (E2 gate passed before E3).
- [x] Edit/undo lifecycle, performance smoke and docs/release note. Initial two-tab blocker (D4) resolved and verified by D5; broad lint still has baseline failures (D3).

## Acceptance trace

Matches plan §3 acceptance table.

| Acceptance                                                                          | Planned proof                                          | Evidence                                                              | Status           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- | ---------------- |
| Golden month rows/total (20100) and exact included leaf IDs                         | Core AQL fixture + client pure fixture                 | `expense-view-query.test.ts`, `expenseData.test.ts`                   | Verified         |
| Internal transfer excluded (uncategorized 700, transfer IDs absent)                 | Same fixtures                                          | Exact leaf IDs and uncategorized totals                               | Verified         |
| Split parent never counted                                                          | Same fixtures                                          | Exact leaf IDs exclude parent                                         | Verified         |
| Boundary transfer counts once; reverse month −1500                                  | Same fixtures                                          | Core edge fixture                                                     | Verified         |
| Refund-only −2500; deleted-category 400                                             | Edge-month fixtures                                    | Core and client edge fixtures                                         | Verified         |
| Monthly/annual reconciliation, leap Feb 29 columns, year boundary                   | Pure fixtures                                          | `expenseData.test.ts`                                                 | Verified         |
| Only display prefs written; `budget.startMonth`/`budgetType`/allocations unchanged  | `ExpenseView.test.tsx` + desktop/mobile e2e            | Local/synced prefs and allocation assertions; core database snapshots | Verified         |
| Invalid/missing prefs fall back without writes                                      | `expenseData.test.ts` validators                       | Missing/invalid pref cases                                            | Verified         |
| No stale values; one `liveQuery`; zero after unmount; error → next payload recovers | `useExpenseData.test.ts`                               | Five lifecycle tests                                                  | Verified         |
| Privacy, keyboard, headers, narrow scroll, two-tab live update                      | UI tests, desktop/mobile/multi-tab e2e, scripted smoke | Four browser tests and two-tab 20100 → 21100 → 20100 smoke pass (D5)  | Verified locally |

## Defer register

No high-severity defers. Medium/low items deferred with rationale are in plan §14 (custom exclusions, hidden-income fixture row, automated rollback test, prewarm skip).

## Execution decision ledger

See `execution-decisions.md`, D1–D6, and `implementation.md` for as-built ownership, evidence, diagnosis and rollback. Independent review pending.

## Verification Record

- Handover follow-up: `yarn workspace @actual-app/core run test:node src/platform/client/browser-server/coordinator.test.ts src/platform/server/connection/shared.test.ts src/server/aql/expense-view-query.test.ts` — 75 passed (64 coordinator, 6 serialization, 5 expense query).

- Core: `yarn workspace @actual-app/core run test:node src/server/aql/expense-view-query.test.ts` — 5 passed. Adjacent `exec.test.ts` — 5 passed.
- Client: `yarn workspace @actual-app/web run test src/components/budget/expense-view/` — 23 passed across 3 files.
- Browser: `yarn workspace @actual-app/web build:browser` — passed. `E2E_START_URL=http://localhost:3010` with Playwright expense desktop/mobile and multi-tab tests — 4 passed, including immediate read/write during handover. The strengthened multi-tab test also passed three consecutive repeats.
- `yarn typecheck`, targeted oxlint/oxfmt and `git diff --check` — passed. `yarn workspace docs build` — passed with no broken links.
- Root `yarn lint` fails on pre-existing formatting; separate root oxlint reports existing imports and task 0005 probes. No unrelated cleanup performed (D3).
- Scripted smoke: 20100 → 21100 → 20100 in both tabs, then 22100 after submitting read/write immediately on promotion. `evidence/two-tab-verification.json` and `two-tabs-after-handover.png` record D5/D6. The 3007-leaf year view reconciles to 320100 with 6 rows (88ms latest observation). Remote-server sync is not verified.

## Execution log

- 2026-10-01 — Continued D6 safe handover slice: reproduced a hanging request immediately after promotion, then observed nine failing-first coordinator cases. Buffer new work until connection and restore succeed; reject unknown-outcome interrupted requests without replay; reject cancelled/failed work using existing response envelopes. Additional red tests guard evicted writes and failure acknowledgement. Final coordinator 64 tests pass, four browser tests pass, and strengthened smoke submits a read/write during handover successfully. No real budget, automatic mutation retry or storage migration was used.

- 2026-10-01 — Continued with a separate cross-tab bugfix slice (D5). Creation in the lobby and replacement by an existing leader left stale coordinator IDs; four failing-first cases proved it. Reconcile actual IDs on metadata replies and notify port associations without a new worker. Coordinator 49 + expense core 5 tests pass; four browser tests pass and the multi-tab test passes three consecutive repeats. Typecheck, browser build and targeted lint pass. Original D4 is closed for local edit/undo; remote sync/in-flight failover requests and baseline lint remain outside this fix.

- 2026-10-01 — Implemented E1 shared inclusion query, core fixture, local prefs, pure aggregation, subscription lifecycle and desktop month mount; gate passed before E2.
- 2026-10-01 — Implemented E2 annual controls, keyed grid, disclosure, keyboard/privacy/localized headers, mobile menu/mount and layout tests; gate passed before E3.
- 2026-10-01 — Completed E3 real edit/undo proof, docs/release note, performance smoke and as-built records. Cross-tab verification and broad lint remain open as D3/D4; existing unrelated work is preserved and no commit was made.

- 2026-09-27 — Planned a locale-independent port using current budget accounting; no feature code written.
- 2026-09-27 — Expanded plan panel (contract, architecture, evidence, verification), parallel workers. Verdict: revise before implementation.
- 2026-09-27 — High-severity fix loop, 2 iterations. Iteration 1 fixed: transfer inclusion rule (§3/§4), fail-closed golden fixture with IDs and per-row values (§12), single inclusion owner in `loot-core/shared` (§2/§7), hook-owned status on direct `liveQuery` (§5), expense navigation off `budget.startMonth` setters (§2–§4), core `test:node` command (§8/§12). Iteration 2 fixed: selector placement and mobile expenses-mode header so the anchor is never lifted into `BudgetPage` (§2/§7/§8), acceptance evidence pointing at named tests, hook/category loading rule. Remaining high = 0.
- 2026-09-27 — Harmonization: absorbed from `plan.review.consolidated.md`: unified edits 1–8 and deferred items → plan §2–§14. Absorbed from `plan.review.md`: transfer wording, fixture fail-closed design, startMonth wording, invalid-pref check, file-list drift. Absorbed from `architecture.md`: shared query/hook-status design, month-control ownership, keying, `showHiddenCategories` not an input, prewarm note, serialized-snapshot fallback (→ Human input required). Absorbed from `plan.review.evidence.md`: verified repo anchors (§1), non-oracle queries, `useQuery`/`liveQuery` behavior, `initialized` gate, no Disclosure component, e2e placement. Absorbed from `plan.review.verification.md`: commands, spy cardinality, manual smoke five-part spec, leap/boundary specifics, E-batch gates. All five review files deleted.
