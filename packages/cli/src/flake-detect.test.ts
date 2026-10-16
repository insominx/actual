import {
  parseTap,
  parseVitestJson,
  summarize,
} from '../integration/flake-detect.mjs';

describe('flake detector', () => {
  it('parses TAP results and ignores skipped tests', () => {
    const results = parseTap(
      [
        'ok 1 - first',
        'not ok 2 - second',
        '    ok 1 - nested',
        'ok 3 - later # SKIP',
        '# pass 1',
      ].join('\n'),
    );
    expect([...results]).toEqual([
      ['0:first', true],
      ['0:second', false],
      ['1:nested', true],
    ]);
  });

  it('parses vitest JSON mixed with other output', () => {
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
    expect([...parseVitestJson(`noise\n${json}\n`)]).toEqual([
      ['/a.test.ts::x ok', true],
      ['/a.test.ts::x bad', false],
    ]);
  });

  it('classifies flaky, always failing and crashed runs', () => {
    const run = (
      index: number,
      entries: [string, boolean][],
      timedOut = false,
    ) => ({
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
    expect(summary.flaky).toEqual([
      { name: 'a', passed: 1, failed: 1, missing: 0 },
    ]);
    expect(summary.alwaysFailing).toEqual([{ name: 'b', failed: 2 }]);
    expect(summary.crashed).toEqual([3]);
  });
});
