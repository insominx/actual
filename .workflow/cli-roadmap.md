Last Edited: 2026-10-04

# Agent CLI roadmap

The user requested a maximally useful CLI and authorized implementation on 2026-10-02. Tasks 0007-0013 are implemented and verified locally on Windows. Lifecycle includes encrypted publication recovery. Synchronization includes browser/two-cache convergence, pending-write recovery, required freshness, bounded watch, and live profile switching. Backups include creation, listing, isolated validation, restore-as-new, comparison, and retention. Task 0014 has verified guarded transaction/split/transfer, recovery, allocation, rename/archive, local creation, clone, restore, guarded publication, direct allocation/carryover, hold/reset, and account creation/update/reopening/deletion checkpoints; tasks 0015-0036 remain planned. Linux and personal adoption remain final acceptance work. This document preserves the full delivery graph. No sub-agent delegation is required.

The first foundation delivers discovery/schema commands, version 2 output, device-local profiles, budget context, and explicit offline sessions. Real disposable servers prove encrypted sessions, two-budget isolation, import deduplication, restart, and offline convergence. See each completed task's implementation.md. Managed lifecycle and first-run bootstrap are delivered locally. Budget lifecycle has Windows packaged proofs, including publication recovery and clone isolation. Synchronization has Windows browser and CLI acceptance. Backups have complete Windows acceptance. Linux execution, the remaining receipt adapters, and the remaining roadmap work are pending.

## Architecture and preserved decisions

Use one `actual` executable with explicit domain operations and configurable inputs. Keep flexible read-only ActualQL. A registry supplies schemas/discovery, CLI execution, and an optional MCP adapter. Dependencies flow CLI/adapter -> public API -> core engine; sync-server owns authentication and remote transport. Do not use internal send calls as a permanent public API or duplicate UI calculation logic in CLI.

Keep planning targets separate from allocations. The current cash-planning module is already implemented in [0006](tasks/0006-cash-planning/progress.md), locally verified and committed in `68ffdbe3b`. This roadmap extends its supported API/tool exposure, not its formulas. Existing account CRUD, normalized JSON import, allocations, rule/schedule CRUD, and ActualQL are reused and hardened rather than replaced.

Private account scope remains Chase, Capital One, Robinhood cash, and cards. Tracking accounts remain inspectable, but holdings valuation, mortgage amortization, wife accounts/ownership segmentation, personal automatic bank setup, spending suggestions, and transaction exclusions remain deferred. Existing configured bank-sync capability gets diagnostics; no new bank linking is implied.

## Shared tool contract

- Version 2 results: `schemaVersion`, `operation`, `context`, `data`, `warnings`; errors have stable code/message/details/retryability and stable exit codes. Preserve legacy command output by default; opt in with `--output-version 2`. New commands default to version 2.
- Context: explicit local/sync budget identity, mode, currency/scale, observed freshness, applicable range/cutoff. Integer cents use the existing scale 100; missing currency is explicit. Date-only values use YYYY-MM-DD.
- Discovery is available without a budget/server. Schemas describe read/write/destructive status, preview/reversal support, feature flags, supported formats, and known prerequisite/authentication limits.
- Reads/pages disclose limits and concurrent snapshot changes. Reports include scope, exclusions, history completeness, and drill-down IDs. Unknown imports are not verified zero spending.
- Preview tokens bind operation, budget, source hashes/options, affected IDs and before/after values. Refresh and check relevant observed state at the engine mutation boundary. This cannot promise global atomicity against remote CRDT clients.
- Receipt state separates prepared, committed-local, synced, failed-before-commit, and uncertain. Retry uses status and never blindly replays uncertain writes. Cross-installation exactly-once delivery is not claimed.
- Device-local profiles/journals/jobs are tool state. Ledger/preferences stay engine-owned. Secrets remain environment/file references. Cache refresh is distinct from a budget mutation; previews cannot secretly write payees/rules/templates/allocations.
- Supported reversal is compensating domain work with postconditions and a new receipt. UI in-memory undo is not cross-process CLI undo. Backups/restore-as-new precede broader recovery.
- Agents may execute authorized routine changes without asking on each write. Tool preview/apply supports reviewable consequences without imposing redundant approvals.

