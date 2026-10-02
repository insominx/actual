import type {
  CashPlanningConfig,
  CashPlanningProjection,
  CashPlanningSummary,
} from '#types/models/cash-planning';

const DAY = 86400000;
export const UNCATEGORIZED_ID = '__cash_planning_uncategorized__';

export function isPlanningDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '0100-01-01' &&
    value <= '9999-12-31' &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function nextPlanningDay(date: string): string {
  return new Date(Date.parse(date) + DAY).toISOString().slice(0, 10);
}

function monthEnd(date: string): string {
  const parsed = new Date(date);
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10);
}

// Inclusive calendar days, independent of daylight saving time.
export function calendarMonths(start: string, end: string): number {
  if (!isPlanningDate(start) || !isPlanningDate(end) || start > end) {
    throw new Error('Invalid cash planning date range');
  }
  let months = 0;
  let cursor = start;
  while (cursor <= end) {
    const last = monthEnd(cursor);
    const stop = last < end ? last : end;
    const days = (Date.parse(stop) - Date.parse(cursor)) / DAY + 1;
    months += days / Number(last.slice(8));
    if (stop === end) {
      break;
    }
    cursor = nextPlanningDay(stop);
  }
  return months;
}

// The earliest end-of-day date with at least the requested calendar-month fraction.
export function dateAfterMonths(asOf: string, months: number): string | null {
  if (!Number.isFinite(months) || months < 0) {
    return null;
  }
  if (months === 0) {
    return asOf;
  }
  let remaining = months;
  let cursor = nextPlanningDay(asOf);
  while (cursor <= '9999-12-31') {
    const last = monthEnd(cursor);
    const daysInMonth = Number(last.slice(8));
    const availableDays = (Date.parse(last) - Date.parse(cursor)) / DAY + 1;
    const fraction = availableDays / daysInMonth;
    if (remaining <= fraction + 1e-10) {
      const days = Math.max(1, Math.ceil(remaining * daysInMonth - 1e-10));
      return new Date(Date.parse(cursor) + (days - 1) * DAY)
        .toISOString()
        .slice(0, 10);
    }
    remaining -= fraction;
    if (last === '9999-12-31') {
      return null;
    }
    cursor = nextPlanningDay(last);
  }
  return null;
}

export function completePlanningMonths(asOf: string, count = 3) {
  const date = new Date(asOf);
  return {
    startDate: new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count, 1),
    )
      .toISOString()
      .slice(0, 10),
    endDate: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0))
      .toISOString()
      .slice(0, 10),
  };
}

export function defaultCashPlanningConfig(asOf: string): CashPlanningConfig {
  return { ...completePlanningMonths(asOf), categoryTargets: {} };
}

export function parseCashPlanningConfig(
  value: string | undefined,
  asOf: string,
): CashPlanningConfig {
  const fallback = defaultCashPlanningConfig(asOf);
  if (!value) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }
    const config = parsed as Partial<CashPlanningConfig>;
    if (
      !config.startDate ||
      !config.endDate ||
      !isPlanningDate(config.startDate) ||
      !isPlanningDate(config.endDate) ||
      config.startDate > config.endDate ||
      config.endDate > asOf
    ) {
      return fallback;
    }
    const targets = Object.fromEntries(
      Object.entries(config.categoryTargets ?? {}).filter(
        ([, amount]) =>
          typeof amount === 'number' && Number.isFinite(amount) && amount >= 0,
      ),
    );
    const goal =
      config.goal &&
      Number.isFinite(config.goal.balance) &&
      (!config.goal.deadline || isPlanningDate(config.goal.deadline))
        ? config.goal
        : undefined;
    return {
      startDate: config.startDate,
      endDate: config.endDate,
      categoryTargets: targets,
      goal,
      forecastEndDate:
        config.forecastEndDate &&
        isPlanningDate(config.forecastEndDate) &&
        config.forecastEndDate > asOf
          ? config.forecastEndDate
          : undefined,
    };
  } catch {
    return fallback;
  }
}

export function projectCashPlanning(
  summary: CashPlanningSummary,
  config: CashPlanningConfig,
  useTargets: boolean,
): CashPlanningProjection {
  const monthlyOutflow = useTargets
    ? summary.categories.reduce(
        (sum, category) =>
          sum +
          (category.available
            ? (config.categoryTargets[category.id] ?? category.monthlyOutflow)
            : category.monthlyOutflow),
        0,
      )
    : summary.monthlyOutflow;
  const monthlySurplus =
    summary.monthlyIncome - monthlyOutflow + summary.monthlyExternalMovement;
  const remaining = config.goal
    ? Math.max(0, config.goal.balance - summary.balance)
    : null;
  const goalState =
    remaining === null
      ? 'none'
      : remaining === 0
        ? 'reached'
        : monthlySurplus > 0
          ? 'reachable'
          : 'unreachable';
  let deadline: CashPlanningProjection['deadline'] = null;
  if (config.goal?.deadline) {
    const months =
      config.goal.deadline > summary.asOf
        ? calendarMonths(nextPlanningDay(summary.asOf), config.goal.deadline)
        : 0;
    const requiredSurplus =
      months > 0 ? (config.goal.balance - summary.balance) / months : null;
    deadline = {
      requiredSurplus,
      maximumOutflow:
        requiredSurplus === null
          ? null
          : summary.monthlyIncome +
            summary.monthlyExternalMovement -
            requiredSurplus,
      surplusGap:
        requiredSurplus === null ? null : monthlySurplus - requiredSurplus,
      balanceGap:
        summary.balance + monthlySurplus * months - config.goal.balance,
    };
  }
  return {
    monthlyOutflow,
    monthlySurplus,
    remaining,
    goalState,
    completionDate:
      goalState === 'reached'
        ? summary.asOf
        : goalState === 'reachable'
          ? dateAfterMonths(summary.asOf, (remaining ?? 0) / monthlySurplus)
          : null,
    depletionDate:
      summary.balance <= 0
        ? summary.asOf
        : monthlySurplus < 0
          ? dateAfterMonths(summary.asOf, summary.balance / -monthlySurplus)
          : null,
    deadline,
  };
}

export function cashPlanningChart(
  summary: CashPlanningSummary,
  config: CashPlanningConfig,
) {
  const end = config.forecastEndDate ?? dateAfterMonths(summary.asOf, 12);
  if (!end || end <= summary.asOf) {
    return [];
  }
  const historical = projectCashPlanning(summary, config, false);
  const targets = projectCashPlanning(summary, config, true);
  const points = [
    {
      date: summary.asOf,
      historical: summary.balance,
      targets: summary.balance,
    },
  ];
  let cursor = nextPlanningDay(summary.asOf);
  while (cursor <= end) {
    const last = monthEnd(cursor);
    const date: string = last < end ? last : end;
    const months = calendarMonths(nextPlanningDay(summary.asOf), date);
    points.push({
      date,
      historical: summary.balance + historical.monthlySurplus * months,
      targets: summary.balance + targets.monthlySurplus * months,
    });
    if (date === end) {
      break;
    }
    cursor = nextPlanningDay(date);
  }
  return points;
}
