import { writeAgentError } from './agent-output';
import { createProgram, wantsAgentOutput } from './program';

// Boundary only: these discovery/validation commands must never call the API.
vi.mock('@actual-app/api', () => ({}));

describe('registered agent commands', () => {
  it('does not change legacy output for entities named like new commands', () => {
    const program = createProgram('test');
    expect(
      wantsAgentOutput(program, ['accounts', 'create', '--name', 'context']),
    ).toBe(false);
    expect(
      wantsAgentOutput(program, ['--profile', 'context', 'query', 'tables']),
    ).toBe(false);
    expect(
      wantsAgentOutput(program, [
        '--profiles-file',
        'local.json',
        'profiles',
        'list',
      ]),
    ).toBe(true);
  });
  let stdout: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stdout.mockRestore();
    process.exitCode = 0;
  });
  async function run(args: string[]) {
    const program = createProgram('test');
    program.exitOverride();
    try {
      await program.parseAsync(args, { from: 'user' });
    } catch (error) {
      writeAgentError(error);
    }
    return JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
  }
  it('discovers every command with schemas and global options without credentials', async () => {
    const result = await run(['capabilities']);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(result.schemaVersion).toBe(2);
    expect(result.context.mode).toBe('no-budget');
    const names = result.data.operations.map((o: { name: string }) => o.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('transactions.import');
    expect(names).toContain('schedules.create');
    expect(names.length).toBeGreaterThan(50);
    for (const operation of result.data.operations) {
      expect(operation.inputSchema.additionalProperties).toBe(false);
      expect(operation.globalOptions.outputVersion.enum).toEqual(['1', '2']);
    }
  });
  it('preserves the existing raw query tables result', async () => {
    const result = await run(['query', 'tables']);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContainEqual({ name: 'transactions' });
  });
  it('rejects unknown transaction fields before connecting', async () => {
    const result = await run([
      '--output-version',
      '2',
      'transactions',
      'import',
      '--account',
      'a',
      '--data',
      '[{"date":"2026-01-01","amount":100,"amout":100}]',
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.details.field).toBe('data[0].amout');
    expect(result.context.budgetId).toBeNull();
    expect(stdout).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid JSON and unsafe split amounts before connecting', async () => {
    let result = await run([
      '--output-version',
      '2',
      'transactions',
      'import',
      '--account',
      'a',
      '--data',
      '{',
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
    result = await run([
      '--output-version',
      '2',
      'transactions',
      'import',
      '--account',
      'a',
      '--data',
      '[{"date":"2026-01-01","subtransactions":[{"amount":1.2}]}]',
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
  });
  it('provides schema detail and never fabricates preview support', async () => {
    const result = await run(['schema', 'transactions.import']);
    expect(result.data.payloadSchema.type).toBe('array');
    expect(result.data.capabilities.preview).toBe(false);
    expect(result.data.capabilities.reversal).toBe(false);
  });
});
