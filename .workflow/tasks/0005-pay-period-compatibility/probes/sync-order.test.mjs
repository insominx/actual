// P09: pure operation-order model of the fork's sync surface. Every result is
// `model-evidence`, never sync proof. No vendored, server or sync imports.
//
// Modeled facts (source anchors in compatibility.md P09):
// - Actual's CRDT merges per (dataset, row, column) cell, last-writer-wins by
//   HLC timestamp; there is no cross-cell transaction or conflict channel.
// - The fork's cadence is four independent `preferences` rows
//   (`flags.payPeriodsEnabled`, `showPayPeriods`, `payPeriodFrequency`,
//   `payPeriodStartDate`); allocations are `zero_budgets` rows keyed by the
//   ordinal period id (`202614-<category>`), with no cadence stamp.
// - Period date ranges below are fixture values pinned by the
//   "fixture ranges" test in date-ranges.test.mjs (vendored source).
//
// Run from repo root:
//   node --test ".workflow/tasks/0005-pay-period-compatibility/probes/*.test.mjs"
import assert from 'node:assert/strict';
import { test } from 'node:test';

const RANGES = {
  'weekly|2026-01-02': {
    '2026-13': ['2026-01-02', '2026-01-08'],
    '2026-14': ['2026-01-09', '2026-01-15'],
  },
  'monthly|2026-01-02': {
    '2026-13': ['2026-01-02', '2026-02-01'],
    '2026-14': ['2026-02-02', '2026-03-01'],
  },
};

function cellKey(m) {
  return `${m.dataset}|${m.row}|${m.column}`;
}

function applyAll(messages) {
  const cells = new Map();
  for (const m of messages) {
    const existing = cells.get(cellKey(m));
    if (!existing || m.timestamp > existing.timestamp) {
      cells.set(cellKey(m), { value: m.value, timestamp: m.timestamp });
    }
  }
  return cells;
}

function snapshot(cells) {
  return Object.fromEntries(
    [...cells]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, v.value]),
  );
}

function pref(id, value, timestamp) {
  return { dataset: 'preferences', row: id, column: 'value', value, timestamp };
}

function budget(periodId, category, amount, timestamp) {
  const row = `${periodId.replace('-', '')}-${category}`;
  return [
    {
      dataset: 'zero_budgets',
      row,
      column: 'month',
      value: Number(periodId.replace('-', '')),
      timestamp,
    },
    {
      dataset: 'zero_budgets',
      row,
      column: 'category',
      value: category,
      timestamp,
    },
    {
      dataset: 'zero_budgets',
      row,
      column: 'amount',
      value: amount,
      timestamp,
    },
  ];
}

function rangeOf(cells, periodId) {
  const freq = cells.get('preferences|payPeriodFrequency|value')?.value;
  const start = cells.get('preferences|payPeriodStartDate|value')?.value;
  return RANGES[`${freq}|${start}`]?.[periodId] ?? null;
}

// HLC timestamps (string-ordered, as in Actual): millis-counter-node.
const T0 = '2026-01-01T00:00:00.000Z-0000-base000000000000';
const T1 = '2026-01-10T09:00:00.000Z-0000-clientB000000000';
const T2 = '2026-01-10T09:00:05.000Z-0000-clientA000000000';

const base = [
  pref('flags.payPeriodsEnabled', 'true', T0),
  pref('showPayPeriods', 'true', T0),
  pref('payPeriodFrequency', 'weekly', T0),
  pref('payPeriodStartDate', '2026-01-02', T0),
];
// Client B, still on weekly, budgets the Jan 9–15 paycheck.
const writeB = budget('2026-14', 'food', 10000, T1);
// Client A, offline and concurrent, switches cadence to monthly.
const writeA = [pref('payPeriodFrequency', 'monthly', T2)];
const intendedRange = ['2026-01-09', '2026-01-15'];

test('P09 A→B, B→A and replay converge to identical cells', () => {
  const aThenB = applyAll([...base, ...writeA, ...writeB]);
  const bThenA = applyAll([...base, ...writeB, ...writeA]);
  const replay = applyAll([
    ...base,
    ...writeB,
    ...writeA,
    ...writeA,
    ...writeB,
    ...base,
  ]);
  assert.deepEqual(snapshot(aThenB), snapshot(bThenA));
  assert.deepEqual(snapshot(replay), snapshot(aThenB));
  assert.equal(aThenB.get('zero_budgets|202614-food|amount').value, 10000);
  assert.equal(
    aThenB.get('preferences|payPeriodFrequency|value').value,
    'monthly',
  );
});

test('P09 converged state loses the range K denoted when B wrote; no conflict surfaced', () => {
  for (const order of [
    [...base, ...writeA, ...writeB],
    [...base, ...writeB, ...writeA],
  ]) {
    const cells = applyAll(order);
    const converged = rangeOf(cells, '2026-14');
    assert.deepEqual(converged, ['2026-02-02', '2026-03-01']);
    assert.notDeepEqual(converged, intendedRange);
    // The only outputs of a merge are cell values; nothing records that
    // 202614-food was written under a different cadence.
    const conflictCells = [...cells.keys()].filter(k => k.includes('conflict'));
    assert.deepEqual(conflictCells, []);
  }
});

test('P09 B writes after A (timestamp order reversed): same loss', () => {
  const lateB = budget(
    '2026-14',
    'food',
    10000,
    '2026-01-10T09:00:09.000Z-0000-clientB000000000',
  );
  const cells = applyAll([...base, ...writeA, ...lateB]);
  assert.deepEqual(rangeOf(cells, '2026-14'), ['2026-02-02', '2026-03-01']);
});

test('P09 variant: concurrent frequency and start-date edits merge into a config neither client chose', () => {
  const editA = [pref('payPeriodFrequency', 'monthly', T2)];
  const editB = [pref('payPeriodStartDate', '2026-01-09', T1)];
  const cells = applyAll([...base, ...editA, ...editB]);
  const merged = {
    payFrequency: cells.get('preferences|payPeriodFrequency|value').value,
    startDate: cells.get('preferences|payPeriodStartDate|value').value,
  };
  const chosenByA = { payFrequency: 'monthly', startDate: '2026-01-02' };
  const chosenByB = { payFrequency: 'weekly', startDate: '2026-01-09' };
  assert.deepEqual(merged, {
    payFrequency: 'monthly',
    startDate: '2026-01-09',
  });
  assert.notDeepEqual(merged, chosenByA);
  assert.notDeepEqual(merged, chosenByB);
});
