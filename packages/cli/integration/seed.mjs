import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as api from '@actual-app/api';

const dataDir = process.env.ACTUAL_DATA_DIR;
if (!dataDir || !dataDir.includes('actual-agent-cli-')) {
  throw new Error('Seed requires the disposable fixture directory.');
}
await mkdir(dataDir, { recursive: true });
const engine = await api.init({
  dataDir,
  serverURL: process.env.ACTUAL_SERVER_URL,
  password: process.env.ACTUAL_PASSWORD,
});
try {
  const fixture = {};
  await api.runImport('Agent CLI disposable', async () => {
    await api.setPreference('defaultCurrencyCode', 'USD');
    fixture.checking = await api.createAccount({ name: 'Checking' }, 1000000);
    fixture.card = await api.createAccount({ name: 'Card' }, -200000);
    fixture.savings = await api.createAccount({ name: 'Savings' }, 0);
    fixture.equity = await api.createAccount(
      { name: 'Equity', offbudget: true },
      400000,
    );
    fixture.closed = await api.createAccount(
      { name: 'Closed cash', closed: true },
      20000,
    );
    const group = await api.createCategoryGroup({
      name: 'Expenses',
      is_income: false,
    });
    fixture.groceries = await api.createCategory({
      name: 'Groceries',
      group_id: group,
      is_income: false,
      hidden: true,
    });
    fixture.dining = await api.createCategory({
      name: 'Dining',
      group_id: group,
      is_income: false,
      hidden: false,
    });
    fixture.deletedCategory = await api.createCategory({
      name: 'Retired',
      group_id: group,
      is_income: false,
      hidden: false,
    });
    await api.deleteCategory(fixture.deletedCategory);
    await api.addTransactions(fixture.checking, [
      {
        date: '2026-08-01',
        amount: -15000,
        imported_id: 'split',
        subtransactions: [
          { amount: -10000, category: fixture.groceries },
          { amount: -5000, category: fixture.dining },
        ],
      },
      {
        date: '2026-08-02',
        amount: 2000,
        category: fixture.groceries,
        payee_name: 'Refund',
        imported_id: 'refund',
      },
      { date: '2026-08-03', amount: -1000, imported_id: 'uncategorized' },
      {
        date: '2099-01-01',
        amount: -500,
        category: fixture.dining,
        imported_id: 'future',
      },
    ]);
    const transferPayee = (await api.getPayees()).find(
      p => p.transfer_acct === fixture.savings,
    );
    await api.addTransactions(
      fixture.checking,
      [{ date: '2026-08-04', amount: -10000, payee: transferPayee.id }],
      { runTransfers: true },
    );
    fixture.schedule = await api.createSchedule({
      name: 'Bill',
      account: fixture.checking,
      payee: null,
      amount: -5000,
      amountOp: 'is',
      date: { frequency: 'monthly', start: '2026-09-01' },
      posts_transaction: false,
    });
  });
  await api.sync();
  if (process.env.ACTUAL_TEST_ENCRYPTED === '1') {
    const result = await engine.send('key-make', {
      password: 'disposable-encryption-password',
    });
    if (result?.error) throw new Error('Disposable encryption setup failed.');
  }
  const budget = (await api.getBudgets()).find(
    b => b.name === 'Agent CLI disposable' && b.id,
  );
  if (!budget?.groupId) {
    throw new Error('Fixture upload did not establish a sync ID.');
  }
  fixture.syncId = budget.groupId;
  fixture.budgetId = budget.id;
  if (process.env.ACTUAL_TEST_ENCRYPTED !== '1') {
    await api.runImport('Second isolated budget', async () => {
      fixture.otherAccount = await api.createAccount(
        { name: 'Other budget only' },
        12345,
      );
    });
    const other = (await api.getBudgets()).find(
      b => b.name === 'Second isolated budget' && b.id,
    );
    fixture.otherSyncId = other.groupId;
    fixture.otherBudgetId = other.id;
  }
  await writeFile(join(dataDir, 'fixture.json'), JSON.stringify(fixture));
} finally {
  await api.shutdown();
}