## Sequence and task map

The listed order is topological. Dependencies are hard prerequisites; other tasks may proceed when their listed predecessors pass. Shared registry/API/type/manifest files require sequential integration even across independent branches.

| Task                                                                       | Outcome                                                           | Hard prerequisites                       | Stage                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- | ---------------------- |
| [0007-cli-contract](tasks/0007-cli-contract/plan.md)                       | CLI schemas, discovery, and compatibility                         | None                                     | Foundation             |
| [0008-cli-integration-harness](tasks/0008-cli-integration-harness/plan.md) | Disposable CLI and API integration harness                        | 0007                                     | Foundation             |
| [0009-cli-sessions](tasks/0009-cli-sessions/plan.md)                       | Explicit budget sessions, profiles, and offline mode              | 0007, 0008                               | Foundation             |
| [0010-cli-runtime](tasks/0010-cli-runtime/plan.md)                         | Headless runtime bootstrap and server management                  | 0009                                     | Foundation             |
| [0011-cli-budget-lifecycle](tasks/0011-cli-budget-lifecycle/plan.md)       | Headless budget creation, selection, and cloning                  | 0009                                     | Foundation             |
| [0012-cli-sync](tasks/0012-cli-sync/plan.md)                               | Synchronization freshness, pending writes, and watch              | 0009, 0011                               | Foundation             |
| [0013-cli-backups](tasks/0013-cli-backups/plan.md)                         | Budget backup, validation, restore, and isolated comparison       | 0011, 0012                               | Foundation             |
| [0014-cli-mutations](tasks/0014-cli-mutations/plan.md)                     | Preview, apply, receipts, and safe retry protocol                 | 0007, 0008, 0012, 0013                   | Foundation             |
| [0015-cli-accounts](tasks/0015-cli-accounts/plan.md)                       | Account management, groups, and balance inspection                | 0011, 0014                               | Domain tools           |
| [0016-cli-catalog-settings](tasks/0016-cli-catalog-settings/plan.md)       | Categories, payees, tags, notes, and preference tools             | 0014                                     | Domain tools           |
| [0017-cli-query](tasks/0017-cli-query/plan.md)                             | Read-only query metadata, search, paging, and aggregation         | 0009, 0012                               | Domain tools           |
| [0018-cli-transactions](tasks/0018-cli-transactions/plan.md)               | Transaction inspection, batch edits, splits, and duplicate merges | 0014, 0015, 0016, 0017                   | Domain tools           |
| [0019-cli-transfers](tasks/0019-cli-transfers/plan.md)                     | Transfer candidate discovery, matching, and repair                | 0018                                     | Domain tools           |
| [0020-cli-file-parsing](tasks/0020-cli-file-parsing/plan.md)               | File inspection, parsing, and shared import mappings              | 0015, 0016, 0017                         | Domain tools           |
| [0021-cli-imports](tasks/0021-cli-imports/plan.md)                         | Import preview, duplicate matching, commit, and history           | 0020, 0018, 0019, 0014                   | Domain tools           |
| [0022-cli-reconciliation](tasks/0022-cli-reconciliation/plan.md)           | Shared reconciliation authority and statement workflows           | 0021, 0019                               | Domain tools           |
| [0023-cli-rules](tasks/0023-cli-rules/plan.md)                             | Rule testing, previews, and controlled application                | 0018, 0021                               | Domain tools           |
| [0024-cli-schedules](tasks/0024-cli-schedules/plan.md)                     | Schedules, upcoming bills, and posting controls                   | 0018, 0019                               | Domain tools           |
| [0025-cli-budgeting](tasks/0025-cli-budgeting/plan.md)                     | Allocations, carryover, templates, and reservations               | 0016, 0018, 0024, 0014                   | Domain tools           |
| [0026-cli-cash-planning](tasks/0026-cli-cash-planning/plan.md)             | Cash-planning API, targets, goals, and scenarios                  | 0017, 0016, 0014                         | Domain tools           |
| [0027-cli-reports](tasks/0027-cli-reports/plan.md)                         | Explainable financial reports and exports                         | 0017, 0019, 0026, 0025                   | Domain tools           |
| [0028-cli-data-quality](tasks/0028-cli-data-quality/plan.md)               | Data quality and history-coverage checks                          | 0021, 0022, 0023, 0027                   | Domain tools           |
| [0029-cli-reversal](tasks/0029-cli-reversal/plan.md)                       | Receipt-based reversal and recovery workflows                     | 0018, 0019, 0021, 0022, 0025, 0026       | Domain tools           |
| [0030-cli-bank-sync](tasks/0030-cli-bank-sync/plan.md)                     | Configured bank-sync diagnostics and controlled refresh           | 0021, 0012, 0019                         | Domain tools           |
| [0031-cli-workflows](tasks/0031-cli-workflows/plan.md)                     | Complete setup, intake, checkup, close, and goal workflows        | 0010, 0015, 0016, 0024, 0025, 0028, 0029 | Workflows and delivery |
| [0032-cli-automation](tasks/0032-cli-automation/plan.md)                   | Saved jobs, file intake, and unattended execution                 | 0031, 0030                               | Workflows and delivery |
| [0033-cli-mcp](tasks/0033-cli-mcp/plan.md)                                 | Optional MCP adapter over the same operation registry             | 0007, 0031                               | Optional interface     |
| [0034-cli-distribution](tasks/0034-cli-distribution/plan.md)               | Packaging, cross-platform documentation, and upgrades             | 0031, 0010                               | Workflows and delivery |
| [0035-cli-acceptance](tasks/0035-cli-acceptance/plan.md)                   | Agent-only workflow acceptance and performance proof              | 0034, 0032, 0030                         | Workflows and delivery |
| [0036-cli-personal-setup](tasks/0036-cli-personal-setup/plan.md)           | Personal account setup and institution-export validation          | 0035                                     | Personal adoption      |

