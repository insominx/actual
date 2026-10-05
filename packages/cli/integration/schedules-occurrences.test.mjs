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

// Packaged proof for 0024: schedule occurrences computed by the engine for
// month-end, leap-day, weekday-pattern, weekend-skip and transfer schedules;
// guarded post and skip of the next occurrence; posted rows that a later
// statement import treats as duplicates; and edits or deletions of the
// schedule that leave posted history unchanged.

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

function recur(start, frequency, extra = {}) {
  return {
    start,
    interval: 1,
    frequency,
    patterns: [],
    skipWeekend: false,
    weekendSolveMode: 'after',
    endMode: 'never',
    ...extra,
  };
}

async function createSchedule(f, ctx, name, date, extra = {}) {
  const data = await legacy(f, [
    'schedules',
    'create',
    '--data',
    JSON.stringify({
      name,
      posts_transaction: false,
      payee: ctx.payee,
      account: ctx.account,
      amount: -5000,
      amountOp: 'is',
      date,
      ...extra,
    }),
  ]);
  return data.id;
}

async function setup(f) {
  const payee = (await legacy(f, ['payees', 'create', '--name', 'Utility'])).id;
  const account = (await legacy(f, ['accounts', 'create', '--name', 'Bills']))
    .id;
  return { payee, account };
}

async function occurrences(cli, id, start, end) {
  const result = await cli([
    'schedules',
    'inspect',
    id,
    '--start',
    start,
    '--end',
    end,
  ]);
  assert.equal(result.schedules.length, 1);
  return result.schedules[0];
}

const ACCT_RANGE = ['--start', '2030-01-01', '--end', '2030-12-31'];

void test('schedule inspection computes month-end, leap-day, pattern, weekend and transfer occurrences without writing', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const ctx = await setup(f);
    const lastDay = await createSchedule(
      f,
      ctx,
      'Last day',
      recur('2030-01-31', 'monthly', {
        patterns: [{ type: 'day', value: -1 }],
      }),
    );
    const plain31 = await createSchedule(
      f,
      ctx,
      'On the 31st',
      recur('2030-01-31', 'monthly'),
    );
    const leap = await createSchedule(
      f,
      ctx,
      'Leap day',
      recur('2028-02-29', 'yearly'),
    );
    const secondFriday = await createSchedule(
      f,
      ctx,
      'Second Friday',
      recur('2030-01-01', 'monthly', { patterns: [{ type: 'FR', value: 2 }] }),
    );
    const weekend = await createSchedule(
      f,
      ctx,
      'Weekend skip',
      recur('2030-06-15', 'monthly', { skipWeekend: true }),
    );
    const savings = (
      await legacy(f, ['accounts', 'create', '--name', 'Savings'])
    ).id;
    const payees = await legacy(f, ['payees', 'list']);
    const transferPayee = payees.find(p => p.transfer_acct === savings).id;
    const transfer = await createSchedule(f, ctx, 'To savings', '2030-03-10', {
      payee: transferPayee,
    });
    const before = await readRaw(f);

    const last = await occurrences(cli, lastDay, '2030-01-01', '2030-06-30');
    assert.deepEqual(last.occurrences, [
      '2030-01-31',
      '2030-02-28',
      '2030-03-31',
      '2030-04-30',
      '2030-05-31',
      '2030-06-30',
    ]);
    assert.equal(last.recurring, true);
    assert.equal(last.nextDate, '2030-01-31');
    assert.equal(last.amount, -5000);
    assert.equal(last.payee.id, ctx.payee);
    assert.equal(last.account.id, ctx.account);
    const plain = await occurrences(cli, plain31, '2030-01-01', '2030-06-30');
    assert.ok(plain.occurrences.includes('2030-01-31'));
    assert.ok(plain.occurrences.includes('2030-03-31'));
    const leapDays = await occurrences(cli, leap, '2028-01-01', '2030-12-31');
    assert.equal(leapDays.occurrences[0], '2028-02-29');
    assert.ok(
      leapDays.occurrences.every(date => /^\d{4}-02-2[89]$/.test(date)),
    );
    const fridays = await occurrences(
      cli,
      secondFriday,
      '2030-01-01',
      '2030-03-31',
    );
    assert.deepEqual(fridays.occurrences, [
      '2030-01-11',
      '2030-02-08',
      '2030-03-08',
    ]);
    const skipped = await occurrences(cli, weekend, '2030-06-01', '2030-06-30');
    assert.deepEqual(skipped.occurrences, ['2030-06-17']);
    const toSavings = await occurrences(
      cli,
      transfer,
      '2030-01-01',
      '2030-12-31',
    );
    assert.deepEqual(toSavings.occurrences, ['2030-03-10']);
    assert.equal(toSavings.recurring, false);
    assert.equal(toSavings.transferAccount.id, savings);

    const upcoming = await cli([
      'schedules',
      'upcoming',
      '--start',
      '2030-03-01',
      '--end',
      '2030-03-31',
      '--account',
      ctx.account,
    ]);
    assert.deepEqual(upcoming.window, {
      start: '2030-03-01',
      end: '2030-03-31',
    });
    assert.ok(upcoming.schedules.some(s => s.id === transfer));
    assert.deepEqual(await readRaw(f), before, 'inspection wrote state');

    for (const args of [
      ['schedules', 'upcoming', '--start', '2030-02-01', '--end', '2030-01-01'],
      ['schedules', 'upcoming', '--start', '2030-01-01', '--end', '2034-01-01'],
      ['schedules', 'inspect', 'missing'],
    ]) {
      const result = await f.cli(args);
      assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT');
    }

    // Reset recomputes next_date from today with the same recurrence.
    await cli([
      'schedules',
      'update',
      lastDay,
      '--data',
      JSON.stringify({ name: 'Last day renamed' }),
      '--reset-next-date',
      '--operation-id',
      'reset-last-day',
    ]);
    const reset = await occurrences(cli, lastDay, '2030-01-01', '2030-01-31');
    assert.equal(reset.nextDate, '2030-01-31');
    assert.equal(reset.name, 'Last day renamed');

    // Post the transfer occurrence: the counterpart lands in savings.
    const posted = await cli([
      'schedules',
      'post',
      transfer,
      '--date',
      '2030-03-10',
      '--operation-id',
      'post-transfer',
    ]);
    assert.equal(posted.receipt.outcome.status, 'committed-local');
    const [row] = await legacy(f, [
      'transactions',
      'list',
      '--account',
      ctx.account,
      ...ACCT_RANGE,
    ]);
    assert.equal(row.schedule, transfer);
    assert.equal(row.amount, -5000);
    assert.ok(row.transfer_id);
    const [counterpart] = await legacy(f, [
      'transactions',
      'list',
      '--account',
      savings,
      ...ACCT_RANGE,
    ]);
    assert.equal(counterpart.amount, 5000);
    assert.equal(counterpart.transfer_id, row.id);
  } finally {
    await f.dispose();
  }
});

