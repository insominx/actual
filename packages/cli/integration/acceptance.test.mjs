import assert from 'node:assert/strict';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFixture, runNode } from './harness.mjs';

// Packaged acceptance for 0035 on a disposable server: six agent-only
// personal workflows over synthetic Chase checking, Capital One card and
// Robinhood cash exports (with a Robinhood positions file that must stay out
// of the budget), every mutation traced to a receipt; then a large synthetic
// history with timings, peak memory, bounded output, paging and two-client
// contention. Metrics go to ACTUAL_TEST_METRICS_OUT when set.

const cliEntry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const MONTH = ['--from-month', '2026-09', '--to-month', '2026-09'];

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
  'six personal workflows on synthetic Chase, Capital One and Robinhood exports, traced to receipts (A1)',
  { timeout: 400000 },
  async () => {
    const f = await createFixture();
    const run = cli(f);
    const operations = [];
    try {
      // 1. Setup: accounts and categories on the selected budget.
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
      operations.push(...setup.summary.operations.map(o => o.operationId));
      const id = step => setup.steps.find(s => s.id === step).result.id;
      const chase = id('account-0');
      const card = id('account-1');
      const robinhood = id('account-2');
      const groceries = id('category-0-0');
      const dining = id('category-0-1');
      const salary = id('category-1-0');
      // Opening balances are dated on the setup day; history imported for an
      // earlier month needs them moved before its first row (decision D3).
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

      // 2. Intake through a saved job; the positions file has no route and
      //    never enters the budget (equity boundary).
      const inbox = join(f.root, 'exports inbox');
      await mkdir(inbox, { recursive: true });
      await aged(
        join(inbox, 'chase-2026-09.csv'),
        'Posting Date,Description,Amount\n09/01/2026,ACME PAYROLL,3000.00\n09/03/2026,WHOLE FOODS,-80.00\n09/10/2026,CAPITAL ONE AUTOPAY,-50.00\n09/12/2026,ROBINHOOD TRANSFER,-200.00\n',
      );
      await aged(
        join(inbox, 'capitalone-2026-09.csv'),
        'Transaction Date,Description,Debit,Credit\n2026-09-05,DINER,45.00,\n2026-09-10,AUTOPAY PAYMENT,,50.00\n',
      );
      await aged(
        join(inbox, 'robinhood-cash-2026-09.csv'),
        'Date,Description,Amount\n2026-09-12,ACH DEPOSIT,200.00\n',
      );
      await aged(
        join(inbox, 'robinhood-positions-2026-09.csv'),
        'Symbol,Quantity,Market Value\nAAPL,3,690.12\n',
      );
      await run([
        'jobs',
        'create',
        'monthly-exports',
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
          {
            match: '^chase-',
            account: chase,
            settings: {
              fields: {
                date: 'Posting Date',
                payee: 'Description',
                amount: 'Amount',
              },
              dateFormat: 'mm dd yyyy',
            },
          },
          {
            match: '^capitalone-',
            account: card,
            settings: {
              fields: {
                date: 'Transaction Date',
                payee: 'Description',
                outflow: 'Debit',
                inflow: 'Credit',
              },
              dateFormat: 'yyyy mm dd',
            },
          },
          {
            match: '^robinhood-cash-',
            account: robinhood,
            settings: {
              fields: { date: 'Date', payee: 'Description', amount: 'Amount' },
              dateFormat: 'yyyy mm dd',
            },
          },
        ]),
      ]);
      const intake = await run(['jobs', 'run', 'monthly-exports']);
      assert.equal(intake.moves.length, 3, JSON.stringify(intake));
      assert.ok(
        intake.pending.some(
          p =>
            p.file === 'robinhood-positions-2026-09.csv' &&
            p.status === 'no-route',
        ),
      );
      const intakeRun = await run(['workflow', 'run', 'inspect', intake.runId]);
      operations.push(...intakeRun.summary.operations.map(o => o.operationId));

      // 3. Categorize and match the card payment and brokerage transfer.
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
          {
            version: '1',
          },
        );
      const grocery = (await rows(chase)).find(r => r.amount === -8000);
      const diner = (await rows(card)).find(r => r.amount === -4500);
      await run([
        'transactions',
        'categorize',
        '--ids',
        grocery.id,
        '--category',
        groceries,
        '--operation-id',
        'acc-categorize-1',
      ]);
      await run([
        'transactions',
        'categorize',
        '--ids',
        diner.id,
        '--category',
        dining,
        '--operation-id',
        'acc-categorize-2',
      ]);
      const payroll = (await rows(chase)).find(r => r.amount === 300000);
      await run([
        'transactions',
        'categorize',
        '--ids',
        payroll.id,
        '--category',
        salary,
        '--operation-id',
        'acc-categorize-3',
      ]);
      operations.push(
        'acc-categorize-1',
        'acc-categorize-2',
        'acc-categorize-3',
      );
      const candidates = intakeRun.unresolved
        .filter(u => u.code === 'transfer-candidate')
        .map(u => u.evidence);
      const amounts = candidates
        .map(c => Math.abs(c.amount))
        .sort((a, b) => a - b);
      assert.deepEqual(amounts, [5000, 20000]);
      for (const [i, candidate] of candidates.entries()) {
        await run([
          'transfers',
          'match',
          '--ids',
          `${candidate.from.id},${candidate.to.id}`,
          '--operation-id',
          `acc-transfer-${i}`,
        ]);
        operations.push(`acc-transfer-${i}`);
      }
      const check = await run(['transfers', 'check', '--account', chase]);
      assert.ok(
        !JSON.stringify(check).includes('"orphan"'),
        JSON.stringify(check),
      );

      // 4. Monthly close against independently computed statement balances.
      const statements = [
        {
          accountId: chase,
          endingBalance: 500000 + 300000 - 8000 - 5000 - 20000,
        },
        { accountId: card, endingBalance: -12000 - 4500 + 5000 },
        { accountId: robinhood, endingBalance: 100000 + 20000 },
      ];
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
      operations.push(...close.summary.operations.map(o => o.operationId));

      // 5. Budget and forecast: allocate, review a goal scenario, save nothing.
      await run([
        'budgets',
        'set-amount',
        '--month',
        '2026-09',
        '--category',
        groceries,
        '--amount',
        '40000',
        '--operation-id',
        'acc-budget-1',
      ]);
      operations.push('acc-budget-1');
      const savedPlan = (await run(['cash-planning', 'inspect'])).saved;
      const review = await run([
        'workflow',
        'goal-review',
        '--scenario',
        JSON.stringify({ categoryTargets: { [groceries]: 45000 } }),
      ]);
      assert.ok(review.steps[0].result.scenario);
      assert.deepEqual(
        (await run(['cash-planning', 'inspect'])).saved,
        savedPlan,
      );

      // 6. Export and resume: net worth CSV for the cash and card accounts,
      //    then an interrupted intake resumed without reimporting.
      const out = join(f.root, 'reports', 'net worth.csv');
      await mkdir(join(f.root, 'reports'));
      const worth = await run([
        'reports',
        'net-worth',
        ...MONTH,
        '--accounts',
        `${chase},${card},${robinhood}`,
        '--export',
        'csv',
        '--out',
        out,
      ]);
      assert.ok((await stat(out)).size > 0);
      assert.equal(worth.report, 'net-worth');
      const csv = await readFile(out, 'utf8');
      const total = String(767000 - 11500 + 120000);
      assert.ok(
        csv.includes(total) || csv.includes(`${total.slice(0, -2)}.00`),
        csv,
      );
      const october = join(f.root, 'chase-2026-10.csv');
      await writeFile(
        october,
        'Posting Date,Description,Amount\n10/01/2026,ACME PAYROLL,3000.00\n',
      );
      const manifest = join(f.root, 'october.json');
      await writeFile(
        manifest,
        JSON.stringify([
          {
            file: october,
            account: chase,
            settings: {
              fields: {
                date: 'Posting Date',
                payee: 'Description',
                amount: 'Amount',
              },
              dateFormat: 'mm dd yyyy',
            },
          },
        ]),
      );
      const paused = await run([
        'workflow',
        'intake',
        manifest,
        '--run-id',
        'wf-october',
        '--stop-after',
        'import-0',
      ]);
      assert.equal(paused.status, 'paused');
      const resumed = await run(['workflow', 'run', 'resume', 'wf-october']);
      assert.ok(['completed', 'needs-review'].includes(resumed.status));
      operations.push(...resumed.summary.operations.map(o => o.operationId));

      // Every mutation is traceable to a committed receipt.
      assert.ok(operations.length >= 15, String(operations.length));
      for (const operationId of operations) {
        const receipt = await run(['changes', 'inspect', operationId]);
        assert.match(
          JSON.stringify(receipt),
          /"(committed-local|synced)"/,
          operationId,
        );
      }
      if (process.env.ACTUAL_TEST_METRICS_OUT) {
        await writeFile(
          `${process.env.ACTUAL_TEST_METRICS_OUT}.receipts.json`,
          JSON.stringify({ operations }, null, 2),
        );
      }
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'large synthetic history: timings, peak memory, bounded output, paging and two-client contention (A3)',
  { timeout: 600000 },
  async () => {
    const f = await createFixture();
    const run = cli(f);
    try {
      const { checking, dining } = f.fixture;
      const total = 6000;
      for (let chunk = 0; chunk < total / 1000; chunk++) {
        const rows = Array.from({ length: 1000 }, (_, i) => {
          const n = chunk * 1000 + i;
          const year = 2024 + Math.floor((n % 24) / 12);
          const m = String(((n % 24) % 12) + 1).padStart(2, '0');
          return {
            date: `${year}-${m}-${String((n % 27) + 1).padStart(2, '0')}`,
            amount: -((n % 97) + 1) * 100,
            payee_name: `Synthetic payee ${n % 150}`,
            ...(n % 3 ? { category: dining } : {}),
            notes: `history ${n}`,
          };
        });
        const file = join(f.root, `history-${chunk}.json`);
        await writeFile(file, JSON.stringify(rows));
        await run(
          ['transactions', 'add', '--account', checking, '--file', file],
          {
            version: '1',
          },
        );
      }
      const measure = async (label, args) => {
        const started = performance.now();
        const result = await runNode(
          [
            '--import',
            'data:text/javascript,process.on("exit",()=>process.stderr.write("MAXRSS="+process.resourceUsage().maxRSS+"\\n"))',
            cliEntry,
            '--output-version',
            '2',
            ...args,
          ],
          {
            cwd: f.root,
            timeout: 120000,
            env: {
              ACTUAL_SERVER_URL: f.serverUrl,
              ACTUAL_PASSWORD: 'disposable-cli-test-password',
              ACTUAL_SYNC_ID: f.fixture.syncId,
              ACTUAL_DATA_DIR: join(f.root, 'a'),
            },
          },
        );
        const ms = Math.round(performance.now() - started);
        assert.equal(
          result.code,
          0,
          `${label}\n${result.stdout}${result.stderr}`,
        );
        const rss = Number(/MAXRSS=(\d+)/.exec(result.stderr)?.[1] ?? 0);
        return {
          label,
          ms,
          maxRssMiB: Math.round(rss / 1024),
          outputBytes: result.stdout.length,
          data: JSON.parse(result.stdout).data,
        };
      };
      const metrics = [];
      metrics.push(await measure('accounts list', ['accounts', 'list']));
      metrics.push(
        await measure('query page (100 rows)', [
          'query',
          'run',
          '--table',
          'transactions',
          '--select',
          'id,date,amount',
          '--order-by',
          'date:desc',
          '--limit',
          '100',
        ]),
      );
      metrics.push(
        await measure('reports cash-flow (24 months)', [
          'reports',
          'cash-flow',
          '--from-month',
          '2024-01',
          '--to-month',
          '2025-12',
        ]),
      );
      metrics.push(
        await measure('checkup data-quality (24 months, limit 50)', [
          'checkup',
          'data-quality',
          '--from-month',
          '2024-01',
          '--to-month',
          '2025-12',
          '--limit',
          '50',
        ]),
      );
      metrics.push(
        await measure('workflow weekly-checkup', [
          'workflow',
          'weekly-checkup',
          '--as-of',
          '2025-12-15',
        ]),
      );
      const page = metrics[1].data;
      const pageRows = Array.isArray(page)
        ? page
        : (page.rows ?? page.data ?? []);
      assert.ok(pageRows.length <= 100, JSON.stringify(page).slice(0, 300));
      const quality = metrics[3].data;
      assert.ok(quality.findings.length <= 50);
      for (const m of metrics) {
        assert.ok(
          m.outputBytes < 5 * 1024 * 1024,
          `${m.label} output is bounded`,
        );
        assert.ok(m.ms < 60000, `${m.label} took ${m.ms}ms`);
      }

      // Two clients categorize the same row: one change commits, the other
      // gets a stale preview or a no-op, and both caches converge.
      const target = (
        await run(
          [
            'transactions',
            'list',
            '--account',
            checking,
            '--start',
            '2025-10-01',
            '--end',
            '2025-10-31',
          ],
          { version: '1' },
        )
      ).find(r => !r.category);
      const [a, b] = await Promise.all([
        f.cli(
          [
            'transactions',
            'categorize',
            '--ids',
            target.id,
            '--category',
            dining,
            '--operation-id',
            'contend-a',
          ],
          { client: 'a', timeout: 120000 },
        ),
        f.cli(
          [
            'transactions',
            'categorize',
            '--ids',
            target.id,
            '--category',
            dining,
            '--operation-id',
            'contend-b',
          ],
          { client: 'b', timeout: 120000 },
        ),
      ]);
      const codes = [a.code, b.code];
      assert.ok(codes.includes(0), a.stdout + b.stdout);
      for (const r of [a, b]) {
        if (r.code !== 0) {
          assert.equal(JSON.parse(r.stdout).error.code, 'STALE_PREVIEW');
        }
      }
      const listA = await run(
        [
          '--refresh',
          'transactions',
          'list',
          '--account',
          checking,
          '--start',
          '2025-10-01',
          '--end',
          '2025-10-31',
        ],
        { client: 'a', version: '1' },
      );
      const listB = await run(
        [
          '--refresh',
          'transactions',
          'list',
          '--account',
          checking,
          '--start',
          '2025-10-01',
          '--end',
          '2025-10-31',
        ],
        { client: 'b', version: '1' },
      );
      assert.deepEqual(listA, listB);
      assert.equal(listA.find(r => r.id === target.id).category, dining);

      const report = {
        transactions: total,
        metrics: metrics.map(({ data: _data, ...m }) => m),
        contention: codes,
      };
      if (process.env.ACTUAL_TEST_METRICS_OUT) {
        await writeFile(
          process.env.ACTUAL_TEST_METRICS_OUT,
          JSON.stringify(report, null, 2),
        );
      }
      console.log(JSON.stringify(report));
    } finally {
      await f.dispose();
    }
  },
);
