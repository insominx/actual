import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, expect } from '@playwright/test';

import { createFixture } from './harness.mjs';

// Browser proof for 0016 A1: a guarded CLI category retirement and payee merge
// preserve transaction totals and update references the browser engine reads.

void test(
  'browser sees CLI category retirement and payee merge with totals preserved',
  { timeout: 150000 },
  async () => {
    const f = await createFixture({ browser: true });
    let browser;
    try {
      browser = await chromium.launch();
      const page = await (await browser.newContext()).newPage();
      page.setDefaultTimeout(15000);
      const send = (name, args) =>
        page.evaluate(({ name, args }) => window.$send(name, args), {
          name,
          args,
        });
      async function cli(args, options) {
        const result = await f.cli(args, options);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        const parsed = JSON.parse(result.stdout);
        return parsed.data ?? parsed;
      }
      const legacy = args => cli(args, { version: '1' });
      await page.goto(f.serverUrl);
      await page
        .getByPlaceholder('Password', { exact: true })
        .fill('disposable-cli-test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Agent CLI disposable', { exact: true }).click();
      await expect(
        page.getByText('Checking', { exact: true }).first(),
      ).toBeVisible();

      const group = (
        await legacy(['category-groups', 'create', '--name', 'Browser group'])
      ).id;
      const keep = (
        await legacy([
          'categories',
          'create',
          '--name',
          'Browser keep',
          '--group-id',
          group,
        ])
      ).id;
      const retire = (
        await legacy([
          'categories',
          'create',
          '--name',
          'Browser retire',
          '--group-id',
          group,
        ])
      ).id;
      const shop = (await legacy(['payees', 'create', '--name', 'Shop'])).id;
      const shop2 = (await legacy(['payees', 'create', '--name', 'Shop 2'])).id;
      await legacy([
        'transactions',
        'add',
        '--account',
        f.fixture.checking,
        '--data',
        JSON.stringify([
          { date: '2026-09-20', amount: -100, category: keep, payee: shop },
          { date: '2026-09-21', amount: -200, category: retire, payee: shop2 },
          { date: '2026-09-22', amount: -300, category: retire, payee: shop2 },
        ]),
      ]);
      const range = {
        accountId: f.fixture.checking,
        startDate: '2026-09-20',
        endDate: '2026-09-22',
      };
      assert.ok(!(await send('sync-budget')).error);
      const before = await send('api/transactions-get', range);
      assert.equal(before.length, 3);
      const total = rows => rows.reduce((sum, row) => sum + row.amount, 0);

      const retired = await cli([
        'categories',
        'delete',
        retire,
        '--transfer-to',
        keep,
        '--operation-id',
        'browser-retire',
      ]);
      assert.equal(retired.receipt.outcome.status, 'committed-local');
      const merged = await cli([
        'payees',
        'merge',
        '--target',
        shop,
        '--ids',
        shop2,
        '--operation-id',
        'browser-merge',
      ]);
      assert.equal(merged.receipt.outcome.status, 'committed-local');

      assert.ok(!(await send('sync-budget')).error);
      const after = await send('api/transactions-get', range);
      assert.equal(after.length, 3);
      assert.equal(total(after), total(before));
      assert.ok(
        after.every(row => row.category === keep),
        'retired category references resolve to the kept category',
      );
      assert.ok(
        after.every(row => row.payee === shop),
        'merged payee references resolve to the target payee',
      );
      const categories = await send('api/categories-get', {
        grouped: false,
      });
      assert.ok(!categories.some(row => row.id === retire));
      const payees = await send('api/payees-get');
      assert.ok(!payees.some(row => row.id === shop2));

      // The browser UI lists the kept category in the budget.
      await page.getByRole('link', { name: 'Budget' }).first().click();
      await expect(
        page.getByText('Browser keep', { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText('Browser retire', { exact: true }),
      ).toHaveCount(0);
    } finally {
      try {
        await browser?.close();
      } finally {
        await f.dispose();
      }
    }
  },
);
