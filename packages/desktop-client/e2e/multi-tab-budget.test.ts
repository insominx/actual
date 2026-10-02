import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';

type BackendWindow = {
  $send: <Result>(name: string, args?: unknown) => Promise<Result>;
};

function total(page: Page) {
  return page
    .getByRole('region', { name: 'Expense grid' })
    .getByRole('row')
    .filter({
      has: page.getByRole('rowheader', { name: 'Total net spending' }),
    })
    .getByRole('cell')
    .last();
}

test('new budget tabs share one backend for edits, undo and leader handover', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    viewport: { width: 1100, height: 700 },
  });
  const messages: string[] = [];
  context.on('page', page => {
    page.on('console', message => messages.push(message.text()));
    page.on('pageerror', error => messages.push(error.message));
  });
  try {
    const leader = await context.newPage();
    await leader.goto('/');
    await new ConfigurationPage(leader).startFresh();
    const transactionId = await leader.evaluate(async () => {
      const send = (window as unknown as BackendWindow).$send;
      const account = await send<string>('account-create', {
        name: 'Shared Checking',
        offBudget: false,
      });
      const categories = await send<{
        list: Array<{ id: string; is_income: boolean }>;
      }>('get-categories');
      const category = categories.list.find(row => !row.is_income);
      if (!category) {
        throw new Error('Missing expense category');
      }
      const id = crypto.randomUUID();
      await send('transactions-batch-update', {
        added: [
          {
            id,
            account,
            category: category.id,
            date: '2025-03-15',
            amount: -10000,
          },
        ],
      });
      const prefs = await send<{ id: string }>('load-prefs');
      const key = `${prefs.id}-budget.startMonth`;
      localStorage.setItem(key, JSON.stringify('2025-03'));
      window.dispatchEvent(new StorageEvent('local-storage', { key }));
      return id;
    });
    await leader.getByRole('button', { name: 'Expenses', exact: true }).click();
    await expect(total(leader)).toHaveText('100.00');

    const follower = await context.newPage();
    await follower.goto('/');
    await expect(total(follower)).toHaveText('100.00');
    const update = (page: Page, amount: number) =>
      page.evaluate(
        async ({ transactionId, amount }) => {
          await (window as unknown as BackendWindow).$send(
            'transactions-batch-update',
            { updated: [{ id: transactionId, amount }] },
          );
        },
        { transactionId, amount },
      );

    await update(leader, -11000);
    await expect(total(leader)).toHaveText('110.00');
    await expect(total(follower)).toHaveText('110.00');
    await follower.evaluate(async () => {
      await (window as unknown as BackendWindow).$send('undo');
    });
    await expect(total(leader)).toHaveText('100.00');
    await expect(total(follower)).toHaveText('100.00');
    await update(follower, -12000);
    await expect(total(leader)).toHaveText('120.00');
    await expect(total(follower)).toHaveText('120.00');

    const promoted = follower.waitForEvent('console', {
      predicate: message =>
        message.text().startsWith('[WorkerBridge] Role: LEADER'),
    });
    await leader.close({ runBeforeUnload: true });
    await promoted;
    const prefs = follower.evaluate(async transactionId => {
      const send = (window as unknown as BackendWindow).$send;
      const [prefs] = await Promise.all([
        send('load-prefs'),
        send('transactions-batch-update', {
          updated: [{ id: transactionId, amount: -13000 }],
        }),
      ]);
      return prefs;
    }, transactionId);
    await expect.poll(() => prefs).toMatchObject({ id: expect.any(String) });
    await expect(total(follower)).toHaveText('130.00');
    await update(follower, -14000);
    await expect(total(follower)).toHaveText('140.00');
  } finally {
    await testInfo.attach('backend-log', {
      body: messages.join('\n'),
      contentType: 'text/plain',
    });
    await context.close();
  }
});
