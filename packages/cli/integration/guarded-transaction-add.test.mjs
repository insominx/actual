import assert from 'node:assert/strict';

import {
  assertRawEffect,
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

// Packaged proof for guarded transaction addition (D58).

async function setup(f) {
  const result = await f.cli(
    ['accounts', 'create', '--name', 'Addition account'],
    { version: '1' },
  );
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return { account: (parsed.data ?? parsed).id };
}

function verifyAdded(before, after, notes, expectedIds) {
  const rows = createdRows(before, after, 'transactions');
  assert.deepEqual(
    rows.map(row => row.notes).sort((a, b) => a.localeCompare(b)),
    [...notes].sort((a, b) => a.localeCompare(b)),
  );
  for (const row of rows) {
    assert.equal(row.tombstone, 0);
    assert.equal(row.transferred_id, null);
  }
  const ids = rows.map(row => row.id).sort((a, b) => a.localeCompare(b));
  if (expectedIds) {
    assert.deepEqual(
      [...expectedIds].sort((a, b) => a.localeCompare(b)),
      ids,
    );
  }
  assertRawEffect(before, after, expected => {
    expected.transactions.push(...rows);
  });
  return ids;
}

const addition = {
  operation: 'transactions.add',
  label: 'transaction addition',
  setup,
  target: (_f, ctx) => ctx.account,
  data: () => [
    { date: '2026-10-02', amount: -1250, notes: 'guarded add one' },
    { date: '2026-10-03', amount: 4000, notes: 'guarded add two' },
  ],
  otherData: () => [{ date: '2026-10-04', amount: -1, notes: 'other' }],
  verify(before, after, { outcome }) {
    const ids = verifyAdded(
      before,
      after,
      ['guarded add one', 'guarded add two'],
      outcome?.transactionAddition?.transactionIds,
    );
    if (outcome) {
      assert.deepEqual(
        [...outcome.affectedIds].sort((a, b) => a.localeCompare(b)),
        ids,
      );
    }
  },
  direct: (_f, ctx) => ({
    args: [
      'transactions',
      'add',
      '--account',
      ctx.account,
      '--data',
      JSON.stringify([
        { date: '2026-10-05', amount: -75, notes: 'direct add' },
      ]),
    ],
    verify(before, after, result) {
      assert.deepEqual(verifyAdded(before, after, ['direct add']), result.ids);
    },
  }),
  laterEdit: (_f, _ctx, outcome) => [
    'transactions',
    'update',
    outcome.transactionAddition.transactionIds[0],
    '--data',
    '{"notes":"later edit"}',
  ],
  independent: (_f, ctx) => ({
    args: [
      'transactions',
      'list',
      '--account',
      ctx.account,
      '--start',
      '2026-10-01',
      '--end',
      '2026-10-31',
    ],
    check(rows) {
      assert.ok(rows.some(row => row.notes === 'guarded add two'));
    },
  }),
};

guardedRegularCases(addition);
guardedInterruptionCases(addition);
