import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

// Packaged proof for 0029: reversals are new guarded operations built from
// receipt before-values. They restore categorization, allocation moves and
// cash targets without touching later unrelated edits, refuse when records
// changed (concurrent edits, transfer legs, reconciliation locks), keep their
// identity on retry, and never claim to undo merges or deletions.

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

async function failure(f, args) {
  const result = await f.cli(args);
  assert.notEqual(result.code, 0, result.stdout);
  return JSON.parse(result.stdout).error;
}

async function rows(f) {
  const list = await legacy(f, [
    'transactions',
    'list',
    '--account',
    f.fixture.checking,
    '--start',
    '2026-08-01',
    '--end',
    '2026-08-31',
  ]);
  return Object.fromEntries(
    list
      .filter(r => r.notes || r.imported_id)
      .map(r => [r.notes ?? r.imported_id, r]),
  );
}

async function addRows(f, account, data, extra = []) {
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    ...extra,
    '--data',
    JSON.stringify(data),
  ]);
}

async function categoryCells(f, ids) {
  const data = await legacy(f, ['budgets', 'month', '2026-08']);
  return Object.fromEntries(
    data.categoryGroups
      .flatMap(group => group.categories)
      .filter(c => ids.includes(c.id))
      .map(c => [c.id, c.budgeted]),
  );
}

void test('categorization, allocation and cash-target reversals restore before-values and leave later edits alone', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    const dining = f.fixture.dining;
    await addRows(f, f.fixture.checking, [
      { date: '2026-08-06', amount: -1500, notes: 'extra' },
    ]);
    let byNotes = await rows(f);
    const targets = [byNotes.uncategorized.id, byNotes.extra.id];
    await cli([
      'transactions',
      'categorize',
      '--ids',
      targets.join(','),
      '--category',
      dining,
      '--operation-id',
      'cat-1',
    ]);
    // A later, unrelated edit.
    await cli([
      'transactions',
      'categorize',
      '--ids',
      byNotes.Refund?.id ?? byNotes.refund.id,
      '--category',
      dining,
      '--operation-id',
      'cat-2',
    ]);
    const inspected = await cli(['changes', 'inspect', 'cat-1']);
    assert.equal(inspected.reversal.supported, true);
    assert.deepEqual(inspected.reversal.request, {
      ids: [...targets].sort(),
      category: null,
    });

    const reversed = await cli([
      'changes',
      'reverse',
      'cat-1',
      '--operation-id',
      'rev-1',
    ]);
    assert.equal(reversed.reverses, 'cat-1');
    assert.equal(reversed.reversal.operationId, 'rev-1');
    assert.equal(
      reversed.reversal.proposal.operation,
      'transactions.categorize',
    );
    assert.equal(reversed.reversal.outcome.status, 'committed-local');
    byNotes = await rows(f);
    assert.equal(byNotes.uncategorized.category, null);
    assert.equal(byNotes.extra.category, null);
    assert.equal(byNotes.refund.category, dining, 'later edit kept');

    // Retrying with the same reversal ID returns the same receipt.
    const retried = await cli([
      'changes',
      'reverse',
      'cat-1',
      '--operation-id',
      'rev-1',
    ]);
    assert.deepEqual(retried.reversal.outcome, reversed.reversal.outcome);
    assert.equal(retried.reversal.createdAt, reversed.reversal.createdAt);
    // A second reversal of the same change is refused.
    const again = await failure(f, [
      'changes',
      'reverse',
      'cat-1',
      '--operation-id',
      'rev-1b',
    ]);
    assert.equal(again.code, 'STALE_PREVIEW');
    assert.ok(again.details.conflicts.length >= 1);

    // Allocation move.
    const fun = (
      await legacy(f, [
        'categories',
        'create',
        '--name',
        'Fun',
        '--group-id',
        (await legacy(f, ['categories', 'list'])).find(c => c.id === dining)
          .group_id,
      ])
    ).id;
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
    const move = [
      'budgets',
      'move',
      '--month',
      '2026-08',
      '--from',
      dining,
      '--to',
      fun,
      '--amount',
      '10000',
    ];
    await cli([...move, '--operation-id', 'mv-1']);
    assert.deepEqual(await categoryCells(f, [dining, fun]), {
      [dining]: 20000,
      [fun]: 10000,
    });
    const preview = await cli([
      'changes',
      'reverse',
      'mv-1',
      '--operation-id',
      'rev-mv',
      '--preview',
    ]);
    assert.equal(preview.reversal.state, 'prepared');
    assert.deepEqual(await categoryCells(f, [dining, fun]), {
      [dining]: 20000,
      [fun]: 10000,
    });
    await cli([
      'changes',
      'apply',
      'rev-mv',
      '--token',
      preview.reversal.token,
    ]);
    assert.deepEqual(await categoryCells(f, [dining, fun]), {
      [dining]: 30000,
      [fun]: 0,
    });

    // Cash target: saving a target, then reversing only that save.
    await cli([
      'cash-planning',
      'save',
      '--data',
      JSON.stringify({
        startDate: '2026-08-01',
        endDate: '2026-09-30',
        categoryTargets: {},
        forecastEndDate: '2027-12-31',
      }),
      '--operation-id',
      'plan-1',
    ]);
    const target = await cli([
      'cash-planning',
      'set-target',
      '--category',
      dining,
      '--amount',
      '40000',
      '--operation-id',
      'plan-2',
    ]);
    const planReverse = await cli([
      'changes',
      'reverse',
      'plan-2',
      '--operation-id',
      'rev-plan',
    ]);
    assert.equal(
      planReverse.reversal.proposal.after.preference.value,
      target.receipt.proposal.before.preference.value,
    );
    const saved = await cli(['cash-planning', 'inspect']);
    assert.deepEqual(saved.saved.config?.categoryTargets ?? {}, {});
  } finally {
    await f.dispose();
  }
});

