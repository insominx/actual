import * as d from 'date-fns';
import type { Locale } from 'date-fns';

export type PayFrequency = 'weekly' | 'biweekly' | 'monthly';

/**
 * Configuration for pay-period budgeting. A config existing means the
 * feature is active; "disabled" is represented by the absence of a config
 * (see `pay-period-config.ts`), never by a flag on this object.
 */
export type PayPeriodConfig = {
  payFrequency: PayFrequency;
  /** Reference pay date anchoring the cadence, in 'yyyy-MM-dd' format. */
  startDate: string;
};

export type PayPeriod = {
  /** Pseudo-month ID: 'YYYY-MM' with MM in 13..99. */
  monthId: string;
  /** First day of the period, 'yyyy-MM-dd'. */
  startDate: string;
  /** Last day of the period (inclusive), 'yyyy-MM-dd'. */
  endDate: string;
};

const PAY_PERIOD_ID_REGEX = /^(\d{4})-(\d{2})$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const PAY_FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'monthly'];

// Pay period IDs share the month ID space: 01-12 are calendar months,
// 13-99 are pay periods of that year. 87 slots comfortably covers the
// worst case (53 weekly periods).
const FIRST_PERIOD_NUMBER = 13;
const MAX_PERIODS_PER_YEAR = 99 - FIRST_PERIOD_NUMBER + 1;

/**
 * Whether an ID is a pay period ID ('YYYY-MM' with MM >= 13). Anything
 * else — calendar months, days, arbitrary strings — returns false.
 */
export function isPayPeriod(id: string): boolean {
  const match = PAY_PERIOD_ID_REGEX.exec(id);
  if (!match) {
    return false;
  }
  const mm = Number(match[2]);
  return mm >= FIRST_PERIOD_NUMBER && mm <= 99;
}

/**
 * Validates raw (e.g. preference-sourced) values into a PayPeriodConfig.
 * Returns null when the values do not describe a usable configuration —
 * callers treat that as "pay periods disabled" rather than guessing.
 */
export function validatePayPeriodConfig(raw: {
  payFrequency?: string;
  startDate?: string;
}): PayPeriodConfig | null {
  const { payFrequency, startDate } = raw;
  if (
    !payFrequency ||
    !PAY_FREQUENCIES.includes(payFrequency as PayFrequency)
  ) {
    return null;
  }
  if (!startDate || !DATE_REGEX.test(startDate)) {
    return null;
  }
  const [year, month, day] = startDate.split('-').map(Number);
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > d.getDaysInMonth(new Date(year, month - 1, 1))) {
    return null;
  }
  return { payFrequency: payFrequency as PayFrequency, startDate };
}

// Always construct local dates at noon; see the DST explanation in
// months.ts `_parse`.
function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}

function formatDay(date: Date): string {
  return d.format(date, 'yyyy-MM-dd');
}

function periodIdFor(year: number, index: number): string {
  return `${year}-${String(FIRST_PERIOD_NUMBER + index).padStart(2, '0')}`;
}

function generateCyclePeriods(
  year: number,
  refDate: Date,
  cycleDays: number,
): Array<{ start: Date; end: Date }> {
  const jan1 = new Date(year, 0, 1, 12);

  // Period starts live on a fixed lattice `refDate + k * cycleDays`.
  // Find the first start on or after Jan 1 of the target year.
  const diffDays = d.differenceInCalendarDays(jan1, refDate);
  let cursor = d.addDays(refDate, Math.ceil(diffDays / cycleDays) * cycleDays);
  // Guard against floating point / rounding surprises at the boundary.
  while (d.differenceInCalendarDays(cursor, jan1) < 0) {
    cursor = d.addDays(cursor, cycleDays);
  }
  while (d.differenceInCalendarDays(d.subDays(cursor, cycleDays), jan1) >= 0) {
    cursor = d.subDays(cursor, cycleDays);
  }

  const periods: Array<{ start: Date; end: Date }> = [];
  while (cursor.getFullYear() === year) {
    periods.push({
      start: cursor,
      end: d.subDays(d.addDays(cursor, cycleDays), 1),
    });
    cursor = d.addDays(cursor, cycleDays);
  }
  return periods;
}

