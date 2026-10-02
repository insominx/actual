# Category Reservations

<ExperimentalFeatureWarning />

Category reservations explain how much of a category's balance is already set aside for the bills and savings targets described by its templates. They add a breakdown next to the balance; they do not change any balance, budgeted amount, report or transfer.

:::note
Enable this feature by turning on **Category reservations** in **Settings → Show advanced settings → Experimental features**.

Reservations read the templates described in [Goal Templates](./goal-templates.md), whether they are written in category notes or set up with [Budget Automations](./budget-automation.md). You do not need to apply the templates for reservations to work, and viewing reservations never changes your budget.
:::

## Where to Find Reservations

Reservations are shown for expense categories in envelope budgets, for the current month only.

- **On desktop**, click a category's balance in the current month. The breakdown appears at the top of the balance menu, above **Transfer to another category**.
- **On mobile**, tap a category's balance. The breakdown appears in the balance window, above the menu options.

A category without any supported templates shows the usual balance menu with no breakdown. Other months, tracking budgets and income categories also show the usual menu.

## Reading the Breakdown

In January, a category named "Bills" with a $500.00 balance and these notes:

```
#template 50
#template 1200 by 2026-12 repeat every year
```

shows a breakdown like this:

| Line                  | Amount               |
| --------------------- | -------------------- |
| Total balance         | $500.00              |
| Reserved              | $100.00              |
| Bills, due 12/01/2026 | $100.00 of $1,200.00 |
| Allowance remaining   | $50.00               |
| Spare                 | $350.00              |

- **Total balance** is the category's balance, the same amount shown in the Balance column.
- **Reserved** is the money the category should hold by now for its upcoming bills and savings targets. Each bill or target is listed below it with its due date and how much of its full amount has built up so far.
- **Allowance remaining** is the part of the rest kept for the monthly amount of simple templates, such as `#template 50`. It never exceeds that monthly amount.
- **Spare** is what is left after Reserved and Allowance remaining.

Total balance always equals Reserved plus Allowance remaining plus Spare.

### How Reserved Builds Up

Each bill or target builds up evenly until it is due. The amount set aside so far is the full amount minus one monthly share for every month still to go, and it is never less than zero or more than the full amount.

For example, a yearly $1,200.00 insurance bill due in 6 months has a monthly share of 1200 / 12 = 100, so the amount set aside so far is 1200 - 100 × 6 = 600, and Reserved shows $600.00.

- **Schedules** use the schedule's next date as the due date. When you pay the bill with a transaction linked to the schedule, or skip the next date, the schedule moves to its next occurrence and the amount starts building up again.
- In the month a schedule is due, the full amount is reserved. If a due date has passed and the bill has not been paid or skipped yet, one full amount stays reserved; missed older occurrences are not added together.
- **By templates** use the target month as the due date. Once that month has passed, the next repeat becomes the due date. Spending from the category does not reset a By template.

### Negative Spare

Reserved is not limited to the category's balance. If the balance is smaller than Reserved, Allowance remaining is $0.00 and Spare is negative, for example -$200.00. A negative Spare means the category holds less than it should by now for the bills and targets its templates describe.

:::caution
Reservations only cover the templates listed in [Supported Templates](#supported-templates). They cannot know about bills that have no template, or about costs that are not recorded in Actual. A positive Spare is not a guarantee that the money is free to spend.
:::

## Supported Templates

| Template                                                            | Example                                       | Shown As            |
| ------------------------------------------------------------------- | --------------------------------------------- | ------------------- |
| Simple monthly amount without a limit                               | `#template 50`                                | Allowance remaining |
| Schedule without `full` or adjustments, repeating monthly or yearly | `#template schedule Insurance`                | Reserved            |
| By template with a repeat and without a starting amount (`from`)    | `#template 1200 by 2026-12 repeat every year` | Reserved            |

If a category uses the same schedule more than once with the same options, it is counted once.

## When Reservations Are Unavailable

If any template in a category cannot be read reliably, the breakdown shows only the total balance and a message instead of partial figures. Other categories are not affected.

| Message                                                        | What It Means                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A template in this category could not be read.                 | A template line has a syntax error, or a saved automation is damaged.                                                                                                                                                                                                                                                                                               |
| A schedule used by this category no longer exists.             | The schedule was deleted, or it was renamed while a note still refers to the old name. Update the note to use the new name.                                                                                                                                                                                                                                         |
| A template matches more than one schedule with that name.      | Two schedules have the same name. Rename one of them.                                                                                                                                                                                                                                                                                                               |
| A schedule used by this category is not active this month.     | The schedule is completed or no longer occurs.                                                                                                                                                                                                                                                                                                                      |
| The same schedule is used by templates with different options. | For example, one template uses the schedule plainly and another uses it with `full`.                                                                                                                                                                                                                                                                                |
| This category uses templates that reservations do not support. | The category uses a template type not listed in [Supported Templates](#supported-templates), such as remainder, average, percentage, spend or goal templates; a simple template with a limit; a schedule with `full` or adjustments; a weekly, daily or one-time schedule; or a By template with `from` or without a repeat count (including `repeat every month`). |

While the breakdown is being calculated, it shows **Calculating reservations…**. If the calculation fails, it shows **Reservations are unavailable right now.** Neither message shows any reservation figures.
