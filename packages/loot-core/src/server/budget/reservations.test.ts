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

function byClaim(...args: Parameters<typeof getByClaim>): ExactClaim {
  const claim = getByClaim(...args);
  if (!claim) {
    throw new Error('Expected a By claim');
  }
  return claim;
}

function allowanceAmount(...args: Parameters<typeof getAllowanceAmount>) {
  const amount = getAllowanceAmount(...args);
  if (amount === null) {
    throw new Error('Expected an allowance');
  }
  return amount;
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
    expect(row.claims.map(c => c.accrued)).toEqual([417, 417]);
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

describe('F15 0-decimal currency', () => {
  it('reconciles a JPY category', () => {
    const allowance = allowanceAmount(simpleTemplate(5000), 0);
    const claim = byClaim(
      byTemplate(12000, '2026-12'),
      '2026-09',
      0,
      'cat:1',
      'Cat',
    );
    expect(claim).toMatchObject({
      target: 12000,
      monthlyRate: 1000,
      monthsRemaining: 3,
    });
    const row = settleReservations(20000, [claim], allowance);
    expect(row).toMatchObject({
      reserved: 9000,
      allowanceTotal: 5000,
      allowance: 5000,
      spare: 6000,
    });
    expectReconciles(row);
  });
});

describe('F16 synthetic 3-decimal currency', () => {
  it('keeps the exact accrual and rounds the total', () => {
    const claim = byClaim(
      byTemplate(12.345, '2026-12'),
      '2026-09',
      3,
      'cat:0',
      'Cat',
    );
    expect(claim).toMatchObject({
      target: 12345,
      monthlyRate: 1028.75,
      monthsRemaining: 3,
    });
    expect(accruedToDate(claim)).toBe(9258.75);
    const row = settleReservations(10000, [claim], 0);
    expect(row).toMatchObject({ reserved: 9259, allowance: 0, spare: 741 });
    expectReconciles(row);
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
          2,
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
        2,
        'k',
        'Cat',
      ),
    ).toBeNull();
    expect(
      getByClaim(
        { ...byTemplate(600, '2026-12'), annual: false },
        '2026-09',
        2,
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
        2,
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
        2,
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
    expect(getAllowanceAmount(simpleTemplate(-5), 2)).toBeNull();
    expect(
      getAllowanceAmount(
        {
          ...simpleTemplate(5),
          limit: { amount: 10, hold: false, period: 'monthly' },
        },
        2,
      ),
    ).toBeNull();
  });
});
