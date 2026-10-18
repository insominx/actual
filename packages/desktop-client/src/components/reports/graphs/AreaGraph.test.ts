import { describe, expect, it } from 'vitest';

import { areaChartDomainEdge } from './areaChartDomain';

describe('areaChartDomainEdge', () => {
  it('snaps two-decimal currencies to the nearest dollar', () => {
    expect(areaChartDomainEdge(5_000, 10, 2, 'min')).toBe(4_900);
    expect(areaChartDomainEdge(5_000, 10, 2, 'max')).toBe(5_100);
    expect(areaChartDomainEdge(-15_050, 10, 2, 'min')).toBe(-15_100);
  });

  it('snaps yen to whole yen instead of collapsing onto 100-yen steps', () => {
    expect(areaChartDomainEdge(50, 2, 0, 'min')).toBe(48);
    expect(areaChartDomainEdge(50, 2, 0, 'max')).toBe(52);
  });

  it('pins a bound to zero when the series touches or crosses zero', () => {
    expect(areaChartDomainEdge(0, 10, 2, 'min')).toBe(0);
    expect(areaChartDomainEdge(8, 10, 0, 'max')).toBe(0);
  });
});
