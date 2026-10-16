import { describe, expect, it } from 'vitest';

import { qif2json } from './qif2json';

describe('qif2json', () => {
  it('parses records, categories and splits', () => {
    const result = qif2json(
      [
        '!Type:Bank',
        'D01/02/2026',
        'T-1.50',
        'PShop &amp; Co',
        'LFood:Lunch',
        '^',
        'D01/03/2026',
        'T-3.00',
        'SA:B',
        'Esplit',
        '$-3.00',
        '^',
      ].join('\n'),
    );
    expect(result.type).toBe('Bank');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: '01/02/2026',
      amount: '-1.50',
      payee: 'Shop & Co',
      category: 'Food',
      subcategory: 'Lunch',
    });
    expect(result.transactions[1].division).toEqual([
      { category: 'A', subcategory: 'B', description: 'split', amount: -3 },
    ]);
  });

  it('keeps a final record without a closing caret and rejects bad input', () => {
    expect(qif2json('!Type:Bank\nD01/01/2026\nT-1').transactions).toHaveLength(
      1,
    );
    expect(() => qif2json('not qif')).toThrow(/valid qif/);
    expect(() => qif2json('!Type:Bank\nZ?')).toThrow(/Unknown Detail Code/);
  });

  it('parses a large file in linear time', () => {
    const records = 120000;
    const text =
      '!Type:Bank\n' +
      Array.from({ length: records }, () => 'D01/01/2026\nT-1.00\nPx\n^').join(
        '\n',
      );
    const started = Date.now();
    expect(qif2json(text).transactions).toHaveLength(records);
    // Quadratic shift() needs about 20 s for this; linear needs milliseconds.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
