import {
  currencyToAmount,
  setNumberFormat,
} from '@actual-app/core/shared/util';
import { afterEach, describe, expect, it } from 'vitest';

import { formatTypedAmountText } from './FocusableAmountInput';

describe('formatTypedAmountText', () => {
  afterEach(() => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
  });

  it('shifts in implied cents when the fraction is shown', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: false });
    const options = { hideFraction: false, decimalPlaces: 2 };

    expect(formatTypedAmountText('1234', options)).toBe('12.34');
  });

  it('accepts typed cents when the fraction is hidden', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    const options = { hideFraction: true, decimalPlaces: 2 };

    expect(formatTypedAmountText('12', options)).toBe('12');
    expect(formatTypedAmountText('12.', options)).toBe('12.');
    expect(formatTypedAmountText('12.3', options)).toBe('12.3');
    expect(formatTypedAmountText('12.34', options)).toBe('12.34');
    expect(formatTypedAmountText('12.345', options)).toBe('12.34');
    expect(formatTypedAmountText('1234.5', options)).toBe('1,234.5');
    expect(formatTypedAmountText('.5', options)).toBe('0.5');
    expect(currencyToAmount(formatTypedAmountText('1234.56', options))).toBe(
      1234.56,
    );
  });

  it('uses the locale decimal separator when the fraction is hidden', () => {
    setNumberFormat({ format: 'dot-comma', hideFraction: true });
    const options = { hideFraction: true, decimalPlaces: 2 };

    expect(formatTypedAmountText('1234,5', options)).toBe('1.234,5');
    expect(currencyToAmount(formatTypedAmountText('1234,5', options))).toBe(
      1234.5,
    );
  });

  it('does not shift in implied decimals for zero-decimal currencies', () => {
    setNumberFormat({ format: 'comma-dot', hideFraction: true });
    const options = { hideFraction: true, decimalPlaces: 0 };

    expect(formatTypedAmountText('1234', options)).toBe('1,234');
  });
});