The machine-readable [dependency manifest](cli-roadmap.json) contains full folder references. The [validation record](cli-roadmap-validation.md) checks unique tasks, prerequisite links, acyclicity, required plan sections, and markdown links. Those checks validate task artifacts, not application behavior.

## Practical milestones

1. **Trustworthy foundations:** schema/discovery, real disposable process/server tests, explicit local/remote sessions, server and budget first-run setup, sync visibility, validated backups, and receipt-backed writes.
2. **Routine money work:** account/catalog/query tools, split/batch transaction editing, transfers, actual file parsing/mappings, import preview/apply, and shared reconciliation authority.
3. **Planning and explanation:** rule tests, occurrences/bills, allocations/templates/reservations, cash targets/goals/scenarios, traceable reports, quality/coverage checks, and supported reversals.
4. **Agent-only adoption:** resumable setup/intake/checkup/month-close/goal workflows, saved unattended jobs, packaged Windows/Linux tools, and remote/browser interoperability acceptance.
5. **Optional structured transport:** MCP consumes the same registry. It is not a dependency of CLI release or personal setup.
6. **Personal validation:** only after synthetic acceptance, use user-provided exports and statement facts in a clone, then prepare the agreed real-budget setup.

Runtime bootstrap and headless budget creation are separate vertical deliverables. Read-only query work can begin after sessions/sync without waiting for all domain mutation tools. Parsing can be proven before importing. Reconciliation moves client-owned business rules into core before layering CLI statement commands on top. Receipt-backed compensation follows the domain operations whose inverses it must validate.

## Scope limits and future prerequisites

- Actual institution exports are not supplied. Personal compatibility is verified in the adoption task, not assumed from format support.
- Fully automatic connection setup would require provider-specific consent/authentication capability work and personal authorization. Existing configured refresh does not supply that prerequisite.
- Household ownership would require an account ownership model, migration, and report inclusion semantics before segmented tool/report additions.
- Holdings/performance tools would require asset/quantity/price/corporate-action and valuation owners before portfolio CLI commands. Cash-to-equity transfers alone are not investment tracking.
- PDF/OCR statement intake would require extraction/provenance, uncertainty review, and parser parity before it could participate in reconciliation. Supported structured files are the first delivery.
- Bank payments require a separate payment authority/product, authorization model, and provider integration. Recording schedules/transfers never initiates movement of bank funds.
- Cloud hosting and package publication remain separate deployment actions; roadmap implementation ends with local packed-artifact verification.

