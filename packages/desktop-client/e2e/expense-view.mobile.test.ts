import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileNavigation } from './page-models/mobile-navigation';

test('mobile expenses own their month controls and scroll without moving the budget month', async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 350, height: 600 } });
  try {
    await page.goto('/');
    await new ConfigurationPage(page).createTestFile();
    const budget = await new MobileNavigation(page).goToBudgetPage();
    const month =
      await budget.selectedBudgetMonthButton.getAttribute('data-month');
    const category = await budget.getCategoryNameForRow(0);
    const budgetedButton = await budget.getButtonForBudgeted(category);
    const budgeted = await budgetedButton.textContent();
    const prefs = await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(([key]) =>
          key.endsWith('-budget.startMonth'),
        ),
      ),
    );
    await budget.budgetPageMenuButton.click();
    await page
      .getByRole('button', { name: 'Show expenses', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Expenses', exact: true }),
    ).toBeVisible();
    await expect(page.locator('button[data-month]')).toHaveCount(0);
    const grid = page.getByRole('region', { name: 'Expense grid' });
    await expect(grid).toBeVisible();
    const label = grid.getByRole('rowheader', { name: 'Total net spending' });
    const beforeScroll = await label.boundingBox();
    await grid.evaluate(element => {
      element.scrollLeft = 300;
    });
    const afterScroll = await label.boundingBox();
    expect(beforeScroll).not.toBeNull();
    expect(afterScroll).not.toBeNull();
    expect(
      Math.abs((afterScroll?.x ?? 0) - (beforeScroll?.x ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      await grid.evaluate(element => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Previous expense period' }).click();
    await expect(page.getByTestId('expense-period')).toHaveText(
      'December 2016',
    );
    await budget.budgetPageMenuButton.click();
    await page
      .getByRole('button', { name: 'Show budget', exact: true })
      .click();
    await expect(budget.selectedBudgetMonthButton).toHaveAttribute(
      'data-month',
      month ?? '',
    );
    await expect(budgetedButton).toHaveText(budgeted ?? '');
    expect(
      await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            key.endsWith('-budget.startMonth'),
          ),
        ),
      ),
    ).toEqual(prefs);
  } finally {
    await page.close();
  }
});
