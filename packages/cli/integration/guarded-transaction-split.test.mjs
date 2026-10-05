import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for guarded split edits: the parent amount is preserved, the
// planned children appear, and invalid sums fail before any write.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

const range = ['--start', '2026-10-01', '--end', '2026-10-31'];

async function setup(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Split account'])
  ).id;
  const group = (
    await legacy(f, ['category-groups', 'create', '--name', 'Split group'])
  ).id;
  const create = async name =>
    (
      await legacy(f, [
        'categories',
        'create',
        '--name',
        name,
        '--group-id',
        group,
      ])
    ).id;
  const food = await create('Split food');
  const home = await create('Split home');
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify([
      { date: '2026-10-02', amount: -1000, notes: 'split one' },
      { date: '2026-10-03', amount: -3000, notes: 'split two' },
    ]),
  ]);
  const rows = await legacy(f, [
    'transactions',
    'list',
    '--account',
    account,
    ...range,
  ]);
  const id = notes => rows.find(row => row.notes === notes).id;
  return { account, food, home, one: id('split one'), two: id('split two') };
}

function assertSplit(before, after, parentId, plan) {
  for (const [table, rows] of Object.entries(before)) {
    if (table === 'transactions') continue;
    assert.deepEqual(after[table], rows, `${table} changed`);
  }
  const parentBefore = before.transactions.find(row => row.id === parentId);
  const parent = after.transactions.find(row => row.id === parentId);
  assert.equal(parent.isParent, 1);
  assert.equal(parent.amount, parentBefore.amount);
  assert.equal(parent.tombstone, 0);
  const children = createdRows(before, after, 'transactions');
  assert.ok(children.every(row => row.parent_id === parentId));
  assert.deepEqual(
    children
      .map(row => `${row.amount}:${row.category}`)
      .sort((a, b) => a.localeCompare(b)),
    plan
      .map(([amount, category]) => `${amount}:${category}`)
      .sort((a, b) => a.localeCompare(b)),
  );
  for (const row of before.transactions) {
    if (row.id === parentId) continue;
    assert.deepEqual(
      after.transactions.find(candidate => candidate.id === row.id),
      row,
    );
  }
}

const split = {
  operation: 'transactions.split',
  label: 'transaction split',
  setup,
  target: (_f, ctx) => ctx.one,
  data: (_f, ctx) => ({
    subtransactions: [
      { amount: -400, category: ctx.food, notes: 'food part' },
      { amount: -600, category: ctx.home },
    ],
  }),
  otherData: (_f, ctx) => ({
    subtransactions: [{ amount: -1000, category: ctx.home }],
  }),
  verify(before, after, { ctx }) {
    assertSplit(before, after, ctx.one, [
      [-400, ctx.food],
      [-600, ctx.home],
    ]);
  },
  direct: (_f, ctx) => ({
    args: [
      'transactions',
      'split',
      ctx.two,
      '--data',
      JSON.stringify([
        { amount: -1000, category: ctx.food },
        { amount: -2000, category: ctx.home },
      ]),
    ],
    verify(before, after) {
      assertSplit(before, after, ctx.two, [
        [-1000, ctx.food],
        [-2000, ctx.home],
      ]);
    },
  }),
  laterEdit: (_f, ctx, outcome) => {
    ctx.laterEdited = true;
    return [
      'transactions',
      'update',
      outcome.transactionSplit.childIds[0],
      '--data',
      JSON.stringify({ notes: 'later child note' }),
    ];
  },
  independent: (_f, ctx) => ({
    args: ['transactions', 'list', '--account', ctx.account, ...range],
    check(rows) {
      const parent = rows.find(row => row.id === ctx.one);
      assert.equal(parent.amount, -1000);
      assert.equal(parent.subtransactions.length, 2);
      assert.equal(
        parent.subtransactions.reduce((sum, row) => sum + row.amount, 0),
        -1000,
      );
      if (ctx.laterEdited) {
        assert.ok(
          parent.subtransactions.some(row => row.notes === 'later child note'),
        );
      }
    },
  }),
};

guardedRegularCases(split);
guardedInterruptionCases(split);

void test('split rejects invalid sums, children and stale previews without writes; get reads the whole split', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await cli(['accounts', 'list']);
    const ctx = await setup(f);
    const before = await readRaw(f);
    for (const children of [
      [{ amount: -400 }, { amount: -500 }],
      [],
      [{ amount: -1000, category: 'missing' }],
      [{ amount: 'x' }],
    ]) {
      const result = await f.cli([
        'transactions',
        'split',
        ctx.one,
        '--data',
        JSON.stringify(children),
        '--operation-id',
        `bad-split-${Math.random().toString(36).slice(2)}`,
      ]);
      assert.notEqual(result.code, 0, JSON.stringify(children));
    }
    assert.deepEqual(await readRaw(f), before, 'rejections wrote state');

    const prepared = await cli([
      'changes',
      'preview',
      'transactions.split',
      ctx.one,
      '--operation-id',
      'stale-split',
      '--data',
      JSON.stringify({
        subtransactions: [{ amount: -1000, category: ctx.food }],
      }),
    ]);
    await legacy(f, [
      'transactions',
      'update',
      ctx.one,
      '--data',
      JSON.stringify({ notes: 'edited after preview' }),
    ]);
    const edited = await readRaw(f);
    const stale = await f.cli([
      'changes',
      'apply',
      'stale-split',
      '--token',
      prepared.token,
    ]);
    assert.notEqual(stale.code, 0, 'stale split must not apply');
    assert.match(stale.stdout + stale.stderr, /STALE_PREVIEW/);
    assert.deepEqual(await readRaw(f), edited, 'stale split wrote state');

    // Read-only get resolves a split child to its balanced parent.
    const applied = await cli([
      'transactions',
      'split',
      ctx.two,
      '--data',
      JSON.stringify([
        { amount: -1000, category: ctx.food },
        { amount: -2000, category: ctx.home },
      ]),
      '--operation-id',
      'split-for-get',
    ]);
    const childId = applied.receipt.outcome.transactionSplit.childIds[0];
    const afterSplit = await readRaw(f);
    const view = await cli(['transactions', 'get', childId]);
    assert.equal(view.transaction.id, ctx.two);
    assert.equal(view.children.length, 2);
    assert.deepEqual(view.split, {
      childCount: 2,
      childTotal: -3000,
      balanced: true,
    });
    assert.deepEqual(view.transfers, []);
    assert.deepEqual(await readRaw(f), afterSplit, 'get wrote state');
    const missing = await f.cli(['transactions', 'get', 'missing-id']);
    assert.notEqual(missing.code, 0);
  } finally {
    await f.dispose();
  }
});
