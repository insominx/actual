import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for 0025: guarded allocation moves that preserve the total
// budgeted and refuse insufficient funds, template preview that matches
// apply without writing, and read-only reservations behind their
// experimental flag.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

function strict(f) {
  return async args => {
    const result = await f.cli(args);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).data;
  };
}

async function errorCode(f, args) {
  const result = await f.cli(args);
  assert.notEqual(result.code, 0, result.stdout);
  return JSON.parse(result.stdout).error.code;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function newCategory(f, name) {
  const categories = await legacy(f, ['categories', 'list']);
  const dining = categories.find(c => c.id === f.fixture.dining);
  return (
    await legacy(f, [
      'categories',
      'create',
      '--name',
      name,
      '--group-id',
      dining.group_id,
    ])
  ).id;
}

async function monthCells(f, month, ids) {
  const data = await legacy(f, ['budgets', 'month', month]);
  const cells = Object.fromEntries(
    data.categoryGroups
      .flatMap(group => group.categories)
      .filter(c => ids.includes(c.id))
      .map(c => [c.id, { budgeted: c.budgeted, balance: c.balance }]),
  );
  return { totalBudgeted: data.totalBudgeted, toBudget: data.toBudget, cells };
}

void test('allocation moves preserve the total, refuse insufficient funds and survive sync', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const fun = await newCategory(f, 'Fun');
    const dining = f.fixture.dining;
    const salary = (await legacy(f, ['categories', 'list'])).find(
      c => c.is_income,
    ).id;
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      f.fixture.checking,
      '--data',
      JSON.stringify([
        { date: '2026-08-05', amount: 100000, category: salary },
      ]),
    ]);
    await legacy(f, [
      'budgets',
      'set-amount',
      '--month',
      '2026-08',
      '--category',
      dining,
      '--amount',
      '30000',
    ]);
    const before = await monthCells(f, '2026-08', [dining, fun]);
    assert.equal(before.cells[dining].balance, 25000);
    const rawBefore = await readRaw(f);

    const preview = await cli([
      'changes',
      'preview',
      'budgets.move',
      '--operation-id',
      'move-preview',
      '--data',
      JSON.stringify({
        month: '2026-08',
        from: dining,
        to: fun,
        amount: 10000,
      }),
    ]);
    assert.deepEqual(await readRaw(f), rawBefore, 'preview wrote state');
    const proposal = preview.proposal;
    assert.equal(proposal.before.from.budgeted, 30000);
    assert.equal(proposal.after.from.budgeted, 20000);
    assert.equal(proposal.after.from.balance, 15000);
    assert.equal(proposal.after.to.budgeted, 10000);
    assert.equal(proposal.after.totalBudgetedChange, 0);
    const applied = await cli([
      'changes',
      'apply',
      'move-preview',
      '--token',
      preview.token,
    ]);
    assert.equal(applied.outcome.status, 'committed-local');
    const moved = await monthCells(f, '2026-08', [dining, fun]);
    assert.equal(moved.cells[dining].budgeted, 20000);
    assert.equal(moved.cells[fun].budgeted, 10000);
    assert.equal(moved.totalBudgeted, before.totalBudgeted);
    assert.equal(moved.toBudget, before.toBudget);

    // Insufficient funds are explicit: a category balance and To Budget.
    assert.equal(
      await errorCode(f, [
        'budgets',
        'move',
        '--month',
        '2026-08',
        '--from',
        dining,
        '--to',
        fun,
        '--amount',
        '50000',
        '--operation-id',
        'move-overspend',
      ]),
      'INVALID_INPUT',
    );
    assert.equal(
      await errorCode(f, [
        'budgets',
        'move',
        '--month',
        '2026-08',
        '--from',
        'to-budget',
        '--to',
        fun,
        '--amount',
        String(moved.toBudget + 1),
        '--operation-id',
        'move-too-much',
      ]),
      'INVALID_INPUT',
    );
    // With explicit permission the source may go negative.
    await cli([
      'budgets',
      'move',
      '--month',
      '2026-08',
      '--from',
      dining,
      '--to',
      fun,
      '--amount',
      '16000',
      '--allow-overspend',
      '--operation-id',
      'move-allowed',
    ]);
    // From To Budget raises the total by the amount.
    const funded = await cli([
      'budgets',
      'move',
      '--month',
      '2026-08',
      '--from',
      'to-budget',
      '--to',
      fun,
      '--amount',
      '5000',
      '--operation-id',
      'move-fund',
    ]);
    assert.equal(funded.receipt.proposal.after.totalBudgetedChange, 5000);
    for (const data of [
      { month: '2026-08', from: dining, to: dining, amount: 1 },
      { month: '2026-08', from: dining, to: fun, amount: 0 },
      { month: '2026-08', from: 'missing', to: fun, amount: 1 },
      { month: '1999-01', from: dining, to: fun, amount: 1 },
    ]) {
      assert.equal(
        await errorCode(f, [
          'changes',
          'preview',
          'budgets.move',
          '--operation-id',
          `bad-${JSON.stringify(data).length}-${data.amount}-${data.from}`,
          '--data',
          JSON.stringify(data),
        ]),
        'INVALID_INPUT',
      );
    }

    // The result survives a sync and a fresh read.
    await cli(['sync']);
    const after = await monthCells(f, '2026-08', [dining, fun]);
    assert.equal(after.cells[dining].budgeted, 4000);
    assert.equal(after.cells[fun].budgeted, 31000);
    assert.equal(Math.abs(after.totalBudgeted - before.totalBudgeted), 5000);
    const raw = await readRaw(f);
    assert.deepEqual(raw.preferences, rawBefore.preferences);
    assert.deepEqual(raw.transactions, rawBefore.transactions);
  } finally {
    await f.dispose();
  }
});

