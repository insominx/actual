import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, expect } from '@playwright/test';

import { createFixture } from './harness.mjs';

test(
  'browser and two CLI caches converge after import, edit, preference change, and undo',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({ browser: true });
    let browser;
    try {
      browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const send = (name, args) =>
        page.evaluate(({ name, args }) => window.$send(name, args), {
          name,
          args,
        });
      async function cli(args, client = 'a') {
        const result = await f.cli(args, { client });
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return JSON.parse(result.stdout).data;
      }
      const listArgs = [
        '--require-fresh',
        'transactions',
        'list',
        '--account',
        f.fixture.checking,
        '--start',
        '2026-09-01',
        '--end',
        '2026-09-30',
      ];
      await page.goto(f.serverUrl);
      await page
        .getByPlaceholder('Password', { exact: true })
        .fill('disposable-cli-test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Agent CLI disposable', { exact: true }).click();
      await expect(
        page.getByText('Checking', { exact: true }).first(),
      ).toBeVisible();
      const prefs = await send('load-prefs');
      assert.equal(prefs.groupId, f.fixture.syncId);
      await cli(['accounts', 'list'], 'b');
      await cli([
        'transactions',
        'import',
        '--account',
        f.fixture.checking,
        '--data',
        JSON.stringify([
          {
            date: '2026-09-15',
            amount: -321,
            imported_id: 'browser-cli-convergence',
            notes: 'CLI import',
          },
        ]),
      ]);
      assert.ok(!(await send('sync-budget')).error);
      const browserRows = await send('api/transactions-get', {
        accountId: f.fixture.checking,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
      const transaction = browserRows.find(
        row => row.imported_id === 'browser-cli-convergence',
      );
      assert.ok(transaction);
      assert.equal(transaction.amount, -321);
      assert.equal(
        (await cli(listArgs, 'b')).find(row => row.id === transaction.id)
          .amount,
        -321,
      );
      const proposal = await cli([
        'changes',
        'preview',
        'transactions.update',
        transaction.id,
        '--operation-id',
        'browser-stale-proof',
        '--data',
        '{"notes":"CLI proposal"}',
      ]);
      assert.equal(proposal.state, 'prepared');
      await send('transactions-batch-update', {
        updated: [{ id: transaction.id, amount: -654 }],
      });
      assert.ok(!(await send('sync-budget')).error);
      const staleApply = await f.cli([
        'changes',
        'apply',
        'browser-stale-proof',
        '--token',
        proposal.token,
      ]);
      assert.equal(staleApply.code, 4, staleApply.stdout + staleApply.stderr);
      assert.equal(JSON.parse(staleApply.stdout).error.code, 'STALE_PREVIEW');
      assert.equal(
        (await cli(['changes', 'status', 'browser-stale-proof'])).state,
        'failed-before-commit',
      );
      assert.equal(
        (
          await send('api/transactions-get', {
            accountId: f.fixture.checking,
            startDate: '2026-09-01',
            endDate: '2026-09-30',
          })
        ).find(row => row.id === transaction.id).amount,
        -654,
      );
      for (const client of ['a', 'b']) {
        assert.equal(
          (await cli(listArgs, client)).find(row => row.id === transaction.id)
            .amount,
          -654,
        );
      }
      await send('undo');
      assert.ok(!(await send('sync-budget')).error);
      for (const client of ['a', 'b']) {
        assert.equal(
          (await cli(listArgs, client)).find(row => row.id === transaction.id)
            .amount,
          -321,
        );
      }
      await send('preferences/save', {
        id: 'defaultCurrencyCode',
        value: 'CAD',
      });
      assert.equal((await send('preferences/get')).defaultCurrencyCode, 'CAD');
      assert.ok(!(await send('sync-budget')).error);
      for (const client of ['a', 'b']) {
        assert.equal(
          (await cli(['--require-fresh', 'budgets', 'inspect'], client))
            .currency,
          'CAD',
        );
      }
      await send('undo');
      assert.ok(!(await send('sync-budget')).error);
      for (const client of ['a', 'b']) {
        assert.equal(
          (await cli(['--require-fresh', 'budgets', 'inspect'], client))
            .currency,
          'USD',
        );
      }
      const finalRows = await send('api/transactions-get', {
        accountId: f.fixture.checking,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
      assert.equal(
        finalRows.find(row => row.id === transaction.id).amount,
        -321,
      );
      assert.equal(
        finalRows.filter(row => row.imported_id === 'browser-cli-convergence')
          .length,
        1,
      );
    } finally {
      try {
        await browser?.close();
      } finally {
        await f.dispose();
      }
    }
  },
);
