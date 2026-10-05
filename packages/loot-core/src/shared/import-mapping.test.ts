import {
  getFileType,
  getInitialDateFormat,
  getInitialMappings,
  parseAmountFields,
  parseDate,
} from './import-mapping';

// CSV cells arrive as strings even where the dialog's type says number.
const row = (value: Record<string, string>) =>
  value as unknown as Parameters<typeof parseAmountFields>[0];

describe('import mapping', () => {
  it('detects mapping fields and the first parseable date format', () => {
    const rows = [
      { Date: '24/12/2026', Amount: '-12.50', Payee: 'Shop', Memo: 'gift' },
    ];
    expect(getInitialMappings(rows)).toMatchObject({
      date: 'Date',
      amount: 'Amount',
      payee: 'Payee',
      notes: 'Memo',
    });
    expect(getInitialDateFormat(rows, { date: 'Date' })).toBe('dd mm yyyy');
    expect(getInitialDateFormat([], { date: 'Date' })).toBe('yyyy mm dd');
  });

  it('parses debit/credit columns, card signs, in/out, flip and multiplier', () => {
    expect(
      parseAmountFields(
        row({ outflow: '12.50', inflow: '' }),
        true,
        false,
        '',
        false,
        '',
      ),
    ).toEqual({ amount: -12.5, outflow: -12.5, inflow: 0 });
    expect(
      parseAmountFields(
        row({ outflow: '', inflow: '3' }),
        true,
        false,
        '',
        false,
        '',
      ),
    ).toEqual({ amount: 3, outflow: 0, inflow: 3 });
    // A card export with charges as positive numbers is flipped.
    expect(
      parseAmountFields(row({ amount: '40.00' }), false, false, '', true, '')
        .amount,
    ).toBe(-40);
    expect(
      parseAmountFields(
        row({ amount: '7', inOut: 'DR' }),
        false,
        true,
        'DR',
        false,
        '',
      ).amount,
    ).toBe(-7);
    expect(
      parseAmountFields(row({ amount: '1.5' }), false, false, '', false, '100')
        .amount,
    ).toBe(150);
  });

  it('keeps day and month order explicit', () => {
    expect(parseDate('03/04/2026', 'mm dd yyyy')).toBe('2026-03-04');
    expect(parseDate('03/04/2026', 'dd mm yyyy')).toBe('2026-04-03');
    expect(parseDate('31/04/2026', 'dd mm yyyy')).toBeNull();
    expect(getFileType('statement.TSV')).toBe('csv');
    expect(getFileType('statement.qfx')).toBe('qfx');
  });
});
