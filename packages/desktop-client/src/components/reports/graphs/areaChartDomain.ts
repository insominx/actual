// Snap a labeled axis bound to one major unit (100 stored cents).
export function areaChartDomainEdge(
  value: number,
  extendRangeAmount: number,
  bound: 'min' | 'max',
): number {
  if (value === 0 || Math.abs(value) <= extendRangeAmount) {
    return 0;
  }
  const unit = 100;
  if (bound === 'min') {
    return Math.floor((value - extendRangeAmount) / unit) * unit;
  }
  return Math.ceil((value + extendRangeAmount) / unit) * unit;
}
