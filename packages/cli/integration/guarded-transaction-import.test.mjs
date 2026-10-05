import assert from 'node:assert/strict';

import {
  assertRawEffect,
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

// Packaged proof for guarded transaction import (D59).

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

function listArgs(account) {
  return [
    'transactions',
    'list',
    '--account',
    account,
    '--start',
    '2026-10-01',
    '--end',
    '2026-10-31',
  ];
}

async function setup(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Import account'])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify([
      { date: '2026-10-02', amount: -1250, imported_id: 'bank-1' },
    ]),
  ]);
  const [existing] = await legacy(f, listArgs(account));
  return { account, existing: existing.id };
}

function verifyImported(before, after, { notes, matched }) {
  const rows = createdRows(before, after, 'transactions');
  assert.deepEqual(
    rows.map(row => row.notes),
    notes,
  );
  assertRawEffect(before, after, expected => {
    if (matched) {
      const row = expected.transactions.find(
        candidate => candidate.id === matched.id,
      );
      assert.ok(row, 'matched transaction exists');
      row.notes = matched.notes;
    }
    expected.transactions.push(...rows);
  });
  return rows.map(row => row.id);
}

const importing = {
  operation: 'transactions.import',
  label: 'transaction import',
  setup,
  target: (_f, ctx) => ctx.account,
  data: () => [
    {
      date: '2026-10-02',
      amount: -1250,
      imported_id: 'bank-1',
      notes: 'matched import',
    },
    {
      date: '2026-10-04',
      amount: -300,
      imported_id: 'bank-2',
      notes: 'imported new',
    },
  ],
  otherData: () => [{ date: '2026-10-05', amount: -1, imported_id: 'other' }],
  verify(before, after, { outcome, ctx }) {
    const added = verifyImported(before, after, {
      notes: ['imported new'],
      matched: { id: ctx.existing, notes: 'matched import' },
    });
    if (outcome) {
      assert.deepEqual(outcome.transactionImport, {
        addedIds: added,
        updatedIds: [ctx.existing],
      });
      assert.deepEqual(outcome.affectedIds, [...added, ctx.existing]);
    }
  },
  direct: (_f, ctx) => ({
    args: [
      'transactions',
      'import',
      '--account',
      ctx.account,
      '--data',
      JSON.stringify([
        {
          date: '2026-10-06',
          amount: -75,
          imported_id: 'bank-3',
          notes: 'direct import',
        },
      ]),
    ],
    verify(before, after, result) {
      assert.deepEqual(
        verifyImported(before, after, { notes: ['direct import'] }),
        result.addedIds,
      );
      assert.deepEqual(result.updatedIds, []);
    },
  }),
  laterEdit: (_f, ctx) => [
    'transactions',
    'update',
    ctx.existing,
    '--data',
    '{"notes":"later edit"}',
  ],
  independent: (_f, ctx) => ({
    args: listArgs(ctx.account),
    check(rows) {
      assert.ok(rows.some(row => row.notes === 'imported new'));
    },
  }),
};

guardedRegularCases(importing);
guardedInterruptionCases(importing);
