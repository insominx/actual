import {
  calendarMonths,
  cashPlanningChart,
  dateAfterMonths,
  maxForecastEndDate,
  nextPlanningDay,
  projectCashPlanning,
} from './cash-planning';

let seed = 20261016;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)];
}
function randomDate() {
  // Bias towards month ends, leap days and year boundaries.
  const year = pick([1999, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2100]);
  const month = 1 + Math.floor(random() * 12);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = pick([
    1,
    2,
    28,
    29,
    30,
    31,
    last,
    last - 1,
    1 + Math.floor(random() * last),
  ]);
  return new Date(Date.UTC(year, month - 1, Math.min(day, last)))
    .toISOString()
    .slice(0, 10);
}

describe('cash planning calendar math properties', () => {
  it('calendarMonths is additive across any split point', () => {
    for (let i = 0; i < 400; i++) {
      const a = randomDate();
      const c = new Date(Date.parse(a) + Math.floor(random() * 900) * 86400000)
        .toISOString()
        .slice(0, 10);
      const b = new Date(
        Date.parse(a) +
          Math.floor(random() * ((Date.parse(c) - Date.parse(a)) / 86400000)) *
            86400000,
      )
        .toISOString()
        .slice(0, 10);
      if (b >= c) {
        continue;
      }
      const whole = calendarMonths(a, c);
      const parts =
        calendarMonths(a, b) + calendarMonths(nextPlanningDay(b), c);
      expect(Math.abs(whole - parts)).toBeLessThan(1e-9);
    }
  });

  it('dateAfterMonths is the earliest date that covers the requested months', () => {
    for (let i = 0; i < 400; i++) {
      const asOf = randomDate();
      const months = random() * 40;
      const date = dateAfterMonths(asOf, months);
      expect(date).not.toBeNull();
      const covered = calendarMonths(nextPlanningDay(asOf), date as string);
      expect(covered).toBeGreaterThanOrEqual(months - 1e-9);
      const before = new Date(Date.parse(date as string) - 86400000)
        .toISOString()
        .slice(0, 10);
      if (before > asOf) {
        expect(calendarMonths(nextPlanningDay(asOf), before)).toBeLessThan(
          months + 1e-9,
        );
      }
    }
  });

  it('chart points are strictly increasing, end at the forecast end, and are linear in months', () => {
    for (let i = 0; i < 100; i++) {
      const asOf = randomDate();
      const summary = {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        asOf,
        balance: Math.floor(random() * 2_000_000) - 500_000,
        monthlyIncome: Math.floor(random() * 500_000),
        monthlyOutflow: Math.floor(random() * 500_000),
        monthlyExternalMovement: Math.floor(random() * 20_000) - 10_000,
        categories: [],
      } as never;
      const forecastEndDate = dateAfterMonths(
        asOf,
        1 + random() * 30,
      ) as string;
      const config = {
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        categoryTargets: {},
        forecastEndDate,
      };
      const chart = cashPlanningChart(summary, config);
      expect(chart[0].date).toBe(asOf);
      expect(chart.at(-1)?.date).toBe(forecastEndDate);
      const projection = projectCashPlanning(summary, config, false);
      for (let k = 1; k < chart.length; k++) {
        expect(chart[k].date > chart[k - 1].date).toBe(true);
        const months = calendarMonths(nextPlanningDay(asOf), chart[k].date);
        expect(
          Math.abs(
            chart[k].historical -
              ((summary as { balance: number }).balance +
                projection.monthlySurplus * months),
          ),
        ).toBeLessThan(1e-6);
      }
    }
  });

  it('keeps maxForecastEndDate a real date after the as-of date', () => {
    for (let i = 0; i < 200; i++) {
      const asOf = randomDate();
      const end = maxForecastEndDate(asOf);
      expect(end > asOf).toBe(true);
      expect(new Date(end).toISOString().slice(0, 10)).toBe(end);
    }
  });
});
