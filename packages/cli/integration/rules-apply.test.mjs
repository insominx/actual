import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  assertRawEffect,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for 0023: read-only rule tests that match import
// execution, ordered rules, and guarded historical application of split,
// delete and set actions with precise rejections.

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

async function createRule(f, rule) {
  const data = await legacy(f, [
    'rules',
    'create',
    '--data',
    JSON.stringify(rule),
  ]);
  return typeof data.id === 'string' ? data.id : data.id.id;
}

const range = ['--start', '2026-10-01', '--end', '2026-10-31'];

async function addRows(f, account, rows) {
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    account,
    '--data',
    JSON.stringify(rows),
  ]);
  return legacy(f, ['transactions', 'list', '--account', account, ...range]);
}

void test('rules test matches import execution without writing and reports rule order', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const account = (await legacy(f, ['accounts', 'create', '--name', 'Card']))
      .id;
    const groceries = f.fixture.groceries;
    const coffee = await createRule(f, {
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { field: 'imported_payee', op: 'contains', value: 'Coffee' },
      ],
      actions: [{ op: 'set', field: 'category', value: groceries }],
    });
    const rename = await createRule(f, {
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'imported_payee', op: 'contains', value: 'SHOP' }],
      actions: [{ op: 'set', field: 'payee_name', value: 'Renamed Shop' }],
    });
    const pre = await createRule(f, {
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'amount', op: 'is', value: -777 }],
      actions: [{ op: 'set', field: 'notes', value: 'from pre' }],
    });
    const late = await createRule(f, {
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'amount', op: 'is', value: -777 }],
      actions: [{ op: 'set', field: 'notes', value: 'from default' }],
    });
    const before = await readRaw(f);
    const sample = {
      account,
      date: '2026-10-04',
      amount: -450,
      payee_name: 'coffee bar',
    };
    const tested = await cli([
      'rules',
      'test',
      '--data',
      JSON.stringify(sample),
    ]);
    assert.equal(tested.result.category, groceries);
    assert.deepEqual(tested.result.payee, { newPayee: 'Coffee Bar' });
    assert.deepEqual(
      tested.appliedRules.map(rule => rule.id),
      [coffee],
    );
    assert.deepEqual(tested.newPayees, ['Coffee Bar']);
    assert.ok(tested.changes.some(change => change.field === 'category'));

    // A rule that renames the payee to a new name reports it, creates nothing.
    const renamed = await cli([
      'rules',
      'test',
      '--data',
      JSON.stringify({ ...sample, payee_name: 'SHOP 42', amount: -100 }),
    ]);
    assert.deepEqual(renamed.result.payee, { newPayee: 'Renamed Shop' });
    assert.deepEqual(
      renamed.appliedRules.map(rule => rule.id),
      [rename],
    );

    // Stages run in order; the later rule's value wins.
    const ordered = await cli([
      'rules',
      'test',
      '--data',
      JSON.stringify({ ...sample, payee_name: 'Other', amount: -777 }),
    ]);
    assert.deepEqual(
      ordered.appliedRules.map(rule => rule.id),
      [pre, late],
    );
    assert.equal(ordered.result.notes, 'from default');
    assert.deepEqual(await readRaw(f), before, 'rules test wrote state');

    // Invalid samples are precise input errors.
    for (const data of [
      { ...sample, amount: 1.5 },
      { ...sample, account: 'missing' },
      { ...sample, extra: 1 },
    ]) {
      const result = await f.cli([
        'rules',
        'test',
        '--data',
        JSON.stringify(data),
      ]);
      assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT');
    }

    // Parity: importing the same row stores the tested result.
    const file = join(f.root, 'row.csv');
    await writeFile(file, 'Date,Payee,Amount\n2026-10-04,coffee bar,-4.50\n');
    const settings = JSON.stringify({
      fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
      dateFormat: 'yyyy mm dd',
    });
    await cli([
      'imports',
      'apply',
      file,
      '--account',
      account,
      '--settings',
      settings,
      '--operation-id',
      'rules-parity',
    ]);
    const [imported] = await legacy(f, [
      'transactions',
      'list',
      '--account',
      account,
      ...range,
    ]);
    assert.equal(imported.category, tested.result.category);
    assert.equal(imported.amount, tested.result.amount);
  } finally {
    await f.dispose();
  }
});

