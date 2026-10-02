import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { addSyncListener } from '#server/sync';
import * as months from '#shared/months';
import { q } from '#shared/query';

import { getCashPlanningSummary } from './app';

const request = { startDate: '2024-01-01', endDate: '2024-02-29' };

beforeEach(async () => {
  vi.spyOn(months, 'currentDay').mockReturnValue('2024-02-29');
  await global.emptyDatabase()();
  await loadMappings();
  await db.insertAccount({ id: 'cash', name: 'Checking' });
  await db.insertAccount({ id: 'card', name: 'Card' });
  await db.insertAccount({ id: 'equity', name: 'Equity', offbudget: 1 });
  await db.insertCategoryGroup({ id: 'group', name: 'Spending' });
  await db.insertCategory({ id: 'food', name: 'Food', cat_group: 'group' });
  await db.insertCategoryGroup({ id: 'ig', name: 'Income', is_income: 1 });
  await db.insertCategory({
    id: 'salary',
    name: 'Salary',
    cat_group: 'ig',
    is_income: 1,
  });
});

afterEach(() => vi.restoreAllMocks());

async function add(
  id: string,
  amount: number,
  extra: Record<string, unknown> = {},
) {
  await db.insertTransaction({
    id,
    amount,
    account: 'cash',
    category: 'food',
    date: '2024-01-15',
    ...extra,
  });
}

it('reads ledger balances, split leaves, transfers and opening flags through the real database without writes', async () => {
  await add('cash-opening', 1000000, { starting_balance_flag: true });
  await add('card-opening', -200000, {
    account: 'card',
    starting_balance_flag: true,
  });
  await add('income', 1200000, { category: 'salary' });
  await add('parent', -900000, { is_parent: true });
  await add('leaf1', -500000, { parent_id: 'parent', is_child: true });
  await add('leaf2', -400000, { parent_id: 'parent', is_child: true });
  await add('refund', 100000);
  await db.insertPayee({ id: 'to-card', name: 'Card', transfer_acct: 'card' });
  await db.insertPayee({ id: 'to-cash', name: 'Cash', transfer_acct: 'cash' });
  await db.insertPayee({
    id: 'to-equity',
    name: 'Equity',
    transfer_acct: 'equity',
  });
  await add('payment', -200000, { payee: 'to-card', transfer_id: 'received' });
  await add('received', 200000, {
    account: 'card',
    payee: 'to-cash',
    transfer_id: 'payment',
  });
  await add('invest', -50000, { payee: 'to-equity', transfer_id: 'invested' });
  await add('invested', 50000, {
    account: 'equity',
    payee: 'to-cash',
    transfer_id: 'invest',
  });
  await add('future', 999999999, { date: '9999-12-31' });
  await db.update('accounts', { id: 'card', closed: 1 });
  const tables = [
    'accounts',
    'transactions',
    'zero_budgets',
    'reflect_budgets',
    'notes',
    'schedules',
    'preferences',
  ];
  const before = await global.getDatabaseDump(tables);
  const writes: unknown[] = [];
  const remove = addSyncListener(message => writes.push(message));
  try {
    const result = await getCashPlanningSummary(request);
    expect(result).toMatchObject({
      balance: 1150000,
      monthlyIncome: 600000,
      monthlyOutflow: 400000,
      monthlyExternalMovement: -25000,
      months: 2,
    });
    expect(
      result.accounts.find(account => account.id === 'card'),
    ).toMatchObject({ closed: true, balance: 0 });
    expect(await global.getDatabaseDump(tables)).toEqual(before);
    expect(writes).toEqual([]);
  } finally {
    remove();
  }
});

it('retains hidden and unmapped deleted categories and rejects invalid/future history', async () => {
  await add('old-spend', -10000);
  await db.update('categories', { id: 'food', tombstone: 1 });
  const result = await getCashPlanningSummary(request);
  expect(result.outflow).toBe(10000);
  expect(result.categories).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'food',
        available: false,
        monthlyOutflow: 5000,
      }),
    ]),
  );
  await expect(
    getCashPlanningSummary({ ...request, endDate: '9999-12-31' }),
  ).rejects.toThrow();
  await expect(
    getCashPlanningSummary({ ...request, startDate: '2024-02-30' }),
  ).rejects.toThrow();
});

it('saves only the cashPlanning preference through the existing handler', async () => {
  const { handlers } = await import('#server/main');
  const before = await global.getDatabaseDump([
    'transactions',
    'zero_budgets',
    'reflect_budgets',
    'notes',
    'schedules',
  ]);
  const value = JSON.stringify({
    ...request,
    categoryTargets: { food: 400000 },
    goal: { balance: 2000000 },
  });
  await handlers['preferences/save']({ id: 'cashPlanning', value });
  expect((await handlers['preferences/get']()).cashPlanning).toBe(value);
  expect(
    await global.getDatabaseDump([
      'transactions',
      'zero_budgets',
      'reflect_budgets',
      'notes',
      'schedules',
    ]),
  ).toEqual(before);
  const { data } = await handlers.query(
    q('preferences').select('*').serialize(),
  );
  expect(data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'cashPlanning', value }),
    ]),
  );
});