void test('template preview matches apply without writing and invalid templates fail clearly', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const month = currentMonth();
    const fixed = await newCategory(f, 'Fixed bill');
    const scheduled = await newCategory(f, 'Scheduled bill');
    await cli([
      'notes',
      'set',
      '--category',
      fixed,
      '--note',
      '#template 120',
      '--operation-id',
      'note-fixed',
    ]);
    await cli([
      'notes',
      'set',
      '--category',
      scheduled,
      '--note',
      '#template schedule Bill',
      '--operation-id',
      'note-scheduled',
    ]);
    const inspected = await cli(['budgets', 'templates']);
    assert.equal(inspected.valid, true);
    assert.deepEqual(
      new Set(inspected.categories.map(c => c.id)),
      new Set([fixed, scheduled]),
    );
    assert.equal(
      inspected.categories.find(c => c.id === fixed).templates[0].type,
      'simple',
    );

    const before = await readRaw(f);
    const preview = await cli([
      'changes',
      'preview',
      'budgets.apply-templates',
      '--operation-id',
      'templates-preview',
      '--data',
      JSON.stringify({ month }),
    ]);
    assert.deepEqual(await readRaw(f), before, 'preview wrote state');
    const rows = Object.fromEntries(
      preview.proposal.after.rows.map(row => [row.categoryId, row]),
    );
    assert.equal(rows[fixed].after.budgeted, 12000);
    assert.equal(rows[scheduled].after.budgeted, 5000);
    assert.equal(rows[fixed].before.budgeted, 0);
    const applied = await cli([
      'changes',
      'apply',
      'templates-preview',
      '--token',
      preview.token,
    ]);
    assert.equal(applied.outcome.status, 'committed-local');
    const cells = await monthCells(f, month, [fixed, scheduled]);
    assert.equal(cells.cells[fixed].budgeted, 12000);
    assert.equal(cells.cells[scheduled].budgeted, 5000);

    // Already funded categories are left alone unless forced or listed.
    const again = await cli([
      'changes',
      'preview',
      'budgets.apply-templates',
      '--operation-id',
      'templates-again',
      '--data',
      JSON.stringify({ month }),
    ]);
    assert.deepEqual(again.proposal.after.rows, []);
    await legacy(f, [
      'budgets',
      'set-amount',
      '--month',
      month,
      '--category',
      fixed,
      '--amount',
      '100',
    ]);
    const listed = await cli([
      'budgets',
      'apply-templates',
      '--month',
      month,
      '--categories',
      fixed,
      '--operation-id',
      'templates-listed',
    ]);
    assert.deepEqual(listed.receipt.outcome.templateApplication.categoryIds, [
      fixed,
    ]);
    assert.equal(
      (await monthCells(f, month, [fixed])).cells[fixed].budgeted,
      12000,
    );

    // An invalid template line is reported; the engine skips it, as the
    // app does, and the preview lists the error beside the rows.
    const broken = await newCategory(f, 'Broken');
    await cli([
      'notes',
      'set',
      '--category',
      broken,
      '--note',
      '#template broken template',
      '--operation-id',
      'note-broken',
    ]);
    const invalid = await cli(['budgets', 'templates']);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some(line => line.startsWith('Broken')));
    const withErrors = await cli([
      'changes',
      'preview',
      'budgets.apply-templates',
      '--operation-id',
      'templates-broken',
      '--data',
      JSON.stringify({ month, force: true }),
    ]);
    assert.ok(
      withErrors.proposal.after.templateErrors.some(line =>
        line.startsWith('Broken'),
      ),
    );
    assert.ok(
      !withErrors.proposal.after.rows.some(row => row.categoryId === broken),
    );
    // Listing a category without templates is a precise input error.
    assert.equal(
      await errorCode(f, [
        'budgets',
        'apply-templates',
        '--month',
        month,
        '--categories',
        f.fixture.dining,
        '--operation-id',
        'templates-none',
      ]),
      'INVALID_INPUT',
    );
  } finally {
    await f.dispose();
  }
});

