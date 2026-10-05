import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRawEffect,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for guarded clearing and explicit reconciled unlocking.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

const range = ['--start', '2026-10-01', '--end', '2026-10-31'];

async function setup(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Clear account'])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify([
      { date: '2026-10-02', amount: -100, notes: 'clear one', cleared: false },
      { date: '2026-10-03', amount: -200, notes: 'clear two', cleared: false },
      {
        date: '2026-10-04',
        amount: -300,
        notes: 'clear three',
        cleared: false,
      },
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
    one: id('clear one'),
    two: id('clear two'),
    three: id('clear three'),
  };
}

function setCleared(expected, ids, value) {
  for (const row of expected.transactions) {
    if (ids.includes(row.id)) row.cleared = value;
  }
}

const clear = {
  operation: 'transactions.clear',
  label: 'transaction clearing',
  setup,
  data: (_f, ctx) => ({ ids: [ctx.one, ctx.two], cleared: true }),
  otherData: (_f, ctx) => ({ ids: [ctx.one], cleared: true }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      setCleared(expected, [ctx.one, ctx.two], 1);
    });
    if (outcome) {
      assert.deepEqual(
        [...outcome.affectedIds].sort((a, b) => a.localeCompare(b)),
        [ctx.one, ctx.two].sort((a, b) => a.localeCompare(b)),
      );
    }
  },
  direct: (_f, ctx) => ({
    args: ['transactions', 'clear', '--ids', ctx.three],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        setCleared(expected, [ctx.three], 1);
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
      JSON.stringify({ cleared: false }),
    ];
  },
  independent: (_f, ctx) => ({
    args: ['transactions', 'list', '--account', ctx.account, ...range],
    check(rows) {
      const find = id => rows.find(row => row.id === id);
      assert.equal(find(ctx.one).cleared, !ctx.laterEdited);
      assert.equal(find(ctx.two).cleared, true);
    },
  }),
};

guardedRegularCases(clear);
guardedInterruptionCases(clear);

void test('reconciled rows need an explicit unlock; stale and invalid requests write nothing', async () => {
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
      ctx.three,
      '--data',
      JSON.stringify({ cleared: true, reconciled: true }),
    ]);
    const before = await readRaw(f);
    const locked = await f.cli([
      'transactions',
      'clear',
      '--ids',
      ctx.three,
      '--uncleared',
      '--operation-id',
      'locked-clear',
    ]);
    assert.notEqual(locked.code, 0, 'reconciled row changed without unlock');
    assert.deepEqual(await readRaw(f), before, 'locked attempt wrote state');

    const prepared = await cli([
      'changes',
      'preview',
      'transactions.clear',
      '--operation-id',
      'stale-clear',
      '--data',
      JSON.stringify({ ids: [ctx.one, ctx.two], cleared: true }),
    ]);
    await legacy(f, [
      'transactions',
      'update',
      ctx.two,
      '--data',
      JSON.stringify({ notes: 'edited after preview' }),
    ]);
    const beforeStale = await readRaw(f);
    const stale = await f.cli([
      'changes',
      'apply',
      'stale-clear',
      '--token',
      prepared.token,
    ]);
    assert.notEqual(stale.code, 0, 'stale preview must not apply');
    assert.match(stale.stdout + stale.stderr, /STALE_PREVIEW/);
    assert.deepEqual(await readRaw(f), beforeStale, 'stale apply wrote state');

    for (const data of [
      { ids: [], cleared: true },
      { ids: [ctx.one, ctx.one], cleared: true },
      { ids: [ctx.one], cleared: 'yes' },
      { ids: [ctx.one], cleared: true, reconciled: true },
      { ids: ['missing-transaction'], cleared: true },
    ]) {
      const result = await f.cli([
        'changes',
        'preview',
        'transactions.clear',
        '--operation-id',
        `bad-${Math.random().toString(36).slice(2)}`,
        '--data',
        JSON.stringify(data),
      ]);
      assert.notEqual(result.code, 0, JSON.stringify(data));
    }
    assert.deepEqual(await readRaw(f), beforeStale, 'rejections wrote state');

    const unlocked = await cli([
      'transactions',
      'clear',
      '--ids',
      ctx.three,
      '--uncleared',
      '--unlock',
      '--operation-id',
      'unlock-clear',
    ]);
    assert.equal(unlocked.receipt.outcome.status, 'committed-local');
    const after = await readRaw(f);
    assertRawEffect(beforeStale, after, expected => {
      for (const row of expected.transactions) {
        if (row.id === ctx.three) {
          row.cleared = 0;
          row.reconciled = 0;
        }
      }
    });
  } finally {
    await f.dispose();
  }
});
