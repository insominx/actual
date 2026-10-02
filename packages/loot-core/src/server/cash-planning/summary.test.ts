import { UNCATEGORIZED_ID } from '#shared/cash-planning';

import { summarizeCashPlanning } from './summary';
import type {
  PlanningAccount,
  PlanningCategory,
  PlanningTransaction,
} from './summary';

const range = { startDate: '2024-01-01', endDate: '2024-02-29' };
const accounts: PlanningAccount[] = [
  {
    id: 'checking',
    name: 'Checking',
    offbudget: false,
    closed: false,
    tombstone: false,
  },
  {
    id: 'card',
    name: 'Card',
    offbudget: false,
    closed: false,
    tombstone: false,
  },
  {
    id: 'savings',
    name: 'Savings',
    offbudget: false,
    closed: true,
    tombstone: false,
  },
  {
    id: 'robinhood',
    name: 'Robinhood cash',
    offbudget: false,
    closed: false,
    tombstone: false,
  },
  {
    id: 'equity',
    name: 'Equity',
    offbudget: true,
    closed: false,
    tombstone: false,
  },
  {
    id: 'deleted',
    name: 'Deleted',
    offbudget: false,
    closed: false,
    tombstone: true,
  },
];
const categories: PlanningCategory[] = [
  {
    id: 'income',
    name: 'Salary',
    is_income: true,
    hidden: false,
    tombstone: false,
  },
  {
    id: 'food',
    name: 'Food',
    is_income: false,
    hidden: false,
    tombstone: false,
  },
  { id: 'old', name: 'Old', is_income: false, hidden: false, tombstone: true },
  {
    id: 'hidden',
    name: 'Hidden',
    is_income: false,
    hidden: true,
    tombstone: false,
  },
];
function tx(
  id: string,
  amount: number,
  extra: Partial<PlanningTransaction> = {},
): PlanningTransaction {
  return {
    id,
    amount,
    account: 'checking',
    date: '2024-01-15',
    category: 'food',
    payee: null,
    transfer_id: null,
    is_parent: false,
    parent_id: null,
    starting_balance_flag: false,
    tombstone: false,
    ...extra,
  };
}
function summary(transactions: PlanningTransaction[]) {
  return summarizeCashPlanning(
    range,
    '2024-02-29',
    accounts,
    transactions,
    categories,
    accounts.map(account => ({ id: account.id, transfer_acct: account.id })),
  );
}

describe('cash planning summary', () => {
  it('includes opening balances and signed card debt once; a card payment changes neither balance nor spending', () => {
    const opening = [
      tx('cash', 1000000, { starting_balance_flag: true }),
      tx('card-open', -200000, {
        account: 'card',
        starting_balance_flag: true,
      }),
    ];
    const before = summary(opening);
    const after = summary([
      ...opening,
      tx('pay', -200000, { payee: 'card', transfer_id: 'receive' }),
      tx('receive', 200000, {
        account: 'card',
        payee: 'checking',
        transfer_id: 'pay',
      }),
    ]);
    expect(before.balance).toBe(800000);
    expect(after.balance).toBe(before.balance);
    expect(after.income).toBe(0);
    expect(after.outflow).toBe(0);
    expect(after.transactionCount).toBe(0);
  });

  it('excludes transfers within checking, savings and Robinhood, and counts cash-to-equity once', () => {
    const result = summary([
      tx('a', -10000, { payee: 'savings' }),
      tx('b', 10000, { account: 'savings', payee: 'checking' }),
      tx('c', -20000, { account: 'savings', payee: 'robinhood' }),
      tx('d', 20000, { account: 'robinhood', payee: 'savings' }),
      tx('e', -50000, { payee: 'equity', transfer_id: 'f' }),
      tx('f', 50000, { account: 'equity', payee: 'checking' }),
    ]);
    expect(result).toMatchObject({
      balance: -50000,
      income: 0,
      outflow: 0,
      externalMovement: -50000,
      monthlyExternalMovement: -25000,
    });
  });

  it('averages two complete months, counting split leaves and refunds once', () => {
    const result = summary([
      tx('salary', 1200000, { category: 'income' }),
      tx('parent', -900000, { is_parent: true }),
      tx('leaf1', -500000, { parent_id: 'parent' }),
      tx('leaf2', -400000, { parent_id: 'parent' }),
      tx('refund', 100000),
    ]);
    expect(result).toMatchObject({
      months: 2,
      income: 1200000,
      outflow: 800000,
      monthlyIncome: 600000,
      monthlyOutflow: 400000,
      transactionCount: 4,
    });
  });

  it('preserves unavailable and uncategorized spending, closed balances, and excludes deleted and future activity', () => {
    const result = summary([
      tx('old', -100, { category: 'old' }),
      tx('hidden', -200, { category: 'hidden' }),
      tx('missing', -300, { category: 'missing' }),
      tx('none', -400, { category: null }),
      tx('closed', 1000, { account: 'savings', starting_balance_flag: true }),
      tx('dead-account', 999999, { account: 'deleted' }),
      tx('dead', 999999, { tombstone: true }),
      tx('future', 999999, { date: '2024-03-01' }),
    ]);
    expect(result.balance).toBe(0);
    expect(result.outflow).toBe(1000);
    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'old', available: false, outflow: 100 }),
        expect.objectContaining({
          id: 'hidden',
          available: false,
          outflow: 200,
        }),
        expect.objectContaining({
          id: 'missing',
          available: false,
          outflow: 300,
        }),
        expect.objectContaining({
          id: UNCATEGORIZED_ID,
          available: true,
          outflow: 400,
        }),
      ]),
    );
    expect(
      result.accounts.find(account => account.id === 'savings'),
    ).toMatchObject({ closed: true, balance: 1000 });
  });

  it('treats empty history as unverified and excludes children of opening balances or deleted parents', () => {
    const result = summary([
      tx('opening', 500, { is_parent: true, starting_balance_flag: true }),
      tx('child', 500, { parent_id: 'opening' }),
      tx('dead-parent', -300, { is_parent: true, tombstone: true }),
      tx('dead-child', -300, { parent_id: 'dead-parent' }),
    ]);
    expect(result).toMatchObject({
      balance: 500,
      income: 0,
      outflow: 0,
      transactionCount: 0,
    });
  });

  it('retains negative income adjustments and net negative category outflows', () => {
    expect(
      summary([tx('reverse', -100, { category: 'income' }), tx('refund', 200)]),
    ).toMatchObject({ income: -100, outflow: -200 });
  });
});