void test('reservations are read-only and flag-gated', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    assert.equal(
      await errorCode(f, ['budgets', 'reservations']),
      'INVALID_INPUT',
    );
    await cli([
      'preferences',
      'set',
      'flags.budgetReservations',
      'true',
      '--operation-id',
      'flag-on',
    ]);
    const saved = await newCategory(f, 'Saved for bill');
    await cli([
      'notes',
      'set',
      '--category',
      saved,
      '--note',
      '#template schedule Bill',
      '--operation-id',
      'note-saved',
    ]);
    const before = await readRaw(f);
    const first = await cli(['budgets', 'reservations']);
    assert.equal(first.month, currentMonth());
    const row = first.categories.find(c => c.categoryId === saved);
    assert.ok(row, 'templated category is listed');
    assert.deepEqual(await readRaw(f), before, 'reservations wrote state');
    assert.equal(
      await errorCode(f, ['budgets', 'reservations', '--month', '2026-08']),
      'INVALID_INPUT',
    );
  } finally {
    await f.dispose();
  }
});

const move = {
  operation: 'budgets.move',
  label: 'allocation move',
  async setup(f) {
    const to = await newCategory(f, 'Kit target');
    await legacy(f, [
      'budgets',
      'set-amount',
      '--month',
      '2026-08',
      '--category',
      f.fixture.dining,
      '--amount',
      '30000',
    ]);
    return { to };
  },
  data: (f, ctx) => ({
    month: '2026-08',
    from: f.fixture.dining,
    to: ctx.to,
    amount: 1000,
  }),
  otherData: (f, ctx) => ({
    month: '2026-08',
    from: f.fixture.dining,
    to: ctx.to,
    amount: 2000,
  }),
  verify(before, after, { outcome, ctx, f }) {
    for (const table of Object.keys(before)) {
      if (!['zero_budgets', 'notes'].includes(table)) {
        assert.deepEqual(after[table], before[table], `${table} changed`);
      }
    }
    const amount = (rows, category) =>
      rows
        .filter(r => r.category === category && r.month === 202608)
        .reduce((sum, r) => sum + r.amount, 0);
    assert.equal(
      amount(after.zero_budgets, f.fixture.dining),
      amount(before.zero_budgets, f.fixture.dining) - 1000,
    );
    assert.equal(
      amount(after.zero_budgets, ctx.to),
      amount(before.zero_budgets, ctx.to) + 1000,
    );
    if (outcome) assert.deepEqual(outcome.budgetMove.amount, 1000);
  },
};

guardedRegularCases(move);
guardedInterruptionCases(move);