function generateMonthlyPeriods(
  year: number,
  refDate: Date,
): Array<{ start: Date; end: Date }> {
  // One period per calendar month, starting on the reference day-of-month
  // (clamped to the month's length, e.g. day 31 in February → Feb 28/29).
  const dayOfMonth = refDate.getDate();

  function startFor(y: number, monthIndex: number): Date {
    const clamped = Math.min(
      dayOfMonth,
      d.getDaysInMonth(new Date(y, monthIndex, 1)),
    );
    return new Date(y, monthIndex, clamped, 12);
  }

  const periods: Array<{ start: Date; end: Date }> = [];
  for (let m = 0; m < 12; m++) {
    const start = startFor(year, m);
    const nextStart = m === 11 ? startFor(year + 1, 0) : startFor(year, m + 1);
    periods.push({ start, end: d.subDays(nextStart, 1) });
  }
  return periods;
}

// Multi-slot cache: navigation regularly alternates between adjacent
// years (e.g. rendering December + January columns), which thrashes a
// single-slot memoizer. Config changes are rare, so a small keyed cache
// with simple eviction is enough.
const periodCache = new Map<string, PayPeriod[]>();
const PERIOD_CACHE_LIMIT = 64;

/**
 * All pay periods of a calendar year. `${year}-13` is always the first
 * period whose start date falls in January of `year`; the config's
 * startDate anchors the cadence but never renumbers other years.
 */
export function generatePayPeriods(
  year: number,
  config: PayPeriodConfig,
): PayPeriod[] {
  const cacheKey = `${year}|${config.payFrequency}|${config.startDate}`;
  const cached = periodCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!validatePayPeriodConfig(config)) {
    throw new Error(
      `generatePayPeriods: invalid pay period config (frequency '${config.payFrequency}', start date '${config.startDate}')`,
    );
  }

  const refDate = parseDay(config.startDate);
  let rawPeriods: Array<{ start: Date; end: Date }>;
  switch (config.payFrequency) {
    case 'weekly':
      rawPeriods = generateCyclePeriods(year, refDate, 7);
      break;
    case 'biweekly':
      rawPeriods = generateCyclePeriods(year, refDate, 14);
      break;
    case 'monthly':
    default:
      rawPeriods = generateMonthlyPeriods(year, refDate);
      break;
  }

  if (rawPeriods.length > MAX_PERIODS_PER_YEAR) {
    throw new Error(
      `generatePayPeriods: ${rawPeriods.length} periods generated for ${year}, which exceeds the ${MAX_PERIODS_PER_YEAR} available ID slots`,
    );
  }

  const periods = rawPeriods.map((p, i) => ({
    monthId: periodIdFor(year, i),
    startDate: formatDay(p.start),
    endDate: formatDay(p.end),
  }));

  if (periodCache.size >= PERIOD_CACHE_LIMIT) {
    periodCache.clear();
  }
  periodCache.set(cacheKey, periods);
  return periods;
}

function findPeriod(
  monthId: string,
  config: PayPeriodConfig,
): PayPeriod | undefined {
  const year = Number(monthId.slice(0, 4));
  return generatePayPeriods(year, config).find(p => p.monthId === monthId);
}

/**
 * The period containing `monthId`'s start/end days, as 'yyyy-MM-dd'
 * strings. Throws when the ID doesn't exist for the given config (e.g.
 * '2026-40' under a monthly cadence, which only has periods 13-24).
 */
export function getPayPeriodBounds(
  monthId: string,
  config: PayPeriodConfig,
): { startDate: string; endDate: string } {
  const period = findPeriod(monthId, config);
  if (!period) {
    throw new Error(
      `Pay period '${monthId}' does not exist for the ${config.payFrequency} cadence starting ${config.startDate}`,
    );
  }
  return { startDate: period.startDate, endDate: period.endDate };
}

/**
 * The pay period ID containing the given date. Consecutive periods tile
 * the timeline exactly, including across year boundaries: a January date
 * can belong to the previous year's last period (e.g. a biweekly period
 * spanning Dec 27 - Jan 9 owns Jan 3).
 */
export function getPayPeriodForDate(
  date: Date,
  config: PayPeriodConfig,
): string {
  const year = date.getFullYear();
  const dateStr = formatDay(date);

  if (date.getMonth() === 0) {
    const priorPeriods = generatePayPeriods(year - 1, config);
    const lastPrior = priorPeriods[priorPeriods.length - 1];
    if (
      lastPrior &&
      dateStr >= lastPrior.startDate &&
      dateStr <= lastPrior.endDate
    ) {
      return lastPrior.monthId;
    }
  }

  const periods = generatePayPeriods(year, config);
  for (const period of periods) {
    if (dateStr >= period.startDate && dateStr <= period.endDate) {
      return period.monthId;
    }
  }

  // Unreachable for valid configs (periods tile the whole year), but a
  // deterministic fallback beats a crash deep inside budget rendering.
  return periods[0]?.monthId ?? periodIdFor(year, 0);
}

