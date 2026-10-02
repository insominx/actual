Last Edited: 2026-09-27

# Fork adoption assessment for insominx/actual

## Recommendation

Port three bounded improvements: category reservations, an expense-only budget view, and desktop transaction column resizing. Investigate pay-period compatibility separately before deciding whether to port it. Prefer selective adaptation over merging fork branches.

Personalization is **inferred**: this is a locally developed Actual fork, used in a browser with multiple budget tabs, and the user has reported a React update loop. There is no evidence of a particular payday cadence, country, bank, debt portfolio, or willingness to send transaction data to AI providers. The priority therefore favors everyday budget clarity, spending review, and transaction usability. No personal budget data was inspected. An optional priority question was offered; the default ranking below applies until answered.

## Ranked task queue

| Order | Task                                                                             | Benefit                                                                             | Effort / risk                                               | Readiness                                                            |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 1     | [0002: category reservations](../0002-budget-reservations/plan.md)               | See future obligations and unclaimed category money before spending or reallocating | Medium / financial calculation and subscription correctness | Complete; read-only current-month breakdown committed in `0eafe3c5e` |
| 2     | [0003: expense-only budget view](../0003-expense-only-budget-view/plan.md)       | Scan daily or monthly spending without allocation columns                           | Medium / aggregation and responsive UI                      | Complete; expense views committed in `5f33b8073`                     |
| 3     | [0004: transaction column resizing](../0004-transaction-column-resizing/plan.md) | Read long payees, notes, and categories comfortably while reconciling               | Small–medium / virtual table interactions                   | Complete; device-local resizing committed in `5475cef91`             |
| 4     | [0005: pay-period compatibility study](../0005-pay-period-compatibility/plan.md) | Establish whether paycheck budgeting can preserve existing allocations and reports  | Bounded study; eventual port is large / high risk           | Complete; compatibility study closed with no port on 2026-10-02      |

Tasks 0002–0004 have no dependency on one another. Within each task, close the first behavior checkpoint before continuing. 0005 is optional after these; it must produce a reviewed compatibility design before a production implementation task exists. These are planning deliverables, not claims that features have shipped.

## Evidence and corrections to the research

Local baseline inspected: `c6c9449c1` (includes the schedule subscription-loop fix) plus the working tree. Original fork counts and ahead/behind distances in [research.md](research.md) remain historical snapshot data, not refreshed compatibility claims.

Public branch heads and repository license metadata were rechecked on 2026-09-27. All four report MIT at the repository level; inspect copied file headers and any new assets/dependencies before reuse. Web fetches failed, then direct HTTPS reads succeeded. The selected docs and calculation/test files were read; no full branch diff or mergeability validation was performed in this assessment.

