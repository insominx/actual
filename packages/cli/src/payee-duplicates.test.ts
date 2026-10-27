import { describe, expect, it } from 'vitest';

import { findDuplicatePayees, payeeKey } from './payee-duplicates';

describe('payeeKey', () => {
  it.each([
    ['Sq *Wakatobi Japanese  Seaside       Usa', 'wakatobi japanese'],
    ['Deli Delicious # 108 O Marina        Ca', 'deli delicious'],
    ['Amazon Mktpl*1l6p72jt3', 'amazon mktpl'],
    ['Chevron 12801 Highway 33 95322 Ca United States', 'chevron'],
    ['Tst*Rio Grill New      Carmel-By-The Usa', 'rio grill new'],
    ['Lyft   *Ride Fri 1pm', 'lyft'],
  ])('reduces %s to %s', (name, key) => {
    expect(payeeKey(name)).toBe(key);
  });
});

describe('findDuplicatePayees', () => {
  const payee = (id: string, name: string, transactionCount: number) => ({
    id,
    name,
    transactionCount,
  });

  it('suggests the busiest variant as the merge target', () => {
    const merged = findDuplicatePayees([
      payee('a', "Togo's #335095         Seaside       Ca", 3),
      payee('b', "Togo's #335095 Olo     Seaside       Usa", 16),
      payee('c', 'Netflix', 24),
    ]);
    expect(merged).toEqual([
      {
        key: "togo's",
        target: payee('b', "Togo's #335095 Olo     Seaside       Usa", 16),
        merge: [payee('a', "Togo's #335095         Seaside       Ca", 3)],
        transactionCount: 19,
      },
    ]);
  });

  it('folds a longer name into a two-word prefix but not a one-word one', () => {
    const groups = findDuplicatePayees([
      payee('a', 'Ambrosia India Bistro', 19),
      payee('b', 'Ambrosia India Bistro - Monterey', 1),
      payee('c', 'Shell', 4),
      payee('d', 'Shell Oil 93002448530', 1),
    ]);
    expect(
      groups.map(g => [g.key, g.target.id, g.merge.map(p => p.id)]),
    ).toEqual([['ambrosia india bistro', 'a', ['b']]]);
  });

  it('keeps distinct people apart', () => {
    expect(
      findDuplicatePayees([
        payee('a', 'Zelle Payment to Dina Jpm99b654i', 1),
        payee('b', 'Zelle Payment to Logan Work Phon', 2),
      ]),
    ).toEqual([]);
  });
});
