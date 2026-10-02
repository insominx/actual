import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';
import {
  addReservationCategory,
  addReservationPayment,
  RESERVATION_CATEGORY,
  ReservationBreakdown,
  undoLastChange,
} from './page-models/reservation-breakdown';

async function openBalanceMenu(page: Page) {
  const balance = page
    .getByTestId('budget-table')
    .getByTestId('row')
    .filter({ hasText: RESERVATION_CATEGORY })
    .first()
    .getByTestId('balance')
    .getByTestId(/^budget/)
    .first();
  const transfer = page.getByRole('button', {
    name: 'Transfer to another category',
  });
  // The first press after the table re-renders can be swallowed
  await expect(async () => {
    if (!(await transfer.isVisible())) {
      await balance.click();
    }
    await expect(transfer).toBeVisible({ timeout: 2000 });
  }).toPass();
  return new ReservationBreakdown(page);
}

test.describe('Category reservations', () => {
  let page: Page;
  let navigation: Navigation;
  let categoryId: string;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new Navigation(page);
    const configurationPage = new ConfigurationPage(page);

    await page.goto('/');
    await configurationPage.createTestFile();

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Category reservations');
    await navigation.goToBudgetPage();

    categoryId = await addReservationCategory(page);
    await page
      .getByText(RESERVATION_CATEGORY, { exact: true })
      .waitFor({ state: 'visible' });
    await page.mouse.move(0, 0);
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('shows the reservation breakdown in the balance menu', async () => {
    const breakdown = await openBalanceMenu(page);

    await breakdown.expectAmounts({ balance: '500.00', spare: '350.00' });
  });

  test('removes the breakdown when the flag is turned off', async () => {
    await expect((await openBalanceMenu(page)).locator).toBeVisible();
    await page.keyboard.press('Escape');

    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Category reservations');
    const toggle = page.getByRole('checkbox', {
      name: 'Category reservations',
    });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await navigation.goToBudgetPage();

    const breakdown = await openBalanceMenu(page);
    await expect(breakdown.locator).toHaveCount(0);
  });

  // The default Playwright user agent uses one direct backend worker per page.
  test('refreshes the open breakdown after a payment and undo', async () => {
    const breakdown = await openBalanceMenu(page);
    await breakdown.expectAmounts({ balance: '500.00', spare: '350.00' });

    await addReservationPayment(page, categoryId);
    await breakdown.expectAmounts({ balance: '400.00', spare: '250.00' });

    await undoLastChange(page);
    await breakdown.expectAmounts({ balance: '500.00', spare: '350.00' });
  });
});

test('refreshes reservations across shared-budget tabs after payment and undo', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  });
  try {
    const leader = await context.newPage();
    await leader.goto('/');
    await new ConfigurationPage(leader).startFresh();
    const navigation = new Navigation(leader);
    const settings = await navigation.goToSettingsPage();
    await settings.enableExperimentalFeature('Category reservations');
    await navigation.goToBudgetPage();

    const fixture = await leader.evaluate(async name => {
      const send = (
        window as unknown as {
          $send: <Result>(name: string, args?: unknown) => Promise<Result>;
        }
      ).$send;
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const account = await send<string>('account-create', {
        name: 'Reservation Checking',
        offBudget: false,
      });
      const groupId = await send<string>('category-group-create', {
        name: 'Reservations',
      });
      const category = await send<string>('category-create', { name, groupId });
      await send('notes-save', {
        id: category,
        note: `#template 50\n#template 100 by ${month} repeat every year`,
      });
      await send('budget/budget-amount', { month, category, amount: 50000 });
      return { account, category, month };
    }, RESERVATION_CATEGORY);

    const follower = await context.newPage();
    await follower.goto('/');
    const panels = [
      await openBalanceMenu(leader),
      await openBalanceMenu(follower),
    ];
    const expectBalances = async (balance: string, spare: string) => {
      for (const panel of panels) {
        await expect(panel.line('Total balance', balance)).toBeVisible();
        await expect(panel.line('Reserved', '100.00')).toBeVisible();
        await expect(panel.line('Allowance remaining', '50.00')).toBeVisible();
        await expect(panel.line('Spare', spare)).toBeVisible();
      }
    };
    await expectBalances('500.00', '350.00');
    await leader.evaluate(async ({ account, category, month }) => {
      await (
        window as unknown as {
          $send: (name: string, args?: unknown) => Promise<unknown>;
        }
      ).$send('transactions-batch-update', {
        added: [
          {
            id: crypto.randomUUID(),
            account,
            category,
            date: `${month}-01`,
            amount: -10000,
          },
        ],
      });
    }, fixture);
    await expectBalances('400.00', '250.00');
    await undoLastChange(follower);
    await expectBalances('500.00', '350.00');
  } finally {
    await context.close();
  }
});