| Source                                    | Pinned reference                           | Evidence used                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hubermjonathan/actual, master             | `5e939d427cb8ca347b3e526b4a230537e5e84668` | [Reservation calculation](https://github.com/hubermjonathan/actual/blob/5e939d427cb8ca347b3e526b4a230537e5e84668/packages/loot-core/src/server/budget/reservations.ts), adjacent tests, budget handler, and [guide](https://github.com/hubermjonathan/actual/blob/5e939d427cb8ca347b3e526b4a230537e5e84668/packages/docs/docs/experimental/reservations.md)       |
| ejina21/actualFinance, master             | `85407067736c8bf2441ab8db4e863182522a15bf` | [Expense aggregation](https://github.com/ejina21/actualFinance/blob/85407067736c8bf2441ab8db4e863182522a15bf/packages/desktop-client/src/components/budget/expense-view/expenseData.ts) and [specification](https://github.com/ejina21/actualFinance/blob/85407067736c8bf2441ab8db4e863182522a15bf/docs/superpowers/specs/2026-09-25-expense-only-budget-view.md) |
| shawalli/actual, fork/master              | `2dee0baf8b0ed859c236ce1b80daff232fc67d5e` | [Feature README](https://github.com/shawalli/actual/blob/2dee0baf8b0ed859c236ce1b80daff232fc67d5e/README.md); implementation must be adapted to today's table                                                                                                                                                                                                     |
| code-with-jov/actual-pay-periods, develop | `62128aa6e24a957e1e85db2ebc7cd43fccfb995b` | [Pay-period guide and limitations](https://github.com/code-with-jov/actual-pay-periods/blob/62128aa6e24a957e1e85db2ebc7cd43fccfb995b/packages/docs/docs/experimental/pay-periods.md)                                                                                                                                                                              |

### Reservations: useful idea, materially narrower first port

The fork's guide still describes distributing limited funds by due date. Its pinned implementation and tests instead preserve every claim's full accrual and expose insufficient funds as negative spare. The code also exposes `allowanceTotal`; the guide's example mentions `committed`, which is not a member of the pure calculation result inspected. Use the pinned code/tests as evidence and explicitly define our result, not the guide's abbreviated API example.

The fork changes the displayed Balance and limits some category transfers. The first port here keeps the canonical balance and all transfer behavior intact, adding a labeled breakdown. This is an intentional scope decision: the useful insight can ship without changing how users move money. Support current-month envelope budgets first; historical reconstruction, tracking semantics, public API/CLI and transfer guards are deferred.

### Expense view: adapt accounting semantics, not locale assumptions

The source excludes groups by Russian names and drops every transfer. Those are not safe generic rules for this fork. Use category IDs/income metadata and current budget accounting: exclude transfers between on-budget accounts, but include categorized movements from on-budget to off-budget accounts as budget spending. Preserve refund signs and count split children once. Closed accounts and hidden categories retain their historical spending. Keep the view preference separate from `budgetType`.

### Column resizing: add only the missing behavior

The current tree already supports column visibility/order in `components/transactions/table/columns.ts` and `hooks/useTransactionTableColumns.ts`. `TransactionsTable.tsx` also automatically sizes amount columns. Adapt the resizing idea around these owners; start with text columns only and keep widths device-local. Do not replace the current column manager or port the old fork's table wholesale.

### Pay periods: demote from immediate port to compatibility study

The fork guide documents separate calendar/period allocations, cadence changes that reinterpret amounts under reused period numbers, unavailable budget-based reports, a fixed template becoming per-paycheck, and API identifiers with month components above 12. These are material adoption costs, even though transaction dates remain unchanged. The research's “complete package” ranking describes breadth, not readiness for this user's live budget. Task 0005 compares a safe full port with a read-only paycheck planning view and the existing forecast; it does not silently replace the requested concept with a different feature.

## What not to port now

| Candidate                                   | Decision and reason                                                                                                                                 | Reconsider when                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Schedule forecast / Budget-vs-Actual report | Existing `server/forecast/`, BalanceForecast and BudgetAnalysis already cover these broad needs; no verified missing behavior justifies a duplicate | A concrete gap remains after exercising existing reports                 |
| Transaction flags                           | Defer new synced transaction fields; current tags, filters and bulk editing may cover review/reimbursement queues                                   | A workflow cannot be represented cleanly with existing tags              |
| Russian / Chinese / Swiss bank import       | Defer provider-specific maintenance; user geography and file formats unknown                                                                        | User identifies a provider and supplies a representative redacted format |
| AI categorization / MCP                     | Defer core integration and external financial-data transmission; no user request for either                                                         | Explicit automation need, with external adapters compared first          |
| Debt / gold / investment model              | Defer broad migrations and niche accounting; ordinary off-budget accounts are already available                                                     | Specific debt payoff or asset valuation requirements emerge              |
| Wallos                                      | Prefer the existing external importer discussed in research                                                                                         | Confirmed subscription workflow requiring tighter integration            |
| Gift-card splits, themes, family branding   | No demonstrated need; gift-card accounting is nontrivial and branding does not improve the selected workflows                                       | User asks for a particular behavior                                      |

## Shared adoption gates

1. Recheck the pinned feature against the target branch; record exact adapted files/commits and license attribution. Drop any already-landed equivalent behavior.
2. Preserve integer currency units, canonical transaction dates, envelope/tracking engine identity, local-first operation, and existing sync ownership.
3. Test synthetic data only. No automatic template application, production budget migration, or external service is part of these plans.
4. Exercise existing schedule-loop tests and a two-tab update scenario for subscription changes. `contentscript.js` extension warnings are not proven to originate in Actual; do not increase listener limits to mask a loop.
5. Run focused tests without snapshot-update flags. Run `yarn typecheck` from the root before commits. Use UI behavior tests for the new feature, not broad automatic visual snapshot rewrites.

## Assessment validation

- Checked current budget, schedule-template, query, preference, table and report owners and product/design guidance.
- Verified four public source heads/licenses and reread selected primary documentation/source.
- `yarn typecheck` passed with Lage cache hits; this is not a fresh full monorepo compile.
- Existing `useSchedules.test.ts` and pending `useDragDrop.test.tsx`: 8 tests passed.
- Port implementation tests in the new tasks are planned, not executed.
