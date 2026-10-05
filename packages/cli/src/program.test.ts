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
    expect(wantsAgentOutput(program, ['--offline', 'budgets', 'create'])).toBe(
      true,
    );
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

  it('requires an allocation operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'budgets',
      'set-amount',
      '--month',
      '2026-08',
      '--category',
      'category-id',
      '--amount',
      '12345',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'budgets.set-amount']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it.each([
    ['payees.update', ['payees', 'update', 'payee-id', '--name', 'Renamed']],
    ['payees.delete', ['payees', 'delete', 'payee-id']],
    [
      'payees.merge',
      ['payees', 'merge', '--target', 'payee-id', '--ids', 'other-id'],
    ],
    ['tags.create', ['tags', 'create', '--tag', 'groceries']],
    ['tags.update', ['tags', 'update', 'tag-id', '--color', 'red']],
    ['tags.delete', ['tags', 'delete', 'tag-id']],
  ])(
    'requires a %s operation ID before connecting and advertises it',
    async (command, args) => {
      const missing = await run(['--output-version', '2', ...args]);
      expect(missing.error.code).toBe('INVALID_INPUT');
      expect(missing.error.details.field).toBe('operationId');
      const schema = await run(['schema', command]);
      expect(schema.data.inputSchema.required).toContain('operationId');
    },
  );
  it('requires a category creation operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'categories',
      'create',
      '--name',
      'New category',
      '--group-id',
      'group-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'categories.create']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a payee creation operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'payees',
      'create',
      '--name',
      'New payee',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'payees.create']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a category group update operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'category-groups',
      'update',
      'group-id',
      '--hidden',
      'true',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'category-groups.update']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a category group deletion operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'category-groups',
      'delete',
      'group-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'category-groups.delete']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a category group creation operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'category-groups',
      'create',
      '--name',
      'Group',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'category-groups.create']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a category deletion operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'categories',
      'delete',
      'category-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'categories.delete']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a category update operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'categories',
      'update',
      'category-id',
      '--hidden',
      'true',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'categories.update']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires an account closure operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'accounts',
      'close',
      'account-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'accounts.close']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires an account deletion operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'accounts',
      'delete',
      'account-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'accounts.delete']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires an account reopen operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'accounts',
      'reopen',
      'account-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'accounts.reopen']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires an account update operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'accounts',
      'update',
      'account-id',
      '--name',
      'Renamed cash',
      '--offbudget',
      'true',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'accounts.update']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires an account creation operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'accounts',
      'create',
      '--name',
      'New cash',
      '--balance',
      '12345',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'accounts.create']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('requires a carryover operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'budgets',
      'set-carryover',
      '--month',
      '2026-08',
      '--category',
      'category-id',
      '--flag',
      'false',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'budgets.set-carryover']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it.each(['hold-next-month', 'reset-hold'])(
    'requires a %s operation ID before connecting and advertises it',
    async command => {
      const missing = await run([
        '--output-version',
        '2',
        'budgets',
        command,
        '--month',
        '2026-08',
        ...(command === 'hold-next-month' ? ['--amount', '12345'] : []),
      ]);
      expect(missing.error.code).toBe('INVALID_INPUT');
      expect(missing.error.details.field).toBe('operationId');
      const schema = await run(['schema', `budgets.${command}`]);
      expect(schema.data.inputSchema.required).toContain('operationId');
    },
  );
  it('requires a publication operation ID before connecting and advertises it', async () => {
    const missing = await run([
      '--output-version',
      '2',
      'budgets',
      'publish',
      'local-id',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    const schema = await run(['schema', 'budgets.publish']);
    expect(schema.data.inputSchema.required).toContain('operationId');
  });
  it('discovers the guarded change checkpoint without enabling general mutation guarantees', async () => {
    const preview = await run(['schema', 'changes.preview']);
    expect(preview.data.capabilities.mutates).toBe(false);
    expect(preview.data.capabilities.preview).toBe(false);
    expect(Object.keys(preview.data.payloadSchema.anyOf[0].properties)).toEqual(
      ['notes', 'amount', 'date', 'cleared'],
    );
    const inventory = await run(['schema', 'changes.list']);
    expect(inventory.data.inputSchema.properties.limit).toMatchObject({
      minimum: 1,
      maximum: 500,
    });
    expect(
      wantsAgentOutput(createProgram('test'), ['changes', 'status', 'id']),
    ).toBe(true);
  });
  it('requires an explicit backup listing directory before reading files', async () => {
    const result = await run(['backups', 'list', '--directory', ' ']);
    expect(result.operation).toBe('backups.list');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.message).toBe('Provide an explicit backup directory.');
  });
  it('declares comparison as read-only and retention as destructive with bounded policy inputs', async () => {
    const comparison = await run(['schema', 'budgets.compare']);
    expect(comparison.data.capabilities.mutates).toBe(false);
    expect(comparison.data.inputSchema.properties.limit.minimum).toBe(1);
    expect(comparison.data.inputSchema.properties.limit.maximum).toBe(1000);
    const retention = await run(['schema', 'backups.prune']);
    expect(retention.data.capabilities.destructive).toBe(true);
    expect(retention.data.inputSchema.properties.keep.minimum).toBe(1);
    expect(retention.data.inputSchema.properties.keep.maximum).toBe(1000);
    const rejected = await run([
      'backups',
      'prune',
      '--directory',
      'unused',
      '--keep',
      '0',
    ]);
    expect(rejected.error.code).toBe('INVALID_INPUT');
    expect(rejected.context.commit).toBe('none');
  });
  it('declares creation retry IDs and validates creation before connecting', async () => {
    const schema = await run(['schema', 'budgets.create']);
    expect(schema.data.inputSchema.required).toContain('operationId');
    const preview = await run(['schema', 'changes.preview']);
    expect(preview.data.arguments[1].required).toBe(false);
    expect(
      preview.data.payloadSchema.anyOf.at(-1).properties.currency.pattern,
    ).toBe('^[A-Z]{3}$');
    const invalidCurrency = await run([
      '--offline',
      'changes',
      'preview',
      'budgets.create',
      '--operation-id',
      'invalid-currency',
      '--data',
      '{"name":"Valid name","currency":"usd"}',
    ]);
    expect(invalidCurrency.error.code).toBe('INVALID_INPUT');
    expect(invalidCurrency.error.details.field).toBe('data');
    expect(invalidCurrency.context.commit).toBe('none');
    const missing = await run([
      '--offline',
      'budgets',
      'create',
      '--name',
      'Valid name',
    ]);
    expect(missing.error.code).toBe('INVALID_INPUT');
    expect(missing.error.details.field).toBe('operationId');
    expect(missing.context.commit).toBe('none');
    const target = await run([
      '--offline',
      'changes',
      'preview',
      'budgets.create',
      'existing-id',
      '--operation-id',
      'new',
      '--data',
      '{"name":"Valid name"}',
    ]);
    expect(target.error.code).toBe('INVALID_INPUT');
    expect(target.context.commit).toBe('none');
  });
  it('declares clone retry IDs and rejects missing IDs before API access', async () => {
    const schema = await run(['schema', 'budgets.clone']);
    expect(schema.data.inputSchema.required).toContain('operationId');
    const result = await run([
      '--offline',
      'budgets',
      'clone',
      '--name',
      'New copy',
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.details.field).toBe('operationId');
    expect(result.context.commit).toBe('none');
  });
  it('declares restore retry IDs and rejects missing IDs before reading an archive', async () => {
    const schema = await run(['schema', 'backups.restore']);
    expect(schema.data.inputSchema.required).toContain('operationId');
    const result = await run([
      '--offline',
      'backups',
      'restore',
      'missing.actualbackup',
      '--name',
      'New restoration',
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.details.field).toBe('operationId');
    expect(result.context.commit).toBe('none');
  });
  it('validates local creation before connecting or writing files', async () => {
    const result = await run(['budgets', 'create', '--name', 'x'.repeat(101)]);
    expect(result.operation).toBe('budgets.create');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.context.commit).toBe('none');
  });
  it('starts version 2 output for lifecycle validation without an explicit output flag', async () => {
    const result = await run(['budgets', 'rename', '--name', ' ']);
    expect(result.schemaVersion).toBe(2);
    expect(result.operation).toBe('budgets.rename');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.context.commit).toBe('none');
  });
  it('declares metadata retry IDs and rejects missing IDs before contacting the API', async () => {
    const schema = await run(['schema', 'budgets.rename']);
    expect(schema.data.inputSchema.required).toContain('operationId');
    const result = await run(['budgets', 'rename', '--name', 'Valid name']);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.error.details.field).toBe('operationId');
    expect(result.context.commit).toBe('none');
  });
  it('uses version 2 for new budget operations and declares inspection read-only', async () => {
    const program = createProgram('test');
    for (const operation of [
      'inspect',
      'select',
      'clone',
      'publish',
      'rename',
      'archive',
    ]) {
      expect(wantsAgentOutput(program, ['budgets', operation])).toBe(true);
    }
    const result = await run(['capabilities']);
    expect(
      result.data.operations.find(
        (o: { name: string }) => o.name === 'budgets.inspect',
      ).capabilities.mutates,
    ).toBe(false);
    expect(
      result.data.operations.find(
        (o: { name: string }) => o.name === 'budgets.clone',
      ).capabilities.mutates,
    ).toBe(true);
  });
  it('discovers every command with schemas and global options without credentials', async () => {
    const result = await run(['capabilities']);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(result.schemaVersion).toBe(2);
    expect(result.context.mode).toBe('no-budget');
    const names = result.data.operations.map((o: { name: string }) => o.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('transactions.import');
    expect(names).toContain('schedules.create');
    expect(names).toContain('sync.status');
    expect(names).toContain('sync.refresh');
    expect(names).toContain('sync.watch');
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
  it('rejects a blank backup directory before connecting', async () => {
    const result = await run(['backups', 'create', '--directory', ' ']);
    expect(result.operation).toBe('backups.create');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.context.commit).toBe('none');
  });
  it('uses version 2 for sync validation without connecting', async () => {
    const program = createProgram('test');
    expect(wantsAgentOutput(program, ['sync', 'status'])).toBe(true);
    expect(wantsAgentOutput(program, ['sync', 'refresh'])).toBe(true);
    expect(wantsAgentOutput(program, ['sync', 'watch'])).toBe(true);
    const result = await run(['--offline', 'sync', 'refresh']);
    expect(result.operation).toBe('sync.refresh');
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.context.commit).toBe('none');
  });
  it('publishes watch bounds and rejects an invalid observation count', async () => {
    const schema = await run(['schema', 'sync.watch']);
    expect(schema.data.inputSchema.properties.samples.minimum).toBe(1);
    expect(schema.data.inputSchema.properties.samples.maximum).toBe(1000);
    const result = await run([
      '--server-url',
      'http://localhost:5006',
      '--sync-id',
      'fixture',
      'sync',
      'watch',
      '--samples',
      '0',
    ]);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(result.context.commit).toBe('none');
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
