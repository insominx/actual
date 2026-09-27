# Workflow queue

The [fork adoption assessment](tasks/0001-actual-fork-recon/assessment.md) explains the ranking, source commits, scope decisions, and deferred candidates. [Original research](tasks/0001-actual-fork-recon/research.md) retains the broad fork scan.

| Priority | Task                                                                          | Phase         | Next action                                                          |
| -------- | ----------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| 1        | [Category reservations](tasks/0002-budget-reservations/plan.md)               | Planned       | Review calculation contract, then implement its first vertical slice |
| 2        | [Expense-only budget view](tasks/0003-expense-only-budget-view/plan.md)       | Planned       | Review spending inclusion rules, then implement month view           |
| 3        | [Transaction column resizing](tasks/0004-transaction-column-resizing/plan.md) | Planned       | Review table interaction contract, then implement local text widths  |
| 4        | [Pay-period compatibility](tasks/0005-pay-period-compatibility/plan.md)       | Study planned | Produce compatibility evidence before planning a production port     |

Each folder's `progress.md` is the execution checklist. No feature implementation is complete. Tasks 0002–0004 are independent; 0005 gates any future pay-period port.
