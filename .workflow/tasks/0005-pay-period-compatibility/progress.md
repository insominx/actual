# Task Progress: pay-period compatibility study

Current status: complete
Current phase: study closed — no port selected (2026-10-02)

## Human input required

- None. The user selected **no port** on 2026-10-02. No paycheck view or production port is queued.

## Agent next actions

None. The compatibility study and direction decision are complete.

## Implementation checklist

- [x] Pin fork and ADR; manifest with pinned/probe hashes, transformation, purity and license notes.
- [x] `survey.md` with owner tuple and all §8 investigation paths resolved against inspected revisions.
- [x] Task 0002 plan-contract comparison recorded as `source-backed analysis`; 0002 folder untouched.
- [x] P01–P04 `reproduced` (or `unknown` + `harness_error`); P04 via child processes with parent `TZ` unchanged.
- [x] P05–P08 ledgers filled from pinned fork tests/source, or `unknown`.
- [x] P09 `model-evidence` in both delivery orders plus replay; P10 month-13 gates and report omission recorded.
- [x] Evidence record for every P01–P10 scenario (plan §12 fields).
- [x] `compatibility.md` comparison and recommendation; this study changed only `.workflow/` files (end-of-study `git status` also lists concurrent task 0004 `packages/desktop-client` edits and a 0001/0002 doc edit made by other sessions, not by this study).

## Acceptance trace

| Acceptance                                        | Planned proof                                              | Evidence                                                                                               | Status |
| ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| Complete consumer map                             | `survey.md` owner tuple + resolved paths/symbols           | `survey.md` owner tuple, consumer map §1–5, all §8 paths resolved                                      | Done   |
| Date and cadence cases reproducible               | `node --test` records for P01–P04                          | `node --test ".workflow/tasks/0005-pay-period-compatibility/probes/*.test.mjs"` exit 0, 9/9, first run | Done   |
| Allocation/sync/disable consequences demonstrated | P05–P10 ledgers with labels; P09 model fixtures            | `compatibility.md` P05–P10; `probes/sync-order.test.mjs` A→B, B→A, replay                              | Done   |
| Actionable comparison and recommendation          | `compatibility.md` option matrix and scoped recommendation | Option matrix, rejected designs, recommendation, next-task scope                                       | Done   |
| Evidence-label discipline                         | One §12 label per scenario; no go from model/unknown       | P01–P04 reproduced; P05–P08, P10 source-backed; P09 model-evidence; full port = defer                  | Done   |

## Defer register

- Full pay-period port: deferred. Requirements, owners, cost and needed integration evidence are in `compatibility.md` Recommendation table. Revisit trigger: user requires true per-paycheck allocations.

## Execution decision ledger

No material scope changes; `execution-decisions.md` not created. Minor execution notes: the plan §12 glob must be quoted in PowerShell; vendored `.ts` emits Node's `MODULE_TYPELESS_PACKAGE_JSON` warning (not a harness error); an extra non-gating "fixture ranges" test pins the date ranges quoted by the P05/P06/P09 ledgers.

## Review

- Mode: expanded panel (contract, architecture, evidence, verification), parallel workers; verdict: revise before implementation.
- Fix loop: 2 iterations; high-severity issues remaining: 0.
- Lens transcripts: [Contract review](9a2c3101-4ddb-4213-99d3-30523da96baf), [Architecture review](b50ee4a5-d2a4-410d-8490-117c56f8f028), [Evidence review](cae491a9-cf12-4f6f-9951-4602cfc1ae7c), [Verification review](f08a3b0f-f340-4f37-968d-ce7f947328a9).

## Execution log

- 2026-10-02 — User selected no port. Re-ran all probes: 9/9 passed. Closed the study; no production changes or follow-up task.

- 2026-09-27 — Demoted broad pay-period port to a bounded compatibility study after rereading source limitations. No production implementation or probes performed.
- 2026-09-27 — Expanded the study execution plan with exact artifact schemas, consumer investigation order, ten fixed scenarios, evidence labels and go/defer criteria. Probes have not run.
- 2026-09-27 — Expanded plan panel, parallel workers. Verdict: revise before implementation.
- 2026-09-27 — Fix loop iteration 1: fixed four high items in `plan.md` — `model-evidence` label and go unreachable in study; single extraction rule (verbatim `pay-periods.ts` via Node type stripping, type-strip fallback, server modules survey-only); P05–P10 fixed ledgers replacing either/or oracles; task 0002 as plan-contract comparison. Absorbed medium items: owner tuple, consumer list, month-13 gates, P04 child-process `TZ`, evidence record fields, P01–P10 as completion set, report-blank rule, invariant split, fetch-failure disposition, title verdict. Re-verified local anchors (`validateMonth`, `api/budget-set-amount`, `isValidYearMonth`, `dbMonth`, `sheetForMonth`, `loadUserBudgets`, `setBuffer`, `exportBudget`; `reservations.ts` absent; root `date-fns` 4.4.0; Node v26.3.0) and P02/P04 date oracles.
- 2026-09-27 — Fix loop iteration 2: re-review found no high items; removed optional `allocations.test.mjs` and P08 `reproduced` path that conflicted with the extraction rule; added ledger-only record format.
- 2026-09-27 — Harmonization: absorbed from `plan.review.consolidated.md`: unified edits 1–8 and deferred items; from `plan.review.md`: contract findings (labels, extraction, completion set, 0002, fetch failure, sequencing); from `architecture.md`: owner tuple, cadence lifecycle class, hash-locked import, fork sync harness rejected for this task; from `plan.review.evidence.md`: verified anchors, missed consumers, key encodings, ordinary-cell old-client apply, fork config prefs; from `plan.review.verification.md`: fixed oracles, P04 procedure, evidence record fields, harness-error separation. Deleted all five review artifacts.
- 2026-09-27 — Study executed. Baseline: Node v26.3.0, local HEAD `9a71fd22`, `git status` only `.workflow/`, task 0002 plan hash `A0B61A77…FEF6` unchanged. Fetched fork `62128aa6` and ADR repo `8e099312` (ADR file `4baa7dac`) to `%TEMP%/pp-study`; merge base `62a18ba7`, 47 commits / 116 files ahead. Vendored `shared/pay-periods.ts` from the git blob (`0791764c`, SHA-256 `F1F16593…EDA5`, `transformation: none`). Wrote `probes/source-manifest.json`, `survey.md`, `probes/date-ranges.test.mjs` (oracles fixed before first run), `probes/sync-order.test.mjs`, `compatibility.md`. `node --test` 9/9 pass on first run. Results: P01–P04 reproduced; P05, P06, P08 (fixed template), P09, P10 fail adoption; P07 passes for fork-only clients. Recommendation: full port defer; read-only paycheck view or no port (HITL). Task 0002 plan hash changed mid-study (17:11, other session) to `710F34B6…383A`; re-read, contract anchors unchanged, comparison stands. Final rerun 9/9 pass.
