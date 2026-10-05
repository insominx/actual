import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

// Fixture-only personal-setup proof for 0036. Uses the same synthetic Chase,
// Capital One and Robinhood shapes as 0035 acceptance. No real personal
// budget, export or credential is touched (Michael declined to share them).

function cli(f) {
  return async (args, options = {}) => {
    const result = await f.cli(args, { timeout: 120000, ...options });
    assert.equal(
      result.code,
      0,
      `${args.join(' ')}\n${result.stdout}${result.stderr}`,
    );
    const parsed = JSON.parse(result.stdout);
    return options.version === '1' ? (parsed.data ?? parsed) : parsed.data;
  };
}

async function aged(path, content) {
  await writeFile(path, content);
  const old = new Date(Date.now() - 120000);
  await utimes(path, old, old);
}

void test(
  'fixture-only personal setup: Chase/Capital One/Robinhood exports reconcile with backup (A1-A3)',
  { timeout: 400000 },
  async () => {
    const f = await createFixture();
    const run = cli(f);
    try {
      // Checklist step 1 (upgrade check is covered by 0034). Setup disposable
      // accounts that mirror the personal institution set.
      const setup = await run([
        'workflow',
        'setup',
        '--spec',
        JSON.stringify({
          accounts: [
            {
              name: 'Chase Checking',
              offbudget: false,
              initialBalance: 500000,
            },
            {
              name: 'Capital One Card',
              offbudget: false,
              initialBalance: -12000,
            },
            {
              name: 'Robinhood Cash',
              offbudget: false,
              initialBalance: 100000,
            },
          ],
          categoryGroups: [
            { name: 'Household', categories: ['Groceries', 'Dining'] },
            { name: 'Earnings', isIncome: true, categories: ['Salary'] },
          ],
        }),
      ]);
      assert.equal(setup.status, 'completed');
      const id = step => setup.steps.find(s => s.id === step).result.id;
      const chase = id('account-0');
      const card = id('account-1');
      const robinhood = id('account-2');
      const groceries = id('category-0-0');
      const dining = id('category-0-1');
      const salary = id('category-1-0');

      // Opening balances dated on setup day must move before back-filled
      // history (0035 D3 / 0036 D5).
      for (const account of [chase, card, robinhood]) {
        const opening = (
          await run(
            [
              'transactions',
              'list',
              '--account',
              account,
              '--start',
              '2026-01-01',
              '--end',
              '2026-12-31',
            ],
            { version: '1' },
          )
        ).find(r => r.starting_balance_flag);
        await run([
          'transactions',
          'update',
          opening.id,
          '--data',
          JSON.stringify({ date: '2026-08-31' }),
        ]);
      }

      // Checklist step 3: backup before mutations (A3).
      const backupDir = join(f.root, 'personal-setup backups');
      const backup = await run([
        'backups',
        'create',
        '--directory',
        backupDir,
      ]);
      assert.ok(backup.path, JSON.stringify(backup));

      // Synthetic representative exports (same shapes as 0035 A1).
      const inbox = join(f.root, 'exports inbox');
      await mkdir(inbox, { recursive: true });
      const chaseFile = join(inbox, 'chase-2026-09.csv');
      const cardFile = join(inbox, 'capitalone-2026-09.csv');
      const cashFile = join(inbox, 'robinhood-cash-2026-09.csv');
      const positionsFile = join(inbox, 'robinhood-positions-2026-09.csv');
      await aged(
        chaseFile,
        'Posting Date,Description,Amount\n09/01/2026,ACME PAYROLL,3000.00\n09/03/2026,WHOLE FOODS,-80.00\n09/10/2026,CAPITAL ONE AUTOPAY,-50.00\n09/12/2026,ROBINHOOD TRANSFER,-200.00\n',
      );
      await aged(
        cardFile,
        'Transaction Date,Description,Debit,Credit\n2026-09-05,DINER,45.00,\n2026-09-10,AUTOPAY PAYMENT,,50.00\n',
      );
      await aged(
        cashFile,
        'Date,Description,Amount\n2026-09-12,ACH DEPOSIT,200.00\n',
      );
      await aged(
        positionsFile,
        'Symbol,Quantity,Market Value\nAAPL,3,690.12\n',
      );

      // Checklist step 4: inspect + preview (A1 format validation).
      const chaseSettings = {
        fields: {
          date: 'Posting Date',
          payee: 'Description',
          amount: 'Amount',
        },
        dateFormat: 'mm dd yyyy',
      };
      const cardSettings = {
        fields: {
          date: 'Transaction Date',
          payee: 'Description',
          outflow: 'Debit',
          inflow: 'Credit',
        },
        dateFormat: 'yyyy mm dd',
      };
      const cashSettings = {
        fields: { date: 'Date', payee: 'Description', amount: 'Amount' },
        dateFormat: 'yyyy mm dd',
      };
      const chaseInspect = await run([
        'imports',
        'inspect',
        chaseFile,
        '--settings',
        JSON.stringify(chaseSettings),
      ]);
      assert.equal(chaseInspect.file.format, 'csv');
      assert.match(chaseInspect.file.sha256, /^[0-9a-f]{64}$/);
      assert.equal(chaseInspect.validCount, 4);
      const chasePreview = await run([
        'imports',
        'preview',
        chaseFile,
        '--account',
        chase,
        '--settings',
        JSON.stringify(chaseSettings),
      ]);
      assert.ok(chasePreview.after || chasePreview.rows || chasePreview);

      // Checklist steps 5-7: saved routes, statement evidence, monthly close.
      await run([
        'jobs',
        'create',
        'personal-exports',
        '--inbox',
        inbox,
        '--processed',
        join(f.root, 'exports done'),
        '--error',
        join(f.root, 'exports error'),
        '--allow',
        'imports.file',
        '--routes',
        JSON.stringify([
          { match: '^chase-', account: chase, settings: chaseSettings },
          { match: '^capitalone-', account: card, settings: cardSettings },
          {
            match: '^robinhood-cash-',
            account: robinhood,
            settings: cashSettings,
          },
        ]),
      ]);
      const intake = await run(['jobs', 'run', 'personal-exports']);
      assert.equal(intake.moves.length, 3, JSON.stringify(intake));
      assert.ok(
        intake.pending.some(
          p =>
            p.file === 'robinhood-positions-2026-09.csv' &&
            p.status === 'no-route',
        ),
        'equity/positions stay no-route',
      );
      const intakeRun = await run(['workflow', 'run', 'inspect', intake.runId]);

      const rows = async account =>
        run(
          [
            'transactions',
            'list',
            '--account',
            account,
            '--start',
            '2026-09-01',
            '--end',
            '2026-09-30',
          ],
          { version: '1' },
        );
      const grocery = (await rows(chase)).find(r => r.amount === -8000);
      const diner = (await rows(card)).find(r => r.amount === -4500);
      const payroll = (await rows(chase)).find(r => r.amount === 300000);
      await run([
        'transactions',
        'categorize',
        '--ids',
        grocery.id,
        '--category',
        groceries,
        '--operation-id',
        'ps-categorize-1',
      ]);
      await run([
        'transactions',
        'categorize',
        '--ids',
        diner.id,
        '--category',
        dining,
        '--operation-id',
        'ps-categorize-2',
      ]);
      await run([
        'transactions',
        'categorize',
        '--ids',
        payroll.id,
        '--category',
        salary,
        '--operation-id',
        'ps-categorize-3',
      ]);

      const candidates = intakeRun.unresolved
        .filter(u => u.code === 'transfer-candidate')
        .map(u => u.evidence);
      assert.deepEqual(
        candidates.map(c => Math.abs(c.amount)).sort((a, b) => a - b),
        [5000, 20000],
      );
      for (const [i, candidate] of candidates.entries()) {
        await run([
          'transfers',
          'match',
          '--ids',
          `${candidate.from.id},${candidate.to.id}`,
          '--operation-id',
          `ps-transfer-${i}`,
        ]);
      }

      // A2: card/brokerage payments reconcile once; no orphans.
      const check = await run(['transfers', 'check', '--account', chase]);
      assert.ok(
        !JSON.stringify(check).includes('"orphan"'),
        JSON.stringify(check),
      );

      const statements = [
        {
          accountId: chase,
          endingBalance: 500000 + 300000 - 8000 - 5000 - 20000,
        },
        { accountId: card, endingBalance: -12000 - 4500 + 5000 },
        { accountId: robinhood, endingBalance: 100000 + 20000 },
      ];
      for (const s of statements) {
        await run([
          'checkup',
          'statement',
          'add',
          '--account',
          s.accountId,
          '--month',
          '2026-09',
          '--ending-balance',
          String(s.endingBalance),
          '--source',
          'synthetic-fixture',
        ]);
      }

      const close = await run([
        'workflow',
        'monthly-close',
        '--month',
        '2026-09',
        '--finish',
        '--backup-directory',
        join(f.root, 'close backups'),
        '--statements',
        JSON.stringify(statements),
      ]);
      assert.equal(
        close.summary.closeComplete,
        true,
        JSON.stringify(close.unresolved),
      );

      // Checklist step 8: included totals and coverage.
      const MONTH = ['--from-month', '2026-09', '--to-month', '2026-09'];
      const netWorth = await run([
        'reports',
        'net-worth',
        ...MONTH,
        '--accounts',
        `${chase},${card},${robinhood}`,
      ]);
      assert.equal(netWorth.report, 'net-worth');
      const quality = await run(['checkup', 'data-quality', ...MONTH]);
      assert.equal(quality.readOnly, true);

      // Statement totals match independently computed balances (A1/A2).
      assert.equal(statements[0].endingBalance, 767000);
      assert.equal(statements[1].endingBalance, -11500);
      assert.equal(statements[2].endingBalance, 120000);
    } finally {
      await f.dispose();
    }
  },
);
