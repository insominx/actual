import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRawEffect,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for transfer review: candidates, guarded match, unmatch and
// repair, and the net cash and category spending invariants.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

const range = ['--start', '2026-10-01', '--end', '2026-10-31'];

async function transferPayee(f, account) {
  const payees = await legacy(f, ['payees', 'list']);
  return payees.find(payee => payee.transfer_acct === account).id;
}

async function rowsOf(f, account) {
  return legacy(f, ['transactions', 'list', '--account', account, ...range]);
}

async function setup(f) {
  const checking = (
    await legacy(f, ['accounts', 'create', '--name', 'Transfer checking'])
  ).id;
  const savings = (
    await legacy(f, ['accounts', 'create', '--name', 'Transfer savings'])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    checking,
    '--data',
    JSON.stringify([
      { date: '2026-10-02', amount: -5000, notes: 'out one' },
      { date: '2026-10-09', amount: -7000, notes: 'out two' },
    ]),
  ]);
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    savings,
    '--data',
    JSON.stringify([
      { date: '2026-10-03', amount: 5000, notes: 'in one' },
      { date: '2026-10-09', amount: 7000, notes: 'in two' },
    ]),
  ]);
  const all = [...(await rowsOf(f, checking)), ...(await rowsOf(f, savings))];
  const id = notes => all.find(row => row.notes === notes).id;
  return {
    checking,
    savings,
    toSavings: await transferPayee(f, savings),
    toChecking: await transferPayee(f, checking),
    outOne: id('out one'),
    inOne: id('in one'),
    outTwo: id('out two'),
    inTwo: id('in two'),
  };
}

function link(expected, from, to, ctx) {
  for (const row of expected.transactions) {
    if (row.id === from) {
      row.transferred_id = to;
      row.description = ctx.toSavings;
      row.category = null;
    }
    if (row.id === to) {
      row.transferred_id = from;
      row.description = ctx.toChecking;
      row.category = null;
    }
  }
}

const match = {
  operation: 'transfers.match',
  label: 'transfer match',
  setup,
  data: (_f, ctx) => ({ ids: [ctx.inOne, ctx.outOne] }),
  otherData: (_f, ctx) => ({ ids: [ctx.outOne, ctx.inTwo] }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      link(expected, ctx.outOne, ctx.inOne, ctx);
    });
    if (outcome) {
      assert.deepEqual(outcome.affectedIds, [ctx.outOne, ctx.inOne]);
    }
  },
  direct: (_f, ctx) => ({
    args: ['transfers', 'match', '--ids', `${ctx.outTwo},${ctx.inTwo}`],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        link(expected, ctx.outTwo, ctx.inTwo, ctx);
      });
    },
  }),
  laterEdit: (_f, ctx) => {
    ctx.laterEdited = true;
    return [
      'transactions',
      'update',
      ctx.outOne,
      '--data',
      JSON.stringify({ notes: 'edited later' }),
    ];
  },
  independent: (_f, ctx) => ({
    args: ['transactions', 'list', '--account', ctx.checking, ...range],
    check(rows) {
      const row = rows.find(r => r.id === ctx.outOne);
      assert.equal(row.transfer_id, ctx.inOne);
      assert.equal(row.notes, ctx.laterEdited ? 'edited later' : 'out one');
    },
  }),
};

guardedRegularCases(match);
guardedInterruptionCases(match);