void test('posting an occurrence is idempotent, imports treat it as a duplicate, and schedule edits keep history', async () => {
  const f = await createFixture({ encrypted: true });
  try {
    const cli = strict(f);
    await cli(['accounts', 'list']);
    const ctx = await setup(f);
    const bill = await createSchedule(
      f,
      ctx,
      'Power',
      recur('2030-01-31', 'monthly', {
        patterns: [{ type: 'day', value: -1 }],
      }),
    );

    // Only the next occurrence can be posted or skipped.
    for (const args of [
      ['schedules', 'post', bill, '--date', '2030-02-28'],
      ['schedules', 'skip', bill, '--date', '2030-02-28'],
      ['schedules', 'post', 'missing', '--date', '2030-01-31'],
    ]) {
      const result = await f.cli([...args, '--operation-id', `bad-${args[1]}`]);
      assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_INPUT');
    }

    const posted = await cli([
      'schedules',
      'post',
      bill,
      '--date',
      '2030-01-31',
      '--operation-id',
      'post-power',
    ]);
    assert.equal(posted.receipt.outcome.status, 'committed-local');
    // A retry with the same operation ID replays; a new ID is refused.
    const replay = await cli([
      'schedules',
      'post',
      bill,
      '--date',
      '2030-01-31',
      '--operation-id',
      'post-power',
    ]);
    assert.deepEqual(
      replay.receipt.outcome.schedulePost.transactionIds,
      posted.receipt.outcome.schedulePost.transactionIds,
    );
    const again = await f.cli([
      'schedules',
      'post',
      bill,
      '--date',
      '2030-01-31',
      '--operation-id',
      'post-power-2',
    ]);
    assert.equal(JSON.parse(again.stdout).error.code, 'INVALID_INPUT');
    const listed = await legacy(f, [
      'transactions',
      'list',
      '--account',
      ctx.account,
      ...ACCT_RANGE,
    ]);
    assert.equal(listed.length, 1);
    const postedId = listed[0].id;
    assert.equal(listed[0].schedule, bill);
    const shown = await occurrences(cli, bill, '2030-01-01', '2030-02-28');
    assert.deepEqual(
      shown.posted.map(p => [p.id, p.date]),
      [[postedId, '2030-01-31']],
    );

    // The bank statement row for the same bill is a duplicate, not a new row.
    const file = join(f.root, 'statement.csv');
    await writeFile(file, 'Date,Payee,Amount\n2030-01-31,Utility,-50.00\n');
    const settings = JSON.stringify({
      fields: { date: 'Date', payee: 'Payee', amount: 'Amount' },
      dateFormat: 'yyyy mm dd',
    });
    await cli([
      'imports',
      'apply',
      file,
      '--account',
      ctx.account,
      '--settings',
      settings,
      '--operation-id',
      'statement-import',
    ]);
    const afterImport = await legacy(f, [
      'transactions',
      'list',
      '--account',
      ctx.account,
      ...ACCT_RANGE,
    ]);
    assert.equal(afterImport.length, 1);
    assert.equal(afterImport[0].id, postedId);

    // Skip: the next occurrence moves to the following month end.
    const skipped = await cli([
      'schedules',
      'skip',
      bill,
      '--date',
      '2030-01-31',
      '--operation-id',
      'skip-power',
    ]);
    assert.equal(skipped.receipt.outcome.scheduleSkip.nextDate, '2030-02-28');

    // Editing and deleting the schedule leaves the posted row unchanged.
    const history = (await readRaw(f)).transactions.find(
      r => r.id === postedId,
    );
    await cli([
      'schedules',
      'update',
      bill,
      '--data',
      JSON.stringify({ amount: -9900, name: 'Power edited' }),
      '--operation-id',
      'edit-power',
    ]);
    assert.deepEqual(
      (await readRaw(f)).transactions.find(r => r.id === postedId),
      history,
    );
    await cli(['schedules', 'delete', bill, '--operation-id', 'delete-power']);
    const deletedAfter = (await readRaw(f)).transactions.find(
      r => r.id === postedId,
    );
    assert.equal(deletedAfter.amount, history.amount);
    assert.equal(deletedAfter.date, history.date);
    assert.equal(deletedAfter.tombstone, 0);
  } finally {
    await f.dispose();
  }
});

