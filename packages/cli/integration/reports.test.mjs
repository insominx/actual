import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for 0027: scoped cash flow, category and net worth reports
// reconcile to the fixture ledger (splits, refunds, transfers, a deleted
// category, off-budget tracking, future-dated rows) and exports neutralize
// formula text and keep the completeness label.

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

function pad(n) {
  return String(n).padStart(2, '0');
}

function monthsFromNow(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const HOSTILE_NOTES = '=HYPERLINK("http://x")<script>';

async function seedReportRows(f) {
  const group = (
    await legacy(f, ['category-groups', 'create', '--name', 'Report group'])
  ).id;
  const retired = (
    await legacy(f, [
      'categories',
      'create',
      '--name',
      'Retired later',
      '--group-id',
      group,
    ])
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    f.fixture.checking,
    '--data',
    JSON.stringify([
      {
        date: '2026-08-05',
        amount: -700,
        category: retired,
        payee_name: '@evil',
        notes: HOSTILE_NOTES,
      },
      {
        date: `${monthsFromNow(1)}-01`,
        amount: -300,
        category: f.fixture.dining,
        notes: 'next month',
      },
    ]),
  ]);
  await legacy(f, ['categories', 'delete', retired]);
  return { retired };
}

void test('cash flow and categories reconcile to the ledger with refunds, splits, transfers and a deleted category', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    const { retired } = await seedReportRows(f);
    const before = await readRaw(f);
    const flow = await cli([
      'reports',
      'cash-flow',
      '--from-month',
      '2026-08',
      '--to-month',
      '2026-08',
      '--details',
    ]);
    assert.equal(flow.report, 'cash-flow');
    assert.deepEqual(flow.totals, {
      income: 2000,
      expense: -16700,
      net: -14700,
      transfersOffBudget: 0,
    });
    // Split children count instead of the parent; transfers are excluded.
    assert.equal(flow.months[0].count, 5);
    assert.equal(flow.details.length, 5);
    assert.equal(flow.contributingIds.length, 5);
    assert.equal(flow.contributingTruncated, false);
    assert.equal(flow.scope.currency, 'USD');
    assert.equal(flow.scope.amounts, 'integer cents');
    assert.equal(flow.completeness.note, null);

    const cats = await cli([
      'reports',
      'categories',
      '--from-month',
      '2026-08',
      '--to-month',
      '2026-08',
    ]);
    const byId = Object.fromEntries(
      cats.categories.map(c => [c.categoryId ?? 'none', c]),
    );
    assert.equal(byId[f.fixture.groceries].total, -8000, 'refund nets');
    assert.equal(byId[f.fixture.dining].total, -5000);
    assert.equal(byId[retired].total, -700);
    assert.equal(byId[retired].deleted, true);
    assert.equal(byId[retired].name, 'Retired later');
    assert.equal(byId.none.kind, 'uncategorized');
    assert.equal(byId.none.total, -1000);
    assert.deepEqual(cats.totals, {
      spending: -13700,
      income: 0,
      uncategorized: -1000,
    });
    // Categories and cash flow agree on the same rows.
    assert.equal(
      cats.totals.spending + cats.totals.income + cats.totals.uncategorized,
      flow.totals.net,
    );
    assert.deepEqual(await readRaw(f), before, 'reports wrote state');

    assert.equal(
      await errorCode(f, [
        'reports',
        'cash-flow',
        '--from-month',
        '2026-09',
        '--to-month',
        '2026-08',
      ]),
      'INVALID_INPUT',
    );
    assert.equal(
      await errorCode(f, [
        'reports',
        'categories',
        '--from-month',
        '2026-08',
        '--to-month',
        '2026-08',
        '--accounts',
        'missing-account',
      ]),
      'INVALID_INPUT',
    );
  } finally {
    await f.dispose();
  }
});

