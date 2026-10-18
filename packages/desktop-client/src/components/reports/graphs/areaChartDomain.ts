// Snap a labeled axis bound to one major unit. Two-decimal currencies snap
// to 100 stored cents ($1). Yen, won, and rial snap to 1 stored unit.
export function areaChartDomainEdge(
  value: number,
  extendRangeAmount: number,
  decimalPlaces: number,
  bound: 'min' | 'max',
): number {
  if (value === 0 || Math.abs(value) <= extendRangeAmount) {
    return 0;
  }
  const unit = 10 ** decimalPlaces;
  if (bound === 'min') {
    return Math.floor((value - extendRangeAmount) / unit) * unit;
  }
  return Math.ceil((value + extendRangeAmount) / unit) * unit;
}
