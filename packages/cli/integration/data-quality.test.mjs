import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for 0028: read-only data-quality findings over seeded
// duplicates, uncategorized rows, an orphan transfer and a statement
// discrepancy; coverage that stays unknown without statement evidence; and
// repeated checkups that write nothing.

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

const RANGE = ['--from-month', '2026-07', '--to-month', '2026-09'];

async function seed(f) {
  const payees = await legacy(f, ['payees', 'list']);
  const transferPayee = payees.find(
    p => p.transfer_acct === f.fixture.savings,
  ).id;
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    f.fixture.checking,
    '--data',
    JSON.stringify([
      {
        date: '2026-08-10',
        amount: -4321,
        payee_name: 'Dup shop',
        category: f.fixture.dining,
        notes: 'dup a',
      },
      {
        date: '2026-08-11',
        amount: -4321,
        payee_name: 'Dup shop',
        category: f.fixture.dining,
        notes: 'dup b',
      },
      {
        date: '2026-08-12',
        amount: -555,
        category: f.fixture.dining,
        imported_id: 'bank-1',
        notes: 'bank a',
      },
      {
        date: '2026-08-12',
        amount: -555,
        category: f.fixture.dining,
        imported_id: 'bank-2',
        notes: 'bank b',
      },
      // A transfer payee without a linked counterpart.
      {
        date: '2026-08-15',
        amount: -800,
        payee: transferPayee,
        notes: 'orphan',
      },
    ]),
  ]);
  // Off-budget rows never need a category.
  await legacy(f, [
    'transactions',
    'add',
    '--account',
    f.fixture.equity,
    '--data',
    JSON.stringify([{ date: '2026-08-20', amount: 999, notes: 'tracking' }]),
  ]);
  const rows = await legacy(f, [
    'transactions',
    'list',
    '--account',
    f.fixture.checking,
    '--start',
    '2026-08-01',
    '--end',
    '2026-08-31',
  ]);
  return Object.fromEntries(
    rows
      .filter(r => r.notes || r.imported_id)
      .map(r => [r.notes ?? r.imported_id, r]),
  );
}

void test('findings cover duplicates, uncategorized rows, an orphan transfer and a statement discrepancy with bounded output', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    const byNotes = await seed(f);
    await cli([
      'checkup',
      'statement',
      'add',
      '--account',
      f.fixture.checking,
      '--month',
      '2026-08',
      '--ending-balance',
      '123',
      '--source',
      'paper statement',
    ]);
    const result = await cli(['checkup', 'data-quality', ...RANGE]);
    assert.equal(result.readOnly, true);
    const byCode = code => result.findings.filter(x => x.code === code);

    const uncategorized = byCode('uncategorized');
    assert.equal(uncategorized.length, 1);
    assert.deepEqual(uncategorized[0].ids, [byNotes.uncategorized.id]);
    assert.equal(uncategorized[0].severity, 'warning');
    assert.equal(
      uncategorized[0].suggested[0].operation,
      'transactions.categorize',
    );

    const dups = byCode('duplicate-candidate');
    assert.equal(dups.length, 1, JSON.stringify(dups));
    assert.deepEqual(
      [...dups[0].ids].sort(),
      [byNotes['dup a'].id, byNotes['dup b'].id].sort(),
    );
    assert.equal(dups[0].evidence.dateGapDays, 1);
    assert.match(dups[0].uncertainty, /^heuristic/);

    const transfers = byCode('transfer-issue');
    assert.equal(transfers.length, 1, JSON.stringify(transfers));
    assert.deepEqual(transfers[0].ids, [byNotes.orphan.id]);
    assert.deepEqual(transfers[0].evidence.issues, ['unlinked-transfer-payee']);
    assert.equal(transfers[0].severity, 'error');

    const discrepancy = byCode('statement-discrepancy');
    assert.equal(discrepancy.length, 1);
    const checking = result.coverage.find(
      c => c.accountId === f.fixture.checking,
    );
    const august = checking.months.find(m => m.month === '2026-08');
    assert.equal(august.status, 'discrepancy');
    assert.equal(
      discrepancy[0].evidence.difference,
      123 - august.statement.ledgerBalance,
    );
    assert.equal(discrepancy[0].evidence.source, 'paper statement');
    assert.match(discrepancy[0].uncertainty, /not bank-verified/);
    // Errors sort first.
    assert.equal(result.findings[0].severity, 'error');

    const limited = await cli([
      'checkup',
      'data-quality',
      ...RANGE,
      '--limit',
      '2',
    ]);
    assert.equal(limited.findings.length, 2);
    assert.equal(limited.truncated, true);
    assert.equal(limited.totalFindings, result.totalFindings);

    assert.equal(
      await errorCode(f, [
        'checkup',
        'data-quality',
        ...RANGE,
        '--accounts',
        'missing-account',
      ]),
      'INVALID_INPUT',
    );
  } finally {
    await f.dispose();
  }
});

