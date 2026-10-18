import { describe, expect, it } from 'vitest';

import { amountOverflowsCell } from './ReportTableRow';

describe('amountOverflowsCell', () => {
  it('uses cents for a two-decimal currency', () => {
    expect(amountOverflowsCell(10_000_000, 2)).toBe(false);
    expect(amountOverflowsCell(10_000_001, 2)).toBe(true);
  });

  it('uses whole units for a zero-decimal currency', () => {
    expect(amountOverflowsCell(100_000, 0)).toBe(false);
    expect(amountOverflowsCell(100_001, 0)).toBe(true);
  });
});
