import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';

const url = process.env.EXPENSE_SMOKE_URL ?? 'http://localhost:3010';
const evidence = new URL(
  '../../../.workflow/tasks/0003-expense-only-budget-view/evidence/',
  import.meta.url,
);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  viewport: { width: 1100, height: 700 },
});
context.setDefaultTimeout(20000);
const log = [];
context.on('page', page =>
  page.on('console', message => {
    if (/WorkerBridge|SharedWorker/.test(message.text())) {
      log.push(message.text());
    }
  }),
);

function total(page) {
  return page
    .getByRole('region', { name: 'Expense grid' })
    .getByRole('row')
    .filter({
      has: page.getByRole('rowheader', { name: 'Total net spending' }),
    })
    .getByRole('cell')
    .last();
}

async function seed(first) {
  await first.goto(url);
  await first
    .getByRole('button', { name: 'Start budgeting', exact: true })
    .click();
  await first.getByTestId('budget-table').waitFor();
  const budgetId = await first.evaluate(async () => {
    const send = window.$send;
    const account = await send('account-create', {
      name: 'Smoke Checking',
      offBudget: false,
    });
    const group = await send('category-group-create', {
      name: 'Smoke Everyday',
    });
    const food = await send('category-create', {
      name: 'Smoke Food',
      groupId: group,
    });
    const fees = await send('category-create', {
      name: 'Smoke Fees',
      groupId: group,
    });
    const hobby = await send('category-create', {
      name: 'Smoke Hobby',
      groupId: group,
    });
    const added = [
      { id: 't-expense', amount: -10000, category: food },
      { id: 't-refund', amount: 2500, category: food },
      { id: 't-food', amount: -3000, category: food },
      { id: 't-fees', amount: -2000, category: fees },
      { id: 't-boundary-total', amount: -6000, category: fees },
      { id: 't-uncat', amount: -700 },
      { id: 't-hobby', amount: -900, category: hobby },
    ].map(row => ({ account, date: '2025-03-15', ...row }));
    await send('transactions-batch-update', { added });
    const { id } = await send('load-prefs');
    localStorage.setItem(`${id}-budget.startMonth`, JSON.stringify('2025-03'));
    window.dispatchEvent(
      new StorageEvent('local-storage', { key: `${id}-budget.startMonth` }),
    );
    await window.__TANSTACK_QUERY_CLIENT__.invalidateQueries({
      queryKey: ['categories', 'lists'],
    });
    return id;
  });
  await first.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(total(first)).toHaveText('201.00');
  return budgetId;
}

try {
  const first = await context.newPage();
  const budgetId = await seed(first);
  const second = await context.newPage();
  await second.goto(url);
  await expect(total(second)).toHaveText('201.00');
  await second.screenshot({
    path: fileURLToPath(new URL('two-tabs-before.png', evidence)),
  });
  await first.evaluate(async () => {
    try {
      await window.$send('transactions-batch-update', {
        updated: [{ id: 't-expense', amount: -11000 }],
      });
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  });
  await expect(total(first)).toHaveText('211.00');
  await expect(total(second)).toHaveText('211.00');
  await second.screenshot({
    path: fileURLToPath(new URL('two-tabs-updated.png', evidence)),
  });
  await first.evaluate(async () => {
    await window.$send('undo');
  });
  await expect(total(first)).toHaveText('201.00');
  await expect(total(second)).toHaveText('201.00');
  const promoted = second.waitForEvent('console', {
    predicate: message =>
      message.text().startsWith('[WorkerBridge] Role: LEADER'),
  });
  await first.close({ runBeforeUnload: true });
  await promoted;
  const handover = second.evaluate(async () => {
    const [prefs] = await Promise.all([
      window.$send('load-prefs'),
      window.$send('transactions-batch-update', {
        updated: [{ id: 't-expense', amount: -12000 }],
      }),
    ]);
    return prefs;
  });
  await expect.poll(() => handover).toMatchObject({ id: budgetId });
  await expect(total(second)).toHaveText('221.00');
  await second.screenshot({
    path: fileURLToPath(new URL('two-tabs-after-handover.png', evidence)),
  });
  const result = {
    scenario: 'two-tab edit/undo',
    result: 'passed',
    time: new Date().toISOString(),
    budgetId,
    before: 20100,
    edited: 21100,
    undone: 20100,
    handoverEdited: 22100,
    coordinator: log,
  };
  await writeFile(
    new URL('two-tab-verification.json', evidence),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  const result = {
    scenario: 'two-tab edit/undo',
    result: 'blocked',
    error: String(error),
    coordinator: log,
  };
  await writeFile(
    new URL('two-tab-verification.json', evidence),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await context.close();
}

const performanceContext = await browser.newContext({
  userAgent: 'playwright',
  viewport: { width: 1100, height: 700 },
});
performanceContext.setDefaultTimeout(20000);
try {
  const first = await performanceContext.newPage();
  await seed(first);
  await first.evaluate(async () => {
    const accounts = await window.$send('accounts-get');
    const account = accounts.find(row => row.name === 'Smoke Checking').id;
    const categories = await window.$send('get-categories');
    const category = categories.list.find(row => row.name === 'Smoke Food').id;
    await window.$send('transactions-batch-update', {
      added: Array.from({ length: 3000 }, (_, index) => ({
        id: `performance-${index}`,
        account,
        category,
        amount: -100,
        date: `2025-${String((index % 12) + 1).padStart(2, '0')}-15`,
      })),
    });
  });
  const started = performance.now();
  await first.getByRole('button', { name: 'Year', exact: true }).click();
  await expect(total(first)).toHaveText('3,201.00');
  const milliseconds = Math.round(performance.now() - started);
  const rows = await first
    .getByRole('region', { name: 'Expense grid' })
    .getByRole('row')
    .count();
  await first.screenshot({
    path: fileURLToPath(new URL('year-performance.png', evidence)),
  });
  console.log(
    JSON.stringify({
      scenario: 'year performance',
      leaves: 3007,
      rows,
      milliseconds,
      total: 320100,
    }),
  );
} finally {
  await performanceContext.close();
  await browser.close();
}
