import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRawEffect,
  guardedRegularCases,
  readRaw,
} from './guarded-kit.mjs';
import { createFixture } from './harness.mjs';

// Packaged proof for the typed synced preference catalog and guarded changes.

function setPreference(expected, id, value) {
  const row = expected.preferences.find(candidate => candidate.id === id);
  if (row) row.value = value;
  else expected.preferences.push({ id, value });
}

const preferenceSet = {
  operation: 'preferences.set',
  label: 'preference change',
  target: () => 'dateFormat',
  data: () => ({ value: 'yyyy-MM-dd' }),
  otherData: () => ({ value: 'dd.MM.yyyy' }),
  verify(before, after, { outcome }) {
    assertRawEffect(before, after, expected => {
      setPreference(expected, 'dateFormat', 'yyyy-MM-dd');
    });
    if (outcome) assert.deepEqual(outcome.affectedIds, ['dateFormat']);
  },
  direct: () => ({
    args: ['preferences', 'set', 'firstDayOfWeekIdx', '1'],
    verify(before, after) {
      assertRawEffect(before, after, expected => {
        setPreference(expected, 'firstDayOfWeekIdx', '1');
      });
    },
  }),
  laterEdit: () => [
    'preferences',
    'set',
    'dateFormat',
    'dd/MM/yyyy',
    '--operation-id',
    'preference-later-edit',
  ],
  independent: () => ({
    args: ['preferences', 'inspect', 'dateFormat'],
    check(rows) {
      assert.equal(rows.length, 1);
      assert.equal(rows[0].value, 'dd/MM/yyyy');
      assert.equal(rows[0].scope, 'synced');
    },
  }),
};

guardedRegularCases(preferenceSet);

void test('preference inspection never writes and domain-owned keys are rejected', async () => {
  const f = await createFixture({ encrypted: true, richBackup: true });
  try {
    const cli = async args => {
      const result = await f.cli(args);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout).data;
    };
    await cli(['accounts', 'list']);
    const before = await readRaw(f);
    const catalog = await cli(['preferences', 'inspect']);
    const unset = catalog.find(row => row.key === 'numberFormat');
    assert.equal(unset.settable, true);
    assert.equal(unset.appDefault, 'comma-dot');
    assert.equal(
      catalog.find(row => row.key === 'cashPlanning').owner,
      '0026-cli-cash-planning',
    );
    for (const args of [
      ['preferences', 'inspect', 'not-a-pref'],
      ['preferences', 'set', 'cashPlanning', '{}', '--operation-id', 'p1'],
      ['preferences', 'set', 'budgetType', 'tracking', '--operation-id', 'p2'],
      ['preferences', 'set', 'hideFraction', 'yes', '--operation-id', 'p3'],
      ['preferences', 'set', 'not-a-pref', 'x', '--operation-id', 'p4'],
    ]) {
      const result = await f.cli(args);
      assert.notEqual(result.code, 0, `${args.join(' ')} should fail`);
    }
    assert.deepEqual(await readRaw(f), before, 'reads and rejections wrote');

    await cli([
      'preferences',
      'set',
      'hideFraction',
      'true',
      '--operation-id',
      'hide-fraction',
    ]);
    const reset = await cli([
      'preferences',
      'reset',
      'hideFraction',
      '--operation-id',
      'hide-fraction-reset',
    ]);
    assert.equal(reset.receipt.outcome.changed, true);
    const fresh = await f.cli(
      ['--require-fresh', 'preferences', 'inspect', 'hideFraction'],
      { client: 'independent' },
    );
    assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
    assert.equal(JSON.parse(fresh.stdout).data[0].value, null);
  } finally {
    await f.dispose();
  }
});