void test('net worth separates net cash from off-budget tracking and future rows stay out unless asked for', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await seedReportRows(f);
    const current = monthsFromNow(0);
    const worth = await cli([
      'reports',
      'net-worth',
      '--from-month',
      '2026-08',
      '--to-month',
      current,
    ]);
    const august = worth.months[0];
    assert.equal(august.month, '2026-08');
    assert.equal(august.asOf, '2026-08-31');
    assert.equal(august.netCash, -14700);
    assert.equal(august.tracking, 0);
    const last = worth.months.at(-1);
    const equity = last.accounts.find(a => a.id === f.fixture.equity);
    assert.equal(equity.offBudget, true);
    assert.equal(last.tracking, equity.balance);
    assert.equal(last.netWorth, last.netCash + last.tracking);
    const onBudget = last.accounts
      .filter(a => !a.offBudget)
      .reduce((sum, a) => sum + a.balance, 0);
    assert.equal(last.netCash, onBudget);
    // The 2099 row and the next-month row are after the cutoff.
    const checking = last.accounts.find(a => a.id === f.fixture.checking);
    const rows = await legacy(f, [
      'transactions',
      'list',
      '--account',
      f.fixture.checking,
      '--start',
      '2000-01-01',
      '--end',
      last.asOf,
    ]);
    assert.equal(
      checking.balance,
      rows.reduce((sum, r) => sum + r.amount, 0),
    );
    assert.ok(rows.every(r => r.date <= last.asOf));

    const next = monthsFromNow(1);
    const excluded = await cli([
      'reports',
      'cash-flow',
      '--from-month',
      next,
      '--to-month',
      next,
    ]);
    assert.equal(excluded.scope.futureDated, 'excluded');
    assert.equal(excluded.totals.expense, 0);
    const included = await cli([
      'reports',
      'cash-flow',
      '--from-month',
      next,
      '--to-month',
      next,
      '--include-future',
    ]);
    assert.equal(included.scope.futureDated, 'included');
    assert.equal(included.totals.expense, -300);
  } finally {
    await f.dispose();
  }
});

void test('CSV and HTML exports neutralize hostile text, carry the incompleteness label and never overwrite', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await seedReportRows(f);
    const csvPath = join(f.root, 'flow.csv');
    const range = [
      '--from-month',
      '2026-07',
      '--to-month',
      '2026-08',
      '--details',
    ];
    const written = await cli([
      'reports',
      'cash-flow',
      ...range,
      '--export',
      'csv',
      '--out',
      csvPath,
    ]);
    assert.equal(written.format, 'csv');
    assert.match(written.completeness.note, /before 2026-08-01/);
    const csv = await readFile(csvPath, 'utf8');
    assert.match(
      csv,
      /completeness,"No transactions are recorded before 2026-08-01/,
    );
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")<script>"`), csv);
    assert.ok(csv.includes(`"'@evil"`), csv);
    assert.ok(csv.includes('-700,-7.00'), csv);
    assert.ok(csv.includes('-16700,-167.00'), csv);
    assert.ok(!/(^|,)=HYPERLINK/m.test(csv));

    const htmlPath = join(f.root, 'cats.html');
    await cli([
      'reports',
      'categories',
      ...range,
      '--export',
      'html',
      '--out',
      htmlPath,
    ]);
    const html = await readFile(htmlPath, 'utf8');
    assert.ok(html.includes('&lt;script&gt;'), 'notes escaped');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('@evil'));
    assert.match(html, /No transactions are recorded before 2026-08-01/);
    assert.ok(!/https?:\/\/(?!x)/.test(html), 'self-contained');

    assert.equal(
      await errorCode(f, [
        'reports',
        'cash-flow',
        ...range,
        '--export',
        'csv',
        '--out',
        csvPath,
      ]),
      'INVALID_INPUT',
    );
    assert.equal(
      await errorCode(f, [
        'reports',
        'net-worth',
        ...range,
        '--export',
        'pdf',
        '--out',
        join(f.root, 'x.pdf'),
      ]),
      'INVALID_INPUT',
    );
  } finally {
    await f.dispose();
  }
});
