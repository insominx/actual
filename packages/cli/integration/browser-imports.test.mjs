import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, expect } from '@playwright/test';

import { createFixture } from './harness.mjs';

// Browser proof for 0020 A2: a mapping saved by the CLI is the browser's
// stored import setting, and a mapping the browser's import dialog saves is
// what the CLI reads and applies.

void test(
  'saved import mappings round-trip between the CLI and the browser',
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

      const account = f.fixture.checking;
      const fields = {
        date: 'Posted',
        amount: 'Value',
        payee: 'Who',
        notes: null,
        inOut: null,
        category: null,
        outflow: null,
        inflow: null,
      };
      await cli([
        'imports',
        'mappings',
        'set',
        '--account',
        account,
        '--settings',
        JSON.stringify({ fields, dateFormat: 'dd mm yyyy', delimiter: ';' }),
        '--operation-id',
        'browser-import-mapping',
      ]);
      assert.ok(!(await send('sync-budget')).error);
      const prefs = await send('preferences/get');
      // The exact keys and serialization the import dialog reads.
      assert.deepEqual(JSON.parse(prefs[`csv-mappings-${account}`]), fields);
      assert.equal(prefs[`parse-date-${account}-csv`], 'dd mm yyyy');
      assert.equal(prefs[`csv-delimiter-${account}`], ';');

      // The dialog saves its settings like this on import.
      await send('preferences/save', {
        id: `csv-mappings-${account}`,
        value: JSON.stringify({ ...fields, payee: 'Merchant' }),
      });
      await send('preferences/save', {
        id: `flip-amount-${account}-csv`,
        value: 'true',
      });
      assert.ok(!(await send('sync-budget')).error);
      const saved = await cli([
        '--require-fresh',
        'imports',
        'mappings',
        'get',
        '--account',
        account,
      ]);
      assert.equal(saved.settings.fields.payee, 'Merchant');
      assert.equal(saved.settings.flipAmount, true);
      assert.equal(saved.settings.delimiter, ';');
      assert.deepEqual(await ledger(), ledgerBefore, 'mappings wrote ledger');
    } finally {
      try {
        await browser?.close();
      } finally {
        await f.dispose();
      }
    }
  },
);
