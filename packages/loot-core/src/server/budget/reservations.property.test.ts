import type { ByTemplate } from '#types/models/templates';

import { accruedToDate, getByClaim, settleReservations } from './reservations';

let seed = 424242;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const index = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
function monthOf(i: number) {
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
}

describe('reservation properties', () => {
  it('By claims roll to the first target month on or after the current one, in whole periods', () => {
    for (let n = 0; n < 2000; n++) {
      const month = monthOf(2020 * 12 + Math.floor(random() * 12 * 12));
      const templateMonth = monthOf(2015 * 12 + Math.floor(random() * 12 * 20));
      const annual = random() < 0.5;
      const repeat = 1 + Math.floor(random() * 30);
      const amount = Math.round(random() * 10000) / 100 + 0.01;
      const template = {
        type: 'by',
        amount,
        month: templateMonth,
        annual,
        repeat,
        priority: 0,
        directive: 'template',
      } as ByTemplate;
      const claim = getByClaim(template, month, 2, 'k', 'label');
      expect(claim).not.toBeNull();
      const period = annual ? repeat * 12 : repeat;
      // Reference: smallest templateMonth + k * period that is >= month.
      const start = index(templateMonth);
      const current = index(month);
      const steps =
        start >= current ? 0 : Math.ceil((current - start) / period);
      const expectedTarget = start + steps * period;
      expect(claim!.nextDate).toBe(`${monthOf(expectedTarget)}-01`);
      expect(claim!.monthsRemaining).toBe(expectedTarget - current);
      expect(claim!.target).toBe(Math.round(amount * 100));
      expect(claim!.monthlyRate).toBeCloseTo(claim!.target / period, 9);
      const accrued = accruedToDate(claim!);
      expect(accrued).toBeGreaterThanOrEqual(0);
      expect(accrued).toBeLessThanOrEqual(claim!.target);
      if (claim!.monthsRemaining === 0) {
        expect(accrued).toBe(claim!.target);
      }
    }
  });

  it('settlement always reconciles and never reserves more than the targets', () => {
    for (let n = 0; n < 2000; n++) {
      const claims = Array.from(
        { length: Math.floor(random() * 5) },
        (_, i) => {
          const target = Math.floor(random() * 500000);
          const monthsRemaining = Math.floor(random() * 24);
          return {
            key: `k${i}`,
            kind: 'by' as const,
            label: `L${Math.floor(random() * 3)}`,
            nextDate: `2027-0${1 + Math.floor(random() * 9)}-01`,
            target,
            monthlyRate: target / (1 + Math.floor(random() * 24)),
            monthsRemaining,
          };
        },
      );
      const balance = Math.floor(random() * 2_000_000) - 500000;
      const allowanceTotal = Math.floor(random() * 300000);
      const row = settleReservations(balance, claims, allowanceTotal);
      expect(row.reserved + row.allowance + row.spare).toBe(row.balance);
      expect(row.claims.reduce((sum, claim) => sum + claim.accrued, 0)).toBe(
        row.reserved,
      );
      expect(row.allowance).toBeGreaterThanOrEqual(0);
      expect(row.allowance).toBeLessThanOrEqual(allowanceTotal);
      expect(row.shortfall).toBe(Math.max(0, -row.spare));
      expect(row.reserved).toBeLessThanOrEqual(
        claims.reduce((sum, c) => sum + c.target, 0) + 1,
      );
      expect(row.claims).toHaveLength(claims.length);
    }
  });
});