These deferred extensions are not required to deliver the useful CLI described above. If the user expands scope, create their prerequisite tasks first.

## Review, evidence, and maintenance

Each plan is ready for review-plan with its prerequisite hold explicit. Review the first schema task now; subsequent task reviews adopt completed predecessor contracts. During implementation, each task records actual evidence and status in progress/implementation artifacts. Completion requires its acceptance checks, not merely command registration.

Run focused CLI/API/core/server tests, root type checking, targeted formatting/lint, affected builds, and browser interoperability where business logic moves or writes sync. Final acceptance uses clean packaged installs, Windows/Linux processes, real disposable sync server, two caches, desktop/mobile browser, encrypted sessions, restarts, and fault injection. Optional MCP has separate parity evidence.

Known baseline: prior cash-planning verification recorded repository-wide formatting failures and no personal export validation. Do not fix unrelated formatting as part of these tasks. Separate observed baseline failures from new defects and rerun relevant checks at delivery time.

2026-10-04 checkpoint: guarded account closure passes full local Windows acceptance. Task 0014 remains partial with 23 existing write adapters outstanding; later tasks retain their prerequisites.

2026-10-04 checkpoint: guarded category updates pass final 15-case local Windows acceptance. Task 0014 remains partial with 22 existing write adapters outstanding.

2026-10-04 checkpoint: guarded category creation passes final nine-case local Windows acceptance. Task 0014 remains partial with 21 existing write adapters outstanding.

2026-10-04 checkpoint: guarded category deletion passes final eleven-case local Windows acceptance. Task 0014 remains partial with 20 existing write adapters outstanding.

2026-10-04 checkpoint: guarded category-group creation passes final nine-case local Windows acceptance. Task 0014 remains partial with 19 existing write adapters outstanding.

2026-10-04 checkpoint: guarded category-group updates pass final nine-case local Windows acceptance. Task 0014 remains partial with 18 existing write adapters outstanding.

2026-10-04 checkpoint: guarded category-group deletion passes final nine-case local Windows acceptance. Task 0014 remains partial with 17 existing write adapters outstanding.

2026-10-04 checkpoint: guarded payee creation passes five-case local Linux acceptance. Task 0014 remains partial with 16 existing write adapters outstanding.
2026-10-04 checkpoint: guarded payee update/delete/merge and tag create/update/delete pass local Linux packaged acceptance. Task 0014 remains partial with 10 existing write adapters outstanding.
2026-10-04 checkpoint: guarded rule create/update/delete pass local Linux packaged acceptance. Task 0014 remains partial with 7 existing write adapters outstanding.
2026-10-04 checkpoint: guarded schedule create/update/delete pass local Linux packaged acceptance. Task 0014 remains partial with 4 existing write adapters outstanding (transactions add/import/full update/delete).
2026-10-04 checkpoint: guarded transaction deletion and category/payee updates pass local Linux acceptance. transactions.add and transactions.import remain.
2026-10-04 checkpoint: 0017-cli-query started (its prerequisites 0009 and 0012 are complete; it does not wait on 0014). Slice 1, core schema metadata and pre-execution query validation, is implemented.

2026-10-04 23:53 PT checkpoint: 0017-cli-query is completed locally on Linux (A1-A3 verified with unit and packaged evidence; Windows rerun pending). Dependents 0018, 0020, 0026 and 0027 no longer wait on 0017 but remain held on 0014 and their other prerequisites.

2026-10-05 00:11 PT checkpoint: 0014-cli-mutations is completed locally on Linux. Every existing write adapter is guarded, the full changes.test.mjs regression passes 86/86 and all guarded-* packaged cases pass; the Windows rerun of the Linux-only adapters remains open. ASSUMPTION for Michael to review: dependents may start on this Linux acceptance. 0016-cli-catalog-settings started (notes, typed synced preferences and catalog inspection).

2026-10-05 00:25 PT checkpoint: 0015-cli-accounts is partially implemented on Linux. `accounts inspect` separates on-budget, off-budget and future balances; guarded account groups (create, rename, delete, assign) survive sync; duplicate names resolve as ambiguous. Opening-balance edits reuse guarded transactions.update (D8); 0015 is completed locally on Linux with the Windows rerun open. 0016 packaged notes, preferences and catalog inspection proofs pass 10/10 on Linux.

