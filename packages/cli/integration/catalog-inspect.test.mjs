import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof that catalog inspection is read-only and reports duplicate
// names, hidden and deleted rows, merge targets and resolved transaction
// counts, including after a guarded category retirement and a payee merge.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

void test('catalog inspection discloses duplicates, deleted targets and moved totals', async () => {
  const f = await createFixture({ encrypted: true, richBackup: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    const account = (
      await legacy(f, ['accounts', 'create', '--name', 'Inspect account'])
    ).id;
    const groupA = (
      await legacy(f, ['category-groups', 'create', '--name', 'Inspect A'])
    ).id;
    const groupB = (
      await legacy(f, ['category-groups', 'create', '--name', 'Inspect B'])
    ).id;
    const keep = (
      await legacy(f, [
        'categories',
        'create',
        '--name',
        'Dup',
        '--group-id',
        groupA,
      ])
    ).id;
    const retire = (
      await legacy(f, [
        'categories',
        'create',
        '--name',
        'Dup',
        '--group-id',
        groupB,
      ])
    ).id;
    const shop = (await legacy(f, ['payees', 'create', '--name', 'Shop'])).id;
    const shop2 = (await legacy(f, ['payees', 'create', '--name', 'Shop'])).id;
    await legacy(f, [
      'transactions',
      'add',
      '--account',
      account,
      '--data',
      JSON.stringify([
        { date: '2026-10-01', amount: -100, category: keep, payee: shop },
        { date: '2026-10-02', amount: -200, category: retire, payee: shop2 },
        { date: '2026-10-03', amount: -300, category: retire, payee: shop2 },
      ]),
    ]);

    const before = await readRaw(f);
    let rows = await cli(['categories', 'inspect', '--name', 'dup']);
    assert.equal(rows.length, 2);
    const byId = (list, id) => list.find(row => row.id === id);
    assert.deepEqual(byId(rows, keep).sameNameIds, [retire]);
    assert.equal(byId(rows, keep).transactionCount, 1);
    assert.equal(byId(rows, retire).transactionCount, 2);
    assert.deepEqual(byId(rows, retire).group, {
      id: groupB,
      name: 'Inspect B',
    });
    const payees = await cli(['payees', 'inspect', '--name', 'shop']);
    assert.deepEqual(byId(payees, shop).sameNameIds, [shop2]);
    assert.deepEqual(await readRaw(f), before, 'inspection wrote state');

    const retired = await cli([
      'categories',
      'delete',
      retire,
      '--transfer-to',
      keep,
      '--operation-id',
      'retire-dup',
    ]);
    assert.equal(retired.receipt.outcome.status, 'committed-local');
    await legacy(f, ['payees', 'merge', '--target', shop, '--ids', shop2]);

    rows = await cli(['categories', 'inspect', '--include-deleted']);
    assert.equal(byId(rows, keep).transactionCount, 3);
    assert.deepEqual(byId(rows, keep).sameNameIds, [retire]);
    assert.equal(byId(rows, retire).deleted, true);
    assert.equal(byId(rows, retire).mappedTo, keep);
    assert.ok(
      !byId(await cli(['categories', 'inspect']), retire),
      'deleted rows are hidden unless requested',
    );
    const merged = await cli(['payees', 'inspect', '--include-deleted']);
    assert.equal(byId(merged, shop).transactionCount, 3);
    assert.equal(byId(merged, shop2).mappedTo, shop);

    // Totals are preserved: the three amounts now resolve to the kept rows.
    const fresh = await f.cli(
      ['--require-fresh', 'categories', 'inspect', '--name', 'dup'],
      { client: 'independent' },
    );
    assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
    assert.equal(byId(JSON.parse(fresh.stdout).data, keep).transactionCount, 3);
  } finally {
    await f.dispose();
  }
});