void test('concurrent edits, modified transfer legs and reconciliation locks block unsafe inverses', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    const dining = f.fixture.dining;
    const payees = await legacy(f, ['payees', 'list']);
    const toEquity = payees.find(p => p.transfer_acct === f.fixture.equity).id;
    await addRows(f, f.fixture.checking, [
      { date: '2026-08-07', amount: -1100, notes: 'edited' },
      { date: '2026-08-08', amount: -1200, notes: 'locked' },
    ]);
    await addRows(
      f,
      f.fixture.checking,
      [{ date: '2026-08-09', amount: -2000, payee: toEquity, notes: 'leg' }],
      ['--run-transfers'],
    );
    const byNotes = await rows(f);
    for (const [name, op] of [
      ['edited', 'cat-edited'],
      ['locked', 'cat-locked'],
      ['leg', 'cat-leg'],
    ]) {
      await cli([
        'transactions',
        'categorize',
        '--ids',
        byNotes[name].id,
        '--category',
        dining,
        '--operation-id',
        op,
      ]);
    }
    // Concurrent edit of the amount.
    await legacy(f, [
      'transactions',
      'update',
      byNotes.edited.id,
      '--data',
      '{"amount":-1111}',
    ]);
    const edited = await failure(f, [
      'changes',
      'reverse',
      'cat-edited',
      '--operation-id',
      'rev-edited',
    ]);
    assert.equal(edited.code, 'STALE_PREVIEW');
    assert.match(edited.details.conflicts.join(' '), /amount/);

    // The other transfer leg changes the categorized leg through the link.
    const leg = await cli(['transactions', 'get', byNotes.leg.id]);
    const counterpart =
      leg.transfer?.id ?? leg.counterpart?.id ?? leg.transaction?.transfer_id;
    assert.ok(counterpart, JSON.stringify(leg));
    await legacy(f, [
      'transactions',
      'update',
      counterpart,
      '--data',
      '{"amount":2500}',
    ]);
    const moved = await failure(f, [
      'changes',
      'reverse',
      'cat-leg',
      '--operation-id',
      'rev-leg',
    ]);
    assert.equal(moved.code, 'STALE_PREVIEW');

    // A reconciliation lock blocks the inverse.
    await legacy(f, [
      'transactions',
      'update',
      byNotes.locked.id,
      '--data',
      '{"cleared":true,"reconciled":true}',
    ]);
    const locked = await failure(f, [
      'changes',
      'reverse',
      'cat-locked',
      '--operation-id',
      'rev-locked',
    ]);
    assert.ok(['INVALID_INPUT', 'STALE_PREVIEW'].includes(locked.code));
    const after = await rows(f);
    assert.equal(after.edited.category, dining);
    assert.equal(after.locked.category, dining);
    assert.equal(after.leg.category, dining);
  } finally {
    await f.dispose();
  }
});

void test('merges, deletions and unapplied changes are never reversed and point to backup recovery', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await addRows(f, f.fixture.checking, [
      { date: '2026-08-10', amount: -777, notes: 'm1' },
      { date: '2026-08-10', amount: -777, notes: 'm2' },
      { date: '2026-08-11', amount: -333, notes: 'gone' },
    ]);
    const byNotes = await rows(f);
    await cli([
      'transactions',
      'merge',
      '--ids',
      `${byNotes.m1.id},${byNotes.m2.id}`,
      '--operation-id',
      'mg-1',
    ]);
    await cli([
      'transactions',
      'delete',
      byNotes.gone.id,
      '--operation-id',
      'del-1',
    ]);
    for (const id of ['mg-1', 'del-1']) {
      const error = await failure(f, [
        'changes',
        'reverse',
        id,
        '--operation-id',
        `rev-${id}`,
      ]);
      assert.equal(error.code, 'INVALID_INPUT');
      assert.ok(
        error.details.recovery.some(step => step.includes('backups restore')),
      );
      const inspected = await cli(['changes', 'inspect', id]);
      assert.equal(inspected.reversal.supported, false);
      assert.match(inspected.diagnosis, /acknowledged|Committed/);
    }
    const prepared = await cli([
      'changes',
      'preview',
      'transactions.categorize',
      '--operation-id',
      'never-applied',
      '--data',
      JSON.stringify({
        ids: [byNotes.uncategorized.id],
        category: f.fixture.dining,
      }),
    ]);
    assert.equal(prepared.state, 'prepared');
    const unapplied = await failure(f, [
      'changes',
      'reverse',
      'never-applied',
      '--operation-id',
      'rev-never',
    ]);
    assert.equal(unapplied.code, 'INVALID_INPUT');
    assert.match(unapplied.message, /never applied/);
    const diagnosis = await cli(['changes', 'inspect', 'never-applied']);
    assert.match(diagnosis.diagnosis, /unchanged/);
    const missing = await failure(f, [
      'changes',
      'reverse',
      'no-such-op',
      '--operation-id',
      'rev-missing',
    ]);
    assert.equal(missing.code, 'MISSING_CONTEXT');
    const same = await failure(f, [
      'changes',
      'reverse',
      'mg-1',
      '--operation-id',
      'mg-1',
    ]);
    assert.equal(same.code, 'INVALID_INPUT');
  } finally {
    await f.dispose();
  }
});
