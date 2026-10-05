# Workflow queue

The CLI roadmap has 30 tasks. Tasks 0007-0013 are implemented and verified locally on Windows, including browser/CLI convergence and bounded watch. Backups include creation, listing, isolated validation, restore-as-new, comparison, and retention. Task 0014 has verified guarded transaction, recovery, and allocation checkpoints; tasks 0015-0036 remain planned. Linux and personal adoption remain final acceptance work.

| Task                                                                              | Status           | Outcome                                                                                                      |
| --------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| [Fork research](tasks/0001-actual-fork-recon/progress.md)                         | Complete         | Research and adoption assessment recorded                                                                    |
| [Category reservations](tasks/0002-budget-reservations/progress.md)               | Complete         | Committed in `0eafe3c5e`; read-only current-month breakdown; payment/undo updates verified across local tabs |
| [Expense-only budget view](tasks/0003-expense-only-budget-view/progress.md)       | Complete         | Committed in `5f33b8073`; local edits, undo and leader handover verified                                     |
| [Transaction column resizing](tasks/0004-transaction-column-resizing/progress.md) | Complete         | Committed in `5475cef91`; device-local widths; pointer, keyboard, reset and mobile checks passed             |
| [Pay-period compatibility study](tasks/0005-pay-period-compatibility/progress.md) | Complete         | User selected no port on 2026-10-02; no follow-up feature queued                                             |
| [Cash planning](tasks/0006-cash-planning/progress.md)                             | Complete locally | Committed in `68ffdbe3b`; locally verified; personal exports and remote-server sync remain unverified        |

The [fork adoption assessment](tasks/0001-actual-fork-recon/assessment.md) explains the ranking, sources and deferred candidates. [Original research](tasks/0001-actual-fork-recon/research.md) retains the broad fork scan. Deferred research candidates are not implementation tasks.

Verification limits: repository-wide formatting still fails on baseline files. Remote-server synchronization was not tested. In the combined 22-test browser run, one reservation menu startup check passed only on retry; the subsequent 12 reservation checks passed without retries. These limits do not represent unfinished implementation in this queue. Reservations remain experimental.

## Agent CLI queue

See the [sequenced roadmap](cli-roadmap.md), [dependency manifest](cli-roadmap.json), and [artifact validation](cli-roadmap-validation.md). Each task has plan/progress files with scope, owner paths, acceptance checks, verification, and prerequisites.

Delivered locally: [CLI contract](tasks/0007-cli-contract/implementation.md), [disposable harness](tasks/0008-cli-integration-harness/implementation.md), and [profiles/offline sessions](tasks/0009-cli-sessions/implementation.md). Runtime management is delivered: [0010 evidence](tasks/0010-cli-runtime/implementation.md). Task 0011 now includes verified publication, rename, and archive. Task 0012 has complete Windows acceptance. Task 0013 has complete Windows acceptance. Task 0014 has verified guarded transaction, recovery, and allocation checkpoints. Other tasks retain their prerequisites. Linux and broader browser interoperability remain for final acceptance. Optional MCP does not block CLI delivery; personal setup remains the final task.

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