void test('empty months stay unknown until a no-activity statement verifies them', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await seed(f);
    const before = await cli([
      'checkup',
      'data-quality',
      ...RANGE,
      '--accounts',
      `${f.fixture.card},${f.fixture.savings}`,
    ]);
    const card = before.coverage.find(c => c.accountId === f.fixture.card);
    assert.deepEqual(
      card.months.map(m => m.status),
      ['unknown', 'unknown', 'unknown'],
    );
    const unknown = before.findings.find(
      x => x.code === 'coverage-unknown' && x.accountId === f.fixture.card,
    );
    assert.deepEqual(unknown.evidence.months, [
      '2026-07',
      '2026-08',
      '2026-09',
    ]);

    await cli([
      'checkup',
      'statement',
      'add',
      '--account',
      f.fixture.card,
      '--month',
      '2026-07',
      '--no-activity',
    ]);
    await cli([
      'checkup',
      'statement',
      'add',
      '--account',
      f.fixture.savings,
      '--month',
      '2026-08',
      '--ending-balance',
      '10000',
    ]);
    // Savings has no July rows, so a no-activity claim verifies July.
    await cli([
      'checkup',
      'statement',
      'add',
      '--account',
      f.fixture.savings,
      '--month',
      '2026-07',
      '--no-activity',
    ]);
    assert.equal(
      await errorCode(f, [
        'checkup',
        'statement',
        'add',
        '--account',
        f.fixture.card,
        '--month',
        '2026-07',
        '--no-activity',
      ]),
      'INVALID_INPUT',
    );
    assert.equal(
      await errorCode(f, [
        'checkup',
        'statement',
        'add',
        '--account',
        f.fixture.card,
        '--month',
        '2026-08',
      ]),
      'INVALID_INPUT',
    );
    const listed = await cli(['checkup', 'statement', 'list']);
    assert.equal(listed.statements.length, 3);

    const after = await cli([
      'checkup',
      'data-quality',
      ...RANGE,
      '--accounts',
      `${f.fixture.card},${f.fixture.savings}`,
    ]);
    const card2 = after.coverage.find(c => c.accountId === f.fixture.card);
    assert.deepEqual(
      card2.months.map(m => m.status),
      ['statement-verified', 'unknown', 'unknown'],
    );
    const savings = after.coverage.find(c => c.accountId === f.fixture.savings);
    assert.equal(savings.months[0].status, 'statement-verified');
    assert.equal(savings.months[1].status, 'statement-verified');
    assert.equal(savings.months[1].statement.ledgerBalance, 10000);
    // A no-activity claim for a month with rows is a discrepancy.
    await cli([
      'checkup',
      'statement',
      'remove',
      '--account',
      f.fixture.savings,
      '--month',
      '2026-07',
    ]);
    await cli([
      'checkup',
      'statement',
      'add',
      '--account',
      f.fixture.savings,
      '--month',
      '2026-08',
      '--no-activity',
      '--replace',
    ]);
    const third = await cli([
      'checkup',
      'data-quality',
      ...RANGE,
      '--accounts',
      f.fixture.savings,
    ]);
    const savings3 = third.coverage[0];
    assert.equal(savings3.months[1].status, 'discrepancy');
    assert.equal(
      third.findings.filter(x => x.code === 'statement-discrepancy').length,
      1,
    );
  } finally {
    await f.dispose();
  }
});

void test('repeated checkups write nothing to the budget and never repair', async () => {
  const f = await createFixture();
  try {
    const cli = strict(f);
    await seed(f);
    const before = await readRaw(f);
    const first = await cli(['checkup', 'data-quality', ...RANGE]);
    const second = await cli(['checkup', 'data-quality', ...RANGE]);
    assert.deepEqual(second.findings, first.findings);
    assert.deepEqual(await readRaw(f), before, 'checkup wrote state');
    assert.ok(first.findings.some(x => x.code === 'duplicate-candidate'));
    assert.ok(first.findings.some(x => x.code === 'transfer-issue'));
  } finally {
    await f.dispose();
  }
});
