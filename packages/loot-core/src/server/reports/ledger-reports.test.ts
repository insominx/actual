import { describe, expect, it } from 'vitest';

import { reportAmountUnit } from './ledger-reports';

describe('reportAmountUnit', () => {
  it('keeps two-decimal currencies in cents', () => {
    expect(reportAmountUnit(null)).toBe('integer cents');
    expect(reportAmountUnit('')).toBe('integer cents');
    expect(reportAmountUnit('USD')).toBe('integer cents');
    expect(reportAmountUnit('EUR')).toBe('integer cents');
  });

  it('labels zero-decimal currencies as whole units', () => {
    expect(reportAmountUnit('JPY')).toBe('whole units');
    expect(reportAmountUnit('KRW')).toBe('whole units');
    expect(reportAmountUnit('IRR')).toBe('whole units');
  });
});
