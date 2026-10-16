import assert from 'node:assert/strict';

import { parseTap, parseVitestJson, summarize } from './flake-detect.mjs';
import { test } from './shard.mjs';

void test('parses TAP results and ignores skipped tests', () => {
  const results = parseTap(
    [
      'ok 1 - first',
      'not ok 2 - second',
      '    ok 1 - nested',
      'ok 3 - later # SKIP',
      '# pass 1',
    ].join('\n'),
  );
  assert.deepEqual(
    [...results],
    [
      ['0:first', true],
      ['0:second', false],
      ['1:nested', true],
    ],
  );
});

void test('parses vitest JSON mixed with other output', () => {
  const json = JSON.stringify({
    testResults: [
      {
        name: '/a.test.ts',
        assertionResults: [
          { fullName: 'x ok', status: 'passed' },
          { fullName: 'x bad', status: 'failed' },
          { fullName: 'x skip', status: 'skipped' },
        ],
      },
    ],
  });
  assert.deepEqual(
    [...parseVitestJson(`noise\n${json}\n`)],
    [
      ['/a.test.ts::x ok', true],
      ['/a.test.ts::x bad', false],
    ],
  );
});

void test('classifies flaky, always failing and crashed runs', () => {
  const run = (index, entries, timedOut = false) => ({
    index,
    timedOut,
    results: new Map(entries),
  });
  const summary = summarize([
    run(1, [
      ['a', true],
      ['b', false],
      ['c', true],
    ]),
    run(2, [
      ['a', false],
      ['b', false],
      ['c', true],
    ]),
    run(3, [], true),
  ]);
  assert.deepEqual(summary.flaky, [
    { name: 'a', passed: 1, failed: 1, missing: 0 },
  ]);
  assert.deepEqual(summary.alwaysFailing, [{ name: 'b', failed: 2 }]);
  assert.deepEqual(summary.crashed, [3]);
});
