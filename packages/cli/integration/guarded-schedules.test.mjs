import assert from 'node:assert/strict';

import {
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

// Packaged proof for guarded schedule creation, updates and deletions. The
// schedule owner also writes its linked rule, next-date row and JSON path
// projection, so verification names exactly those tables and requires every
// other table to stay byte-identical.

const SCHEDULE_TABLES = [
  'schedules',
  'rules',
  'schedules_next_date',
  'schedules_json_paths',
];

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

function assertOnlyScheduleTables(before, after) {
  for (const table of Object.keys(before)) {
    if (!SCHEDULE_TABLES.includes(table)) {
      assert.deepEqual(after[table], before[table], `${table} changed`);
    }
  }
}

function row(rows, id) {
  const found = rows.find(candidate => candidate.id === id);
  assert.ok(found, `row ${id} exists`);
  return found;
}

async function setup(f) {
  const payee = (await legacy(f, ['payees', 'create', '--name', 'Utility'])).id;
  const account = (
    await legacy(f, ['accounts', 'create', '--name', 'Schedule bills'])
  ).id;
  return { payee, account };
}

function request(ctx, name) {
  return {
    name,
    posts_transaction: false,
    payee: ctx.payee,
    account: ctx.account,
    amount: -4200,
    amountOp: 'is',
    date: '2030-01-15',
  };
}

async function legacySchedule(f, ctx, name) {
  const data = await legacy(f, [
    'schedules',
    'create',
    '--data',
    JSON.stringify(request(ctx, name)),
  ]);
  return data.id;
}

function verifyCreated(before, after, name, expectedId) {
  assertOnlyScheduleTables(before, after);
  const schedules = createdRows(before, after, 'schedules');
  const rules = createdRows(before, after, 'rules');
  assert.equal(schedules.length, 1);
  assert.equal(rules.length, 1);
  const [schedule] = schedules;
  if (expectedId) assert.equal(schedule.id, expectedId);
  assert.equal(schedule.name, name);
  assert.equal(schedule.rule, rules[0].id);
  assert.equal(schedule.tombstone, 0);
  assert.deepEqual(JSON.parse(rules[0].actions), [
    { op: 'link-schedule', value: schedule.id },
  ]);
  assert.equal(
    after.schedules_next_date.filter(r => r.schedule_id === schedule.id).length,
    1,
  );
  return schedule.id;
}

const creation = {
  operation: 'schedules.create',
  label: 'schedule creation',
  setup,
  data: (_f, ctx) => request(ctx, 'Packaged schedule'),
  otherData: (_f, ctx) => request(ctx, 'Other schedule'),
  verify(before, after, { outcome }) {
    const id = verifyCreated(
      before,
      after,
      'Packaged schedule',
      outcome?.scheduleCreation?.scheduleId,
    );
    if (outcome) assert.deepEqual(outcome.affectedIds, [id]);
  },
  direct: (_f, ctx) => ({
    args: [
      'schedules',
      'create',
      '--data',
      JSON.stringify(request(ctx, 'Direct schedule')),
    ],
    verify(before, after, result) {
      assert.equal(verifyCreated(before, after, 'Direct schedule'), result.id);
    },
  }),
  laterEdit: (_f, _ctx, outcome) => [
    'schedules',
    'update',
    outcome.scheduleCreation.scheduleId,
    '--data',
    JSON.stringify({ name: 'Later name' }),
  ],
  independent: (_f, _ctx, outcome) => ({
    args: ['schedules', 'list'],
    check(rows) {
      assert.equal(
        rows.filter(r => r.id === outcome.scheduleCreation.scheduleId).length,
        1,
      );
    },
  }),
};

const update = {
  operation: 'schedules.update',
  label: 'schedule update',
  async setup(f) {
    const ctx = await setup(f);
    ctx.id = await legacySchedule(f, ctx, 'Update me');
    ctx.other = await legacySchedule(f, ctx, 'Direct update');
    return ctx;
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({ fields: { name: 'Updated schedule', amount: -9900 } }),
  otherData: () => ({ fields: { name: 'Different' } }),
  verify(before, after, { outcome, ctx }) {
    assertOnlyScheduleTables(before, after);
    const schedule = row(after.schedules, ctx.id);
    assert.equal(schedule.name, 'Updated schedule');
    const rule = row(after.rules, schedule.rule);
    const amount = JSON.parse(rule.conditions).find(c => c.field === 'amount');
    assert.equal(amount.value, -9900);
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: [
      'schedules',
      'update',
      ctx.other,
      '--data',
      JSON.stringify({ name: 'Direct renamed' }),
    ],
    verify(before, after) {
      assertOnlyScheduleTables(before, after);
      assert.equal(row(after.schedules, ctx.other).name, 'Direct renamed');
    },
  }),
  laterEdit: (_f, ctx) => [
    'schedules',
    'update',
    ctx.id,
    '--data',
    JSON.stringify({ name: 'Later' }),
  ],
  independent: (_f, ctx) => ({
    args: ['schedules', 'list'],
    check(rows) {
      assert.ok(rows.some(r => r.id === ctx.id));
    },
  }),
};

const deletion = {
  operation: 'schedules.delete',
  label: 'schedule deletion',
  async setup(f) {
    const ctx = await setup(f);
    ctx.id = await legacySchedule(f, ctx, 'Delete me');
    ctx.other = await legacySchedule(f, ctx, 'Direct delete');
    return ctx;
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({}),
  otherData: () => ({ unexpected: true }),
  verify(before, after, { outcome, ctx }) {
    assertOnlyScheduleTables(before, after);
    const schedule = row(after.schedules, ctx.id);
    assert.equal(schedule.tombstone, 1);
    assert.equal(row(after.rules, schedule.rule).tombstone, 1);
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id, schedule.rule]);
  },
  direct: (_f, ctx) => ({
    args: ['schedules', 'delete', ctx.other],
    verify(before, after) {
      assertOnlyScheduleTables(before, after);
      assert.equal(row(after.schedules, ctx.other).tombstone, 1);
    },
  }),
  independent: (_f, ctx) => ({
    args: ['schedules', 'list'],
    check(rows) {
      assert.ok(!rows.some(r => r.id === ctx.id));
    },
  }),
};

for (const spec of [creation, update, deletion]) guardedRegularCases(spec);
guardedInterruptionCases(creation);
