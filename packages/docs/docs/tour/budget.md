# The Budget

This view lets you manage your budget. You'll find more information about envelope budgeting with Actual in [Budgeting](../budgeting/index.md).

![The Budget page showing October and November side by side](/img/a-tour-of-actual/tour-budget-overview@2x.webp)

The maximum number of months you can see at any one time is defined by the width of your screen.

You can choose how many months to display by clicking on the corresponding number of calendar icons in the top left corner.

<img width="92" alt="Four calendar icons, two of them highlighted to show two months" src="/img/a-tour-of-actual/tour-budget-month-count@2x.webp" />

Based on this, you can then choose which months to show:

<img width="574" alt="The month picker with October and November selected" src="/img/a-tour-of-actual/tour-budget-month-picker@2x.webp" />

## Expenses View

Choose **Expenses** above the budget table to view spending without changing your budget. On mobile, open the **Budget page menu** and choose **Show expenses**. Choose **Budget**, or **Show budget** on mobile, to return to your allocations and the month you were budgeting.

Use **Month** to see one column for each day, or **Year** to see the twelve months of the selected year. The arrows and **Today** button move through expense periods only; they do not change the month shown in Budget. Expand a category group to see its categories. On narrow screens, scroll the grid horizontally; category names stay visible.

The amounts show **net spending** from on-budget accounts:

- Expense payments increase spending. Refunds reduce spending, so a refund-only period can have a negative total.
- Transfers between on-budget accounts are excluded. An expense-categorized transfer to an off-budget account counts as spending; an expense-categorized transfer back reduces spending. Only the on-budget side counts.
- Income categories and transactions originating in off-budget accounts are excluded.
- Uncategorized outflows appear in their own row. Uncategorized inflows do not count. Payments whose category was deleted appear as uncategorized outflows.
- Hidden expense categories and groups, and history from closed on-budget accounts, remain included.

The Expenses view updates when transactions change, including after undo. It is read-only: selecting it does not change your budgeting method, allocations, categories, or transactions. Your display and month/year choices are saved separately for each budget on this device, not synced to other devices.

## The Month header

At the top of each month, you have a couple of choices in the user interface.

<img width="650" alt="The October and November headers with the note, minimize and menu buttons labeled" src="/img/a-tour-of-actual/tour-budget-header-expanded@2x.webp" />

- **A. Notes.** Clicking on the note icon lets you add a note. Actual fully supports Markdown and the note will be rendered according to your Markdown when the cursor is hovering over the note.
- **B. Minimize.** You can minimize the header by clicking on the chevrons, which appear when you hover over the month.
- **C. Menu.** Clicking on the three vertical dots lets you execute the following functions on that month's budget categories:
  - Copy last month's budget.
  - Set budgets to zero.
  - Set budgets to 3 month average.
  - Set budgets to 6 month average.
  - Set budgets to 12 month average.

When the top is minimized, you can still access the same functionality as when the top section is expanded.

<img width="650" alt="The minimized October and November headers, showing only the amount to budget" src="/img/a-tour-of-actual/tour-budget-header-minimized@2x.webp" />

Here's the rendered Markdown when you hover over the note.

<img width="413" alt="A month note with a heading, bold text and a bulleted list rendered from Markdown" src="/img/a-tour-of-actual/tour-budget-header-note@2x.webp" />

## The Budget Table

### Left side - category section

The budget detail section lists all your categories and their grouping. The image below shows two expense category groups, _Usual Expenses_ and _Bills_, along with the income categories.

<img width="856" alt="The budget table with the category menu, the Bills group and the Internet category labeled" src="/img/a-tour-of-actual/tour-budget-table@2x.webp" />

- **A. Category menu.** Clicking on the three vertical dots allows you to toggle hidden categories, expand all or collapse all category groups.
- **B. Category group.** When you hover over a category group, you can add a new category to the group by clicking the + icon or add a note by clicking the note icon. All notes on the Budget page support full Markdown. The dropdown will allow you to toggle between hide or show the _category group_, rename or delete the group.
- **C. Category.** Categories have the same functionality as groups: hide, rename and delete. You can also add a note here, with information specific to the category.

### The middle - the budget section

This is the juicy part of the user interface; this is where you work with your budgeted numbers.

We have three columns under a month heading: _Budgeted_, _Spent_, and _Balance_.

- _Budgeted_ is how much money we allocated to this category that month.
- The _Spent_ column displays how much we spent in a month.
- The _Balance_ is the difference between the _Budgeted_ and the _Spent_ columns + what was left over from the previous month (as a rule of thumb).

You work with the _Budgeted_ column to manipulate your budget: You can enter a number or use a dropdown which will populate the entry based on a
_copy of last month's budget_, or the previous 3-month, 6-month or yearly average. Notes can be added to each budget entry, also.
