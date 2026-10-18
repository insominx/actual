import type { TransactionEntity } from '@actual-app/core/types/models';

import {
  calculateRunningBalancesBottomUp,
  calculateRunningBalancesTopDown,
} from './useTransactions';

// Newest first, as the account register lists them
const tx = (id: string, amount: number) =>
  ({ id, amount }) as unknown as TransactionEntity;

describe('running balances', () => {
  const all = [tx('c', -300), tx('b', 200), tx('a', 1000)];

  it('top-down: the balance after each row follows from the account balance', () => {
    // Account balance after the newest row is 900
    const balances = calculateRunningBalancesTopDown(all, 'inline', 900);
    expect([...balances]).toEqual([
      ['c', 900],
      ['b', 1200],
      ['a', 1000],
    ]);
  });

  it('top-down: a partially loaded list does not treat its last row as the oldest', () => {
    // Only the two newest rows are loaded; 'b' is not the first transaction
    const balances = calculateRunningBalancesTopDown(
      all.slice(0, 2),
      'inline',
      900,
    );
    expect(balances.get('b')).toBe(1200);
  });

  it('top-down and bottom-up agree on a complete list', () => {
    const top = calculateRunningBalancesTopDown(all, 'inline', 900);
    const bottom = calculateRunningBalancesBottomUp(all, 'inline', 0);
    // Same balances; the maps only differ in insertion order
    expect(Object.fromEntries(top)).toEqual(Object.fromEntries(bottom));
  });
});
