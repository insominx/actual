import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRawEffect,
  guardedInterruptionCases,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for guarded note changes and read-only note lookup.

async function legacy(f, args) {
  const result = await f.cli(args, { version: '1' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  return parsed.data ?? parsed;
}

function setNote(expected, id, note) {
  const row = expected.notes.find(candidate => candidate.id === id);
  if (row) row.note = note;
  else expected.notes.push({ id, note });
}

const noteSet = {
  operation: 'notes.set',
  label: 'note change',
  async setup(f) {
    const id = (await legacy(f, ['accounts', 'create', '--name', 'Noted'])).id;
    const other = (
      await legacy(f, ['accounts', 'create', '--name', 'Other noted'])
    ).id;
    return { id, other };
  },
  target: (_f, ctx) => `account-${ctx.id}`,
  data: () => ({ note: 'Planned note' }),
  otherData: () => ({ note: 'Different note' }),
  verify(before, after, { outcome, ctx }) {
    assertRawEffect(before, after, expected => {
      setNote(expected, `account-${ctx.id}`, 'Planned note');
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, [`account-${ctx.id}`]);
  },
  direct: (_f, ctx) => ({
    args: ['notes', 'set', '--account', ctx.other, '--note', 'Direct note'],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        setNote(expected, `account-${ctx.other}`, 'Direct note');
      });
    },
  }),
  laterEdit: (_f, ctx) => [
    'notes',
    'set',
    '--account',
    ctx.id,
    '--note',
    'Later note',
    '--operation-id',
    'note-later-edit',
  ],
  independent: (_f, ctx) => ({
    args: ['notes', 'get', '--account', ctx.id],
    check(result) {
      assert.equal(result.note, 'Later note');
      assert.deepEqual(result.target, {
        kind: 'account',
        id: ctx.id,
        name: 'Noted',
      });
    },
  }),
};

guardedRegularCases(noteSet);
guardedInterruptionCases(noteSet);

void test('note reads never write, orphan targets fail, and month notes resolve', async () => {
  const f = await createFixture({ encrypted: true, richBackup: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await cli(['accounts', 'list']);
    const groups = await legacy(f, ['category-groups', 'list']);
    const category = groups.flatMap(group => group.categories ?? [])[0];
    assert.ok(category, 'fixture has a category');
    const before = await readRaw(f);

    const missing = await cli(['notes', 'get', '--month', '2026-10']);
    assert.deepEqual(missing, {
      id: 'budget-2026-10',
      target: { kind: 'month', month: '2026-10' },
      note: null,
    });
    const categoryMonth = await cli([
      'notes',
      'get',
      '--category',
      category.id,
      '--month',
      '2026-10',
    ]);
    assert.equal(categoryMonth.target.kind, 'category-month');
    assert.equal(categoryMonth.note, null);
    for (const args of [
      ['notes', 'get', 'not-a-target'],
      ['notes', 'get', '--account', 'missing'],
      ['notes', 'get', '--month', '2026-13'],
      ['notes', 'get', '--account', 'a', '--group', 'b'],
      ['notes', 'set', 'not-a-target', '--note', 'x', '--operation-id', 'o1'],
      ['notes', 'set', '--month', '2026-10', '--operation-id', 'o2'],
    ]) {
      const result = await f.cli(args);
      assert.notEqual(result.code, 0, `${args.join(' ')} should fail`);
    }
    assert.deepEqual(await readRaw(f), before, 'reads and rejections wrote');

    const set = await cli([
      'notes',
      'set',
      '--month',
      '2026-10',
      '--note',
      'Month plan',
      '--operation-id',
      'month-note',
    ]);
    assert.equal(set.receipt.outcome.status, 'committed-local');
    assert.equal(
      (await cli(['notes', 'get', '--month', '2026-10'])).note,
      'Month plan',
    );
    const cleared = await cli([
      'notes',
      'set',
      'budget-2026-10',
      '--clear',
      '--operation-id',
      'month-note-clear',
    ]);
    assert.equal(cleared.receipt.outcome.changed, true);
    const fresh = await f.cli(
      ['--require-fresh', 'notes', 'get', '--month', '2026-10'],
      { client: 'independent' },
    );
    assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
    assert.equal(JSON.parse(fresh.stdout).data.note, '');
  } finally {
    await f.dispose();
  }
});
