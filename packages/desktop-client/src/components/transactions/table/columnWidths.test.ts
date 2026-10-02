import { describe, expect, it } from 'vitest';

import {
  clampColumnWidth,
  patchViewWidths,
  projectViewWidths,
  removeViewWidths,
  resolveTextColumnStyle,
  tableMinWidth,
} from './columnWidths';

const amountColumnWidths = { amount: 100, balance: 103 };

describe('clampColumnWidth', () => {
  it('clamps to 80-1200 and rounds fractional widths', () => {
    expect(clampColumnWidth(10)).toBe(80);
    expect(clampColumnWidth(5000)).toBe(1200);
    expect(clampColumnWidth(240.4)).toBe(240);
    expect(clampColumnWidth(240.5)).toBe(241);
    expect(clampColumnWidth(79.6)).toBe(80);
    expect(clampColumnWidth(1200.4)).toBe(1200);
  });
});

describe('projectViewWidths', () => {
  it('keeps only finite numbers for known text columns', () => {
    const raw = {
      acct: {
        payee: 240.6,
        notes: 'Infinity',
        category: '1e999',
        account: Number.NaN,
        group: [300],
        date: 300,
        payment: 400,
        extra: 500,
      },
    };
    expect(projectViewWidths(raw, 'acct')).toEqual({ payee: 241 });
  });

  it('drops nested objects and clamps out-of-range values', () => {
    const raw = {
      acct: { payee: { width: 240 }, notes: 10, category: 99999 },
    };
    expect(projectViewWidths(raw, 'acct')).toEqual({
      notes: 80,
      category: 1200,
    });
  });

  it('returns an empty projection for missing or malformed data', () => {
    expect(projectViewWidths(undefined, 'acct')).toEqual({});
    expect(projectViewWidths('nope', 'acct')).toEqual({});
    expect(projectViewWidths([{ payee: 200 }], '0')).toEqual({});
    expect(projectViewWidths({ acct: [200] }, 'acct')).toEqual({});
    expect(projectViewWidths({ other: { payee: 200 } }, 'acct')).toEqual({});
  });
});

describe('resolveTextColumnStyle', () => {
  it('stays flexible when no width is set', () => {
    expect(resolveTextColumnStyle('payee', {})).toEqual({ width: 'flex' });
    expect(resolveTextColumnStyle('payee', undefined)).toEqual({
      width: 'flex',
    });
  });

  it('returns a fixed fragment when a width is set', () => {
    expect(resolveTextColumnStyle('payee', { payee: 240 })).toEqual({
      width: 240,
      style: { flexGrow: 0, flexShrink: 0, flexBasis: 240, width: 240 },
    });
  });
});

describe('tableMinWidth', () => {
  const columns = [
    'date',
    'account',
    'payee',
    'notes',
    'category',
    'payment',
    'deposit',
    'balance',
    'cleared',
  ] as const;

  it('is undefined without any visible override', () => {
    expect(
      tableMinWidth({
        columns,
        widths: {},
        amountColumnWidths,
        scrollWidth: 15,
      }),
    ).toBeUndefined();
    expect(
      tableMinWidth({
        columns: ['date', 'payee'],
        widths: { notes: 300 },
        amountColumnWidths,
        scrollWidth: 15,
      }),
    ).toBeUndefined();
  });

  it('sums selection, fixed, amount, override and unset widths plus padding', () => {
    const width = tableMinWidth({
      columns,
      widths: { payee: 240 },
      amountColumnWidths,
      scrollWidth: 15,
    });
    // selection 20 + date 110 + account 80 + payee 240 + notes 80
    // + category 80 + payment 100 + deposit 100 + balance 103 + cleared 38
    // + trailing 5 + scrollbar 15
    expect(width).toBe(
      20 + 110 + 80 + 240 + 80 + 80 + 100 + 100 + 103 + 38 + 5 + 15,
    );
  });
});

describe('patchViewWidths', () => {
  it('keeps other views and unknown column keys', () => {
    const prev = {
      other: { payee: 300 },
      acct: { notes: 200, future: 123 },
      junk: 'kept',
    };
    expect(patchViewWidths(prev, 'acct', 'payee', 240.4)).toEqual({
      other: { payee: 300 },
      acct: { notes: 200, future: 123, payee: 240 },
      junk: 'kept',
    });
    expect(prev.acct).toEqual({ notes: 200, future: 123 });
  });

  it('deletes a column with null and removes an empty view entry', () => {
    const prev = { acct: { payee: 240 }, other: { notes: 100 } };
    expect(patchViewWidths(prev, 'acct', 'payee', null)).toEqual({
      other: { notes: 100 },
    });
  });

  it('starts fresh from malformed stored values', () => {
    expect(patchViewWidths('corrupt', 'acct', 'payee', 5000)).toEqual({
      acct: { payee: 1200 },
    });
    expect(patchViewWidths({ acct: [1] }, 'acct', 'payee', 90)).toEqual({
      acct: { payee: 90 },
    });
  });
});

describe('removeViewWidths', () => {
  it('removes only the given view', () => {
    expect(
      removeViewWidths({ acct: { payee: 240 }, other: { x: 1 } }, 'acct'),
    ).toEqual({ other: { x: 1 } });
  });
});
