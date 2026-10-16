import type { CategoryGroupEntity } from '@actual-app/core/types/models';

import { buildExpenseSummary, getExpenseRange } from './expenseData';

let seed = 7;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const daysIn = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const groups = [
  {
    id: 'g1',
    name: 'G1',
    is_income: false,
    categories: [
      { id: 'c1', name: 'C1', is_income: false },
      { id: 'c2', name: 'C2', is_income: false },
    ],
  },
  { id: 'g2', name: 'G2', is_income: false, categories: [] },
] as unknown as CategoryGroupEntity[];

const anchors = [
  '0100-01',
  '2024-02',
  '2025-02',
  '2100-02',
  '2026-03',
  '2026-10',
  '2026-11',
  '2027-12',

  '9998-12',
];

describe('expense summary properties', () => {
  it('has one column per calendar day or month whatever the time zone', () => {
    for (const anchor of anchors) {
      const [year, month] = anchor.split('-').map(Number);
      const summary = buildExpenseSummary([], groups, 'month', anchor);
      expect(summary.columns).toHaveLength(daysIn(year, month));
      expect(summary.columns[0]).toBe(`${anchor}-01`);
      expect(summary.columns.at(-1)).toBe(
        `${anchor}-${String(daysIn(year, month)).padStart(2, '0')}`,
      );
      expect(new Set(summary.columns).size).toBe(summary.columns.length);
      const range = getExpenseRange('month', anchor);
      expect(range.start).toBe(`${anchor}-01`);
      expect(range.endExclusive > summary.columns.at(-1)!).toBe(true);
    }
    for (const year of ['2024', '2026', '0100', '9998']) {
      expect(
        buildExpenseSummary([], groups, 'year', year).columns,
      ).toHaveLength(12);
    }
  });

  it('counts every in-range leaf exactly once and nothing outside the range', () => {
    for (let n = 0; n < 300; n++) {
      const anchor = anchors[1 + Math.floor(random() * 6)];
      const period = random() < 0.5 ? 'month' : 'year';
      const key = period === 'year' ? anchor.slice(0, 4) : anchor;
      const range = getExpenseRange(period, key);
      const leaves = Array.from({ length: 40 }, (_, i) => {
        const base = Date.parse(range.start) / 86400000;
        const day = Math.floor(random() * 800) - 200;
        return {
          id: `t${i}`,
          date: new Date((base + day) * 86400000).toISOString().slice(0, 10),
          categoryId: [null, 'c1', 'c2', 'gone'][Math.floor(random() * 4)],
          spending: Math.floor(random() * 20000) - 5000,
        };
      });
      const inRange = leaves.filter(
        l => l.date >= range.start && l.date < range.endExclusive,
      );
      const summary = buildExpenseSummary(leaves, groups, period, key);
      const expected = inRange.reduce((sum, l) => sum + l.spending, 0);
      expect(summary.total.total).toBe(expected);
      const columnSum = Object.values(summary.total.columns).reduce(
        (a, b) => a + b,
        0,
      );
      expect(columnSum).toBe(expected);
      const groupSum = summary.groups.reduce((s, g) => s + g.total, 0);
      expect(groupSum + summary.uncategorized.total).toBe(expected);
      for (const group of summary.groups) {
        expect(group.categories.reduce((s, c) => s + c.total, 0)).toBe(
          group.total,
        );
      }
    }
  });
});
