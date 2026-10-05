import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

// Packaged proof for 0031: a fresh headless setup, multi-file intake and
// monthly close on a disposable local budget; pause, crash-after-commit
// resume and cancellation of an intake run; incomplete reconciliation that
// never claims a complete close; and goal review that saves nothing.

const csvSettings = {
  fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
  dateFormat: 'yyyy mm dd',
};

async function ok(f, args, options) {
  const result = await f.cli(args, options);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout).data;
}

async function fails(f, args, options) {
  const result = await f.cli(args, options);
  assert.notEqual(result.code, 0, result.stdout);
  return { code: result.code, error: JSON.parse(result.stdout).error };
}

async function legacy(f, args, options = {}) {
  const result = await f.cli(args, { ...options, version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

async function intakeFiles(f, prefix, checking, other) {
  const first = join(f.root, `${prefix}-checking.csv`);
  const second = join(f.root, `${prefix}-other.csv`);
  await writeFile(
    first,
    'Date,Payee,Amount\n2026-09-03,Grocer,-42.10\n2026-09-10,Card payment,-50.00\n',
  );
  await writeFile(
    second,
    'Date,Payee,Amount\n2026-09-10,Payment received,50.00\n',
  );
  const manifest = join(f.root, `${prefix}-manifest.json`);
  await writeFile(
    manifest,
    JSON.stringify([
      {
        file: `${prefix}-checking.csv`,
        account: checking,
        settings: csvSettings,
      },
      { file: `${prefix}-other.csv`, account: other, settings: csvSettings },
    ]),
  );
  return manifest;
}

test(
  'fresh headless setup, multi-file intake and monthly close (A1, A3)',
  { timeout: 240000 },
  async () => {
    const f = await createFixture({ fresh: true });
    try {
      await ok(f, ['server', 'bootstrap']);
      // Local budget creation is offline, as with budgets create.
      const setup = await ok(f, [
        '--offline',
        'workflow',
        'setup',
        '--spec',
        JSON.stringify({
          budgetName: 'Workflow household',
          accounts: [
            { name: 'Checking', offbudget: false, initialBalance: 100000 },
            { name: 'Card', offbudget: false, initialBalance: 0 },
          ],
          categoryGroups: [{ name: 'Bills', categories: ['Rent', 'Power'] }],
        }),
      ]);
      assert.equal(setup.status, 'completed', JSON.stringify(setup));
      assert.equal(setup.steps.length, 6);
      assert.ok(setup.steps.every(s => s.status === 'committed'));
      assert.equal(setup.summary.operations.length, 6);
      const budgetId = setup.budget.budgetId;
      assert.ok(budgetId);
      const checking = setup.steps.find(s => s.id === 'account-0').result.id;
      const card = setup.steps.find(s => s.id === 'account-1').result.id;
      const local = ['--offline', '--budget-id', budgetId];

      const manifest = await intakeFiles(f, 'fresh', checking, card);
      const intake = await ok(f, [...local, 'workflow', 'intake', manifest]);
      assert.deepEqual(
        intake.steps.map(s => [s.id, s.status]),
        [
          ['import-0', 'committed'],
          ['import-1', 'committed'],
          ['transfers', 'completed'],
          ['review', 'completed'],
        ],
      );
      assert.equal(intake.steps[0].result.summary.add, 2);
      // The card payment pair and the uncategorized imported rows stay
      // explicit unresolved review items; observed months are not claimed as
      // statement-verified.
      assert.equal(intake.status, 'needs-review');
      assert.ok(intake.unresolved.some(u => u.code === 'transfer-candidate'));
      assert.ok(intake.unresolved.some(u => u.code === 'uncategorized'));
      const coverage = intake.steps[3].result.coverage;
      assert.ok(coverage.every(a => a.summary.statementVerified === 0));

      const status = await ok(f, [
        ...local,
        'reconcile',
        'status',
        checking,
        '--date',
        '2026-09-30',
      ]);
      const cardStatus = await ok(f, [
        ...local,
        'reconcile',
        'status',
        card,
        '--date',
        '2026-09-30',
      ]);
      // A3: one statement does not match, so the close is not complete even
      // though the other account reconciled.
      const partial = await ok(f, [
        ...local,
        'workflow',
        'monthly-close',
        '--month',
        '2026-09',
        '--finish',
        '--statements',
        JSON.stringify([
          { accountId: checking, endingBalance: status.clearedBalance },
          { accountId: card, endingBalance: cardStatus.clearedBalance + 100 },
        ]),
      ]);
      assert.equal(partial.steps[0].status, 'committed');
      assert.equal(partial.steps[1].status, 'unresolved');
      assert.equal(partial.summary.closeComplete, false);
      assert.equal(partial.status, 'needs-review');
      assert.ok(partial.unresolved.some(u => u.code === 'statement-unmatched'));
      const unchanged = await ok(f, [...local, 'reconcile', 'status', card]);
      assert.equal(unchanged.account.lastReconciled, null);

      const backups = join(f.root, 'backups');
      await import('node:fs/promises').then(fs => fs.mkdir(backups));
      const close = await ok(f, [
        ...local,
        'workflow',
        'monthly-close',
        '--month',
        '2026-09',
        '--finish',
        '--backup-directory',
        backups,
        '--statements',
        JSON.stringify([
          { accountId: card, endingBalance: cardStatus.clearedBalance },
        ]),
      ]);
      assert.equal(close.summary.closeComplete, true, JSON.stringify(close));
      assert.equal(
        close.summary.receiptsCommand,
        'changes inspect <operation-id>',
      );
      assert.equal(close.steps[0].id, 'backup');
      assert.equal(close.artifacts[0].kind, 'backup');
      assert.ok((await stat(close.artifacts[0].path)).size > 0);
      const reconciled = await ok(f, [...local, 'reconcile', 'status', card]);
      assert.ok(reconciled.account.lastReconciled);
      const receipt = await ok(f, [
        ...local,
        'changes',
        'inspect',
        close.summary.operations[0].operationId,
      ]);
      assert.ok(JSON.stringify(receipt).includes('reconcile.finish'));
    } finally {
      await f.dispose();
    }
  },
);

test(
  'intake resumes after a crash without reimporting, cancellation keeps partial outcomes, goal review saves nothing (A2, A3)',
  { timeout: 240000 },
  async () => {
    const f = await createFixture();
    try {
      const { checking, savings, dining } = f.fixture;
      const range = ['--start', '2026-09-01', '--end', '2026-09-30'];
      const count = async account =>
        (
          await legacy(f, [
            'transactions',
            'list',
            '--account',
            account,
            ...range,
          ])
        ).length;
      const before = await count(checking);
      const manifest = await intakeFiles(f, 'resume', checking, savings);
      const paused = await ok(f, [
        'workflow',
        'intake',
        manifest,
        '--run-id',
        'wf-resume1',
        '--stop-after',
        'import-1',
      ]);
      assert.equal(paused.status, 'paused');
      assert.equal(await count(checking), before + 2);

      // Simulate a crash after the second import committed but before the
      // run recorded it: the step is pending with its fixed payload.
      const record = join(f.root, 'a', 'workflow-runs', 'wf-resume1.json');
      const saved = JSON.parse(await readFile(record, 'utf8'));
      const step = saved.steps.find(s => s.id === 'import-1');
      step.status = 'pending';
      delete step.result;
      saved.status = 'running';
      await writeFile(record, JSON.stringify(saved));

      const resumed = await ok(f, ['workflow', 'run', 'resume', 'wf-resume1']);
      assert.deepEqual(
        resumed.steps.map(s => s.status),
        ['committed', 'committed', 'completed', 'completed'],
      );
      assert.equal(
        resumed.steps[1].result.receipt.operationId,
        'wf-resume1-import-1',
      );
      assert.equal(await count(checking), before + 2);
      assert.equal(await count(savings), 1);
      const again = await fails(f, ['workflow', 'run', 'resume', 'wf-resume1']);
      assert.equal(again.code, 2);

      // Cancellation after the first import keeps that import and marks the
      // rest not-run.
      const second = await intakeFiles(f, 'cancel', checking, savings);
      await writeFile(
        join(f.root, 'cancel-checking.csv'),
        'Date,Payee,Amount\n2026-09-20,Hardware,-7.00\n',
      );
      await ok(f, [
        'workflow',
        'intake',
        second,
        '--run-id',
        'wf-cancel1',
        '--stop-after',
        'import-0',
      ]);
      const cancelled = await ok(f, [
        'workflow',
        'run',
        'cancel',
        'wf-cancel1',
      ]);
      assert.equal(cancelled.status, 'cancelled');
      assert.deepEqual(
        cancelled.steps.map(s => s.status),
        ['committed', 'not-run', 'not-run', 'not-run'],
      );
      assert.equal(cancelled.summary.operations.length, 1);
      assert.equal(await count(checking), before + 3);
      assert.equal(
        (await fails(f, ['workflow', 'run', 'resume', 'wf-cancel1'])).code,
        2,
      );

      const listed = await ok(f, ['workflow', 'run', 'list']);
      assert.deepEqual(listed.runs.map(r => r.runId).sort(), [
        'wf-cancel1',
        'wf-resume1',
      ]);

      // A3: goal review leaves the saved plan untouched.
      const plan = await ok(f, ['cash-planning', 'inspect']);
      const review = await ok(f, [
        'workflow',
        'goal-review',
        '--scenario',
        JSON.stringify({ categoryTargets: { [dining]: 99999 } }),
      ]);
      assert.equal(review.status, 'completed');
      assert.ok(review.steps[0].result.scenario);
      assert.match(review.steps[0].result.saveCommand, /Nothing was saved/);
      const after = await ok(f, ['cash-planning', 'inspect']);
      assert.deepEqual(after.saved, plan.saved);

      const weekly = await ok(f, [
        'workflow',
        'weekly-checkup',
        '--as-of',
        '2026-09-15',
      ]);
      assert.ok(['completed', 'needs-review'].includes(weekly.status));
      assert.deepEqual(
        weekly.steps.map(s => [s.id, s.status]),
        [
          ['data-quality', 'completed'],
          ['schedules', 'completed'],
          ['bank-sync', 'completed'],
        ],
      );
      assert.equal(weekly.summary.operations.length, 0);
      assert.equal(await count(checking), before + 3);

      const bad = await fails(f, [
        'workflow',
        'monthly-close',
        '--month',
        '2026-9',
        '--statements',
        '[]',
      ]);
      assert.equal(bad.code, 2);
    } finally {
      await f.dispose();
    }
  },
);
