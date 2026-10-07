import { enUS } from 'date-fns/locale';

import {
  amountToCurrencyInteger,
  amountToInteger,
  applyChanges,
  applyFindReplace,
  currencyToAmount,
  getNumberFormat,
  integerToCurrency,
  integerToCurrencyScaled,
  integerToCurrencyWithDecimal,
  looselyParseAmount,
  setNumberFormat,
  stringToInteger,
  titleFirst,
  tsToRelativeTime,
} from './util';

describe('utility functions', () => {
  test('amountToInteger rounds half away from zero so outflows mirror inflows', () => {
    expect(amountToInteger(12.34)).toBe(1234);
    expect(amountToInteger(-12.34)).toBe(-1234);
    // Exactly representable halves must round the same size in both directions
    expect(amountToInteger(0.125)).toBe(13);
    expect(amountToInteger(-0.125)).toBe(-13);
    expect(amountToInteger(2.5, 0)).toBe(3);
    expect(amountToInteger(-2.5, 0)).toBe(-3);
  });

  test('amountToInteger never returns negative zero', () => {
    expect(Object.is(amountToInteger(-0.001), 0)).toBe(true);
    expect(Object.is(amountToInteger(0), 0)).toBe(true);
  });

  test('tsToRelativeTime returns Unknown instead of throwing on a malformed timestamp', () => {
    expect(tsToRelativeTime(null, enUS)).toBe('Unknown');
    expect(tsToRelativeTime('not-a-number', enUS)).toBe('Unknown');
  });

  test('applyFindReplace treats $ in a literal replacement as plain text', () => {
    expect(applyFindReplace('USD 5', 'USD', '$$', false)).toBe('$$ 5');
    expect(applyFindReplace('a b', 'a', '$&$&', false)).toBe('$&$& b');
  });

  test('applyFindReplace still expands capture groups in regex mode', () => {
    expect(applyFindReplace('abc', '(b)', '[$1]', true)).toBe('a[b]c');
  });

  test('applyChanges ignores updates for unknown ids', () => {
    const items = [{ id: 'a', name: 'A' }];
    const result = applyChanges(
      { added: [], updated: [{ id: 'missing', name: 'X' }], deleted: [] },
      items,
    );
    expect(result).toEqual([{ id: 'a', name: 'A' }]);
    expect(result).toHaveLength(1);
    expect(Object.keys(result)).toEqual(['0']);
  });

  test('looseParseAmount works with basic numbers', () => {
    // Parsing is currently limited to 1,2 decimal places or 5-9.
    // Ignoring 3 places removes the possibility of improper parse
    //  of amounts without decimal amounts included.
    expect(looselyParseAmount('3')).toBe(3);
    expect(looselyParseAmount('3.4')).toBe(3.4);
    expect(looselyParseAmount('3.45')).toBe(3.45);
    // cant tell if this next case should be decimal or different format
    // so we set as full numbers
    expect(looselyParseAmount('3.456')).toBe(3456); // the expected failing case
    expect(looselyParseAmount('3.4500')).toBe(3.45);
    expect(looselyParseAmount('3.45000')).toBe(3.45);
    expect(looselyParseAmount('3.450000')).toBe(3.45);
    expect(looselyParseAmount('3.4500000')).toBe(3.45);
    expect(looselyParseAmount('3.45000000')).toBe(3.45);
    expect(looselyParseAmount('3.450000000')).toBe(3.45);
  });

  test('looseParseAmount works with alternate formats', () => {
    expect(looselyParseAmount('3,45')).toBe(3.45);
    expect(looselyParseAmount('3,456')).toBe(3456); //expected failing case
    expect(looselyParseAmount('3,4500')).toBe(3.45);
    expect(looselyParseAmount('3,45000')).toBe(3.45);
    expect(looselyParseAmount('3,450000')).toBe(3.45);
    expect(looselyParseAmount('3,4500000')).toBe(3.45);
    expect(looselyParseAmount('3,45000000')).toBe(3.45);
    expect(looselyParseAmount('3,450000000')).toBe(3.45);
    expect(looselyParseAmount("3'456.78")).toBe(3456.78);
    expect(looselyParseAmount("3'456.78000")).toBe(3456.78);
    expect(looselyParseAmount('1,00,000.99')).toBe(100000.99);
    expect(looselyParseAmount('1,00,000.99000')).toBe(100000.99);
  });

  test('looseParseAmount works with leading decimal characters', () => {
    expect(looselyParseAmount('.45')).toBe(0.45);
    expect(looselyParseAmount(',45')).toBe(0.45);
  });

  test('looseParseAmount works with negative numbers', () => {
    expect(looselyParseAmount('-3')).toBe(-3);
    expect(looselyParseAmount('-3.45')).toBe(-3.45);
    expect(looselyParseAmount('-3,45')).toBe(-3.45);
    // Unicode minus
    expect(looselyParseAmount('−3')).toBe(-3);
    expect(looselyParseAmount('−3.45')).toBe(-3.45);
    expect(looselyParseAmount('−3,45')).toBe(-3.45);
  });

  test('looseParseAmount keeps a trailing minus negative', () => {
    expect(looselyParseAmount('3.45-')).toBe(-3.45);
    expect(looselyParseAmount('3,45-')).toBe(-3.45);
    expect(looselyParseAmount('1.234,56-')).toBe(-1234.56);
    expect(looselyParseAmount('$1,055.00-')).toBe(-1055);
    expect(looselyParseAmount('3-')).toBe(-3);
    expect(looselyParseAmount('3.45−')).toBe(-3.45);
    expect(looselyParseAmount('-3.45')).toBe(-3.45);
  });

  test('looseParseAmount works with parentheses (negative)', () => {
    expect(looselyParseAmount('(3.45)')).toBe(-3.45);
    expect(looselyParseAmount('(3)')).toBe(-3);
    // Parentheses with Unicode minus
    expect(looselyParseAmount('(−3.45)')).toBe(-3.45);
    expect(looselyParseAmount('(−3)')).toBe(-3);
  });

  test('looseParseAmount ignores non-numeric characters', () => {
    // This is strange behavior because it does not work for just
    // `3_45_23` (it needs a decimal amount). This function should be
    // thought through more.
    expect(looselyParseAmount('3_45_23.10')).toBe(34523.1);
    expect(looselyParseAmount('(1 500.99)')).toBe(-1500.99);
  });

  test('looseParseAmount handles trailing whitespace', () => {
    expect(looselyParseAmount('1055 ')).toBe(1055);
    expect(looselyParseAmount('$1,055 ')).toBe(1055);
    expect(looselyParseAmount('$1,055.00 ')).toBe(1055);
    expect(looselyParseAmount(' $1,055 ')).toBe(1055);
    expect(looselyParseAmount('3.45 ')).toBe(3.45);
    expect(looselyParseAmount(' 3.45 ')).toBe(3.45);
  });

  test('looseParseAmount does not count a currency suffix as decimal places', () => {
    expect(looselyParseAmount('3.4 €')).toBe(3.4);
    expect(looselyParseAmount('3.45€')).toBe(3.45);
    expect(looselyParseAmount('3.45 €')).toBe(3.45);
    expect(looselyParseAmount('3,45 €')).toBe(3.45);
    expect(looselyParseAmount('3.45 USD')).toBe(3.45);
    expect(looselyParseAmount('3.45000000 €')).toBe(3.45);
    expect(looselyParseAmount(' -110.7 €')).toBe(-110.7);
    expect(looselyParseAmount('1.234,5 kr')).toBe(1234.5);
    expect(looselyParseAmount('(3.4 €)')).toBe(-3.4);
    // three places are still ambiguous, same as without a suffix
    expect(looselyParseAmount('3.456 €')).toBe(3456);
    expect(looselyParseAmount('1.500 €')).toBe(1500);
  });

  test('number formatting works with comma-dot format', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1,234.56');

    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1,235');
  });

  test('number formatting works with comma-dot-in format', () => {
    setNumberFormat({ format: 'comma-dot-in', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234567.89'))).toBe('12,34,567.89');

    setNumberFormat({ format: 'comma-dot-in', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234567.89'))).toBe('12,34,568');
  });

  test('number formatting works with dot-comma format', () => {
    setNumberFormat({ format: 'dot-comma', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1.234,56');

    setNumberFormat({ format: 'dot-comma', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1.235');
  });

  test('number formatting works with space-comma format', () => {
    setNumberFormat({ format: 'space-comma', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    // grouping separator space char is a narrow non-breaking space (U+202F)
    expect(formatter.format(Number('1234.56'))).toBe('1\u202F234,56');

    setNumberFormat({ format: 'space-comma', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe('1\u202F235');
  });

  test('number formatting works with apostrophe-dot format', () => {
    setNumberFormat({ format: 'apostrophe-dot', hideFraction: false });
    let formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe(`1\u2019234.56`);

    setNumberFormat({ format: 'apostrophe-dot', hideFraction: true });
    formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('1234.56'))).toBe(`1\u2019235`);
  });

  test('number formatting never shows negative zero with decimal places', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    const formatter = getNumberFormat().formatter;
    expect(formatter.format(-0)).toBe('0.00');
    expect(formatter.format(Number('-0.001'))).toBe('0.00');
    expect(formatter.format(Number('-0.01'))).toBe('-0.01');
    expect(integerToCurrency(-0)).toBe('0.00');

    setNumberFormat({ format: 'dot-comma', hideFraction: false });
    expect(getNumberFormat().formatter.format(-0)).toBe('0,00');
  });

  test('number formatting works with small negative numbers with 0 decimal places', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    const formatter = getNumberFormat().formatter;
    expect(formatter.format(Number('-0.1'))).toBe('0');
    expect(formatter.format(Number('-0.5'))).toBe('-1');
    expect(formatter.format(Number('-0.9'))).toBe('-1');
    expect(formatter.format(Number('-1.2'))).toBe('-1');
  });

  test('currencyToAmount works with basic numbers', () => {
    expect(currencyToAmount('3')).toBe(3);
    expect(currencyToAmount('3.4')).toBe(3.4);
    expect(currencyToAmount('3.45')).toBe(3.45);
    expect(currencyToAmount('3.45060')).toBe(3.4506);
  });

  test('currencyToAmount works with varied formats', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    expect(currencyToAmount('3,45')).toBe(3.45);
    expect(currencyToAmount('3,456')).toBe(3456);
    expect(currencyToAmount('3,45000')).toBe(345000);
    expect(currencyToAmount("3'456.78")).toBe(3456.78);
    expect(currencyToAmount("3'456.78000")).toBe(3456.78);
    expect(currencyToAmount('1,00,000.99')).toBe(100000.99);
    expect(currencyToAmount('1,00,000.99000')).toBe(100000.99);
  });

  test('currencyToAmount works with leading decimal characters', () => {
    expect(currencyToAmount('.45')).toBe(0.45);
    expect(currencyToAmount(',45')).toBe(0.45);
  });

  test('currencyToAmount works with negative numbers', () => {
    expect(currencyToAmount('-3')).toBe(-3);
    expect(currencyToAmount('-3.45')).toBe(-3.45);
    expect(currencyToAmount('-3,45')).toBe(-3.45);
    // Unicode minus
    expect(currencyToAmount('−3')).toBe(-3);
    expect(currencyToAmount('−3.45')).toBe(-3.45);
    expect(currencyToAmount('−3,45')).toBe(-3.45);
  });

  test('currencyToAmount works with non-fractional numbers', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    expect(currencyToAmount('3.')).toBe(3);
    expect(currencyToAmount('3,')).toBe(3);
    expect(currencyToAmount('3,000')).toBe(3000);
    expect(currencyToAmount('3,000.')).toBe(3000);
  });

  test('currencyToAmount works with hidden fractions', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    expect(currencyToAmount('3.45')).toBe(3.45);
    expect(currencyToAmount('3.456')).toBe(3.456);
    expect(currencyToAmount('3.4500')).toBe(3.45);
    expect(currencyToAmount('3.')).toBe(3);
    expect(currencyToAmount('3,')).toBe(3);
    expect(currencyToAmount('3,000')).toBe(3000);
    expect(currencyToAmount('3,000.')).toBe(3000);
  });

  test('currencyToAmount works with apostrophe-dot format', () => {
    setNumberFormat({ format: 'apostrophe-dot', hideFraction: false });

    // Test with regular apostrophe (U+0027) - what users type on keyboard
    const keyboardApostrophe = '12\u0027345.67';
    expect(keyboardApostrophe.charCodeAt(2)).toBe(0x0027); // Verify it's U+0027
    expect(currencyToAmount(keyboardApostrophe)).toBe(12345.67);
    expect(currencyToAmount('1\u0027234.56')).toBe(1234.56);
    expect(currencyToAmount('1\u0027000.33')).toBe(1000.33);
    expect(currencyToAmount('100\u0027000.99')).toBe(100000.99);
    expect(currencyToAmount('1\u0027000\u0027000.50')).toBe(1000000.5);

    // Test with right single quotation mark (U+2019) - what Intl.NumberFormat outputs
    const intlApostrophe = '12\u2019345.67';
    expect(intlApostrophe.charCodeAt(2)).toBe(0x2019); // Verify it's U+2019
    expect(currencyToAmount(intlApostrophe)).toBe(12345.67);
    expect(currencyToAmount('1\u2019234.56')).toBe(1234.56);
    expect(currencyToAmount('1\u2019000.33')).toBe(1000.33);
  });

  test('currencyToAmount works with dot-comma', () => {
    setNumberFormat({ format: 'dot-comma', hideFraction: false });
    expect(currencyToAmount('3,45')).toBe(3.45);
    expect(currencyToAmount('3,456')).toBe(3.456);
    expect(currencyToAmount('3,4500')).toBe(3.45);
    expect(currencyToAmount('3,')).toBe(3);
    expect(currencyToAmount('3.')).toBe(3);
    expect(currencyToAmount('3.000')).toBe(3000);
    expect(currencyToAmount('3.000,')).toBe(3000);
  });

  test('titleFirst works with all inputs', () => {
    expect(titleFirst('')).toBe('');
    expect(titleFirst(undefined)).toBe('');
    expect(titleFirst(null)).toBe('');
    expect(titleFirst('a')).toBe('A');
    expect(titleFirst('abc')).toBe('Abc');
  });

  test('stringToInteger works with negative numbers', () => {
    expect(stringToInteger('-3')).toBe(-3);
    // Unicode minus
    expect(stringToInteger('−3')).toBe(-3);
  });

  describe('integerToCurrencyWithDecimal with currency', () => {
    beforeEach(() => {
      setNumberFormat({ format: 'comma-dot', hideFraction: false });
    });

    test('empty string (None) uses 2dp', () => {
      expect(integerToCurrencyWithDecimal(1234, '')).toBe('12.34');
    });

    test('USD uses 2dp', () => {
      expect(integerToCurrencyWithDecimal(1234, 'USD')).toBe('12.34');
    });

    test('JPY uses 0dp', () => {
      expect(integerToCurrencyWithDecimal(1234, 'JPY')).toBe('1,234');
    });

    test('IRR uses 0dp', () => {
      expect(integerToCurrencyWithDecimal(1234, 'IRR')).toBe('1,234');
    });

    test('unknown currency XYZ defaults to 2dp', () => {
      expect(integerToCurrencyWithDecimal(1234, 'XYZ')).toBe('12.34');
    });

    test('no currency argument preserves existing behavior', () => {
      expect(integerToCurrencyWithDecimal(1234)).toBe('12.34');
      expect(integerToCurrencyWithDecimal(1200)).toBe('12.00');
    });
  });

  describe('integerToCurrencyScaled', () => {
    beforeEach(() => {
      setNumberFormat({ format: 'comma-dot', hideFraction: true });
    });

    test('two-decimal currencies keep the hide-fraction preference', () => {
      expect(integerToCurrencyScaled(10000, 'USD')).toBe('100');
      expect(integerToCurrencyScaled(10000)).toBe('100');
    });

    test('zero-decimal currencies are not divided by 100', () => {
      expect(integerToCurrencyScaled(1234, 'JPY')).toBe('1,234');
      expect(integerToCurrencyScaled(1234, 'KRW')).toBe('1,234');
      expect(integerToCurrencyScaled(1234, 'IRR')).toBe('1,234');
    });
  });

  describe('amountToCurrencyInteger', () => {
    test('empty string (None) uses 2dp', () => {
      expect(amountToCurrencyInteger(12.34, '')).toBe(1234);
    });

    test('USD uses 2dp', () => {
      expect(amountToCurrencyInteger(12.34, 'USD')).toBe(1234);
    });

    test('JPY uses 0dp (multiply by 1)', () => {
      expect(amountToCurrencyInteger(1234, 'JPY')).toBe(1234);
    });

    test('IRR uses 0dp (multiply by 1)', () => {
      expect(amountToCurrencyInteger(1234, 'IRR')).toBe(1234);
    });

    it.each<[number, string]>([
      [12.34, 'USD'],
      [1234, 'JPY'],
      [5678, 'IRR'],
    ])(
      'round-trip amountToCurrencyInteger/integerToCurrencyWithDecimal: %s %s',
      (amount, currency) => {
        setNumberFormat({ format: 'comma-dot', hideFraction: false });
        const encoded = amountToCurrencyInteger(amount, currency);
        const decoded = parseFloat(
          integerToCurrencyWithDecimal(encoded, currency).replace(/,/g, ''),
        );
        expect(decoded).toBeCloseTo(amount, 8);
      },
    );
  });
});
