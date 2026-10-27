import { describe, expect, it } from 'vitest';

import { areaChartDomainEdge } from './areaChartDomain';

describe('areaChartDomainEdge', () => {
  it('snaps bounds to the nearest dollar', () => {
    expect(areaChartDomainEdge(5_000, 10, 'min')).toBe(4_900);
    expect(areaChartDomainEdge(5_000, 10, 'max')).toBe(5_100);
    expect(areaChartDomainEdge(-15_050, 10, 'min')).toBe(-15_100);
  });

  it('pins a bound to zero when the series touches or crosses zero', () => {
    expect(areaChartDomainEdge(0, 10, 'min')).toBe(0);
    expect(areaChartDomainEdge(8, 1_000, 'max')).toBe(0);
  });
});

