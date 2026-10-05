import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for 0022: core-owned reconciliation status with the app's
// cleared-balance definition and a statement cutoff, zero-difference finish
// over a frozen candidate set (splits and transfers included), explicit
// adjustment and unlock, and last_reconciled surviving sync.

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

const RANGE = ['--start', '2026-01-01', '--end', '2026-12-31'];

async function statementAccount(f) {
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Statement'])
  ).id;
  const payees = await legacy(f, ['payees', 'list']);
  const transferPayee = payees.find(
    p => p.transfer_acct === f.fixture.savings,
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--run-transfers',
    '--data',
    JSON.stringify([
      {
        date: '2026-09-01',
        amount: -3000,
        cleared: true,
        notes: 'split',
        subtransactions: [
          { amount: -1000, category: f.fixture.dining },
          { amount: -2000, category: f.fixture.groceries },
        ],
      },
      {
        date: '2026-09-03',
        amount: -1000,
        cleared: true,
        notes: 'transfer',
        payee: transferPayee,
      },
      { date: '2026-09-05', amount: 10000, cleared: true, notes: 'deposit' },
      { date: '2026-09-10', amount: -500, cleared: false, notes: 'pending' },
      { date: '2026-09-20', amount: -2000, cleared: true, notes: 'later' },
    ]),
  ]);
  const rows = await legacy(f, [
    'transactions',
    'list',
    '--account',
    account,
    ...RANGE,
  ]);
  const byNotes = Object.fromEntries(
    rows.filter(r => r.notes).map(r => [r.notes, r]),
  );
  return { account, rows, byNotes };
}

void test('status matches the app cleared balance, cutoff excludes later rows, and only a zero difference with the frozen set finishes', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const { account, rows, byNotes } = await statementAccount(f);
    // The app's reconcile bar sums cleared top-level transactions.
    const appCleared = rows
      .filter(r => r.cleared)
      .reduce((sum, r) => sum + r.amount, 0);
    const before = await readRaw(f);
    const all = await cli(['reconcile', 'status', account]);
    assert.equal(all.clearedBalance, appCleared);
    assert.equal(all.difference, null);
    assert.equal(all.canFinish, false);
    const cut = await cli([
      'reconcile',
      'status',
      account,
      '--date',
      '2026-09-15',
      '--balance',
      String(appCleared + 2000),
    ]);
    assert.equal(cut.clearedBalance, appCleared + 2000);
    assert.equal(cut.difference, 0);
    assert.equal(cut.canFinish, true);
    assert.equal(cut.clearedAfterCutoffCount, 1);
    assert.equal(cut.unclearedCount, 1);
    assert.ok(cut.candidateIds.includes(byNotes.split.id));
    assert.ok(cut.candidateIds.includes(byNotes.transfer.id));
    assert.ok(!cut.candidateIds.includes(byNotes.later.id));
    assert.ok(!cut.candidateIds.includes(byNotes.pending.id));
    assert.deepEqual(await readRaw(f), before, 'status wrote state');

    const finishArgs = (id, balance, ids) => [
      'reconcile',
      'finish',
      account,
      '--date',
      '2026-09-15',
      '--balance',
      String(balance),
      '--ids',
      ids.join(','),
      '--operation-id',
      id,
    ];
    // A nonzero difference and a stale candidate set cannot finish.
    assert.equal(
      await errorCode(
        f,
        finishArgs('finish-off', appCleared + 1999, cut.candidateIds),
      ),
      'INVALID_INPUT',
    );
    assert.equal(
      await errorCode(
        f,
        finishArgs(
          'finish-short',
          appCleared + 2000,
          cut.candidateIds.slice(1),
        ),
      ),
      'INVALID_INPUT',
    );
    // A preview made stale by clearing another row before apply.
    const preview = await cli([
      'changes',
      'preview',
      'reconcile.finish',
      '--operation-id',
      'finish-stale',
      '--data',
      JSON.stringify({
        accountId: account,
        statementBalance: appCleared + 2000,
        statementDate: '2026-09-15',
        ids: cut.candidateIds,
      }),
    ]);
    await legacy(f, [
      'transactions',
      'update',
      byNotes.pending.id,
      '--data',
      '{"cleared":true}',
    ]);
    assert.equal(
      await errorCode(f, [
        'changes',
        'apply',
        'finish-stale',
        '--token',
        preview.token,
      ]),
      'STALE_PREVIEW',
    );
    const fresh = await cli([
      'reconcile',
      'status',
      account,
      '--date',
      '2026-09-15',
      '--balance',
      String(appCleared + 1500),
    ]);
    assert.equal(fresh.difference, 0);
    const finished = await cli(
      finishArgs('finish-ok', appCleared + 1500, fresh.candidateIds),
    );
    const locked = finished.receipt.outcome.reconciliation.lockedIds;
    const splitChildren = (await readRaw(f)).transactions.filter(
      r => r.parent_id === byNotes.split.id && r.tombstone === 0,
    );
    assert.equal(splitChildren.length, 2);
    for (const child of splitChildren) assert.ok(locked.includes(child.id));
    const raw = await readRaw(f);
    const reconciled = id => raw.transactions.find(r => r.id === id).reconciled;
    assert.equal(reconciled(byNotes.split.id), 1);
    assert.equal(reconciled(byNotes.transfer.id), 1);
    assert.equal(reconciled(byNotes.pending.id), 1);
    assert.equal(reconciled(byNotes.later.id), 0);
    for (const child of splitChildren) assert.equal(reconciled(child.id), 1);
    // The transfer counterpart in savings is not locked by this account.
    const counterpart = raw.transactions.find(
      r => r.id === byNotes.transfer.transfer_id,
    );
    assert.equal(counterpart.reconciled, 0);
    assert.ok(raw.accounts.find(a => a.id === account).last_reconciled);
  } finally {
    await f.dispose();
  }
});

