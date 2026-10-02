import { Command } from 'commander';

import { discoverOperations, validateCommandInput } from './agent-contract';
import { AgentError, serializeAgentError } from './agent-output';

function command() {
  const root = new Command('actual');
  root
    .command('accounts')
    .command('create')
    .requiredOption('--name <name>')
    .option('--balance <amount>');
  return root;
}

describe('agent command contract', () => {
  it('discovers the actual registered options without a connection', () => {
    const [operation] = discoverOperations(command());
    expect(operation.name).toBe('accounts.create');
    expect(operation.inputSchema.required).toEqual(['name']);
    expect(operation.inputSchema.properties.balance).toMatchObject({
      type: 'integer',
    });
    expect(operation.capabilities).toMatchObject({
      mutates: true,
      preview: false,
      reversal: false,
    });
  });

  it('rejects unsafe money and blank names before dispatch', () => {
    const leaf = command().commands[0].commands[0];
    expect(() =>
      validateCommandInput(leaf, {
        name: 'Checking',
        balance: '9007199254740992',
      }),
    ).toThrow(AgentError);
    expect(() => validateCommandInput(leaf, { name: '  ' })).toThrow(
      AgentError,
    );
    expect(() =>
      validateCommandInput(leaf, { name: 'Checking', balance: '-200000' }),
    ).not.toThrow();
  });

  it('rejects impossible dates and negative paging', () => {
    const root = new Command('actual');
    const leaf = root
      .command('transactions')
      .command('list')
      .option('--start <date>')
      .option('--limit <n>');
    expect(() => validateCommandInput(leaf, { start: '2025-02-29' })).toThrow(
      AgentError,
    );
    expect(() =>
      validateCommandInput(leaf, { start: '2024-02-29', limit: '-1' }),
    ).toThrow(AgentError);
    expect(() =>
      validateCommandInput(leaf, { start: '2024-02-29', limit: '10' }),
    ).not.toThrow();
  });

  it('returns stable errors and redacts unknown engine messages', () => {
    expect(
      serializeAgentError(
        new AgentError('STALE_PREVIEW', 'Refresh the proposal.'),
      ).exitCode,
    ).toBe(4);
    const result = serializeAgentError(
      new Error('password=secret unexpected engine failure'),
    );
    expect(result.exitCode).toBe(5);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(
      serializeAgentError(
        new AgentError('PARTIAL_COMPLETION', 'Local changes committed.', true),
      ).exitCode,
    ).toBe(6);
  });
});
