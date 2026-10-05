import { combineAggregate } from './query-aggregate';

vi.mock('@actual-app/api', () => ({}));

const categories = new Map([
  ['food', { name: 'Food', deleted: false }],
  ['old', { name: 'Old', deleted: true }],
]);

describe('split-aware aggregate recipe', () => {
  it('labels categories, refunds, uncategorized, starting balances and transfers separately', () => {
    const result = combineAggregate({
      regular: [
        {
          category: 'food',
          starting_balance_flag: false,
          total: -8000,
          count: 2,
        },
        {
          category: null,
          starting_balance_flag: false,
          total: -1000,
          count: 1,
        },
        {
          category: 'income',
          starting_balance_flag: true,
          total: 100000,
          count: 1,
        },
        { category: 'old', starting_balance_flag: false, total: -50, count: 1 },
        {
          category: 'gone',
          starting_balance_flag: false,
          total: -25,
          count: 1,
        },
      ],
      regularInflow: [
        {
          category: 'food',
          starting_balance_flag: false,
          total: 2000,
          count: 1,
        },
        {
          category: 'income',
          starting_balance_flag: true,
          total: 100000,
          count: 1,
        },
      ],
      transfer: { total: 0, inflow: 10000, count: 2 },
      categories,
      engineTotal: 90925,
      engineCount: 8,
    });
    expect(result.total).toBe(90925);
    expect(result.groups.map(group => group.kind)).toEqual([
      'category',
      'category',
      'category',
      'uncategorized',
      'starting-balance',
      'transfer',
    ]);
    expect(
      result.groups.find(group => group.categoryId === 'food'),
    ).toMatchObject({
      total: -8000,
      inflow: 2000,
      outflow: -10000,
      count: 2,
    });
    expect(
      result.groups.find(group => group.categoryId === 'old'),
    ).toMatchObject({
      deleted: true,
      unavailable: false,
    });
    expect(
      result.groups.find(group => group.categoryId === 'gone'),
    ).toMatchObject({
      name: null,
      unavailable: true,
    });
    expect(result.groups.at(-1)).toMatchObject({
      kind: 'transfer',
      total: 0,
      inflow: 10000,
      outflow: -10000,
    });
  });

  it('refuses to return totals that disagree with the engine', () => {
    expect(() =>
      combineAggregate({
        regular: [{ category: null, total: -1, count: 1 }],
        regularInflow: [],
        transfer: { total: 0, inflow: 0, count: 0 },
        categories,
        engineTotal: -2,
        engineCount: 1,
      }),
    ).toThrow('do not match');
  });
});