/**
 * The period after `monthId`, wrapping from a year's last period to
 * `${year + 1}-13`.
 */
export function nextPayPeriod(
  monthId: string,
  config: PayPeriodConfig,
): string {
  const year = Number(monthId.slice(0, 4));
  const mm = Number(monthId.slice(5, 7));
  const lastMm =
    FIRST_PERIOD_NUMBER + generatePayPeriods(year, config).length - 1;

  if (mm < lastMm) {
    return `${year}-${String(mm + 1).padStart(2, '0')}`;
  }
  return periodIdFor(year + 1, 0);
}

/**
 * The period before `monthId`, wrapping from `${year}-13` to the previous
 * year's last period.
 */
export function prevPayPeriod(
  monthId: string,
  config: PayPeriodConfig,
): string {
  const year = Number(monthId.slice(0, 4));
  const mm = Number(monthId.slice(5, 7));

  if (mm > FIRST_PERIOD_NUMBER) {
    return `${year}-${String(mm - 1).padStart(2, '0')}`;
  }
  const priorCount = generatePayPeriods(year - 1, config).length;
  return periodIdFor(year - 1, priorCount - 1);
}

/**
 * Adds n periods (n may be negative) to a pay period ID.
 */
export function addPayPeriods(
  monthId: string,
  n: number,
  config: PayPeriodConfig,
): string {
  let current = monthId;
  for (let i = 0; i < Math.abs(n); i++) {
    current =
      n > 0 ? nextPayPeriod(current, config) : prevPayPeriod(current, config);
  }
  return current;
}

/**
 * All period IDs from `start` to `end` inclusive. Both must be pay period
 * IDs; `start` must not be after `end`.
 */
export function payPeriodRangeInclusive(
  start: string,
  end: string,
  config: PayPeriodConfig,
): string[] {
  if (start > end) {
    return [];
  }
  const result: string[] = [];
  let current = start;
  while (current <= end) {
    result.push(current);
    if (current === end) {
      break;
    }
    current = nextPayPeriod(current, config);
  }
  return result;
}

export type PayPeriodLabelFormat = 'picker' | 'summary' | 'short';

/**
 * Human-readable label for a pay period.
 *
 * - 'picker': ultra-compact for month-picker cells — first letter of the
 *   start month plus the 1-based position among periods starting in that
 *   month, e.g. 'J1', 'J2', 'F1'.
 * - 'short': the date range, e.g. 'Jan 5 - Jan 18'.
 * - 'summary': the date range plus period number, e.g.
 *   'Jan 5 - Jan 18 (PP1)'.
 */
export function getPayPeriodLabel(
  monthId: string,
  config: PayPeriodConfig,
  format: PayPeriodLabelFormat = 'summary',
  locale?: Locale,
): string {
  const periodNumber = Number(monthId.slice(5, 7)) - FIRST_PERIOD_NUMBER + 1;
  const period = findPeriod(monthId, config);
  if (!period) {
    return `PP${periodNumber}`;
  }

  const start = parseDay(period.startDate);
  const end = parseDay(period.endDate);

  if (format === 'picker') {
    const monthLetter = d.format(start, 'MMM', { locale })[0];
    const siblings = generatePayPeriods(start.getFullYear(), config).filter(
      p => p.startDate.slice(0, 7) === period.startDate.slice(0, 7),
    );
    const position = siblings.findIndex(p => p.monthId === monthId) + 1;
    return `${monthLetter}${position}`;
  }

  const range = `${d.format(start, 'MMM d', { locale })} - ${d.format(end, 'MMM d', { locale })}`;
  if (format === 'short') {
    return range;
  }
  return `${range} (PP${periodNumber})`;
}

type DateFilter =
  | { $gte: string; $lte: string }
  | { $transform: '$month'; $eq: string };

/**
 * AQL-compatible date filter selecting the transactions belonging to a
 * budget column. Pay periods filter by the period's actual day range;
 * calendar months keep the existing `$month` transform. Centralized here
 * so drill-through and transaction lists don't hand-roll (and drift on)
 * this logic.
 */
export function getPayPeriodDateFilter(
  month: string,
  config: PayPeriodConfig | null,
): DateFilter {
  if (config && isPayPeriod(month)) {
    const { startDate, endDate } = getPayPeriodBounds(month, config);
    return { $gte: startDate, $lte: endDate };
  }
  return { $transform: '$month', $eq: month };
}
