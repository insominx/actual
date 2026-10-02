import * as db from '#server/db';
import {
  buildExpenseRangeQuery,
  normalizeExpenseLeaves,
} from '#shared/expense-range-query';
import type { ExpenseQueryRow } from '#shared/expense-range-query';

import { compileAndRunAqlQuery } from './exec';
import { schema, schemaConfig } from './schema';

beforeEach(global.emptyDatabase());

async function seed() {
  for (const account of [
    { id: 'A1', name: 'Checking', offbudget: 0, closed: 0 },
    { id: 'A2', name: 'Old Card', offbudget: 0, closed: 1 },
    { id: 'A3', name: 'Brokerage', offbudget: 1, closed: 0 },
  ]) {
    await db.insertAccount(account);
  }
  await db.insertCategoryGroup({ id: 'everyday', name: 'Everyday' });
  await db.insertCategoryGroup({ id: 'archive', name: 'Archive', hidden: 1 });
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  for (const category of [
    { id: 'food', name: 'Food', cat_group: 'everyday' },
    { id: 'fees', name: 'Fees', cat_group: 'everyday' },
    { id: 'hobby', name: 'Old Hobby', cat_group: 'archive', hidden: 1 },
    { id: 'salary', name: 'Salary', cat_group: 'income', is_income: 1 },
    { id: 'deleted', name: 'Deleted', cat_group: 'everyday', tombstone: 1 },
  ] satisfies Partial<db.DbCategory>[]) {
    await db.insertCategory(category);
  }
  for (const account of ['A1', 'A2', 'A3']) {
    await db.insertPayee({
      id: `to-${account}`,
      name: account,
      transfer_acct: account,
    });
  }
  await db.insertPayee({ id: 'shop', name: 'Shop' });
  const transactions = [
    { id: 't-expense', amount: -10000, category: 'food', payee: 'shop' },
    { id: 't-refund', amount: 2500, category: 'food' },
    { id: 't-split-parent', amount: -5000, is_parent: true },
    {
      id: 't-split-food',
      amount: -3000,
      category: 'food',
      is_child: true,
      parent_id: 't-split-parent',
    },
    {
      id: 't-split-fees',
      amount: -2000,
      category: 'fees',
      is_child: true,
      parent_id: 't-split-parent',
    },
    { id: 't-xfer-out', amount: -4000, payee: 'to-A2' },
    { id: 't-xfer-in', account: 'A2', amount: 4000, payee: 'to-A1' },
    { id: 't-boundary-on', amount: -6000, category: 'fees', payee: 'to-A3' },
    { id: 't-boundary-off', account: 'A3', amount: 6000, payee: 'to-A1' },
    { id: 't-uncat-out', amount: -700 },
    { id: 't-uncat-in', amount: 800 },
    { id: 't-income', amount: 20000, category: 'salary' },
    { id: 't-hidden', account: 'A2', amount: -900, category: 'hobby' },
    { id: 't-dead', amount: -300, category: 'food', tombstone: true },
    { id: 't-dead-parent', amount: -1200, is_parent: true, tombstone: true },
    {
      id: 't-dead-child-1',
      amount: -700,
      category: 'food',
      is_child: true,
      parent_id: 't-dead-parent',
    },
    {
      id: 't-dead-child-2',
      amount: -500,
      category: 'fees',
      is_child: true,
      parent_id: 't-dead-parent',
    },
    { id: 'april-refund', date: '2025-04-01', amount: 2500, category: 'food' },
    {
      id: 'may-deleted',
      date: '2025-05-01',
      amount: -400,
      category: 'deleted',
    },
    {
      id: 'june-boundary',
      date: '2025-06-01',
      amount: 1500,
      category: 'fees',
      payee: 'to-A3',
    },
  ];
  for (const transaction of transactions) {
    await db.insertTransaction({
      account: 'A1',
      date: '2025-03-15',
      ...transaction,
    });
  }
}

async function read(start: string, endExclusive: string) {
  const { data }: { data: ExpenseQueryRow[] } = await compileAndRunAqlQuery(
    schema,
    schemaConfig,
    buildExpenseRangeQuery({ start, endExclusive }).serialize(),
    {},
  );
  return normalizeExpenseLeaves(data);
}

it('includes exactly the seven golden leaves, including hidden and closed history', async () => {
  await seed();
  const tables = [
    'transactions',
    'accounts',
    'payees',
    'categories',
    'category_groups',
    'zero_budgets',
    'reflect_budgets',
    'notes',
    'messages_crdt',
  ];
  const before = await global.getDatabaseDump(tables);
  const leaves = await read('2025-03-01', '2025-04-01');
  expect(await global.getDatabaseDump(tables)).toEqual(before);
  expect(leaves.map(leaf => leaf.id).sort()).toEqual([
    't-boundary-on',
    't-expense',
    't-hidden',
    't-refund',
    't-split-fees',
    't-split-food',
    't-uncat-out',
  ]);
  expect(
    Object.fromEntries(leaves.map(leaf => [leaf.id, leaf.spending])),
  ).toEqual({
    't-expense': 10000,
    't-refund': -2500,
    't-split-food': 3000,
    't-split-fees': 2000,
    't-boundary-on': 6000,
    't-uncat-out': 700,
    't-hidden': 900,
  });
  expect(leaves.reduce((total, leaf) => total + leaf.spending, 0)).toBe(20100);
});

it.each([
  ['2025-04-01', '2025-05-01', 'april-refund', 'food', -2500],
  ['2025-05-01', '2025-06-01', 'may-deleted', null, 400],
  ['2025-06-01', '2025-07-01', 'june-boundary', 'fees', -1500],
] as const)(
  'handles refund, deleted-category and reverse-boundary months: %s',
  async (start, endExclusive, id, categoryId, spending) => {
    await seed();
    expect(await read(start, endExclusive)).toEqual([
      { id, date: start, categoryId, spending },
    ]);
  },
);

it('excludes categorized internal transfers and off-budget expenses, includes uncategorized boundary outflows only', async () => {
  await seed();
  for (const transaction of [
    { id: 'internal-food', amount: -1000, category: 'food', payee: 'to-A2' },
    { id: 'off-food', account: 'A3', amount: -2000, category: 'food' },
    { id: 'boundary-uncat', amount: -300, payee: 'to-A3' },
    { id: 'boundary-uncat-in', amount: 300, payee: 'to-A3' },
  ]) {
    await db.insertTransaction({
      account: 'A1',
      date: '2025-07-01',
      ...transaction,
    });
  }
  expect(await read('2025-07-01', '2025-08-01')).toEqual([
    {
      id: 'boundary-uncat',
      date: '2025-07-01',
      categoryId: null,
      spending: 300,
    },
  ]);
});
