import { q } from '@actual-app/core/shared/query';
import type { CashPlanningSummary } from '@actual-app/core/types/models/cash-planning';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileNavigation } from './page-models/mobile-navigation';
import { Navigation } from './page-models/navigation';

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Extend the browser's existing Window declaration.
  interface Window {
    $send: <T>(name: string, args?: unknown) => Promise<T>;
  }
}
const range = { startDate: '2016-11-01', endDate: '2016-12-31' };
async function send<T>(page: Page, name: string, args?: unknown): Promise<T> {
  return page.evaluate(({ name, args }) => window.$send<T>(name, args), {
    name,
    args,
  });
}
async function snapshot(page: Page) {
  const result: Record<string, unknown> = {};
  for (const table of [
    'transactions',
    'zero_budgets',
    'reflect_budgets',
    'notes',
    'schedules',
  ]) {
    result[table] = await send(page, 'query', q(table).select('*').serialize());
  }
  return result;
}
async function open(page: Page, mobile: boolean) {
  if (mobile) {
    await new MobileNavigation(page).goToReportsPage();
  } else {
    await new Navigation(page).goToReportsPage();
  }
  await page
    .getByRole('button', { name: 'Cash planning', exact: true })
    .click();
  await expect(page.getByTestId('cash-planning')).toBeVisible();
  await page.getByLabel('Start date', { exact: true }).fill(range.startDate);
  await page.getByLabel('End date', { exact: true }).fill(range.endDate);
  await expect(
    page.getByRole('heading', { name: /^Net cash position/ }),
  ).toBeVisible();
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} cash planning saves separate targets and goals, reloads and masks figures`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({
      viewport: mobile
        ? { width: 350, height: 700 }
        : { width: 1280, height: 900 },
    });
    try {
      await page.goto('/');
      await new ConfigurationPage(page).createTestFile();
      const accounts = await send<
        { id: string; offbudget: boolean; closed: boolean }[]
      >(page, 'accounts-get');
      const account = accounts.find(row => !row.offbudget && !row.closed);
      if (!account) {
        throw new Error('Missing test account');
      }
      const groupId = await send<string>(page, 'category-group-create', {
        name: 'Planning test',
      });
      const category = await send<string>(page, 'category-create', {
        name: 'Planning food',
        groupId,
      });
      await send(page, 'transactions-batch-update', {
        added: [
          {
            id: crypto.randomUUID(),
            account: account.id,
            category,
            date: '2016-12-15',
            amount: -40000,
          },
        ],
      });
      const before = await snapshot(page);
      const initialPrefs = await send<Record<string, string>>(
        page,
        'preferences/get',
      );
      await open(page, mobile);
      expect(
        (await send<Record<string, string>>(page, 'preferences/get'))
          .cashPlanning,
      ).toBe(initialPrefs.cashPlanning);
      expect(await snapshot(page)).toEqual(before);
      const historical = page.locator('section').filter({
        has: page.getByRole('heading', {
          name: 'Historical rate',
          exact: true,
        }),
      });
      const targets = page.locator('section').filter({
        has: page.getByRole('heading', {
          name: 'Category targets',
          exact: true,
          level: 3,
        }),
      });
      await expect(historical).toBeVisible();
      const historicalBefore = await historical.textContent();
      const targetBefore = await targets.textContent();
      await page.getByLabel('Monthly target for Planning food').fill('100');
      await expect(historical).toHaveText(historicalBefore ?? '');
      await expect(targets).not.toHaveText(targetBefore ?? '');
      await page
        .getByLabel('Desired net cash balance', { exact: true })
        .fill('20000');
      await page
        .getByLabel('Goal deadline', { exact: true })
        .fill('2018-01-01');
      await page
        .getByLabel('Forecast end date', { exact: true })
        .fill('2018-06-30');
      await page.getByRole('button', { name: 'Save plan' }).click();
      await expect(
        page.getByText('Plan saved.', { exact: true }),
      ).toBeVisible();
      const prefs = await send<Record<string, string>>(page, 'preferences/get');
      expect(JSON.parse(prefs.cashPlanning)).toMatchObject({
        ...range,
        categoryTargets: { [category]: 10000 },
        goal: { balance: 2000000, deadline: '2018-01-01' },
        forecastEndDate: '2018-06-30',
      });
      expect(await snapshot(page)).toEqual(before);
      await page.reload();
      await expect(
        page.getByLabel('Monthly target for Planning food'),
      ).toHaveValue('100.00');
      await expect(page.getByLabel('Start date', { exact: true })).toHaveValue(
        range.startDate,
      );
      await expect(
        page.getByLabel('Forecast end date', { exact: true }),
      ).toHaveValue('2018-06-30');
      await page.getByLabel('Monthly target for Planning food').fill('');
      await page.getByRole('button', { name: 'Save plan' }).click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              (await send<Record<string, string>>(page, 'preferences/get'))
                .cashPlanning,
            ).categoryTargets[category],
        )
        .toBeUndefined();
      for (const theme of ['auto', 'dark', 'midnight'] as const) {
        await page.evaluate(theme => window.Actual.setTheme(theme), theme);
        const historicalBounds = await historical.boundingBox();
        const targetBounds = await targets.boundingBox();
        const chartBounds = await page
          .getByTestId('cash-planning-chart')
          .boundingBox();
        if (!historicalBounds || !targetBounds || !chartBounds) {
          throw new Error('Missing projection layout');
        }
        expect(chartBounds.y).toBeGreaterThanOrEqual(
          Math.max(
            historicalBounds.y + historicalBounds.height,
            targetBounds.y + targetBounds.height,
          ),
        );
        await page
          .getByRole('heading', { name: /^Net cash position/ })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-balances.png`),
        });
        await page.getByTestId('cash-planning-chart').scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-projection.png`),
        });
      }
      await send(page, 'preferences/save', {
        id: 'isPrivacyEnabled',
        value: 'true',
      });
      await expect(page.getByTestId('cash-planning-chart')).toHaveCount(0);
      await expect(
        page.getByLabel('Monthly target for Planning food'),
      ).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: /^Net cash position/ }),
      ).toContainText('••••');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .getByTestId('cash-planning')
          .evaluate(element => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    } finally {
      await page.close();
    }
  });
}

test('refreshes imports, reconciliation, category edits, undo, and shared budget tabs', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  let second: Page | undefined;
  try {
    await page.goto('/');
    await new ConfigurationPage(page).startFresh();
    await send(page, 'account-create', {
      name: 'Planning checking',
      offBudget: false,
    });
    await open(page, false);
    const before = await send<CashPlanningSummary>(
      page,
      'cash-planning/get-summary',
      range,
    );
    const account = before.accounts.find(row => !row.closed);
    if (!account) {
      throw new Error('Missing test account');
    }
    const heading = page.getByRole('heading', { name: /^Net cash position/ });
    const balanceBefore = await heading.textContent();
    const imported = {
      imported_id: 'cash-planning-import',
      date: '2016-12-20',
      amount: -12345,
      payee_name: 'Cash planning test',
    };
    await send(page, 'transactions-import', {
      accountId: account.id,
      transactions: [imported],
      isPreview: false,
    });
    await expect(heading).not.toHaveText(balanceBefore ?? '');
    const after = await send<CashPlanningSummary>(
      page,
      'cash-planning/get-summary',
      range,
    );
    expect(after.balance).toBe(before.balance - 12345);
    await send(page, 'transactions-import', {
      accountId: account.id,
      transactions: [imported],
      isPreview: false,
    });
    expect(
      (
        await send<CashPlanningSummary>(
          page,
          'cash-planning/get-summary',
          range,
        )
      ).balance,
    ).toBe(after.balance);
    const transactions = await send<{
      data: { id: string; imported_id: string }[];
    }>(
      page,
      'query',
      q('transactions').select(['id', 'imported_id']).serialize(),
    );
    const transaction = transactions.data.find(
      row => row.imported_id === imported.imported_id,
    );
    if (!transaction) {
      throw new Error('Missing imported transaction');
    }
    await send(page, 'transactions-batch-update', {
      updated: [{ id: transaction.id, cleared: true, reconciled: true }],
    });
    expect(
      (
        await send<CashPlanningSummary>(
          page,
          'cash-planning/get-summary',
          range,
        )
      ).balance,
    ).toBe(after.balance);
    const groupId = await send<string>(page, 'category-group-create', {
      name: 'Cash planning edits',
    });
    const category = await send<string>(page, 'category-create', {
      name: 'Cash planning spending',
      groupId,
    });
    await send(page, 'transactions-batch-update', {
      updated: [{ id: transaction.id, category }],
    });
    await expect(
      page.getByLabel('Monthly target for Cash planning spending'),
    ).toBeVisible();
    await send(page, 'undo');
    expect(
      (
        await send<CashPlanningSummary>(
          page,
          'cash-planning/get-summary',
          range,
        )
      ).categories.find(row => row.id === category)?.outflow,
    ).toBe(0);
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText('Plan saved.', { exact: true })).toBeVisible();
    second = await page.context().newPage();
    await second.goto('/reports/cash-planning');
    await expect(
      second.getByRole('heading', { name: /^Net cash position/ }),
    ).toHaveText((await heading.textContent()) ?? '');
    await send(second, 'transactions-batch-update', {
      added: [
        {
          id: crypto.randomUUID(),
          account: account.id,
          date: '2016-12-21',
          amount: -10000,
        },
      ],
    });
    await expect
      .poll(
        async () =>
          (await heading.textContent()) ===
          (await second
            ?.getByRole('heading', { name: /^Net cash position/ })
            .textContent()),
      )
      .toBe(true);
    await send(second, 'preferences/save', {
      id: 'cashPlanning',
      value: JSON.stringify({
        ...range,
        categoryTargets: { [category]: 5000 },
      }),
    });
    await expect(
      page.getByLabel('Monthly target for Cash planning spending'),
    ).toHaveValue('50.00');
  } finally {
    await second?.close();
    await page.close();
    await context.close();
  }
});