void test('adjustments and unlocks are explicit and last reconciled survives sync', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const { account, byNotes } = await statementAccount(f);
    const status = await cli(['reconcile', 'status', account]);
    const statement = status.clearedBalance - 700;
    const off = await cli([
      'reconcile',
      'status',
      account,
      '--balance',
      String(statement),
    ]);
    assert.equal(off.difference, -700);
    assert.equal(off.canFinish, false);
    const before = await readRaw(f);
    const adjusted = await cli([
      'reconcile',
      'adjust',
      account,
      '--amount',
      '-700',
      '--date',
      '2026-09-14',
      '--operation-id',
      'adjust',
    ]);
    const [adjustmentId] = adjusted.receipt.outcome.adjustment.transactionIds;
    const after = await readRaw(f);
    const added = after.transactions.filter(
      r => !before.transactions.some(b => b.id === r.id),
    );
    assert.deepEqual(
      added.map(r => [r.id, r.amount, r.cleared, r.notes]),
      [[adjustmentId, -700, 1, 'Reconciliation balance adjustment']],
    );
    for (const table of Object.keys(before)) {
      if (table !== 'transactions') {
        assert.deepEqual(after[table], before[table], `${table} changed`);
      }
    }
    assert.equal(
      await errorCode(f, [
        'reconcile',
        'adjust',
        account,
        '--amount',
        '0',
        '--operation-id',
        'adjust-zero',
      ]),
      'INVALID_INPUT',
    );
    const ready = await cli([
      'reconcile',
      'status',
      account,
      '--balance',
      String(statement),
    ]);
    assert.equal(ready.difference, 0);
    await cli([
      'reconcile',
      'finish',
      account,
      '--balance',
      String(statement),
      '--ids',
      ready.candidateIds.join(','),
      '--operation-id',
      'finish-all',
    ]);
    // Changing a reconciled row needs the explicit unlock.
    assert.equal(
      await errorCode(f, [
        'transactions',
        'clear',
        '--ids',
        byNotes.deposit.id,
        '--uncleared',
        '--operation-id',
        'clear-locked',
      ]),
      'INVALID_INPUT',
    );
    await cli([
      'transactions',
      'clear',
      '--ids',
      byNotes.deposit.id,
      '--unlock',
      '--operation-id',
      'unlock-deposit',
    ]);
    await cli(['sync']);
    const reloaded = await cli(['reconcile', 'status', account]);
    assert.ok(reloaded.account.lastReconciled);
    assert.ok(reloaded.candidateIds.includes(byNotes.deposit.id));
    assert.equal(reloaded.reconciledBalance, statement - 10000);
  } finally {
    await f.dispose();
  }
});

const adjust = {
  operation: 'reconcile.adjust',
  label: 'reconciliation adjustment',
  async setup(f) {
    const account = (
      await legacy(f, ['accounts', 'create', '--name', 'Adjust kit'])
    ).id;
    return { account };
  },
  data: (_f, ctx) => ({
    accountId: ctx.account,
    amount: -700,
    date: '2026-09-14',
  }),
  otherData: (_f, ctx) => ({
    accountId: ctx.account,
    amount: -800,
    date: '2026-09-14',
  }),
  verify(before, after, { outcome, ctx }) {
    for (const table of Object.keys(before)) {
      if (table !== 'transactions') {
        assert.deepEqual(after[table], before[table], `${table} changed`);
      }
    }
    const added = after.transactions.filter(
      r => !before.transactions.some(b => b.id === r.id),
    );
    assert.equal(added.length, 1);
    assert.equal(added[0].amount, -700);
    assert.equal(added[0].acct, ctx.account);
    assert.equal(added[0].cleared, 1);
    if (outcome) {
      assert.deepEqual(outcome.adjustment.transactionIds, [added[0].id]);
    }
  },
};

guardedRegularCases(adjust);
guardedInterruptionCases(adjust);
