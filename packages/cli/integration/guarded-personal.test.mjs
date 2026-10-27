import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for the guarded operations added for personal bookkeeping:
// transfers create, transactions update-many, budgets set-type, and
// changes resolve's refusal of anything but an uncertain receipt.

function strict(f) {
  return async (args, options) => {
    const result = await f.cli(args, options);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout).data;
  };
}

void test('transfers create links a new counterpart; update-many sets per-row fields', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const added = await cli([
      'transactions',
      'add',
      '--account',
      f.fixture.checking,
      '--operation-id',
      'personal-add',
      '--data',
      JSON.stringify([
        { date: '2026-10-20', amount: -12500, payee_name: 'To savings' },
        { date: '2026-10-21', amount: -500, payee_name: 'Coffee' },
      ]),
    ]);
    const [withdrawal, coffee] = added.ids;

    const created = await cli([
      'transfers',
      'create',
      withdrawal,
      '--account',
      f.fixture.savings,
      '--operation-id',
      'personal-transfer',
    ]);
    const counterpartId = created.receipt.outcome.transferCreate.counterpartId;
    const raw = await readRaw(f);
    const source = raw.transactions.find(row => row.id === withdrawal);
    const counterpart = raw.transactions.find(row => row.id === counterpartId);
    assert.equal(source.transferred_id, counterpartId);
    assert.equal(counterpart.transferred_id, withdrawal);
    assert.equal(counterpart.acct, f.fixture.savings);
    assert.equal(counterpart.amount, 12500);
    // A retry with the same operation ID returns the receipt and adds nothing.
    await cli([
      'transfers',
      'create',
      withdrawal,
      '--account',
      f.fixture.savings,
      '--operation-id',
      'personal-transfer',
    ]);
    assert.equal(
      (await readRaw(f)).transactions.filter(
        row => row.acct === f.fixture.savings && !row.tombstone,
      ).length,
      raw.transactions.filter(
        row => row.acct === f.fixture.savings && !row.tombstone,
      ).length,
    );

    const updated = await cli([
      'transactions',
      'update-many',
      '--operation-id',
      'personal-update-many',
      '--data',
      JSON.stringify([
        { id: coffee, notes: 'with a friend', category: f.fixture.dining },
      ]),
    ]);
    assert.deepEqual(updated.receipt.proposal.after.changedIds, [coffee]);
    const row = (await readRaw(f)).transactions.find(r => r.id === coffee);
    assert.equal(row.notes, 'with a friend');
    assert.equal(row.category, f.fixture.dining);
    assert.equal(row.amount, -500);
  } finally {
    await f.dispose();
  }
});

void test('budgets set-type switches and restores each type with its own amounts', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const month = '2026-10';
    await cli([
      'budgets',
      'set-amount',
      '--month',
      month,
      '--category',
      f.fixture.dining,
      '--amount',
      '30000',
      '--operation-id',
      'personal-envelope-amount',
    ]);
    const tracking = await cli([
      'budgets',
      'set-type',
      '--type',
      'tracking',
      '--operation-id',
      'personal-set-tracking',
    ]);
    assert.equal(tracking.receipt.proposal.before.type, 'envelope');
    assert.equal(tracking.receipt.outcome.changed, true);
    const inTracking = await cli(['budgets', 'month', month]);
    assert.equal(inTracking.toBudget ?? null, null);
    const back = await cli([
      'budgets',
      'set-type',
      '--type',
      'envelope',
      '--operation-id',
      'personal-set-envelope',
    ]);
    assert.equal(back.receipt.outcome.changed, true);
    const restored = await cli(['budgets', 'month', month]);
    assert.equal(restored.totalBudgeted, -30000);

    // A committed receipt is not something resolve can act on.
    const refused = await f.cli([
      'changes',
      'resolve',
      'personal-set-envelope',
    ]);
    assert.notEqual(refused.code, 0);
    assert.equal(JSON.parse(refused.stdout).error.code, 'INVALID_INPUT');
  } finally {
    await f.dispose();
  }
});

