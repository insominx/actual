import type { ByTemplate, SimpleTemplate } from '#types/models/templates';

import {
  accruedToDate,
  getAllowanceAmount,
  getByClaim,
  settleReservations,
} from './reservations';
import type { ExactClaim } from './reservations';

const insurance: ExactClaim = {
  key: 'insurance',
  kind: 'schedule',
  label: 'Insurance',
  nextDate: '2027-03-15',
  target: 120000,
  monthlyRate: 10000,
  monthsRemaining: 6,
};

function byTemplate(amount: number, month: string): ByTemplate {
  return {
    type: 'by',
    amount,
    month,
    annual: true,
    priority: 0,
    directive: 'template',
  };
}

function simpleTemplate(monthly: number): SimpleTemplate {
  return { type: 'simple', monthly, priority: 0, directive: 'template' };
}

function expectReconciles(row: ReturnType<typeof settleReservations>) {
  expect(row.reserved + row.allowance + row.spare).toBe(row.balance);
}

describe('accruedToDate', () => {
  it('accrues everything except what the remaining months still collect', () => {
    expect(accruedToDate(insurance)).toBe(60000);
  });

  it('reserves the full target when due now', () => {
    expect(accruedToDate({ ...insurance, monthsRemaining: 0 })).toBe(120000);
  });

  it('never goes below zero', () => {
    expect(accruedToDate({ ...insurance, monthsRemaining: 20 })).toBe(0);
  });
});

describe('settleReservations', () => {
  it('F1 surplus', () => {
    const row = settleReservations(120000, [insurance], 50000);
    expect(row).toEqual({
      balance: 120000,
      reserved: 60000,
      allowance: 50000,
      allowanceTotal: 50000,
      spare: 10000,
      shortfall: 0,
      claims: [
        {
          key: 'insurance',
          kind: 'schedule',
          label: 'Insurance',
          nextDate: '2027-03-15',
          target: 120000,
          accrued: 60000,
        },
      ],
    });
    expectReconciles(row);
  });

  it.each([
    { id: 'F2 deficit', balance: 40000, spare: -20000, shortfall: 20000 },
    { id: 'F3 zero', balance: 0, spare: -60000, shortfall: 60000 },
    { id: 'F4 negative', balance: -10000, spare: -70000, shortfall: 70000 },
  ])('$id', ({ balance, spare, shortfall }) => {
    const row = settleReservations(balance, [insurance], 50000);
    expect(row).toMatchObject({
      balance,
      reserved: 60000,
      allowance: 0,
      allowanceTotal: 50000,
      spare,
      shortfall,
    });
    expectReconciles(row);
  });

  it('F14 sums exact claims then rounds once', () => {
    const claim = {
      kind: 'schedule' as const,
      nextDate: '2027-04-10',
      target: 1000,
      monthlyRate: 1000 / 12,
      monthsRemaining: 7,
    };
    const row = settleReservations(
      1000,
      [
        { ...claim, key: 'a', label: 'A' },
        { ...claim, key: 'b', label: 'B' },
      ],
      0,
    );
    expect(row.reserved).toBe(833);
    expect(row.claims.map(c => c.accrued)).toEqual([417, 416]);
    expect(row.claims.reduce((sum, claim) => sum + claim.accrued, 0)).toBe(
      row.reserved,
    );
    expect(row).toMatchObject({ allowance: 0, spare: 167, shortfall: 0 });
    expectReconciles(row);
  });

  it('orders claims by next date, then label', () => {
    const row = settleReservations(
      0,
      [
        { ...insurance, key: 'c', label: 'C', nextDate: '2027-05-01' },
        { ...insurance, key: 'b', label: 'B', nextDate: '2027-01-01' },
        { ...insurance, key: 'a', label: 'A', nextDate: '2027-05-01' },
      ],
      0,
    );
    expect(row.claims.map(c => c.key)).toEqual(['b', 'a', 'c']);
  });
});

describe('getByClaim', () => {
  it.each([0.1, 1.5, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER])(
    'rejects an unsupported monthly repeat of %s',
    repeat => {
      expect(
        getByClaim(
          { ...byTemplate(600, '2026-08'), annual: false, repeat },
          '2026-09',
          'k',
          'Cat',
        ),
      ).toBeNull();
    },
  );

  it('rejects a By template without a period', () => {
    expect(
      getByClaim(
        { ...byTemplate(600, '2026-12'), annual: undefined },
        '2026-09',
        'k',
        'Cat',
      ),
    ).toBeNull();
    expect(
      getByClaim(
        { ...byTemplate(600, '2026-12'), annual: false },
        '2026-09',
        'k',
        'Cat',
      ),
    ).toBeNull();
  });

  it('rejects a By template with a spend-from month', () => {
    expect(
      getByClaim(
        { ...byTemplate(600, '2026-12'), from: '2026-01' },
        '2026-09',
        'k',
        'Cat',
      ),
    ).toBeNull();
  });

  it('uses a numeric monthly repeat as the period', () => {
    expect(
      getByClaim(
        {
          ...byTemplate(300, '2026-08'),
          annual: false,
          repeat: 3,
        },
        '2026-09',
        'k',
        'Cat',
      ),
    ).toMatchObject({
      nextDate: '2026-11-01',
      monthlyRate: 10000,
      monthsRemaining: 2,
    });
  });
});

describe('getAllowanceAmount', () => {
  it('rejects negative amounts and limits', () => {
    expect(getAllowanceAmount(simpleTemplate(-5))).toBeNull();
    expect(
      getAllowanceAmount(
        {
          ...simpleTemplate(5),
          limit: { amount: 10, hold: false, period: 'monthly' },
        },
      ),
    ).toBeNull();
  });
});