const post = {
  operation: 'schedules.post',
  label: 'schedule post',
  async setup(f) {
    const ctx = await setup(f);
    ctx.id = await createSchedule(f, ctx, 'Kit bill', '2030-05-20');
    ctx.other = await createSchedule(f, ctx, 'Kit other', '2030-05-21');
    return ctx;
  },
  data: (_f, ctx) => ({ id: ctx.id, date: '2030-05-20' }),
  otherData: (_f, ctx) => ({ id: ctx.other, date: '2030-05-21' }),
  verify(before, after, { outcome, ctx }) {
    const ids = new Set(before.transactions.map(r => r.id));
    const added = after.transactions.filter(r => !ids.has(r.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].schedule, ctx.id);
    assert.equal(added[0].amount, -5000);
    assert.equal(added[0].acct, ctx.account);
    for (const table of Object.keys(before)) {
      if (table !== 'transactions') {
        assert.deepEqual(after[table], before[table], `${table} changed`);
      }
    }
    if (outcome) {
      assert.deepEqual(outcome.schedulePost.transactionIds, [added[0].id]);
    }
  },
};

const skip = {
  operation: 'schedules.skip',
  label: 'schedule skip',
  async setup(f) {
    const ctx = await setup(f);
    ctx.id = await createSchedule(
      f,
      ctx,
      'Kit skip',
      recur('2030-05-20', 'monthly'),
    );
    ctx.other = await createSchedule(
      f,
      ctx,
      'Kit skip other',
      recur('2030-05-21', 'monthly'),
    );
    return ctx;
  },
  data: (_f, ctx) => ({ id: ctx.id, date: '2030-05-20' }),
  otherData: (_f, ctx) => ({ id: ctx.other, date: '2030-05-21' }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      for (const row of expected.schedules_next_date) {
        if (row.schedule_id === ctx.id) {
          const changed = after.schedules_next_date.find(r => r.id === row.id);
          Object.assign(row, changed);
        }
      }
    });
    const next = after.schedules_next_date.find(r => r.schedule_id === ctx.id);
    assert.equal(next.local_next_date, 20300620);
    if (outcome) assert.equal(outcome.scheduleSkip.nextDate, '2030-06-20');
  },
};

guardedRegularCases(post);
guardedInterruptionCases(post);
guardedRegularCases(skip);
guardedInterruptionCases(skip);
