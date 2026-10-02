import { act, renderHook } from '@testing-library/react';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTransactionColumnWidths } from './useTransactionColumnWidths';

let mockBudgetId: string | undefined = 'budget-1';

vi.mock('./useMetadataPref', () => ({
  useMetadataPref: () => [mockBudgetId, vi.fn()],
}));

const KEY = 'budget-1-transaction-table-widths';

let setItemSpy: MockInstance<Storage['setItem']>;

function seed(value: unknown) {
  localStorage.setItem(
    KEY,
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

function stored(key = KEY) {
  const raw = localStorage.getItem(key);
  return raw == null ? null : JSON.parse(raw);
}

function setItemCalls(key = KEY) {
  return setItemSpy.mock.calls.filter(([k]) => k === key).length;
}

function renderWidths(viewId = 'acct-a') {
  return renderHook(({ viewId }) => useTransactionColumnWidths(viewId), {
    initialProps: { viewId },
  });
}

beforeEach(() => {
  localStorage.clear();
  mockBudgetId = 'budget-1';
  setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
  setItemSpy.mockRestore();
  localStorage.clear();
});

describe('useTransactionColumnWidths', () => {
  it('merges a commit into the latest stored map and keeps other views', () => {
    const { result } = renderWidths('acct-a');

    // Another tab writes after this hook mounted
    seed({ 'acct-b': { notes: 300 } });

    act(() => result.current.commitWidth('acct-a', 'payee', 240));

    expect(stored()).toEqual({
      'acct-a': { payee: 240 },
      'acct-b': { notes: 300 },
    });
    expect(result.current.widths).toEqual({ payee: 240 });
    expect(result.current.hasCustomWidths).toBe(true);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['an array', '[1,2,3]'],
    ['a string', '"hello"'],
  ])('falls back to empty widths for %s without writing', (_, raw) => {
    seed(raw);
    setItemSpy.mockClear();

    const { result } = renderWidths('acct-a');

    expect(result.current.widths).toEqual({});
    expect(result.current.hasCustomWidths).toBe(false);
    expect(setItemCalls()).toBe(0);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('projects only valid numbers and never writes on mount', () => {
    seed({
      'acct-a': { payee: 'Infinity', notes: 250, category: '1e999' },
    });
    setItemSpy.mockClear();

    const { result } = renderWidths('acct-a');

    expect(result.current.widths).toEqual({ notes: 250 });
    expect(setItemCalls()).toBe(0);
  });

  it('never writes without a budget id', () => {
    mockBudgetId = undefined;
    const { result } = renderWidths('acct-a');

    act(() => result.current.commitWidth('acct-a', 'payee', 240));
    act(() => result.current.resetWidths('acct-a'));

    expect(localStorage.getItem('undefined-transaction-table-widths')).toBe(
      null,
    );
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(result.current.widths).toEqual({});
  });

  it('ignores a commit for a stale view key', () => {
    const { result, rerender } = renderWidths('acct-a');

    rerender({ viewId: 'acct-b' });
    act(() => result.current.commitWidth('acct-a', 'payee', 240));
    act(() => result.current.resetWidths('acct-a'));

    expect(setItemCalls()).toBe(0);
  });

  it('resets only the active view and skips the write when there is nothing to reset', () => {
    seed({ 'acct-a': { payee: 240 }, 'acct-b': { notes: 300 } });
    setItemSpy.mockClear();

    const { result, rerender } = renderWidths('acct-a');
    act(() => result.current.resetWidths('acct-a'));

    expect(stored()).toEqual({ 'acct-b': { notes: 300 } });
    expect(result.current.widths).toEqual({});
    expect(setItemCalls()).toBe(1);

    rerender({ viewId: 'acct-c' });
    act(() => result.current.resetWidths('acct-c'));
    expect(setItemCalls()).toBe(1);
  });

  it('skips writing a value equal to the current width', () => {
    seed({ 'acct-a': { payee: 240 } });
    setItemSpy.mockClear();

    const { result } = renderWidths('acct-a');
    act(() => result.current.commitWidth('acct-a', 'payee', 240));
    act(() => result.current.commitWidth('acct-a', 'payee', 240.2));
    act(() => result.current.commitWidth('acct-a', 'notes', null));

    expect(setItemCalls()).toBe(0);
  });

  it('keeps unknown column keys and unknown view ids across commits', () => {
    seed({
      'acct-a': { payee: 200, futureColumn: 123 },
      'some-future-view': { payee: 999, extra: true },
    });

    const { result } = renderWidths('acct-a');
    act(() => result.current.commitWidth('acct-a', 'notes', 300));
    act(() => result.current.commitWidth('acct-a', 'payee', null));

    expect(stored()).toEqual({
      'acct-a': { futureColumn: 123, notes: 300 },
      'some-future-view': { payee: 999, extra: true },
    });
  });

  it('picks up widths written by another tab', () => {
    seed({ 'acct-a': { payee: 200 }, 'acct-b': { notes: 150 } });
    const { result } = renderWidths('acct-a');
    expect(result.current.widths).toEqual({ payee: 200 });

    act(() => {
      seed({ 'acct-a': { payee: 400 }, 'acct-b': { notes: 150 } });
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(result.current.widths).toEqual({ payee: 400 });

    act(() => result.current.commitWidth('acct-a', 'category', 180));
    expect(stored()).toEqual({
      'acct-a': { payee: 400, category: 180 },
      'acct-b': { notes: 150 },
    });
  });
});
