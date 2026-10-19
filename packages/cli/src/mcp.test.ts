import { PassThrough } from 'node:stream';

import { forwardedGlobalArgs } from './commands/mcp';
import { buildTools, serveMcp, toolArgv, ToolInputError } from './mcp';
import { createProgram } from './program';

vi.mock('@actual-app/api', () => ({}));

describe('mcp adapter', () => {
  const program = createProgram('test');

  it('generates domain tools from the registry and excludes CLI-only commands', () => {
    const tools = buildTools(program);
    expect(tools.has('accounts_list')).toBe(true);
    expect(tools.has('imports_preview')).toBe(true);
    expect(tools.has('server_start')).toBe(false);
    expect(tools.has('sync_watch')).toBe(false);
    expect(tools.has('mcp_serve')).toBe(false);
    const preview = tools.get('imports_preview');
    expect(preview?.tool.inputSchema.required).toEqual(
      expect.arrayContaining(['account', 'file']),
    );
    expect(preview?.tool.annotations.readOnlyHint).toBe(true);
    const limited = buildTools(program, ['changes']);
    expect([...limited.keys()].every(name => name.startsWith('changes_'))).toBe(
      true,
    );
  });

  it('maps validated input onto CLI arguments', () => {
    const tools = buildTools(program);
    const preview = tools.get('imports_preview');
    if (!preview) throw new Error('missing tool');
    expect(
      toolArgv(preview, {
        file: 'a.csv',
        account: 'acct',
        saved: false,
        reimportDeleted: false,
        skipInvalid: true,
      }),
    ).toEqual([
      'imports',
      'preview',
      '--account',
      'acct',
      '--no-saved',
      '--skip-invalid',
      '--no-reimport-deleted',
      '--',
      'a.csv',
    ]);
    expect(() => toolArgv(preview, { file: 'a.csv' })).toThrow(ToolInputError);
    // Flag-looking operands stay operands, and inherited names are not arguments.
    expect(
      toolArgv(preview, { file: '--sync-id=other', account: 'acct' }),
    ).toEqual([
      'imports',
      'preview',
      '--account',
      'acct',
      '--',
      '--sync-id=other',
    ]);
    expect(() =>
      toolArgv(preview, { file: 'a.csv', account: 'x', constructor: 'y' }),
    ).toThrow(/Unknown argument/);
    expect(() =>
      toolArgv(preview, { file: 'a.csv', account: 'x', extra: 1 }),
    ).toThrow(/Unknown argument/);
    expect(() => toolArgv(preview, { file: 'a.csv', account: 3 })).toThrow(
      /must be string/,
    );
  });

  it('forwards global options except output selection', () => {
    expect(
      forwardedGlobalArgs([
        '--sync-id',
        's',
        '--output-version',
        '2',
        '--format=json',
        '-f',
        'table',
        '-f=csv',
        'mcp',
        'serve',
        '--domains',
        'accounts',
      ]),
    ).toEqual(['--sync-id', 's']);
  });

  it('answers protocol requests on its output stream only', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) =>
      lines.push(...chunk.toString().trim().split('\n')),
    );
    const served = serveMcp({
      root: program,
      globalArgs: [],
      cliEntry: 'unused.js',
      version: 'test',
      input,
      output,
    });
    input.write(
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}\n',
    );
    input.write('{"jsonrpc":"2.0","id":2,"method":"nope"}\n');
    input.write('not json\n');
    input.write(
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"execute"}}\n',
    );
    input.end();
    await served;
    const messages = lines.map(line => JSON.parse(line));
    expect(messages[0].result.protocolVersion).toBe('2025-03-26');
    expect(messages[1].error.code).toBe(-32601);
    expect(messages[2].error.code).toBe(-32700);
    expect(messages[3].error.code).toBe(-32602);
  });

  it('survives arguments a process cannot receive and malformed params', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) =>
      lines.push(...chunk.toString().trim().split('\n')),
    );
    const served = serveMcp({
      root: program,
      globalArgs: [],
      cliEntry: 'does-not-exist.js',
      version: 'test',
      input,
      output,
    });
    input.write(
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":null}\n',
    );
    input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":[]}\n');
    input.write(
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"accounts_close","arguments":{"id":"a\\u0000b"}}}\n',
    );
    input.write('{"jsonrpc":"2.0","id":4,"method":"tools/list"}\n');
    // Give the NUL-byte call time to fail before stdin closes.
    await new Promise(resolve => setTimeout(resolve, 200));
    input.end();
    await served;
    const byId = new Map(
      lines.map(line => JSON.parse(line)).map(message => [message.id, message]),
    );
    expect(byId.get(1).error.code).toBe(-32602);
    expect(byId.get(2).result.tools.length).toBeGreaterThan(0);
    expect(byId.get(3).error.code).toBe(-32602);
    expect(byId.get(4).result.tools.length).toBeGreaterThan(0);
  });
});
