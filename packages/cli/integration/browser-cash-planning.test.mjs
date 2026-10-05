import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, expect } from '@playwright/test';

import { createFixture } from './harness.mjs';

// Browser proof for 0026 A3: a CLI plan save reaches the browser and a browser
// save reaches the CLI, through the synced cashPlanning preference only.

void test(
  'cash plan saves round-trip between the CLI and the browser',
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
      async function cli(args) {
        const result = await f.cli(args);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      }
      await page.goto(f.serverUrl);
      await page
        .getByPlaceholder('Password', { exact: true })
        .fill('disposable-cli-test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Agent CLI disposable', { exact: true }).click();
      await expect(
        page.getByText('Checking', { exact: true }).first(),
      ).toBeVisible();
      const ledger = () =>
        send('api/transactions-get', {
          accountId: f.fixture.checking,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        });
      const ledgerBefore = await ledger();

      await cli([
        'cash-planning',
        'set-target',
        '--category',
        f.fixture.dining,
        '--amount',
        '55555',
        '--operation-id',
        'browser-plan-target',
      ]);
      assert.ok(!(await send('sync-budget')).error);
      const browserPlan = JSON.parse(
        (await send('preferences/get')).cashPlanning,
      );
      assert.equal(browserPlan.categoryTargets[f.fixture.dining], 55555);

      const edited = {
        ...browserPlan,
        categoryTargets: { [f.fixture.dining]: 12345 },
        goal: { balance: 3000000 },
      };
      await send('preferences/save', {
        id: 'cashPlanning',
        value: JSON.stringify(edited),
      });
      assert.ok(!(await send('sync-budget')).error);
      const view = await cli(['--require-fresh', 'cash-planning', 'inspect']);
      assert.deepEqual(view.saved.config.categoryTargets, {
        [f.fixture.dining]: 12345,
      });
      assert.deepEqual(view.saved.config.goal, { balance: 3000000 });
      assert.deepEqual(await ledger(), ledgerBefore, 'plan saves wrote ledger');
    } finally {
      try {
        await browser?.close();
      } finally {
        await f.dispose();
      }
    }
  },
);
