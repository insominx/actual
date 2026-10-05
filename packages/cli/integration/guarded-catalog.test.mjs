import assert from 'node:assert/strict';

import {
  assertRawEffect,
  createdRows,
  guardedInterruptionCases,
  guardedRegularCases,
} from './guarded-kit.mjs';

// Packaged proof for guarded payee updates, deletions and merges and tag
// creation, updates and deletions.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

async function payees(f, names) {
  const ids = [];
  for (const name of names) {
    ids.push((await legacy(f, ['payees', 'create', '--name', name])).id);
  }
  return ids;
}

function patchRow(rows, id, patch) {
  const row = rows.find(candidate => candidate.id === id);
  assert.ok(row, `row ${id} exists`);
  Object.assign(row, patch);
}

const payeeUpdate = {
  operation: 'payees.update',
  label: 'payee update',
  async setup(f) {
    const [id, other] = await payees(f, ['Original payee', 'Other payee']);
    return { id, other };
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({ name: 'Renamed payee' }),
  otherData: () => ({ name: 'Different name' }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      patchRow(expected.payees, ctx.id, { name: 'Renamed payee' });
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: ['payees', 'update', ctx.other, '--name', 'Direct name'],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.payees, ctx.other, { name: 'Direct name' });
      });
    },
  }),
  laterEdit: (_f, ctx) => ['payees', 'update', ctx.id, '--name', 'Later'],
  independent: (_f, ctx) => ({
    args: ['payees', 'list'],
    check(rows) {
      assert.ok(rows.some(row => row.id === ctx.id));
    },
  }),
};

const payeeDeletion = {
  operation: 'payees.delete',
  label: 'payee deletion',
  async setup(f) {
    const [id, other] = await payees(f, ['Doomed payee', 'Direct doomed']);
    return { id, other };
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({}),
  otherData: () => ({ unexpected: true }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      patchRow(expected.payees, ctx.id, { tombstone: 1 });
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: ['payees', 'delete', ctx.other],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.payees, ctx.other, { tombstone: 1 });
      });
    },
  }),
  independent: (_f, ctx) => ({
    args: ['payees', 'list'],
    check(rows) {
      assert.ok(!rows.some(row => row.id === ctx.id));
    },
  }),
};

const payeeMerge = {
  operation: 'payees.merge',
  label: 'payee merge',
  async setup(f) {
    const [target, first, second, third] = await payees(f, [
      'Merge target',
      'Merge source one',
      'Merge source two',
      'Direct merge source',
    ]);
    return { target, first, second, third };
  },
  target: (_f, ctx) => ctx.target,
  data: (_f, ctx) => ({ mergeIds: [ctx.first, ctx.second] }),
  otherData: (_f, ctx) => ({ mergeIds: [ctx.first] }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      for (const id of [ctx.first, ctx.second]) {
        patchRow(expected.payees, id, { tombstone: 1 });
        patchRow(expected.payee_mapping, id, { targetId: ctx.target });
      }
    });
    if (outcome) {
      assert.deepEqual(outcome.affectedIds, [
        ctx.target,
        ctx.first,
        ctx.second,
      ]);
      assert.deepEqual(outcome.payeeMerge, {
        targetId: ctx.target,
        mergedIds: [ctx.first, ctx.second],
      });
    }
  },
  direct: (_f, ctx) => ({
    args: ['payees', 'merge', '--target', ctx.target, '--ids', ctx.third],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.payees, ctx.third, { tombstone: 1 });
        // Mappings already remapped to the merged source follow it too.
        for (const row of expected.payee_mapping) {
          if (row.targetId === ctx.third) row.targetId = ctx.target;
        }
      });
    },
  }),
  independent: (_f, ctx) => ({
    args: ['payees', 'list'],
    check(rows) {
      assert.ok(rows.some(row => row.id === ctx.target));
      assert.ok(!rows.some(row => row.id === ctx.first));
    },
  }),
};

