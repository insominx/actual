import { describe, expect, it } from 'vitest';

import { amountScale, amountToInteger } from './amount-scale';

describe('amountScale', () => {
  it('keeps two decimal places for ordinary and unknown currencies', () => {
    expect(amountScale('USD')).toBe(100);
    expect(amountScale('PLN')).toBe(100);
    expect(amountScale(undefined)).toBe(100);
    expect(amountScale('')).toBe(100);
  });

  it('uses whole units for the zero-decimal currencies Actual supports', () => {
    expect(amountScale('JPY')).toBe(1);
    expect(amountScale('jpy')).toBe(1);
    expect(amountScale('KRW')).toBe(1);
    expect(amountScale('IRR')).toBe(1);
  });
});

describe('amountToInteger', () => {
  it('scales two-decimal amounts by 100 when no currency is given', () => {
    expect(amountToInteger('12.5')).toBe(1250);
    expect(amountToInteger('-100.00', 'USD')).toBe(-10000);
  });

  it('does not invent cents for zero-decimal currencies', () => {
    expect(amountToInteger('1000', 'JPY')).toBe(1000);
    expect(amountToInteger('-12.4', 'KRW')).toBe(-12);
  });
});
