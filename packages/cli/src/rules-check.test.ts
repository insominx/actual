import { ruleDrift, ruleSample } from './rules-check';

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  account: 'acct',
  date: '2026-10-01',
  amount: -500,
  imported_payee: 'COFFEE BAR',
  payee: 'p-coffee',
  notes: null,
  category: 'dining',
  ...over,
});

describe('rule drift', () => {
  it('passes the stored category and payee so untouched fields stay equal', () => {
    expect(ruleSample(row())).toEqual({
      account: 'acct',
      date: '2026-10-01',
      amount: -500,
      imported_payee: 'COFFEE BAR',
      payee: 'p-coffee',
      notes: undefined,
      category: 'dining',
    });
  });

  it('reports only transactions the rules would change', () => {
    const report = ruleDrift(
      [row(), row({ id: 't2' }), row({ id: 't3' })],
      [
        { result: { category: 'dining', payee: 'p-coffee' } },
        {
          result: { category: 'groceries', payee: 'p-coffee' },
          appliedRules: [{ id: 'r1' }],
        },
        { error: 'bad account' },
      ],
      4,
    );
    expect(report.checked).toBe(3);
    expect(report.rules).toBe(4);
    expect(report.drifted).toEqual([
      {
        id: 't2',
        date: '2026-10-01',
        amount: -500,
        importedPayee: 'COFFEE BAR',
        current: { category: 'dining', payee: 'p-coffee' },
        rules: { category: 'groceries', payee: 'p-coffee' },
        appliedRules: ['r1'],
      },
    ]);
    expect(report.errors).toEqual([{ id: 't3', error: 'bad account' }]);
  });
});