function verifyTagCreated(before, after, tag, expectedId) {
  const rows = createdRows(before, after, 'tags');
  assert.equal(rows.length, 1);
  const [row] = rows;
  if (expectedId) assert.equal(row.id, expectedId);
  assert.equal(row.tag, tag.tag);
  assert.equal(row.color, tag.color ?? null);
  assert.equal(row.description, tag.description ?? null);
  assert.equal(row.tombstone, 0);
  assertRawEffect(before, after, expected => {
    expected.tags.push(row);
  });
  return row.id;
}

const tagCreation = {
  operation: 'tags.create',
  label: 'tag creation',
  data: () => ({ tag: 'packaged', color: '#00ff00', description: 'Proof' }),
  otherData: () => ({ tag: 'another' }),
  verify(before, after, { proposal, outcome }) {
    const id = verifyTagCreated(
      before,
      after,
      proposal.request,
      outcome?.tagCreation?.tagId,
    );
    if (outcome) {
      assert.deepEqual(outcome.affectedIds, [id]);
      assert.equal(outcome.tagCreation.action, 'insert');
    }
  },
  direct: () => ({
    args: ['tags', 'create', '--tag', 'direct'],
    verify(before, after, result) {
      assert.equal(
        verifyTagCreated(before, after, { tag: 'direct' }),
        result.id,
      );
    },
  }),
  laterEdit: (_f, _ctx, outcome) => [
    'tags',
    'update',
    outcome.tagCreation.tagId,
    '--color',
    '#123456',
  ],
  independent: (_f, _ctx, outcome) => ({
    args: ['tags', 'list'],
    check(rows) {
      assert.equal(
        rows.filter(row => row.id === outcome.tagCreation.tagId).length,
        1,
      );
    },
  }),
};

async function tags(f, names) {
  const ids = [];
  for (const tag of names) {
    ids.push((await legacy(f, ['tags', 'create', '--tag', tag])).id);
  }
  return ids;
}

const tagUpdate = {
  operation: 'tags.update',
  label: 'tag update',
  async setup(f) {
    const [id, other] = await tags(f, ['original', 'other']);
    return { id, other };
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({ tag: 'renamed', description: 'Updated' }),
  otherData: () => ({ color: 'red' }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      patchRow(expected.tags, ctx.id, {
        tag: 'renamed',
        description: 'Updated',
      });
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: ['tags', 'update', ctx.other, '--color', 'blue'],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.tags, ctx.other, { color: 'blue' });
      });
    },
  }),
  laterEdit: (_f, ctx) => ['tags', 'update', ctx.id, '--color', 'green'],
  independent: (_f, ctx) => ({
    args: ['tags', 'list'],
    check(rows) {
      assert.equal(rows.find(row => row.id === ctx.id)?.tag, 'renamed');
    },
  }),
};

const tagDeletion = {
  operation: 'tags.delete',
  label: 'tag deletion',
  async setup(f) {
    const [id, other] = await tags(f, ['doomed', 'directdoomed']);
    return { id, other };
  },
  target: (_f, ctx) => ctx.id,
  data: () => ({}),
  otherData: () => ({ unexpected: true }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      patchRow(expected.tags, ctx.id, { tombstone: 1 });
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [ctx.id]);
  },
  direct: (_f, ctx) => ({
    args: ['tags', 'delete', ctx.other],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        patchRow(expected.tags, ctx.other, { tombstone: 1 });
      });
    },
  }),
  independent: (_f, ctx) => ({
    args: ['tags', 'list'],
    check(rows) {
      assert.ok(!rows.some(row => row.id === ctx.id));
    },
  }),
};

for (const spec of [
  payeeUpdate,
  payeeDeletion,
  payeeMerge,
  tagCreation,
  tagUpdate,
  tagDeletion,
]) {
  guardedRegularCases(spec);
}
// Interruption proof for the multi-row merge and the identity-creating write.
guardedInterruptionCases(payeeMerge);
guardedInterruptionCases(tagCreation);
