import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFixture } from './harness.mjs';

// Packaged proof for read-only query metadata and validation (task 0017).

function parse(result) {
  return JSON.parse(result.stdout);
}

void test(
  'query metadata comes from the core schema and invalid expressions fail before connecting',
  { timeout: 180000 },
  async () => {
    const f = await createFixture();
    try {
      const tables = await f.cli(['query', 'tables']);
      assert.equal(tables.code, 0, tables.stdout + tables.stderr);
      const tableData = parse(tables).data;
      assert.equal(tableData.source, 'core-schema');
      const names = tableData.tables.map(table => table.name);
      for (const name of ['transactions', 'accounts', 'payees', 'notes']) {
        assert.ok(names.includes(name), `core table ${name} is listed`);
      }
      assert.ok(tableData.filterOperators.includes('$oneof'));

      const fields = parse(
        await f.cli(['query', 'fields', 'transactions']),
      ).data;
      assert.deepEqual(
        fields.fields.find(field => field.name === 'payee'),
        { name: 'payee', type: 'id', ref: 'payees', required: false },
      );
      const unknownTable = await f.cli(['query', 'fields', 'nope']);
      assert.equal(unknownTable.code, 2, unknownTable.stdout);
      assert.equal(parse(unknownTable).error.code, 'INVALID_INPUT');

      const legacy = await f.cli(['query', 'tables'], { version: '1' });
      assert.equal(legacy.code, 0, legacy.stdout + legacy.stderr);
      assert.deepEqual(
        JSON.parse(legacy.stdout).map(table => table.name),
        [
          'transactions',
          'accounts',
          'categories',
          'payees',
          'rules',
          'schedules',
        ],
      );

      for (const args of [
        ['--filter', '{"amount":{"$between":[1,2]}}'],
        ['--select', 'amount,missing_field'],
        ['--filter', '{"payee.nope":"x"}'],
      ]) {
        const rejected = await f.cli([
          'query',
          'run',
          '--table',
          'transactions',
          ...args,
        ]);
        assert.equal(rejected.code, 2, rejected.stdout + rejected.stderr);
        const body = parse(rejected);
        assert.equal(body.error.code, 'INVALID_INPUT');
        assert.equal(body.error.details.field, 'query');
        assert.equal(
          body.context.mode,
          'no-budget',
          'rejected before connecting',
        );
      }

      const ok = await f.cli([
        'query',
        'run',
        '--table',
        'transactions',
        '--select',
        'amount,payee.name',
        '--filter',
        '{"account":"' + f.fixture.checking + '"}',
        '--limit',
        '2',
      ]);
      assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    } finally {
      await f.dispose();
    }
  },
);