void test('historical rules apply previews splits and deletes exactly and rejects stale or reconciled scope', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const account = (await legacy(f, ['accounts', 'create', '--name', 'Old']))
      .id;
    const rows = await addRows(f, account, [
      { date: '2026-10-02', amount: -1000, notes: 'split me' },
      { date: '2026-10-03', amount: -500, notes: 'delete me' },
      { date: '2026-10-04', amount: -300, notes: 'locked' },
    ]);
    const byNotes = Object.fromEntries(rows.map(row => [row.notes, row.id]));
    const split = await createRule(f, {
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'is', value: 'split me' }],
      actions: [
        {
          op: 'set-split-amount',
          field: 'amount',
          value: 50,
          options: { splitIndex: 1, method: 'fixed-percent' },
        },
        {
          op: 'set-split-amount',
          field: 'amount',
          value: 50,
          options: { splitIndex: 2, method: 'fixed-percent' },
        },
      ],
    });
    const del = await createRule(f, {
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'is', value: 'delete me' }],
      actions: [{ op: 'delete-transaction', value: null }],
    });
    const lockRule = await createRule(f, {
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'is', value: 'locked' }],
      actions: [{ op: 'set', field: 'cleared', value: false }],
    });

    const matches = await cli(['rules', 'matches', split]);
    assert.deepEqual(matches.ids, [byNotes['split me']]);
    assert.equal(matches.splitRule, true);

    const before = await readRaw(f);
    const prepared = await cli([
      'changes',
      'preview',
      'rules.apply',
      '--operation-id',
      'split-apply',
      '--data',
      JSON.stringify({ ruleId: split, ids: matches.ids }),
    ]);
    assert.deepEqual(await readRaw(f), before, 'preview wrote state');
    const planned = prepared.proposal.after.rows;
    assert.equal(planned.length, 3);
    assert.equal(planned[0].is_parent, true);
    assert.deepEqual(
      planned.slice(1).map(row => [row.newChildOf, row.amount]),
      [
        [byNotes['split me'], -500],
        [byNotes['split me'], -500],
      ],
    );
    const applied = await cli([
      'changes',
      'apply',
      'split-apply',
      '--token',
      prepared.token,
    ]);
    assert.equal(applied.outcome.status, 'committed-local');
    assert.equal(applied.outcome.ruleApplication.createdIds.length, 2);
    const [parent] = await legacy(f, [
      'transactions',
      'list',
      '--account',
      account,
      ...range,
    ]).then(list => list.filter(row => row.id === byNotes['split me']));
    assert.equal(parent.is_parent, true);
    assert.deepEqual(
      parent.subtransactions.map(row => row.amount),
      [-500, -500],
    );

    // Delete action: preview marks the row deleted; apply deletes it.
    const deletion = await cli([
      'rules',
      'apply',
      del,
      '--ids',
      byNotes['delete me'],
      '--operation-id',
      'delete-apply',
    ]);
    assert.equal(deletion.receipt.proposal.after.rows[0].tombstone, true);
    const remaining = await legacy(f, [
      'transactions',
      'list',
      '--account',
      account,
      ...range,
    ]);
    assert.ok(!remaining.some(row => row.id === byNotes['delete me']));

    // Reconciled candidates need explicit permission.
    await legacy(f, [
      'transactions',
      'update',
      byNotes.locked,
      '--data',
      '{"reconciled":true}',
    ]);
    const locked = await f.cli([
      'rules',
      'apply',
      lockRule,
      '--ids',
      byNotes.locked,
      '--operation-id',
      'locked-apply',
    ]);
    assert.equal(JSON.parse(locked.stdout).error.code, 'INVALID_INPUT');
    await cli([
      'rules',
      'apply',
      lockRule,
      '--ids',
      byNotes.locked,
      '--allow-reconciled',
      '--operation-id',
      'locked-apply-2',
    ]);

    // A transaction that does not match the rule is rejected.
    const unmatched = await f.cli([
      'rules',
      'apply',
      lockRule,
      '--ids',
      byNotes['split me'],
      '--operation-id',
      'unmatched-apply',
    ]);
    assert.equal(JSON.parse(unmatched.stdout).error.code, 'INVALID_INPUT');

    // A rule edited after preview makes the preview stale.
    const rowsNow = await addRows(f, account, [
      { date: '2026-10-05', amount: -200, notes: 'locked' },
    ]);
    const fresh = rowsNow.find(
      row => row.notes === 'locked' && !row.reconciled,
    );
    const stalePrep = await cli([
      'changes',
      'preview',
      'rules.apply',
      '--operation-id',
      'stale-rule',
      '--data',
      JSON.stringify({ ruleId: lockRule, ids: [fresh.id] }),
    ]);
    await legacy(f, [
      'rules',
      'update',
      '--data',
      JSON.stringify({
        id: lockRule,
        stage: null,
        conditionsOp: 'and',
        conditions: [{ field: 'notes', op: 'is', value: 'locked' }],
        actions: [{ op: 'set', field: 'notes', value: 'edited rule' }],
      }),
    ]);
    const beforeStale = await readRaw(f);
    const stale = await f.cli([
      'changes',
      'apply',
      'stale-rule',
      '--token',
      stalePrep.token,
    ]);
    assert.equal(JSON.parse(stale.stdout).error.code, 'STALE_PREVIEW');
    assert.deepEqual(await readRaw(f), beforeStale);

    // Invalid definitions are rejected by rule creation.
    const bad = await f.cli([
      'rules',
      'create',
      '--operation-id',
      'bad-rule',
      '--data',
      JSON.stringify({
        stage: 'sometimes',
        conditionsOp: 'and',
        conditions: [],
        actions: [],
      }),
    ]);
    assert.notEqual(bad.code, 0);
  } finally {
    await f.dispose();
  }
});

const ruleApply = {
  operation: 'rules.apply',
  label: 'rule application',
  async setup(f) {
    const account = (
      await legacy(f, ['accounts', 'create', '--name', 'Rule kit'])
    ).id;
    const rows = await addRows(f, account, [
      { date: '2026-10-02', amount: -100, notes: 'kit one' },
      { date: '2026-10-03', amount: -200, notes: 'kit two' },
    ]);
    const ruleId = await createRule(f, {
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'notes', op: 'contains', value: 'kit' }],
      actions: [{ op: 'set', field: 'notes', value: 'kit ruled' }],
    });
    return { ruleId, ids: rows.map(row => row.id).sort() };
  },
  data: (_f, ctx) => ({ ruleId: ctx.ruleId, ids: ctx.ids }),
  otherData: (_f, ctx) => ({ ruleId: ctx.ruleId, ids: [ctx.ids[0]] }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      for (const row of expected.transactions) {
        if (ctx.ids.includes(row.id)) row.notes = 'kit ruled';
      }
    });
    if (outcome) {
      assert.deepEqual(outcome.ruleApplication.updatedIds.sort(), ctx.ids);
      assert.deepEqual(outcome.ruleApplication.createdIds, []);
    }
  },
};

guardedRegularCases(ruleApply);
guardedInterruptionCases(ruleApply);
