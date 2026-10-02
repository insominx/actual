import type { ExpenseLeaf } from '@actual-app/core/shared/expense-range-query';
import type { CategoryGroupEntity } from '@actual-app/core/types/models';

import {
  buildExpenseSummary,
  getExpenseRange,
  parseDisplayMode,
  parseExpensePeriod,
} from './expenseData';

const groups: CategoryGroupEntity[] = [
  {
    id: 'everyday',
    name: 'Everyday',
    categories: [
      { id: 'food', name: 'Food', group: 'everyday' },
      { id: 'fees', name: 'Fees', group: 'everyday' },
    ],
  },
  {
    id: 'archive',
    name: 'Archive',
    hidden: true,
    categories: [
      { id: 'hobby', name: 'Old Hobby', group: 'archive', hidden: true },
    ],
  },
  { id: 'income', name: 'Income', is_income: true, categories: [] },
];
const golden: ExpenseLeaf[] = [
  { id: 't-expense', date: '2025-03-15', categoryId: 'food', spending: 10000 },
  { id: 't-refund', date: '2025-03-15', categoryId: 'food', spending: -2500 },
  {
    id: 't-split-food',
    date: '2025-03-15',
    categoryId: 'food',
    spending: 3000,
  },
  {
    id: 't-split-fees',
    date: '2025-03-15',
    categoryId: 'fees',
    spending: 2000,
  },
  {
    id: 't-boundary-on',
    date: '2025-03-15',
    categoryId: 'fees',
    spending: 6000,
  },
  { id: 't-uncat-out', date: '2025-03-15', categoryId: null, spending: 700 },
  { id: 't-hidden', date: '2025-03-15', categoryId: 'hobby', spending: 900 },
];

it('reconciles every golden category, group, column and grand total', () => {
  const summary = buildExpenseSummary(golden, groups, 'month', '2025-03');
  expect(summary.groups.map(group => group.total)).toEqual([18500, 900]);
  expect(
    summary.groups.flatMap(group => group.categories.map(row => row.total)),
  ).toEqual([10500, 8000, 900]);
  expect(summary.uncategorized.total).toBe(700);
  expect(summary.total.total).toBe(20100);
  for (const row of [
    ...summary.groups,
    ...summary.groups.flatMap(group => group.categories),
    summary.uncategorized,
    summary.total,
  ]) {
    expect(row.columns['2025-03-15']).toBe(row.total);
    expect(
      Object.values(row.columns).reduce((sum, amount) => sum + amount, 0),
    ).toBe(row.total);
  }
});

it.each([
  ['2024-02', 29],
  ['2025-02', 28],
  ['2025-01', 31],
  ['2025-04', 30],
] as const)(
  'uses real calendar days for %s and zeros for empty periods',
  (anchor, count) => {
    const summary = buildExpenseSummary([], groups, 'month', anchor);
    expect(summary.columns).toHaveLength(count);
    expect(summary.columns.at(-1)).toBe(`${anchor}-${count}`);
    expect(Object.values(summary.total.columns)).toEqual(Array(count).fill(0));
  },
);

it('reconciles annual totals to twelve monthly summaries and assigns year boundaries', () => {
  const leaves: ExpenseLeaf[] = [
    ...golden,
    { id: 'april', date: '2025-04-01', categoryId: 'food', spending: -2500 },
    { id: 'may', date: '2025-05-01', categoryId: null, spending: 400 },
    { id: 'june', date: '2025-06-01', categoryId: 'fees', spending: -1500 },
    { id: 'december', date: '2024-12-31', categoryId: 'food', spending: 100 },
    { id: 'january', date: '2025-01-01', categoryId: 'food', spending: 200 },
  ];
  const annual = buildExpenseSummary(leaves, groups, 'year', '2025');
  const rows = (summary: ReturnType<typeof buildExpenseSummary>) => [
    ...summary.groups,
    ...summary.groups.flatMap(group => group.categories),
    summary.uncategorized,
    summary.total,
  ];
  const monthly = annual.columns.map(month =>
    buildExpenseSummary(leaves, groups, 'month', month),
  );
  rows(annual).forEach((row, index) => {
    expect(row.total).toBe(
      monthly.reduce((sum, summary) => sum + rows(summary)[index].total, 0),
    );
    annual.columns.forEach((column, columnIndex) =>
      expect(row.columns[column]).toBe(rows(monthly[columnIndex])[index].total),
    );
  });
  expect(annual.total.columns['2025-01']).toBe(200);
  expect(
    buildExpenseSummary(leaves, groups, 'year', '2024').total.columns[
      '2024-12'
    ],
  ).toBe(100);
  expect(
    buildExpenseSummary(leaves, groups, 'month', '2024-12').total.columns[
      '2024-12-31'
    ],
  ).toBe(100);
});

it('reconciles temporarily missing categories without caching category metadata', () => {
  const leaves = [
    { id: 'missing', date: '2025-03-01', categoryId: 'food', spending: 400 },
  ];
  expect(
    buildExpenseSummary(leaves, [], 'month', '2025-03').uncategorized.total,
  ).toBe(400);
  const loaded = buildExpenseSummary(leaves, groups, 'month', '2025-03');
  expect(loaded.uncategorized.total).toBe(0);
  expect(loaded.groups[0].total).toBe(400);
});

it.each([undefined, null, '', 'bogus', {}, 1])(
  'defaults malformed preferences without writes: %s',
  value => {
    expect(parseDisplayMode(value)).toBe('budget');
    expect(parseExpensePeriod(value)).toBe('month');
  },
);

it('accepts supported preferences and validates query anchors', () => {
  expect(parseDisplayMode('expenses')).toBe('expenses');
  expect(parseExpensePeriod('year')).toBe('year');
  expect(getExpenseRange('month', '2025-12')).toEqual({
    start: '2025-12-01',
    endExclusive: '2026-01-01',
  });
  expect(getExpenseRange('year', '2024')).toEqual({
    start: '2024-01-01',
    endExclusive: '2025-01-01',
  });
  for (const anchor of ['2025-13', 'bogus', '2025', '0000-01', '9999-12']) {
    expect(() => getExpenseRange('month', anchor)).toThrow();
  }
  for (const anchor of ['2025-01', 'bogus', '0', '0000', '9999']) {
    expect(() => getExpenseRange('year', anchor)).toThrow();
  }
});
