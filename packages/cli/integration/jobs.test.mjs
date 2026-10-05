import assert from 'node:assert/strict';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

// Packaged proof for 0032: a saved intake job imports stable routed inbox
// files once, leaves partial/unrouted files pending, moves duplicates
// without importing, requires a policy for cross-account reuse, serializes
// overlapping invocations, resumes an interrupted run without replaying
// committed imports, previews with --dry-run, stops when disabled, and its
// scheduler recipe command runs as printed.

const csvSettings = {
  fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
  dateFormat: 'yyyy mm dd',
};

async function ok(f, args) {
  const result = await f.cli(args);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout).data;
}

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

async function aged(path, content) {
  await writeFile(path, content);
  const old = new Date(Date.now() - 120000);
  await utimes(path, old, old);
}

test(
  'saved intake job: stable files once, overlap, resume, dry run, disable, scheduler recipe',
  { timeout: 300000 },
  async () => {
    const f = await createFixture();
    try {
      const { checking, savings } = f.fixture;
      const inbox = join(f.root, 'inbox');
      const processed = join(f.root, 'processed');
      const errors = join(f.root, 'error');
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

      const job = await ok(f, [
        'jobs',
        'create',
        'nightly',
        '--inbox',
        inbox,
        '--processed',
        processed,
        '--error',
        errors,
        '--routes',
        JSON.stringify([
          { match: '^checking-', account: checking, settings: csvSettings },
          { match: '^savings-', account: savings, settings: csvSettings },
        ]),
        '--allow',
        'imports.file',
      ]);
      assert.equal(job.enabled, true);
      assert.equal(job.budget.syncId, f.fixture.syncId);
      const nested = await f.cli([
        'jobs',
        'create',
        'bad',
        '--inbox',
        inbox,
        '--processed',
        join(inbox, 'done'),
        '--error',
        errors,
        '--routes',
        '[{"match":"x","account":"y"}]',
        '--allow',
        'imports.file',
      ]);
      assert.equal(nested.code, 2);

      const first =
        'Date,Payee,Amount\n2026-09-04,Bakery,-4.50\n2026-09-05,Cinema,-12.00\n';
      await aged(join(inbox, 'checking-1.csv'), first);
      await aged(join(inbox, 'checking-2.csv.part'), 'Date,Payee,Amount\n');
      await writeFile(
        join(inbox, 'checking-new.csv'),
        'Date,Payee,Amount\n2026-09-06,Fresh,-1.00\n',
      );
      await aged(join(inbox, 'unknown.csv'), first);

      // Dry run previews and changes nothing.
      const dry = await ok(f, ['jobs', 'run', 'nightly', '--dry-run']);
      assert.equal(dry.wouldImport.length, 1);
      assert.equal(dry.wouldImport[0].summary.add, 2);
      assert.deepEqual(
        dry.pending.map(p => [p.file, p.status]),
        [
          ['checking-2.csv.part', 'pending-unstable'],
          ['checking-new.csv', 'pending-unstable'],
          ['unknown.csv', 'no-route'],
        ],
      );
      assert.equal(await count(checking), before);

      // Two simultaneous invocations: one active run, one import.
      const [a, b] = await Promise.all([
        f.cli(['jobs', 'run', 'nightly']),
        f.cli(['jobs', 'run', 'nightly']),
      ]);
      const outcomes = [a, b].map(r => ({
        code: r.code,
        body: JSON.parse(r.stdout),
      }));
      const imported = outcomes.filter(o => o.code === 0 && o.body.data.runId);
      assert.equal(imported.length, 1, JSON.stringify(outcomes));
      for (const o of outcomes.filter(o => o !== imported[0])) {
        if (o.code !== 0) {
          assert.equal(o.code, 5);
          assert.equal(o.body.error.details.reason, 'job-active');
          assert.equal(o.body.error.retryable, true);
        } else {
          assert.equal(o.body.data.runId, null);
        }
      }
      assert.equal(await count(checking), before + 2);
      assert.deepEqual(await readdir(processed), ['checking-1.csv']);
      const resultPath = imported[0].body.data.resultPath;
      assert.ok((await stat(resultPath)).size > 0);

      // The same content again: moved as a duplicate, not imported. The same
      // content for another account waits for an explicit policy.
      await aged(join(inbox, 'checking-again.csv'), first);
      await aged(join(inbox, 'savings-copy.csv'), first);
      const repeat = await ok(f, ['jobs', 'run', 'nightly']);
      assert.equal(repeat.runId, null);
      assert.deepEqual(
        repeat.moves.map(m => [m.file, m.outcome]),
        [['checking-again.csv', 'duplicate']],
      );
      assert.ok(
        repeat.pending.some(
          p =>
            p.file === 'savings-copy.csv' &&
            p.status === 'cross-account-review',
        ),
      );
      assert.equal(await count(checking), before + 2);
      assert.equal(await count(savings), 0);

      // Interrupted run: pause after the first import, then rewrite it to the
      // pending state a crash leaves; the next run resumes and replays.
      await aged(
        join(inbox, 'checking-3.csv'),
        'Date,Payee,Amount\n2026-09-07,Hardware,-7.00\n',
      );
      const old = new Date(Date.now() - 120000);
      await utimes(join(inbox, 'checking-new.csv'), old, old);
      const paused = await ok(f, [
        'jobs',
        'run',
        'nightly',
        '--stop-after',
        'import-0',
      ]);
      assert.equal(paused.runStatus, 'paused');
      assert.equal(await count(checking), before + 3);
      const record = join(f.root, 'a', 'workflow-runs', `${paused.runId}.json`);
      const saved = JSON.parse(await readFile(record, 'utf8'));
      saved.steps[0].status = 'pending';
      delete saved.steps[0].result;
      saved.status = 'running';
      await writeFile(record, JSON.stringify(saved));
      const resumed = await ok(f, ['jobs', 'run', 'nightly']);
      assert.equal(resumed.resumed, paused.runId);
      assert.equal(await count(checking), before + 4);
      assert.deepEqual(
        resumed.moves.map(m => m.outcome),
        ['imported', 'imported'],
      );
      const status = await ok(f, ['jobs', 'status', 'nightly']);
      assert.equal(status.imported, 3);
      assert.equal(status.active, null);
      assert.ok(status.lastResult);

      // Scheduler recipe: the printed command runs as-is.
      const recipe = await ok(f, [
        'jobs',
        'schedule',
        'nightly',
        '--every',
        '10',
      ]);
      assert.match(recipe.cron, /^\*\/10 \* \* \* \* 'actual' '--data-dir' /);
      assert.match(recipe.cron, /'jobs' 'run' 'nightly'/);
      assert.match(
        recipe.windowsTaskScheduler,
        /^schtasks \/Create \/SC MINUTE \/MO 10 /,
      );
      const scheduled = await ok(f, recipe.command.args);
      assert.equal(scheduled.job, 'nightly');
      assert.equal(await count(checking), before + 4);

      // Disable stops future runs and leaves files where they are.
      await ok(f, ['jobs', 'disable', 'nightly']);
      await aged(
        join(inbox, 'checking-4.csv'),
        'Date,Payee,Amount\n2026-09-08,Late,-2.00\n',
      );
      const disabled = await f.cli(['jobs', 'run', 'nightly']);
      assert.equal(disabled.code, 2);
      assert.ok((await readdir(inbox)).includes('checking-4.csv'));
      assert.equal(await count(checking), before + 4);
      const listed = await ok(f, ['jobs', 'list']);
      assert.deepEqual(
        listed.jobs.map(j => [j.name, j.enabled]),
        [['nightly', false]],
      );
      await mkdir(join(f.root, 'unused'), { recursive: true });
    } finally {
      await f.dispose();
    }
  },
);
