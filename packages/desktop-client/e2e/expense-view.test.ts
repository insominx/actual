import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';

type TestWindow = {
  $send: <Result>(name: string, args?: unknown) => Promise<Result>;
};

test('updates net spending after ledger edits and undo without remounting', async ({
  browser,
}) => {
  const page = await browser.newPage();
  try {
    await page.goto('/');
    await new ConfigurationPage(page).createTestFile();
    await page.getByRole('button', { name: 'Expenses', exact: true }).click();
    const total = page
      .getByRole('region', { name: 'Expense grid' })
      .getByRole('row')
      .filter({
        has: page.getByRole('rowheader', { name: 'Total net spending' }),
      })
      .getByRole('cell')
      .last();
    await expect(total).toBeVisible();
    const before = Number((await total.textContent())?.replaceAll(',', ''));
    const id = await page.evaluate(async () => {
      const send = (window as unknown as TestWindow).$send;
      const accounts =
        await send<Array<{ id: string; offbudget: number; closed: number }>>(
          'accounts-get',
        );
      const categories = await send<{
        list: Array<{ id: string; is_income: boolean }>;
      }>('get-categories');
      const account = accounts.find(row => !row.offbudget && !row.closed);
      const category = categories.list.find(row => !row.is_income);
      if (!account || !category) {
        throw new Error('Missing expense fixture');
      }
      const id = crypto.randomUUID();
      await send('transactions-batch-update', {
        added: [
          {
            id,
            account: account.id,
            category: category.id,
            date: '2017-01-15',
            amount: -10000,
          },
        ],
      });
      return id;
    });
    await expect(total).toHaveText((before + 100).toFixed(2));
    await page.evaluate(async id => {
      await (window as unknown as TestWindow).$send(
        'transactions-batch-update',
        { updated: [{ id, amount: -11000 }] },
      );
    }, id);
    await expect(total).toHaveText((before + 110).toFixed(2));
    await page.evaluate(async () => {
      await (window as unknown as TestWindow).$send('undo');
    });
    await expect(total).toHaveText((before + 100).toFixed(2));
  } finally {
    await page.close();
  }
});

test('expense navigation leaves the budget month, engine and allocations unchanged', async ({
  browser,
}) => {
  const page: Page = await browser.newPage();
  try {
    await page.goto('/');
    await new ConfigurationPage(page).createTestFile();
    const budget = await new Navigation(page).goToBudgetPage();
    const month = await budget.selectedMonthButton.textContent();
    const budgeted = await budget.budgetTable
      .getByTestId('budget')
      .first()
      .textContent();
    const read = () =>
      page.evaluate(async () => ({
        keys: Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            key.endsWith('-budget.startMonth'),
          ),
        ),
        prefs: await (window as unknown as TestWindow).$send('preferences/get'),
      }));
    const before = await read();
    await page.getByRole('button', { name: 'Expenses', exact: true }).click();
    const grid = page.getByRole('region', { name: 'Expense grid' });
    await expect(grid).toBeVisible();
    await page.getByRole('button', { name: 'Previous expense period' }).click();
    await expect(page.getByTestId('expense-period')).toHaveText(
      'December 2016',
    );
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect(
      page.getByRole('columnheader', { name: 'December 2016' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next expense period' }).click();
    await expect(page.getByTestId('expense-period')).toHaveText('2017');
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.getByTestId('expense-period')).toHaveText(
      'December 2017',
    );
    await page.getByRole('button', { name: 'Budget', exact: true }).click();
    await expect(budget.selectedMonthButton).toHaveText(month ?? '');
    await expect(budget.budgetTable.getByTestId('budget').first()).toHaveText(
      budgeted ?? '',
    );
    expect(await read()).toEqual(before);
    await page.getByRole('button', { name: 'Expenses', exact: true }).click();
    await expect(page.getByTestId('expense-period')).toHaveText('January 2017');
  } finally {
    await page.close();
  }
});
