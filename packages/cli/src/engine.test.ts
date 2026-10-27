import { describe, expect, it, vi } from 'vitest';

import {
  engineNeeded,
  explainEngineLoadError,
  GLOBAL_VALUE_OPTIONS,
} from './engine';
import { createProgram } from './program';

vi.mock('@actual-app/api', () => ({}));

describe('engineNeeded', () => {
  it.each([
    [['--help'], false],
    [['-h'], false],
    [['--version'], false],
    [['-V'], false],
    [['accounts', 'list', '--help'], false],
    [['capabilities'], false],
    [['schema', 'accounts.create'], false],
    [['profiles', 'list'], false],
    [['mcp'], false],
    [['help', 'accounts'], false],
    [['--format', 'json', 'capabilities'], false],
    [['--profile', 'p', '--profiles-file', 'x', 'schema'], false],
    [['accounts', 'list'], true],
    [['--profile', 'schema', 'accounts', 'list'], true],
    [['accounts', 'create', '--name', 'schema'], true],
    [['sync', '--', '--help'], true],
    [[], true],
  ])('%j -> %s', (argv, expected) => {
    expect(engineNeeded(argv)).toBe(expected);
  });

  it('knows every global option that takes a value', () => {
    const program = createProgram();
    const valued = program.options
      .filter(option => option.required || option.optional)
      .map(option => option.long)
      .filter((flag): flag is string => Boolean(flag))
      .sort();
    expect([...GLOBAL_VALUE_OPTIONS].sort()).toEqual(valued);
  });
});

describe('explainEngineLoadError', () => {
  function missing(path: string) {
    return Object.assign(new Error(`Cannot find module '${path}'`), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
  }

  it('names the rebuild when the bundle imports loot-core sources', () => {
    for (const path of [
      String.raw`D:\repo\packages\loot-core\src\platform\server\connection\errors`,
      '/repo/packages/loot-core/src/platform/server/connection/errors',
    ]) {
      expect(explainEngineLoadError(missing(path)).message).toContain(
        'yarn workspace @actual-app/api build',
      );
    }
  });

  it('passes other errors through', () => {
    const other = missing('/repo/node_modules/left-pad/index.js');
    expect(explainEngineLoadError(other)).toBe(other);
  });
});