void test('transfer review keeps net cash and category spending, flags ambiguity and repairs links', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const run = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await run(['accounts', 'list']);
    const ctx = await setup(f);
    const card = (await legacy(f, ['accounts', 'create', '--name', 'Card'])).id;
    const equity = (
      await legacy(f, [
        'accounts',
        'create',
        '--name',
        'Owner equity',
        '--offbudget',
      ])
    ).id;
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      ctx.checking,
      '--data',
      JSON.stringify([
        { date: '2026-10-12', amount: -3000, notes: 'card payment' },
        { date: '2026-10-13', amount: -3000, notes: 'card payment twin' },
        { date: '2026-10-20', amount: -9000, notes: 'to equity' },
        {
          date: '2026-10-21',
          amount: -1500,
          notes: 'groceries',
          category: f.fixture.dining,
        },
      ]),
    ]);
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      card,
      '--data',
      JSON.stringify([{ date: '2026-10-12', amount: 3000, notes: 'payment' }]),
    ]);
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      equity,
      '--data',
      JSON.stringify([
        { date: '2026-10-20', amount: 9000, notes: 'equity in' },
      ]),
    ]);
    const onBudget = async () =>
      (await run(['accounts', 'inspect', '--cutoff', '2026-10-31'])).totals;
    const spending = async () =>
      (await run(['query', 'aggregate', ...range])).groups.filter(
        group => group.kind === 'category',
      );
    const cashBefore = await onBudget();
    const spendingBefore = await spending();
    assert.ok(spendingBefore.length > 0, 'fixture has category spending');

    const candidates = await run(['transfers', 'candidates', ...range]);
    const find = notes =>
      candidates.candidates.filter(c => c.from.notes === notes);
    assert.equal(find('out one')[0].classification, 'internal');
    assert.equal(find('out one')[0].ambiguous, false);
    assert.equal(find('card payment')[0].ambiguous, true);
    assert.equal(find('card payment twin')[0].ambiguous, true);
    assert.equal(find('to equity')[0].classification, 'budget-boundary');

    // An ambiguous pair is never matched implicitly; the agent picks one.
    const cardPayment = find('card payment')[0];
    for (const [ids, op] of [
      [[ctx.outOne, ctx.inOne], 'm1'],
      [[cardPayment.from.id, cardPayment.to.id], 'm2'],
    ]) {
      await run([
        'transfers',
        'match',
        '--ids',
        ids.join(','),
        '--operation-id',
        op,
      ]);
    }
    const twin = find('card payment twin')[0];
    const rejected = await f.cli([
      'transfers',
      'match',
      '--ids',
      `${twin.from.id},${twin.to.id}`,
      '--operation-id',
      'm3',
    ]);
    assert.notEqual(rejected.code, 0, 'card credit was linked twice');
    const equityPair = find('to equity')[0];
    await run([
      'transfers',
      'match',
      '--ids',
      `${equityPair.from.id},${equityPair.to.id}`,
      '--operation-id',
      'm4',
    ]);

    // A1: internal transfers and card payments change neither on-budget cash
    // nor category spending. A2: the equity boundary reduces on-budget cash
    // once, as it already did before matching; matching adds no movement.
    assert.deepEqual(await onBudget(), cashBefore);
    assert.deepEqual(await spending(), spendingBefore);
    const inspected = await run(['transfers', 'inspect', ctx.outOne]);
    assert.equal(inspected.linked, true);
    assert.deepEqual(inspected.issues, []);
    assert.equal(inspected.counterpart.id, ctx.inOne);
    assert.equal(
      (await run(['transfers', 'inspect', equityPair.from.id])).classification,
      'budget-boundary',
    );
    assert.deepEqual((await run(['transfers', 'check'])).findings, []);

    // Unmatch keeps both rows; repair of a clean link is refused.
    const beforeUnmatch = await readRaw(f);
    await run(['transfers', 'unmatch', ctx.inOne, '--operation-id', 'u1']);
    assertRawEffect(beforeUnmatch, await readRaw(f), expected => {
      for (const row of expected.transactions) {
        if (row.id === ctx.outOne || row.id === ctx.inOne) {
          row.transferred_id = null;
          row.description = null;
        }
      }
    });
    const clean = await f.cli([
      'transfers',
      'repair',
      cardPayment.from.id,
      '--operation-id',
      'r0',
    ]);
    assert.notEqual(clean.code, 0, 'repaired a clean link');
    assert.deepEqual(await onBudget(), cashBefore);

    // Reconciled entries need --allow-reconciled.
    await legacy(f, [
      'transactions',
      'update',
      ctx.outOne,
      '--data',
      JSON.stringify({ reconciled: true }),
    ]);
    const lockedBefore = await readRaw(f);
    const locked = await f.cli([
      'transfers',
      'match',
      '--ids',
      `${ctx.outOne},${ctx.inOne}`,
      '--operation-id',
      'm5',
    ]);
    assert.notEqual(locked.code, 0, 'reconciled entry linked without consent');
    assert.deepEqual(await readRaw(f), lockedBefore);
    await run([
      'transfers',
      'match',
      '--ids',
      `${ctx.outOne},${ctx.inOne}`,
      '--allow-reconciled',
      '--operation-id',
      'm6',
    ]);
    assert.deepEqual((await run(['transfers', 'check'])).findings, []);
  } finally {
    await f.dispose();
  }
});
