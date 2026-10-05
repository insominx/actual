import assert from 'node:assert/strict';

import {
  assertRawEffect,
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

// Packaged proof for guarded rule creation, updates and deletions.

function ruleFields(payee) {
  return {
    stage: 'pre',
    conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'is', value: payee }],
    actions: [{ op: 'set', field: 'notes', value: 'from rule' }],
  };
}

async function legacyRule(f, payee) {
  const result = await f.cli(
    ['rules', 'create', '--data', JSON.stringify(ruleFields(payee))],
    { version: '1' },
  );
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  const data = parsed.data ?? parsed;
  return typeof data.id === 'string' ? data.id : data.id.id;
}

function patchRow(rows, id, patch) {
  const row = rows.find(candidate => candidate.id === id);
  assert.ok(row, `row ${id} exists`);
  Object.assign(row, patch);
}

function verifyRuleCreated(before, after, fields, expectedId) {
  const rows = createdRows(before, after, 'rules');
  assert.equal(rows.length, 1);
  const [row] = rows;
  if (expectedId) assert.equal(row.id, expectedId);
  assert.equal(row.stage, fields.stage === 'default' ? null : fields.stage);
  assert.equal(row.conditions_op, fields.conditionsOp);
  // The owner stores the payee field under its internal column name.
  assert.deepEqual(
    JSON.parse(row.conditions),
    fields.conditions.map(condition => ({
      ...condition,
      field: condition.field === 'payee' ? 'description' : condition.field,
    })),
  );
  assert.deepEqual(JSON.parse(row.actions), fields.actions);
  assert.equal(row.tombstone, 0);
  assertRawEffect(before, after, expected => {
    expected.rules.push(row);
  });
  return row.id;
}

const creation = {
  operation: 'rules.create',
  label: 'rule creation',
  data: () => ruleFields('packaged-payee'),
  otherData: () => ruleFields('other-payee'),
  verify(before, after, { proposal, outcome }) {
    const id = verifyRuleCreated(
      before,
      after,
      proposal.request,
      outcome?.ruleCreation?.ruleId,
    );
    if (outcome) assert.deepEqual(outcome.affectedIds, [id]);
  },
  direct: () => ({
    args: [
      'rules',
      'create',
      '--data',
      JSON.stringify({ ...ruleFields('direct-payee'), stage: 'default' }),
    ],
    verify(before, after, result) {
      assert.equal(
        verifyRuleCreated(before, after, {
          ...ruleFields('direct-payee'),
          stage: 'default',
        }),
        result.id,
      );
    },
  }),
  laterEdit: (_f, _ctx, outcome) => [
    'rules',
    'delete',
    outcome.ruleCreation.ruleId,
  ],
  independent: (_f, _ctx, outcome) => ({
    args: ['rules', 'list'],
    check(rows) {
      assert.ok(Array.isArray(rows));
      assert.ok(outcome.ruleCreation.ruleId);
    },
  }),
};

const update = {
  operation: 'rules.update',
  label: 'rule update',
  async setup(f) {
    return {
      id: await legacyRule(f, 'update-payee'),
      other: await legacyRule(f, 'direct-update-payee'),
    };
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({ stage: 'post', conditionsOp: 'or' }),
  otherData: () => ({ stage: null }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      patchRow(expected.rules, ctx.id, { stage: 'post', conditions_op: 'or' });
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: [
      'rules',
      'update',
      '--data',
      JSON.stringify({
        ...ruleFields('direct-update-payee'),
        id: ctx.other,
        stage: 'post',
      }),
    ],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.rules, ctx.other, { stage: 'post' });
      });
    },
  }),
  laterEdit: (_f, ctx) => ['rules', 'delete', ctx.id],
  independent: (_f, ctx) => ({
    args: ['rules', 'list'],
    check(rows) {
      const row = rows.find(rule => rule.id === ctx.id);
      assert.ok(!row || row.stage === 'post');
    },
  }),
};

const deletion = {
  operation: 'rules.delete',
  label: 'rule deletion',
  async setup(f) {
    return {
      id: await legacyRule(f, 'delete-payee'),
      other: await legacyRule(f, 'direct-delete-payee'),
    };
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({}),
  otherData: () => ({ unexpected: true }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      patchRow(expected.rules, ctx.id, { tombstone: 1 });
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: ['rules', 'delete', ctx.other],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.rules, ctx.other, { tombstone: 1 });
      });
    },
  }),
  independent: (_f, ctx) => ({
    args: ['rules', 'list'],
    check(rows) {
      assert.ok(!rows.some(rule => rule.id === ctx.id));
    },
  }),
};

for (const spec of [creation, update, deletion]) guardedRegularCases(spec);
guardedInterruptionCases(creation);
