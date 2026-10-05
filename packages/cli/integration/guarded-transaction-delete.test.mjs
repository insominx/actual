import assert from 'node:assert/strict';

import {
  assertRawEffect,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

// Packaged proof for guarded transaction deletion, including split children.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

async function setup(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Deletion account'])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify([
      {
        date: '2026-10-02',
        amount: -300,
        notes: 'split target',
        subtransactions: [{ amount: -100 }, { amount: -200 }],
      },
      { date: '2026-10-03', amount: -50, notes: 'direct target' },
    ]),
  ]);
  const rows = await legacy(f, [
    'transactions',
    'list',
    '--account',
    account,
    '--start',
    '2026-10-01',
    '--end',
    '2026-10-31',
  ]);
  const split = rows.find(row => row.notes === 'split target');
  const direct = rows.find(row => row.notes === 'direct target');
  return {
    id: split.id,
    children: split.subtransactions.map(child => child.id),
    other: direct.id,
  };
}

function tombstone(expected, ids) {
  for (const id of ids) {
    const row = expected.transactions.find(candidate => candidate.id === id);
    assert.ok(row, `transaction ${id} exists`);
    row.tombstone = 1;
  }
}

const deletion = {
  operation: 'transactions.delete',
  label: 'transaction deletion',
  setup,
  target: (_f, ctx) => ctx.id,
  data: () => ({}),
  otherData: () => ({ unexpected: true }),
  verify(before, after, { outcome, ctx }) {
    const ids = [ctx.id, ...ctx.children].sort((a, b) => a.localeCompare(b));
    assertRawEffect(before, after, expected => tombstone(expected, ids));
    if (outcome) assert.deepEqual(outcome.affectedIds, ids);
  },
  direct: (_f, ctx) => ({
    args: ['transactions', 'delete', ctx.other],
    verify(before, after) {
      assertRawEffect(before, after, expected =>
        tombstone(expected, [ctx.other]),
      );
    },
  }),
};

guardedRegularCases(deletion);
guardedInterruptionCases(deletion);
