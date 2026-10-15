import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Adversarial regressions found by the fork bug hunt. Each case is a minimal
// request that used to pass preview and then either wrote a bad row or failed
// the apply acknowledgement after writing. They run on one disposable budget
// and assert the request is refused at preview with no state change.

function parse(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function preview(f, operation, target, data, id) {
  return f.cli([
    'changes',
    'preview',
    operation,
    ...(target ? [target] : []),
    '--operation-id',
    id,
    '--data',
    JSON.stringify(data),
  ]);
}

async function assertRefused(f, operation, target, data, id) {
  const before = await readRaw(f);
  const result = await preview(f, operation, target, data, id);
  assert.equal(
    result.code,
    2,
    `${id} must be refused at preview: ${result.stdout}${result.stderr}`,
  );
  assert.deepEqual(await readRaw(f), before, `${id} wrote state`);
}

void test(
  'transaction add and import refuse rows that would corrupt or fail after writing',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking, equity, dining, deletedCategory, savings } = f.fixture;
      await f.cli(['accounts', 'list']);
      const listed = parse(await f.cli(['payees', 'list'], { version: '1' }));
      const payees = listed.data ?? listed;
      const transferPayee = payees.find(p => p.transfer_acct === savings).id;
      const day = { date: '2026-09-17', amount: -100 };
      const cases = [
        ['unknown category', checking, { ...day, category: 'nope' }],
        ['deleted category', checking, { ...day, category: deletedCategory }],
        ['unknown payee', checking, { ...day, payee: 'nope' }],
        ['date before 1995', checking, { ...day, date: '1994-12-31' }],
        ['forged transfer link', checking, { ...day, transfer_id: 'abc' }],
        [
          'unbalanced split',
          checking,
          { ...day, subtransactions: [{ amount: -60 }, { amount: -60 }] },
        ],
        [
          'split child with unknown category',
          checking,
          {
            ...day,
            subtransactions: [
              { amount: -60, category: 'nope' },
              { amount: -40 },
            ],
          },
        ],
        [
          'category on an off-budget account',
          equity,
          { ...day, category: dining },
        ],
      ];
      let n = 0;
      for (const [label, account, row] of cases) {
        await assertRefused(
          f,
          'transactions.add',
          account,
          [row],
          `add-${++n}`,
        );
        await assertRefused(
          f,
          'transactions.import',
          account,
          [{ ...row, imported_id: `imp-${n}` }],
          `import-${n}`,
        );
        void label;
      }
      // A transfer payee needs a linked counterpart: add cannot make one.
      await assertRefused(
        f,
        'transactions.add',
        checking,
        [{ ...day, payee: transferPayee }],
        'add-transfer-payee',
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'amounts beyond the budget engine limit are refused instead of bricking the budget',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking, dining } = f.fixture;
      await f.cli(['accounts', 'list']);
      const tooBig = 2 ** 52;
      const day = { date: '2026-09-17', amount: tooBig };
      await assertRefused(f, 'transactions.add', checking, [day], 'big-add');
      await assertRefused(
        f,
        'transactions.import',
        checking,
        [{ ...day, imported_id: 'big' }],
        'big-import',
      );
      await assertRefused(
        f,
        'accounts.create',
        null,
        { name: 'Huge', offbudget: false, initialBalance: tooBig },
        'big-account',
      );
      await assertRefused(
        f,
        'budgets.set-amount',
        dining,
        { month: '2026-08', amount: tooBig },
        'big-budget',
      );
      // The budget still answers: no refused request left a poisoned sum.
      const listed = await f.cli(['accounts', 'list'], { timeout: 20000 });
      assert.equal(listed.code, 0, listed.stdout + listed.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'transaction update and reconcile adjust refuse dates the engine cannot store',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking } = f.fixture;
      await f.cli(['accounts', 'list']);
      const existing = (await readRaw(f)).transactions.find(
        row => row.acct === checking && !row.tombstone,
      );
      assert.ok(existing, 'fixture has a checking transaction');
      for (const date of ['1990-01-01', '2026-02-30']) {
        await assertRefused(
          f,
          'transactions.update',
          existing.id,
          { date },
          `update-${date}`,
        );
        // A date that is not a real day used to be stored as 20260230.
        await assertRefused(
          f,
          'reconcile.adjust',
          null,
          { accountId: checking, amount: 100, date },
          `adjust-${date}`,
        );
      }
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'schedule create and update refuse recurrences the schedule engine cannot evaluate',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking, schedule } = f.fixture;
      await f.cli(['accounts', 'list']);
      const listed = parse(await f.cli(['payees', 'list'], { version: '1' }));
      const payee = (listed.data ?? listed)[0].id;
      const create = date => ({
        name: 'Adversarial',
        posts_transaction: false,
        payee,
        account: checking,
        amount: -4200,
        amountOp: 'is',
        date,
      });
      const bad = [
        { frequency: 'bogus', start: '2026-01-01', endMode: 'never' },
        {
          frequency: 'weekly',
          start: '2026-01-01',
          interval: -1,
          endMode: 'never',
        },
      ];
      let n = 0;
      for (const date of bad) {
        await assertRefused(
          f,
          'schedules.create',
          null,
          create(date),
          `sched-create-${++n}`,
        );
        await assertRefused(
          f,
          'schedules.update',
          schedule,
          { fields: { date } },
          `sched-update-${n}`,
        );
      }
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'rules cannot point at missing rows and stale rules cannot write dangling categories',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking } = f.fixture;
      await f.cli(['accounts', 'list']);
      const listed = parse(await f.cli(['payees', 'list'], { version: '1' }));
      const payee = (listed.data ?? listed)[0].id;
      const rule = action => ({
        stage: 'default',
        conditionsOp: 'and',
        conditions: [{ field: 'account', op: 'is', value: checking }],
        actions: [{ op: 'set', ...action }],
      });
      let n = 0;
      for (const action of [
        { field: 'category', value: 'ghost-category' },
        { field: 'payee', value: 'ghost-payee' },
        { field: 'account', value: 'ghost-account' },
      ]) {
        await assertRefused(
          f,
          'rules.create',
          null,
          rule(action),
          `rule-ghost-${++n}`,
        );
      }
      void payee;
      // The legacy (unguarded) rule command still accepts a missing category.
      const legacy = await f.cli(
        [
          'rules',
          'create',
          '--data',
          JSON.stringify(rule({ field: 'category', value: 'ghost-category' })),
        ],
        { version: '1' },
      );
      assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
      // A guarded add would run that rule, store a dangling category, then fail
      // the receipt read-back after committing. It must be refused at preview.
      await assertRefused(
        f,
        'transactions.add',
        checking,
        [{ date: '2026-09-17', amount: -123, notes: 'hello' }],
        'add-through-ghost-rule',
      );
      await assertRefused(
        f,
        'transactions.import',
        checking,
        [
          {
            date: '2026-09-17',
            amount: -124,
            notes: 'hello',
            imported_id: 'ghost-rule-import',
          },
        ],
        'import-through-ghost-rule',
      );
      await assertRefused(
        f,
        'reconcile.adjust',
        null,
        { accountId: checking, amount: 100 },
        'adjust-through-ghost-rule',
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'file import refusals explain themselves instead of printing [object Object]',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking } = f.fixture;
      await f.cli(['accounts', 'list']);
      const file = join(f.root, 'bad-date.csv');
      await writeFile(file, 'Date,Amount,Payee\n2026-02-30,-5.00,Shop\n');
      const settings = {
        fields: { date: 'Date', amount: 'Amount', payee: 'Payee' },
        dateFormat: 'yyyy mm dd',
        hasHeaderRow: true,
      };
      const result = await f.cli([
        'imports',
        'preview',
        file,
        '--account',
        checking,
        '--no-saved',
        '--settings',
        JSON.stringify(settings),
      ]);
      assert.equal(result.code, 2, result.stdout + result.stderr);
      const message = parse(result)?.error?.message ?? '';
      assert.doesNotMatch(message, /object Object/);
      assert.match(message, /invalid|row 1/i);
    } finally {
      await f.dispose();
    }
  },
);
