// Zero-decimal ISO codes Actual stores as whole units. Keep this set aligned
// with currencies whose decimalPlaces is 0 in
// packages/loot-core/src/shared/currencies.ts. Unknown codes stay at 2
// decimal places, which is what every existing bank integration assumed.
const ZERO_DECIMAL_CURRENCIES = new Set(['IRR', 'JPY', 'KRW']);

export function amountScale(currency?: string | null): number {
  if (currency && ZERO_DECIMAL_CURRENCIES.has(currency.trim().toUpperCase())) {
    return 1;
  }
  return 100;
}

export function amountToInteger(
  n: string | number,
  currency?: string | null,
): number {
  return Math.round(Number(n) * amountScale(currency));
}
