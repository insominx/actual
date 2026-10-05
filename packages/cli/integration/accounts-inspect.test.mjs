import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof that account inspection is read-only, separates future
// activity and off-budget money from on-budget totals, discloses duplicate
// names, and that guarded account group changes survive sync.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

void test('account inspection separates totals and account groups survive sync', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    const cash = (
      await legacy(f, [
        'accounts',
        'create',
        '--name',
        'Cash',
        '--balance',
        '1000000',
      ])
    ).id;
    const card = (
      await legacy(f, [
        'accounts',
        'create',
        '--name',
        'Cash',
        '--balance',
        '-200000',
      ])
    ).id;
    const savings = (
      await legacy(f, [
        'accounts',
        'create',
        '--name',
        'Savings',
        '--offbudget',
        '--balance',
        '500000',
      ])
    ).id;
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      cash,
      '--data',
      JSON.stringify([
        { date: '2099-01-15', amount: -30000, cleared: false },
        { date: '2026-01-02', amount: -1000, cleared: false },
      ]),
    ]);

    const before = await readRaw(f);
    const view = await cli(['accounts', 'inspect']);
    assert.deepEqual(await readRaw(f), before, 'inspection wrote state');
    const byId = id => view.accounts.find(row => row.id === id);
    assert.equal(byId(cash).balances.ledger, 999000);
    assert.equal(byId(cash).balances.future, -30000);
    assert.equal(byId(cash).balances.futureTransactionCount, 1);
    assert.equal(
      byId(cash).balances.cleared + byId(cash).balances.uncleared,
      byId(cash).balances.ledger,
    );
    assert.equal(byId(card).balances.ledger, -200000);
    assert.deepEqual(byId(cash).sameNameIds, [card]);
    assert.equal(byId(savings).offbudget, true);
    const resolved = await cli(['query', 'resolve', 'accounts', 'Cash']);
    assert.equal(resolved.status, 'ambiguous', 'duplicate names never guess');
    assert.deepEqual(
      new Set(resolved.matches.map(row => row.id)),
      new Set([cash, card]),
    );
    const sum = predicate =>
      view.accounts
        .filter(row => !row.closed && predicate(row))
        .reduce((total, row) => total + row.balances.ledger, 0);
    assert.equal(
      view.totals.onBudget,
      sum(row => !row.offbudget),
    );
    assert.equal(
      view.totals.offBudget,
      sum(row => row.offbudget),
    );
    assert.equal(view.totals.all, view.totals.onBudget + view.totals.offBudget);

    // Guarded account group lifecycle: create, rename, assign, delete.
    const created = await cli([
      'account-groups',
      'create',
      '--name',
      'Everyday',
      '--operation-id',
      'group-create',
    ]);
    assert.equal(created.receipt.outcome.status, 'committed-local');
    const groupId = created.id;
    const retried = await cli([
      'account-groups',
      'create',
      '--name',
      'Everyday',
      '--operation-id',
      'group-create',
    ]);
    assert.equal(retried.id, groupId, 'retry returns the same group');
    const renamed = await cli([
      'account-groups',
      'update',
      groupId,
      '--name',
      'Daily',
      '--operation-id',
      'group-rename',
    ]);
    assert.equal(renamed.receipt.outcome.status, 'committed-local');
    const assigned = await cli([
      'accounts',
      'update',
      cash,
      '--account-group-id',
      groupId,
      '--operation-id',
      'group-assign',
    ]);
    assert.equal(assigned.receipt.outcome.status, 'committed-local');
    const grouped = (await cli(['accounts', 'inspect'])).accounts.find(
      row => row.id === cash,
    );
    assert.deepEqual(grouped.group, { id: groupId, name: 'Daily' });
    assert.equal(grouped.balances.ledger, 999000, 'grouping keeps balance');

    const fresh = await f.cli(['--require-fresh', 'account-groups', 'list'], {
      client: 'independent',
    });
    assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
    assert.ok(
      JSON.parse(fresh.stdout).data.some(
        group => group.id === groupId && group.name === 'Daily',
      ),
      'renamed group reached an independent client',
    );

    const deleted = await cli([
      'account-groups',
      'delete',
      groupId,
      '--operation-id',
      'group-delete',
    ]);
    assert.equal(deleted.receipt.outcome.status, 'committed-local');
    const after = await cli(['accounts', 'inspect']);
    assert.equal(after.accounts.find(row => row.id === cash).group, null);
    assert.ok(
      !(await cli(['account-groups', 'list'])).some(g => g.id === groupId),
    );

    const missing = await f.cli([
      'account-groups',
      'create',
      '--name',
      'No id',
    ]);
    assert.notEqual(missing.code, 0, 'writes require --operation-id');
  } finally {
    await f.dispose();
  }
});
