import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';

// Hostile input through the fork's own screens: a forecast horizon the chart
// cannot draw, and a damaged saved column-width map.

async function started(page: Page) {
  await page.goto('/');
  await new ConfigurationPage(page).createTestFile();
}

test.describe('adversarial UI input', () => {
  test('cash planning refuses forecast end dates beyond the horizon without freezing', async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await started(page);
      await new Navigation(page).goToReportsPage();
      await page
        .getByRole('button', { name: 'Cash planning', exact: true })
        .click();
      await expect(page.getByTestId('cash-planning')).toBeVisible();
      await page.getByLabel('Start date', { exact: true }).fill('2016-11-01');
      await page.getByLabel('End date', { exact: true }).fill('2016-12-31');
      const forecast = page.getByLabel('Forecast end date', { exact: true });
      for (const date of ['9999-12-31', '5000-01-01']) {
        await forecast.fill(date);
        // A frozen page cannot answer; the alert must appear promptly.
        await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 });
        await expect(
          page.getByRole('button', { name: 'Save plan' }),
        ).toBeDisabled();
      }
      await forecast.fill('2030-01-01');
      await expect(page.getByRole('alert')).toBeHidden();
    } finally {
      await page.close();
    }
  });

  test('a damaged saved column-width map never breaks the table or its widths', async ({
    browser,
  }) => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    try {
      await started(page);
      const account = await new Navigation(page).goToAccountPage(
        'Ally Savings',
      );
      await expect(account.transactionTableRow.first()).toBeVisible();
      const handle = page.getByRole('separator', {
        name: 'Resize Payee column',
      });
      await handle.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.up('ArrowRight');
      const key = await page.evaluate(
        () =>
          Object.keys(localStorage).find(k =>
            k.endsWith('-transaction-table-widths'),
          ) ?? null,
      );
      expect(key).not.toBeNull();
      const hostile = [
        '{"__proto__":{"payee":900},"constructor":{"payee":900}}',
        '[1,2,3]',
        'null',
        '"text"',
        '{"x":{"payee":1e999,"notes":-5,"category":"9"}}',
        '{not json',
      ];
      for (const value of hostile) {
        await page.evaluate(
          ([k, v]) => localStorage.setItem(k, v),
          [key as string, value],
        );
        await page.reload();
        await expect(page.getByTestId('transaction-table-header')).toBeVisible({
          timeout: 20000,
        });
        const widths = await page
          .getByTestId('transaction-table-header')
          .getByTestId('payee')
          .evaluate(el => el.getBoundingClientRect().width);
        expect(widths).toBeGreaterThan(79);
        expect(widths).toBeLessThan(1201);
      }
    } finally {
      await page.close();
    }
  });
});
