import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for guarded duplicate merges: the engine keeps the imported
// row, fills its empty fields from the manual duplicate and tombstones it.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

const range = ['--start', '2026-10-01', '--end', '2026-10-31'];

async function setup(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Merge account'])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify([
      { date: '2026-10-02', amount: -1500, notes: 'manual one' },
      { date: '2026-10-03', amount: -1500, imported_id: 'bank-one' },
      { date: '2026-10-05', amount: -2500, notes: 'manual two' },
      { date: '2026-10-06', amount: -2500, imported_id: 'bank-two' },
    ]),
  ]);
  const rows = await legacy(f, [
    'transactions',
    'list',
    '--account',
    account,
    ...range,
  ]);
  const by = predicate => rows.find(predicate).id;
  return {
    account,
    manual: by(row => row.notes === 'manual one'),
    imported: by(row => row.imported_id === 'bank-one'),
    manual2: by(row => row.notes === 'manual two'),
    imported2: by(row => row.imported_id === 'bank-two'),
  };
}

function assertMerged(before, after, keep, drop, notes) {
  for (const [table, rows] of Object.entries(before)) {
    if (table === 'transactions') continue;
    assert.deepEqual(after[table], rows, `${table} changed`);
  }
  const find = (rows, id) => rows.find(row => row.id === id);
  for (const row of before.transactions) {
    if (row.id === keep || row.id === drop) continue;
    assert.deepEqual(find(after.transactions, row.id), row);
  }
  assert.equal(find(after.transactions, drop).tombstone, 1);
  const kept = find(after.transactions, keep);
  assert.equal(kept.tombstone, 0);
  assert.equal(kept.notes, notes);
  assert.equal(kept.amount, find(before.transactions, keep).amount);
}

const merge = {
  operation: 'transactions.merge',
  label: 'transaction merge',
  setup,
  data: (_f, ctx) => ({ ids: [ctx.manual, ctx.imported] }),
  otherData: (_f, ctx) => ({ ids: [ctx.manual2, ctx.imported2] }),
  verify(before, after, { outcome, proposal, ctx }) {
    if (proposal) assert.equal(proposal.after.keepId, ctx.imported);
    assertMerged(before, after, ctx.imported, ctx.manual, 'manual one');
    if (outcome) assert.equal(outcome.transactionMerge.keptId, ctx.imported);
  },
  direct: (_f, ctx) => ({
    args: ['transactions', 'merge', '--ids', `${ctx.manual2},${ctx.imported2}`],
    verify(before, after) {
      assertMerged(before, after, ctx.imported2, ctx.manual2, 'manual two');
    },
  }),
  laterEdit: (_f, ctx) => {
    ctx.laterEdited = true;
    return [
      'transactions',
      'update',
      ctx.imported,
      '--data',
      JSON.stringify({ notes: 'later note' }),
    ];
  },
  independent: (_f, ctx) => ({
    args: ['transactions', 'list', '--account', ctx.account, ...range],
    check(rows) {
      assert.ok(!rows.some(row => row.id === ctx.manual));
      assert.equal(
        rows.find(row => row.id === ctx.imported).notes,
        ctx.laterEdited ? 'later note' : 'manual one',
      );
    },
  }),
};

guardedRegularCases(merge);
guardedInterruptionCases(merge);

void test('merge rejects reconciled, mismatched and stale duplicates without writes', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await cli(['accounts', 'list']);
    const ctx = await setup(f);
    await legacy(f, [
      'transactions',
      'update',
      ctx.manual2,
      '--data',
      JSON.stringify({ reconciled: true }),
    ]);
    const before = await readRaw(f);
    // Reconciled, mismatched amounts, repeated IDs.
    for (const ids of [
      [ctx.manual2, ctx.imported2],
      [ctx.manual, ctx.imported2],
      [ctx.manual, ctx.manual],
    ]) {
      const result = await f.cli([
        'transactions',
        'merge',
        '--ids',
        ids.join(','),
        '--operation-id',
        `reject-${ids.join('-')}`,
      ]);
      assert.notEqual(result.code, 0, ids.join(','));
      assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT');
    }
    assert.deepEqual(await readRaw(f), before, 'rejections wrote state');

    const prepared = await cli([
      'changes',
      'preview',
      'transactions.merge',
      '--operation-id',
      'stale-merge',
      '--data',
      JSON.stringify({ ids: [ctx.manual, ctx.imported] }),
    ]);
    await legacy(f, [
      'transactions',
      'update',
      ctx.manual,
      '--data',
      JSON.stringify({ notes: 'edited after preview' }),
    ]);
    const edited = await readRaw(f);
    const stale = await f.cli([
      'changes',
      'apply',
      'stale-merge',
      '--token',
      prepared.token,
    ]);
    assert.notEqual(stale.code, 0, 'stale merge must not apply');
    assert.match(stale.stdout + stale.stderr, /STALE_PREVIEW/);
    assert.deepEqual(await readRaw(f), edited, 'stale merge wrote state');
  } finally {
    await f.dispose();
  }
});