void test('imports --max-day-gap adds a look-alike from last week and --only-new leaves matched rows alone', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const account = f.fixture.savings;
    await cli([
      'transactions',
      'add',
      '--account',
      account,
      '--operation-id',
      'personal-weekly',
      '--data',
      JSON.stringify([
        {
          date: '2026-10-05',
          amount: 20000,
          payee_name: 'Weekly',
          notes: 'curated',
        },
      ]),
    ]);
    const settings = JSON.stringify({
      fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
      dateFormat: 'yyyy mm dd',
    });
    const csv = async (name, dates, payee = 'Weekly transfer') => {
      const file = join(f.root, name);
      await writeFile(
        file,
        [
          'Date,Payee,Amount',
          ...dates.map(date => `${date},${payee},200.00`),
          '',
        ].join('\n'),
      );
      return [file, '--account', account, '--no-saved', '--settings', settings];
    };

    // Next week's identical transfer: by default it matches this week's
    // transaction (7 days away) and would be dropped; with a 3-day limit it
    // is added.
    const nextWeek = await csv('next-week.csv', ['2026-10-12']);
    const plain = await cli(['imports', 'preview', ...nextWeek]);
    assert.equal(plain.after.summary.add, 0);
    assert.equal(plain.after.rows[0].match.dayGap, 7);
    const limited = await cli([
      'imports',
      'preview',
      ...nextWeek,
      '--max-day-gap',
      '3',
    ]);
    assert.equal(limited.after.rows[0].outcome, 'add');
    assert.equal(limited.after.rows[0].match.forcedAdd, true);
    await cli([
      'imports',
      'apply',
      ...nextWeek,
      '--max-day-gap',
      '3',
      '--operation-id',
      'personal-import-gap',
    ]);
    assert.equal(
      (await readRaw(f)).transactions.filter(
        row => row.acct === account && !row.tombstone && row.amount === 20000,
      ).length,
      2,
    );

    // Batch flags reach every file: a week later again, previewed in a batch.
    const following = await csv('following-week.csv', ['2026-10-19']);
    await writeFile(
      join(f.root, 'batch.json'),
      JSON.stringify([
        {
          file: following[0],
          account,
          useSaved: false,
          settings: JSON.parse(settings),
        },
      ]),
    );
    const batchPlain = await cli([
      'imports',
      'batch',
      join(f.root, 'batch.json'),
      '--dry-run',
    ]);
    assert.equal(batchPlain.files[0].summary.add, 0);
    const batchLimited = await cli([
      'imports',
      'batch',
      join(f.root, 'batch.json'),
      '--dry-run',
      '--max-day-gap',
      '3',
    ]);
    assert.equal(batchLimited.files[0].summary.add, 1);

    // The same-day row matches the curated transaction. By default the import
    // would refresh its imported payee; --only-new leaves it untouched.
    // Same payee as the curated row once title-cased (so it is the match, not
    // next week's row), but different raw text, which a refresh would copy.
    const sameDay = await csv('same-day.csv', ['2026-10-05'], 'WEEKLY');
    const refreshing = await cli(['imports', 'preview', ...sameDay]);
    assert.equal(refreshing.after.summary.update, 1);
    const onlyNew = await cli(['imports', 'preview', ...sameDay, '--only-new']);
    assert.equal(onlyNew.after.summary.update, 0);
    assert.equal(onlyNew.after.rows[0].outcome, 'duplicate');
    await cli([
      'imports',
      'apply',
      ...sameDay,
      '--only-new',
      '--operation-id',
      'personal-import-only-new',
    ]);
    const curated = (await readRaw(f)).transactions.find(
      row => row.acct === account && row.date === 20261005 && !row.tombstone,
    );
    assert.equal(curated.notes, 'curated');
    assert.equal(curated.imported_description, 'Weekly');
  } finally {
    await f.dispose();
  }
});

void test('rules check reports only transactions the rules would change', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    // The default fixture seeds no rules; add one that sets dining by notes.
    const created = await f.cli(
      [
        'rules',
        'create',
        '--data',
        JSON.stringify({
          stage: 'pre',
          conditionsOp: 'and',
          conditions: [
            { field: 'notes', op: 'contains', value: 'Disposable rule' },
          ],
          actions: [{ op: 'set', field: 'category', value: f.fixture.dining }],
        }),
      ],
      { version: '1' },
    );
    assert.equal(created.code, 0, created.stdout + created.stderr);
    const parsed = JSON.parse(created.stdout);
    // Like the other create commands, version 1 prints the new id.
    const { id: ruleId } = parsed.data ?? parsed;
    assert.equal(typeof ruleId, 'string');
    const added = await cli([
      'transactions',
      'add',
      '--account',
      f.fixture.checking,
      '--operation-id',
      'personal-rule-rows',
      '--data',
      JSON.stringify([
        { date: '2026-10-02', amount: -900, notes: 'Disposable rule lunch' },
        { date: '2026-10-03', amount: -400, notes: 'Unrelated' },
      ]),
    ]);
    const [ruled, plain] = added.ids;
    // A manual category that the seeded rule (notes -> dining) disagrees with.
    await cli([
      'transactions',
      'update-many',
      '--operation-id',
      'personal-rule-manual',
      '--data',
      JSON.stringify([
        { id: ruled, category: f.fixture.groceries },
        { id: plain, category: f.fixture.groceries },
      ]),
    ]);
    const report = await cli(['rules', 'check', '--ids', `${ruled},${plain}`]);
    assert.equal(report.checked, 2);
    // The seeded schedule's own rule runs too.
    assert.equal(report.rules, 2);
    assert.deepEqual(
      report.drifted.map(row => row.id),
      [ruled],
    );
    assert.equal(report.drifted[0].current.category, f.fixture.groceries);
    assert.equal(report.drifted[0].rules.category, f.fixture.dining);
    assert.deepEqual(report.drifted[0].appliedRules, [ruleId]);
    const refused = await f.cli(['rules', 'check']);
    assert.notEqual(refused.code, 0);
  } finally {
    await f.dispose();
  }
});
