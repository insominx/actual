import { describe, expect, it } from 'vitest';

import { chartAxisMargin } from './chartAxisMargin';

describe('chartAxisMargin', () => {
  it('widens once a dollar label reaches five digits', () => {
    expect(chartAxisMargin(100_000, () => '$1,000', 20)).toBe(0);
    expect(chartAxisMargin(1_000_000, () => '$10,000', 20)).toBe(20);
  });

  it('widens yen labels by their formatted length', () => {
    expect(chartAxisMargin(1_000, () => '¥1,000', 20, 5)).toBe(5);
    expect(chartAxisMargin(10_000, () => '¥10,000', 20, 5)).toBe(20);
    expect(chartAxisMargin(100_000, () => '¥100,000', 20, 5)).toBe(20);
  });

  it('ignores bidi marks and a leading minus when measuring', () => {
    expect(chartAxisMargin(-1_000_000, () => '\u202A$\u202C10,000', 20)).toBe(
      20,
    );
    expect(chartAxisMargin(100_000, () => '\u202A$\u202C1,000', 20, 5)).toBe(5);
  });
});
