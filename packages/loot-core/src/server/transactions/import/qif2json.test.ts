import { describe, expect, it } from 'vitest';

import { qif2json } from './qif2json';

describe('qif2json', () => {
  it('ignores blank lines in CRLF files', () => {
    const result = qif2json('!Type:Bank\r\nD01/02/2026\r\nT-1.50\r\n^\r\n\r\n');
    expect(result.transactions).toHaveLength(1);
  });

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

  it('accepts Quicken `U` amount lines', () => {
    const result = qif2json(
      [
        '!Type:Bank',
        'D01/02/2026',
        'U-1,234.56',
        'T-1,234.56',
        '^',
        'D01/03/2026',
        'U-7.00',
        '^',
      ].join('\n'),
    );
    expect(result.transactions.map(t => t.amount)).toEqual([
      '-1,234.56',
      '-7.00',
    ]);
  });

  it('skips Quicken option switches and account headers', () => {
    const result = qif2json(
      [
        '!Option:AutoSwitch',
        '!Account',
        'NChecking',
        'TBank',
        '^',
        'NSavings',
        'TBank',
        '^',
        '!Clear:AutoSwitch',
        '!Account',
        'NChecking',
        'TBank',
        '^',
        '!Type:Bank',
        'D01/02/2026',
        'T-1.50',
        'PShop',
        '^',
      ].join('\r\n'),
    );
    expect(result.type).toBe('Bank');
    expect(result.transactions).toEqual([
      { date: '01/02/2026', amount: '-1.50', payee: 'Shop' },
    ]);
  });

  it('rejects a second account section instead of merging it', () => {
    expect(() =>
      qif2json(
        [
          '!Account',
          'NChecking',
          '^',
          '!Type:Bank',
          'D01/02/2026',
          'T-1.50',
          '^',
          '!Account',
          'NSavings',
          '^',
          '!Type:Bank',
          'D01/03/2026',
          'T-2.00',
          '^',
        ].join('\n'),
      ),
    ).toThrow(/more than one account/);
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
