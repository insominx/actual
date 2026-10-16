import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { unzipSync, zipSync } from 'fflate';

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
  return result;
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
        const refused = await assertRefused(
          f,
          'transactions.update',
          existing.id,
          { date },
          `update-${date}`,
        );
        // The refusal says why instead of a generic "cannot preview".
        assert.doesNotMatch(
          parse(refused)?.error?.message ?? '',
          /Check the identity/,
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

void test(
  'file import refuses an amount beyond the engine limit instead of importing zero',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking } = f.fixture;
      await f.cli(['accounts', 'list']);
      const file = join(f.root, 'huge.csv');
      await writeFile(
        file,
        'Date,Amount,Payee\n2026-09-07,99999999999999999,Shop\n',
      );
      const result = await f.cli([
        'imports',
        'preview',
        file,
        '--account',
        checking,
        '--no-saved',
        '--settings',
        JSON.stringify({
          fields: { date: 'Date', amount: 'Amount', payee: 'Payee' },
          dateFormat: 'yyyy mm dd',
          hasHeaderRow: true,
        }),
      ]);
      assert.equal(result.code, 2, result.stdout + result.stderr);
      assert.match(parse(result)?.error?.message ?? '', /not a number/);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'file import refuses scientific-notation amounts and future two-digit years',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      const { checking } = f.fixture;
      await f.cli(['accounts', 'list']);
      const cases = [
        ['2026 09 07', '1e3', 'yyyy mm dd', /not a number/],
        ['01 01 94', '-3.00', 'mm dd yy', /two-digit year/],
      ];
      let n = 0;
      for (const [date, amount, dateFormat, expected] of cases) {
        const file = join(f.root, `quirk-${++n}.csv`);
        await writeFile(file, `Date,Amount,Payee\n${date},${amount},Shop\n`);
        const result = await f.cli([
          'imports',
          'preview',
          file,
          '--account',
          checking,
          '--no-saved',
          '--settings',
          JSON.stringify({
            fields: { date: 'Date', amount: 'Amount', payee: 'Payee' },
            dateFormat,
            hasHeaderRow: true,
          }),
        ]);
        assert.equal(result.code, 2, result.stdout + result.stderr);
        assert.match(parse(result)?.error?.message ?? '', expected);
      }
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'restore refuses an archive whose database carries a trigger',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      await f.cli(['accounts', 'list']);
      const directory = join(f.root, 'backups');
      const created = await f.cli([
        '--offline',
        'backups',
        'create',
        '--directory',
        directory,
      ]);
      assert.equal(created.code, 0, created.stderr);
      const source = parse(created).data.path;
      // Rewrite the archive with a trigger that would delete accounts on the
      // next transaction insert, then fix the manifest hash so only the
      // database content is suspicious.
      const evil = join(directory, 'trigger.actualbackup');
      await cp(source, evil, { recursive: true });
      const entries = unzipSync(await readFile(join(evil, 'budget.zip')));
      const scratch = join(await mkdtemp(join(tmpdir(), 'adv-trigger-')), 'db');
      await writeFile(scratch, entries['db.sqlite']);
      const database = new DatabaseSync(scratch);
      database.exec(
        'CREATE TRIGGER evil AFTER INSERT ON transactions BEGIN DELETE FROM accounts; END;',
      );
      database.close();
      entries['db.sqlite'] = new Uint8Array(await readFile(scratch));
      const zip = zipSync(entries);
      await writeFile(join(evil, 'budget.zip'), zip);
      const manifest = JSON.parse(
        await readFile(join(evil, 'manifest.json'), 'utf8'),
      );
      manifest.bytes = zip.length;
      manifest.sha256 = createHash('sha256').update(zip).digest('hex');
      await writeFile(join(evil, 'manifest.json'), JSON.stringify(manifest));
      const before = (await readdir(join(f.root, 'a'))).sort();
      const restored = await f.cli([
        '--offline',
        'backups',
        'restore',
        evil,
        '--name',
        'Trigger restore',
        '--operation-id',
        'trigger-restore',
      ]);
      assert.equal(restored.code, 2, restored.stdout + restored.stderr);
      assert.deepEqual((await readdir(join(f.root, 'a'))).sort(), before);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'cash plan refuses a forecast horizon that would never finish computing',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      await f.cli(['accounts', 'list']);
      const inspected = await f.cli(
        [
          'cash-planning',
          'inspect',
          '--scenario',
          JSON.stringify({ forecastEndDate: '9999-12-31' }),
        ],
        { timeout: 20000 },
      );
      assert.equal(inspected.code, 2, inspected.stdout + inspected.stderr);
      assert.match(inspected.stdout + inspected.stderr, /within 50 years/);
      const saved = await preview(
        f,
        'cash-planning.save',
        null,
        {
          config: {
            startDate: '2026-01-01',
            endDate: '2026-09-30',
            forecastEndDate: '9999-12-31',
          },
        },
        'cash-far',
      );
      assert.equal(saved.code, 2, saved.stdout + saved.stderr);
      const fine = await f.cli(['cash-planning', 'inspect'], {
        timeout: 20000,
      });
      assert.equal(fine.code, 0, fine.stdout + fine.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'closing an account refuses to move its balance into a closed account',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      await f.cli(['accounts', 'list']);
      const refused = await assertRefused(
        f,
        'accounts.close',
        f.fixture.checking,
        { transferAccount: f.fixture.closed },
        'close-into-closed',
      );
      assert.match(refused.stdout + refused.stderr, /closed/i);
      const ok = await preview(
        f,
        'accounts.close',
        f.fixture.checking,
        { transferAccount: f.fixture.savings },
        'close-into-open',
      );
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'import inspection explains why settings or files are refused',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      await f.cli(['accounts', 'list']);
      const file = join(f.root, 'explain.csv');
      await writeFile(file, 'Date,Amount\n2026-09-01,-1.00\n');
      const settings = {
        fields: { date: 'Date', amount: 'Amount' },
        dateFormat: 'yyyy mm dd',
      };
      for (const bad of [
        { ...settings, skipStartLines: -1 },
        { ...settings, delimiter: 'ab' },
        { ...settings, multiplier: 0 },
      ]) {
        const result = await f.cli([
          'imports',
          'inspect',
          file,
          '--settings',
          JSON.stringify(bad),
        ]);
        assert.equal(result.code, 2, result.stdout + result.stderr);
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /The engine operation failed/,
        );
      }
      const ok = await f.cli([
        'imports',
        'inspect',
        file,
        '--settings',
        JSON.stringify(settings),
      ]);
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'malformed flags and unknown ids are explained, not reported as engine failures',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ richBackup: true });
    try {
      await f.cli(['accounts', 'list']);
      for (const [args, pattern] of [
        [['transactions', 'merge', '--ids', 'zzz'], /exactly two/],
        [['transfers', 'match', '--ids', 'zzz'], /exactly two/],
        [['transfers', 'inspect', 'zzz'], /./],
        [
          [
            'jobs',
            'create',
            'bad-flag',
            '--inbox',
            'a',
            '--processed',
            'b',
            '--error',
            'c',
            '--routes',
            '[]',
            '--allow',
            'imports.file',
            '--stable-seconds',
            'zzz',
          ],
          /stable-seconds/,
        ],
        [['jobs', 'schedule', 'nope', '--every', 'zzz'], /--every/],
        [
          ['rules', 'test', '--data', '{}', '--file', 'zzz'],
          /--data and --file/,
        ],
        // Usage errors on subcommands are structured too (they used to print
        // text and exit 1), and validation errors keep their reason.
        [['accounts', 'create'], /required option '--name <name>'/],
        [['transactions', 'list'], /required option '--account <id>'/],
        [['query', 'run'], /--table is required/],
        [
          [
            'query',
            'run',
            '--table',
            'transactions',
            '--last',
            '1',
            '--limit',
            '2',
          ],
          /mutually exclusive/,
        ],
        [
          ['categories', 'update', 'zzz', '--operation-id', 'u1'],
          /No update fields/,
        ],
        [
          ['payees', 'update', 'zzz', '--operation-id', 'u2'],
          /No fields to update/,
        ],
      ]) {
        const result = await f.cli(args, { version: '2' });
        assert.equal(result.code, 2, `${args.join(' ')}: ${result.stdout}`);
        assert.match(result.stdout, pattern, args.join(' '));
        assert.doesNotMatch(result.stdout, /The engine operation failed/);
      }
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'category and group duplicate names are refused with a reason on create, rename and move',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({});
    try {
      let n = 0;
      const run = async args => {
        const result = await f.cli([...args, '--operation-id', `dup-${++n}`]);
        return { code: result.code, body: parse(result) };
      };
      const g1 = (await run(['category-groups', 'create', '--name', 'G1'])).body
        .data.id;
      const g2 = (await run(['category-groups', 'create', '--name', 'G2'])).body
        .data.id;
      const alpha = (
        await run(['categories', 'create', '--name', 'Alpha', '--group-id', g1])
      ).body.data.id;
      const beta = (
        await run(['categories', 'create', '--name', 'Beta', '--group-id', g1])
      ).body.data.id;
      const other = (
        await run(['categories', 'create', '--name', 'alpha', '--group-id', g2])
      ).body.data.id;
      assert.ok(alpha && beta && other);

      for (const [args, pattern] of [
        [
          ['categories', 'create', '--name', 'ALPHA', '--group-id', g1],
          /already exists/,
        ],
        [['category-groups', 'create', '--name', 'g1'], /already exists/],
        [['category-groups', 'update', g2, '--name', 'G1'], /already exists/],
        [['categories', 'update', beta, '--name', 'ALPHA'], /already exists/],
        [['categories', 'update', beta, '--name', 'Alpha'], /already exists/],
        [['categories', 'update', other, '--group-id', g1], /already exists/],
      ]) {
        const result = await run(args);
        assert.equal(result.code, 2, args.join(' '));
        assert.match(result.body.error.message, pattern, args.join(' '));
        assert.doesNotMatch(result.body.error.message, /Check the identity/);
      }
      // Same name in another group, or a rename to itself in a new case, is fine.
      assert.equal(
        (await run(['categories', 'update', alpha, '--name', 'ALPHA'])).code,
        0,
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'workflow as-of dates must be real calendar days and refuse before a run starts',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({});
    try {
      for (const asOf of [
        '2026-02-31',
        '2025-02-29',
        '2026-13-01',
        '0000-01-01',
      ]) {
        const result = await f.cli([
          'workflow',
          'weekly-checkup',
          '--as-of',
          asOf,
        ]);
        assert.equal(
          result.code,
          2,
          `${asOf}: ${result.stdout}${result.stderr}`,
        );
        assert.equal(parse(result).error.code, 'INVALID_INPUT');
      }
      const ok = await f.cli([
        'workflow',
        'weekly-checkup',
        '--as-of',
        '2024-02-29',
      ]);
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'JSON input with a lone surrogate or invalid UTF-8 is refused instead of leaving an uncertain receipt',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({});
    try {
      const accounts = await f.cli(['accounts', 'list'], { version: '1' });
      const account = JSON.parse(accounts.stdout).find(a => !a.offbudget).id;
      const lone = await f.cli([
        'transactions',
        'add',
        '--account',
        account,
        '--data',
        '[{"date":"2026-10-03","amount":-1,"notes":"\\ud800"}]',
        '--operation-id',
        'lone-surrogate',
      ]);
      assert.equal(lone.code, 2, lone.stdout + lone.stderr);
      assert.match(parse(lone).error.message, /lone surrogate/);
      const file = join(f.root, 'latin1.json');
      await writeFile(
        file,
        Buffer.concat([
          Buffer.from('[{"date":"2026-10-03","amount":-1,"notes":"caf'),
          Buffer.from([0xe9]),
          Buffer.from('"}]'),
        ]),
      );
      const bad = await f.cli([
        'transactions',
        'add',
        '--account',
        account,
        '--file',
        file,
        '--operation-id',
        'latin1-json',
      ]);
      assert.equal(bad.code, 2, bad.stdout + bad.stderr);
      assert.match(parse(bad).error.message, /not valid UTF-8/);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'a batch whose receipt would not fit with its outcome is refused at preview, not committed and left uncertain',
  { timeout: 180000 },
  async () => {
    const f = await createFixture({});
    try {
      const accounts = await f.cli(['accounts', 'list'], { version: '1' });
      const account = JSON.parse(accounts.stdout).find(a => !a.offbudget).id;
      const count = async () => {
        const list = await f.cli(
          [
            'transactions',
            'list',
            '--account',
            account,
            '--start',
            '2026-10-01',
            '--end',
            '2026-10-01',
          ],
          { version: '1' },
        );
        return JSON.parse(list.stdout).length;
      };
      const rows = file =>
        writeFile(
          file,
          JSON.stringify(
            Array.from(
              { length: file.endsWith('big.json') ? 2000 : 300 },
              (_, i) => ({
                date: '2026-10-01',
                amount: -((i % 1000) + 1),
              }),
            ),
          ),
        );
      const big = join(f.root, 'big.json');
      await rows(big);
      const refused = await f.cli(
        [
          'transactions',
          'add',
          '--account',
          account,
          '--file',
          big,
          '--operation-id',
          'too-big',
        ],
        { timeout: 120000 },
      );
      assert.equal(refused.code, 2, refused.stdout + refused.stderr);
      assert.match(parse(refused).error.message, /too large|one MiB/);
      assert.equal(await count(), 0);
      const small = join(f.root, 'small.json');
      await rows(small);
      const ok = await f.cli(
        [
          'transactions',
          'add',
          '--account',
          account,
          '--file',
          small,
          '--operation-id',
          'fits',
        ],
        { timeout: 120000 },
      );
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
      assert.equal(await count(), 300);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'parallel invocations all sign in; the sync server refuses more than five simultaneous sign-ins',
  { timeout: 180000 },
  async () => {
    const f = await createFixture({});
    try {
      const first = await f.cli(['accounts', 'list']);
      assert.equal(first.code, 0, first.stderr);
      const results = await Promise.all(
        Array.from({ length: 14 }, () =>
          f.cli(['accounts', 'list'], { timeout: 120000 }),
        ),
      );
      const failures = results.filter(result => result.code !== 0);
      assert.equal(
        failures.length,
        0,
        failures.map(result => result.stdout).join('\n'),
      );
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'a damaged saved copy is reported as such and recovers once it is removed',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({});
    try {
      const first = await f.cli(['accounts', 'list']);
      assert.equal(first.code, 0, first.stderr);
      const dataDir = join(f.root, 'a');
      const budget = (await readdir(dataDir)).find(name =>
        name.startsWith('Agent-CLI'),
      );
      await writeFile(
        join(dataDir, budget, 'db.sqlite'),
        Buffer.alloc(40000, 7),
      );
      const broken = await f.cli(['accounts', 'list']);
      assert.equal(broken.code, 5, broken.stdout);
      const { error } = JSON.parse(broken.stdout);
      assert.equal(error.details.issue, 'local-budget-unreadable');
      assert.equal(error.retryable, false);
      assert.ok(error.message.includes(join(dataDir, budget)), error.message);
      await rm(join(dataDir, budget), { recursive: true, force: true });
      await rm(join(dataDir, '.actual-cli'), { recursive: true, force: true });
      const healed = await f.cli(['accounts', 'list']);
      assert.equal(healed.code, 0, healed.stdout + healed.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'a budget saved by a different version is reported as a version mismatch',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({});
    try {
      const first = await f.cli(['accounts', 'list']);
      assert.equal(first.code, 0, first.stderr);
      const dataDir = join(f.root, 'a');
      const budget = (await readdir(dataDir)).find(name =>
        name.startsWith('Agent-CLI'),
      );
      const db = new DatabaseSync(join(dataDir, budget, 'db.sqlite'));
      // A newer migration next to a missing known one is what a database
      // written by another version looks like to this engine.
      db.prepare('INSERT INTO __migrations__ (id) VALUES (?)').run(
        99999999999999,
      );
      db.prepare(
        'DELETE FROM __migrations__ WHERE id = (SELECT MIN(id) FROM __migrations__)',
      ).run();
      db.close();
      const result = await f.cli(['accounts', 'list']);
      assert.equal(result.code, 5, result.stdout);
      const { error } = JSON.parse(result.stdout);
      assert.equal(error.details.issue, 'budget-version-mismatch');
      assert.equal(error.retryable, false);
      assert.match(error.message, /different version/);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'amounts that individually fit but add up past the engine limit are refused instead of stalling the budget',
  { timeout: 180000 },
  async () => {
    const f = await createFixture({});
    try {
      const accounts = JSON.parse(
        (await f.cli(['accounts', 'list'], { version: '1' })).stdout,
      );
      const account = accounts.find(a => !a.offbudget).id;
      const big = amount =>
        JSON.stringify([{ date: '2026-05-01', amount, notes: 'big' }]);
      const add = async (amount, id) => {
        await writeFile(join(f.root, `${id}.json`), big(amount));
        return f.cli(
          [
            'transactions',
            'add',
            '--account',
            account,
            '--file',
            join(f.root, `${id}.json`),
            '--operation-id',
            id,
          ],
          { timeout: 60000 },
        );
      };
      assert.equal((await add(1100000000000000, 'big-1')).code, 0);
      assert.equal((await add(1100000000000000, 'big-2')).code, 0);
      const refused = await add(1100000000000000, 'big-3');
      assert.equal(refused.code, 2, refused.stdout);
      assert.match(
        JSON.parse(refused.stdout).error.message,
        /more than the budget engine can calculate/,
      );
      // Budgeted amounts count too, and re-allocating a cell replaces its value.
      const month = '2026-05';
      const set = amount =>
        f.cli(
          [
            'budgets',
            'set-amount',
            '--month',
            month,
            '--category',
            f.fixture.dining,
            '--amount',
            String(amount),
            '--operation-id',
            `set-${amount}`,
          ],
          { timeout: 60000 },
        );
      assert.equal((await set(60000000000000)).code, 2);
      assert.equal((await set(1000)).code, 0);
      assert.equal(
        (await set(500)).code,
        0,
        'a smaller value replaces the old one',
      );
      await writeFile(join(f.root, 'legacy.json'), big(1100000000000000));
      const legacy = await f.cli(
        [
          'transactions',
          'add',
          '--account',
          account,
          '--file',
          join(f.root, 'legacy.json'),
        ],
        { version: '1', timeout: 60000 },
      );
      assert.notEqual(legacy.code, 0, 'the unguarded form refuses it too');
      // The budget still opens and answers.
      const list = await f.cli(['accounts', 'list'], { timeout: 60000 });
      assert.equal(list.code, 0, list.stdout + list.stderr);
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'a rule pattern that backtracks exponentially is refused when written and never stalls a test run',
  { timeout: 120000 },
  async () => {
    const f = await createFixture({});
    try {
      const accounts = JSON.parse(
        (await f.cli(['accounts', 'list'], { version: '1' })).stdout,
      );
      const account = accounts.find(a => !a.offbudget).id;
      const rule = pattern => ({
        stage: null,
        conditionsOp: 'and',
        conditions: [{ field: 'notes', op: 'matches', value: pattern }],
        actions: [{ op: 'set', field: 'notes', value: 'changed' }],
      });
      const create = (pattern, id) =>
        f.cli([
          'rules',
          'create',
          '--data',
          JSON.stringify(rule(pattern)),
          '--operation-id',
          id,
        ]);
      const refused = await create('(a+)+$', 'redos-1');
      assert.equal(refused.code, 2, refused.stdout);
      assert.match(
        JSON.parse(refused.stdout).error.message,
        /repeats a group that already repeats/,
      );
      // A rule that predates the refusal (or comes from the unguarded form)
      // must not stall evaluation either.
      await f.cli(
        ['rules', 'create', '--data', JSON.stringify(rule('(a+)+$'))],
        {
          version: '1',
        },
      );
      const ok = await create('^(amazon|amzn)\\b', 'redos-2');
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
      const started = Date.now();
      const tested = await f.cli(
        [
          'rules',
          'test',
          '--data',
          JSON.stringify({
            account,
            date: '2026-05-01',
            amount: -100,
            notes: `${'a'.repeat(60)}!`,
          }),
        ],
        { timeout: 60000 },
      );
      assert.equal(tested.code, 0, tested.stdout + tested.stderr);
      assert.ok(Date.now() - started < 20000);
    } finally {
      await f.dispose();
    }
  },
);
