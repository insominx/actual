import { describe, expect, it } from 'vitest';

import { amountOverflowsCell } from './ReportTableRow';

describe('amountOverflowsCell', () => {
  it('overflows above 100,000 major units', () => {
    expect(amountOverflowsCell(10_000_000)).toBe(false);
    expect(amountOverflowsCell(10_000_001)).toBe(true);
  });
});

