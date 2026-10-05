import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readRaw } from './guarded-kit.mjs';
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

void test(
  'version 2 query pages tie-break equal dates by id and disclose concurrent changes',
  { timeout: 180000 },
  async () => {
    const f = await createFixture();
    try {
      const created = await f.cli(['accounts', 'create', '--name', 'Paging'], {
        version: '1',
      });
      assert.equal(created.code, 0, created.stdout + created.stderr);
      const account = JSON.parse(created.stdout).id;
      const added = await f.cli(
        [
          'transactions',
          'add',
          '--account',
          account,
          '--data',
          JSON.stringify(
            [1, 2, 3, 4, 5].map(n => ({
              date: '2026-10-02',
              amount: -n,
              notes: `same day ${n}`,
            })),
          ),
        ],
        { version: '1' },
      );
      assert.equal(added.code, 0, added.stdout + added.stderr);
      const base = [
        'query',
        'run',
        '--table',
        'transactions',
        '--select',
        'id,date,amount',
        '--filter',
        JSON.stringify({ account }),
        '--order-by',
        'date',
        '--limit',
        '2',
      ];
      const seen = [];
      let cursor;
      let pages = 0;
      do {
        const result = await f.cli([
          ...base,
          ...(cursor ? ['--cursor', cursor] : []),
        ]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        const body = parse(result);
        assert.equal(body.data.page.tieBreaker, 'id');
        assert.deepEqual(body.data.page.orderBy, ['date', { id: 'asc' }]);
        assert.equal(
          body.data.snapshot.changedSinceCursor,
          cursor ? false : null,
        );
        assert.deepEqual(body.warnings, []);
        seen.push(...body.data.rows.map(row => row.id));
        cursor = body.data.page.nextCursor;
        assert.equal(body.data.page.truncated, Boolean(cursor));
        pages += 1;
      } while (cursor);
      assert.equal(pages, 3);
      assert.equal(seen.length, 5);
      assert.deepEqual(
        seen,
        [...seen].sort((a, b) => a.localeCompare(b)),
      );

      // A change from another client between pages is disclosed.
      const first = parse(await f.cli(base));
      const change = await f.cli(
        [
          'transactions',
          'add',
          '--account',
          account,
          '--data',
          JSON.stringify([{ date: '2026-10-02', amount: -9 }]),
        ],
        { version: '1', client: 'b' },
      );
      assert.equal(change.code, 0, change.stdout + change.stderr);
      // Reads use the local cache unless freshness is required.
      const second = await f.cli([
        '--require-fresh',
        ...base,
        '--cursor',
        first.data.page.nextCursor,
      ]);
      assert.equal(second.code, 0, second.stdout + second.stderr);
      const body = parse(second);
      assert.equal(body.data.snapshot.changedSinceCursor, true);
      assert.equal(body.warnings.length, 1);

      const otherQuery = await f.cli([
        'query',
        'run',
        '--table',
        'accounts',
        '--cursor',
        first.data.page.nextCursor,
      ]);
      assert.equal(otherQuery.code, 2, otherQuery.stdout);
      assert.equal(parse(otherQuery).error.details.field, 'cursor');
    } finally {
      await f.dispose();
    }
  },
);

void test(
  'split-aware aggregates match engine rows and write nothing',
  { timeout: 180000 },
  async () => {
    const f = await createFixture();
    try {
      const aggregate = async args => {
        const result = await f.cli(['query', 'aggregate', ...args]);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        return parse(result).data;
      };
      const august = ['--start', '2026-08-01', '--end', '2026-08-31'];
      // Prime the local cache so the raw comparison sees only aggregate effects.
      await aggregate(august);
      const before = await readRaw(f);
      const before2 = parse(
        await f.cli(['query', 'run', '--table', 'transactions', '--count']),
      );
      const byKind = data => kind =>
        data.groups.filter(group => group.kind === kind);
      const leaves = await aggregate([
        ...august,
        '--account',
        f.fixture.checking,
      ]);
      const leaf = byKind(leaves);
      const category = id =>
        leaves.groups.find(group => group.categoryId === id);
      assert.deepEqual(
        {
          total: category(f.fixture.groceries).total,
          inflow: category(f.fixture.groceries).inflow,
          outflow: category(f.fixture.groceries).outflow,
          count: category(f.fixture.groceries).count,
        },
        { total: -8000, inflow: 2000, outflow: -10000, count: 2 },
      );
      assert.equal(category(f.fixture.dining).total, -5000);
      assert.equal(leaf('uncategorized')[0].total, -1000);
      assert.equal(leaf('transfer')[0].total, -10000);
      assert.equal(leaves.total, -24000);
      assert.equal(leaves.count, 5);

      const parents = await aggregate([
        ...august,
        '--account',
        f.fixture.checking,
        '--splits',
        'parents',
      ]);
      assert.equal(parents.total, -24000, 'split mode never changes the total');
      assert.equal(byKind(parents)('uncategorized')[0].total, -16000);
      assert.equal(parents.count, 4);

      const all = await aggregate(august);
      const transfer = byKind(all)('transfer')[0];
      assert.deepEqual(
        {
          total: transfer.total,
          inflow: transfer.inflow,
          count: transfer.count,
        },
        { total: 0, inflow: 10000, count: 2 },
      );

      const everything = await aggregate([]);
      const starting = parse(
        await f.cli([
          'query',
          'run',
          '--table',
          'transactions',
          '--select',
          'amount',
          '--filter',
          '{"starting_balance_flag":true}',
        ]),
      ).data.rows.reduce((sum, row) => sum + row.amount, 0);
      assert.equal(byKind(everything)('starting-balance')[0].total, starting);
      assert.notEqual(starting, 0);

      assert.deepEqual(await readRaw(f), before, 'aggregates wrote state');
      assert.deepEqual(
        parse(
          await f.cli(['query', 'run', '--table', 'transactions', '--count']),
        ),
        before2,
      );
    } finally {
      await f.dispose();
    }
  },
);
