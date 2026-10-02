---
title: Cash planning
---

Open **Reports → Cash planning** to inspect your net cash position and plan a desired total balance.
The report keeps planning targets separate from budget allocations, templates, and scheduled transactions.
Reading the report does not change your ledger. **Save plan** saves only the report settings for this budget.
These settings sync with the budget.

## Set up accounts

Create on-budget accounts for checking, savings, Robinhood cash, and credit cards.
Use negative opening balances for credit card debt. The report includes that debt once in the total.
Keep mortgage principal and equity holdings in off-budget tracking accounts.
Record Robinhood cash separately from holdings. Use the reported cash balance, rather than buying power.
Closed on-budget accounts remain included, so inspect and reconcile any remaining balance.

## Import and reconcile history

Use Actual's existing transaction imports, including CSV and OFX/QFX.
For CSV, select the date, amount, and payee mappings and check the preview before importing.
Actual retains the existing mapping and duplicate-matching behavior.
Validate representative exports from each institution during setup. Supported formats do not establish compatibility with every Chase, Capital One, or Robinhood export.

Choose an opening-balance date before your imported history.
Check the opening balance against the statement and avoid counting imported activity twice.
Categorize income and spending. Match transfers between accounts, including credit card payments.
An unmatched card payment can appear as spending until you match the transfer.
Reconcile each account against its statement after importing. The report includes uncleared transactions.

## Read the averages

The report defaults to the last three complete calendar months.
Select one, three, six, or twelve complete months, or enter custom dates.
The report divides activity by calendar-month fractions: selected days divided by days in each month, summed across the range.
Two complete months equal exactly two months. Zero-activity days remain in the denominator.

Opening balances affect net cash but do not affect historical income or outflows.
Split transaction leaves count once. Refunds in spending categories reduce outflows.
Positive uncategorized activity counts as income; negative uncategorized activity counts as outflow.
Hidden, deleted, and missing spending categories remain in totals. Their targets are read-only.
Merged categories use their replacement category.
Transfers within included accounts do not affect income or spending.
Transfers across the on-budget boundary appear once as signed external cash movements.
For example, transferring cash into equity reduces accessible cash. Mortgage payments still affect cash flow.

Averages depend on imported history. The report cannot establish that missing transactions mean zero spending.
When the selected period has no historical cash activity, it shows an empty-history message and suppresses projections.

## Set targets and a goal

Enter a nonnegative monthly target beside each available category, including uncategorized spending.
An empty target uses the unrounded historical average. Clearing a target restores that behavior.
Changes update the **Category targets** projection immediately. The **Historical rate** projection continues to use historical outflows.
Both projections use historical income and external cash movements.
Neither projection includes scheduled transactions, investment returns, or changes to budget allocations.

Enter an optional desired total net cash balance and deadline.
Each projection shows the remaining amount and estimated completion date.
With a deadline, it also shows required monthly surplus, maximum category outflows, and signed gaps.
A negative gap means the projection falls short. A negative maximum outflow means even zero category spending would not meet the required surplus.
An already reached goal shows **Already reached**. A goal that needs an increase with zero or negative surplus shows **Not reached at this rate**.

The chart defaults to twelve forecast months. Its end date is independent of the goal deadline.
Forecasts begin tomorrow, using the balance through today and the same calendar-month fractions as history.
The report rounds displayed money to the budget currency, while calculations retain unrounded rates.
**Net cash depletion** estimates when the combined balance reaches zero. It does not predict individual account overdrafts.

Select **Save plan** to keep your settings. Reopening the report restores saved settings.
Unsaved changes stay local to the open report. If another session saves settings, discard your changes to load them or save your draft.
Privacy mode masks amounts and completion/depletion dates and hides the chart and amount editors, on desktop and mobile.

Automatic connections, equity tracking, other household members' accounts, spending suggestions, and transaction exclusions are outside this first version.