2026-10-05 00:41 PT checkpoint: 0018-cli-transactions started (ASSUMPTION for Michael to review: 0016's open browser check does not block it). Guarded `transactions categorize` over frozen IDs passes 6/6 packaged cases on Linux, including three process kills. Open in 0018: `transactions get`, guarded split edits and duplicate merge.

2026-10-05 01:14 PT checkpoint: 0016-cli-catalog-settings is completed locally on Linux (browser check for A1 passes in `browser-catalog.test.mjs`). 0018-cli-transactions is completed locally on Linux: guarded categorize, merge, split and clear/unlock plus `transactions get` (0018 D10-D11). 0026-cli-cash-planning is completed locally on Linux: `cash-planning inspect` with transient scenarios and guarded save/reset/target/goal edits, proven in packaged and browser tests. Windows reruns remain open for 0014-0018 and 0026. 0019-cli-transfers and 0020-cli-file-parsing now have every prerequisite completed locally; 0019 starts next.

2026-10-05 01:24 PT checkpoint: 0019-cli-transfers is completed locally on Linux (transfer candidates, inspect, check, guarded match/unmatch/repair; packaged 6/6, API 2/2; decisions D1-D7). 0024-cli-schedules now has all prerequisites completed locally; 0020-cli-file-parsing is ready.

2026-10-05 01:31 PT checkpoint: 0020-cli-file-parsing is completed locally on Linux: the import dialog's mapping rules are shared core code, `imports inspect|parse` normalize files without writes, and `imports mappings get|set|reset` share the dialog's synced preferences (browser round-trip proven). Revised dependency contract (0020 D5): 0021's import preview must freeze the file SHA-256 so a changed file invalidates a prepared import. 0021-cli-imports now has every prerequisite completed locally.

2026-10-05 01:48 PT checkpoint: 0021-cli-imports is completed locally on Linux: guarded `imports.file` (read-only `imports preview` with per-row outcomes and exact versus heuristic match evidence, `imports apply` bound to the file hash, settings and options, `imports history` from the device-local journal) and `imports batch` (per-file receipts, stop at first failure, overlap detection, transfer candidate review). 0022-cli-reconciliation and 0023-cli-rules now have every prerequisite completed locally.

2026-10-05 02:02 PT checkpoint: 0023-cli-rules is completed locally on Linux: `rules test` (import-path evaluation with rule trace, no writes), `rules matches`, and guarded `rules.apply` (the rule editor's apply actions over frozen IDs, with split, delete and new-payee preview). Engine gap recorded for Michael (0023 D3): rules that set a new payee name create it during import previews.

2026-10-05 02:20 PT checkpoint: 0024-cli-schedules is completed locally on Linux: `schedules inspect|upcoming` (engine recurrence occurrences with status, links and posted rows, no writes) and guarded `schedules.post|skip` for the next occurrence with duplicate protection (packaged 12/12, API 1/1; decisions D1-D9). 0025-cli-budgeting now has every prerequisite completed locally.

2026-10-05 02:47 PT checkpoint: 0025-cli-budgeting is completed locally on Linux: guarded `budgets.move` (total preserved, explicit insufficient funds) and `budgets.apply-templates` (preview equals apply, skipped invalid templates listed), read-only `budgets templates` and flag-gated `budgets reservations` (packaged 8/8, API 1/1; D1-D8). 0022-cli-reconciliation is completed locally on Linux: `reconcile status` with statement cutoff, guarded zero-difference `reconcile.finish` over the frozen set and explicit `reconcile.adjust` (packaged 7/7, API 1/1; D1-D7). 0027-cli-reports and 0029-cli-reversal now have every prerequisite completed locally; 0028 waits on 0027.

2026-10-05 03:02 PT checkpoint: 0027-cli-reports is completed locally on Linux: read-only `reports cash-flow|categories|net-worth` from a core report owner with declared scope, completeness and contributing IDs, plus CSV/HTML export with formula-safe escaping (packaged 3/3, API 1/1; D1-D10). 0028-cli-data-quality now has every prerequisite completed locally.
