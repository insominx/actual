import { accumulateMonthlyBalances } from './BalanceHistoryGraph';

describe('accumulateMonthlyBalances', () => {
  it('turns monthly changes into running balances, oldest month last in the input', () => {
    // The query returns the most recent month first
    const monthlyTotals = [
      { date: '2024-03', balance: 30 },
      { date: '2024-02', balance: 20 },
      { date: '2024-01', balance: 10 },
    ];

    expect(accumulateMonthlyBalances(100, monthlyTotals)).toEqual([
      { date: '2024-01', balance: 110 },
      { date: '2024-02', balance: 130 },
      { date: '2024-03', balance: 160 },
    ]);
  });

  it('does not mutate its input, so repeated runs give the same result', () => {
    const monthlyTotals = [
      { date: '2024-02', balance: 20 },
      { date: '2024-01', balance: 10 },
    ];

    const first = accumulateMonthlyBalances(0, monthlyTotals);
    const second = accumulateMonthlyBalances(0, monthlyTotals);

    expect(second).toEqual(first);
    expect(monthlyTotals).toEqual([
      { date: '2024-02', balance: 20 },
      { date: '2024-01', balance: 10 },
    ]);
  });
});
