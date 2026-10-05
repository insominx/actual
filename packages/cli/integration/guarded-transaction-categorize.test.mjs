import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRawEffect,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for guarded batch categorization over frozen IDs.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

const range = ['--start', '2026-10-01', '--end', '2026-10-31'];
const categoryOf = row => row.category?.id ?? row.category ?? null;

async function setup(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Batch account'])
  ).id;
  const group = (
    await legacy(f, ['category-groups', 'create', '--name', 'Batch group'])
  ).id;
  const food = (
    await legacy(f, [
      'categories',
      'create',
      '--name',
      'Batch food',
      '--group-id',
      group,
    ])
  ).id;
  const fun = (
    await legacy(f, [
      'categories',
      'create',
      '--name',
      'Batch fun',
      '--group-id',
      group,
    ])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify([
      { date: '2026-10-02', amount: -100, notes: 'batch one' },
      { date: '2026-10-03', amount: -200, notes: 'batch two' },
      { date: '2026-10-04', amount: -300, notes: 'batch three' },
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
  return {
    account,
    food,
    fun,
    one: id('batch one'),
    two: id('batch two'),
    three: id('batch three'),
  };
}

function setCategory(expected, ids, category) {
  for (const row of expected.transactions) {
    if (ids.includes(row.id)) row.category = category;
  }
}

const categorize = {
  operation: 'transactions.categorize',
  label: 'transaction categorization',
  setup,
  data: (_f, ctx) => ({ ids: [ctx.one, ctx.two], category: ctx.food }),
  otherData: (_f, ctx) => ({ ids: [ctx.one], category: ctx.food }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      setCategory(expected, [ctx.one, ctx.two], ctx.food);
    });
    if (outcome) {
      assert.deepEqual(
        [...outcome.affectedIds].sort((a, b) => a.localeCompare(b)),
        [ctx.one, ctx.two].sort((a, b) => a.localeCompare(b)),
      );
    }
  },
  direct: (_f, ctx) => ({
    args: [
      'transactions',
      'categorize',
      '--ids',
      ctx.three,
      '--category',
      ctx.fun,
    ],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        setCategory(expected, [ctx.three], ctx.fun);
      });
    },
  }),
  laterEdit: (_f, ctx) => {
    ctx.laterEdited = true;
    return [
      'transactions',
      'update',
      ctx.one,
      '--data',
      JSON.stringify({ category: ctx.fun }),
    ];
  },
  independent: (_f, ctx) => ({
    args: ['transactions', 'list', '--account', ctx.account, ...range],
    check(rows) {
      const find = id => rows.find(row => row.id === id);
      assert.equal(
        categoryOf(find(ctx.one)),
        ctx.laterEdited ? ctx.fun : ctx.food,
      );
      assert.equal(categoryOf(find(ctx.two)), ctx.food);
    },
  }),
};

guardedRegularCases(categorize);
guardedInterruptionCases(categorize);

void test('categorization rejects stale affected records and guarded rows without writes', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await cli(['accounts', 'list']);
    const ctx = await setup(f);
    const prepared = await cli([
      'changes',
      'preview',
      'transactions.categorize',
      '--operation-id',
      'stale-batch',
      '--data',
      JSON.stringify({ ids: [ctx.one, ctx.two], category: ctx.food }),
    ]);
    assert.deepEqual(prepared.proposal.after.unchangedIds, []);
    // Editing one frozen record after preview makes the batch stale.
    await legacy(f, [
      'transactions',
      'update',
      ctx.two,
      '--data',
      JSON.stringify({ notes: 'edited after preview' }),
    ]);
    const before = await readRaw(f);
    const stale = await f.cli([
      'changes',
      'apply',
      'stale-batch',
      '--token',
      prepared.token,
    ]);
    assert.notEqual(stale.code, 0, 'stale preview must not apply');
    assert.match(stale.stdout + stale.stderr, /STALE_PREVIEW/);
    assert.deepEqual(await readRaw(f), before, 'stale apply wrote state');

    for (const data of [
      { ids: [], category: ctx.food },
      { ids: [ctx.one, ctx.one], category: ctx.food },
      { ids: [ctx.one], category: 'missing-category' },
      { ids: ['missing-transaction'], category: ctx.food },
    ]) {
      const result = await f.cli([
        'changes',
        'preview',
        'transactions.categorize',
        '--operation-id',
        `bad-${Math.random().toString(36).slice(2)}`,
        '--data',
        JSON.stringify(data),
      ]);
      assert.notEqual(result.code, 0, JSON.stringify(data));
    }
    assert.deepEqual(await readRaw(f), before, 'rejections wrote state');
  } finally {
    await f.dispose();
  }
});
