import { Command, Option } from 'commander';

import {
  discoverOperations,
  operationName,
  validateCommandInput,
} from './agent-contract';
import { AgentError, beginAgentOutput, flushAgentOutput } from './agent-output';
import { registerAccountGroupsCommand } from './commands/account-groups';
import { registerAccountsCommand } from './commands/accounts';
import { registerBackupsCommand } from './commands/backups';
import { registerBudgetsCommand } from './commands/budgets';
import { registerCashPlanningCommand } from './commands/cash-planning';
import { registerCategoriesCommand } from './commands/categories';
import { registerCategoryGroupsCommand } from './commands/category-groups';
import { registerChangesCommand } from './commands/changes';
import { registerDiagnosticsCommand } from './commands/diagnostics';
import { registerNotesCommand } from './commands/notes';
import { registerPayeesCommand } from './commands/payees';
import { registerPreferencesCommand } from './commands/preferences';
import { registerProfilesCommand } from './commands/profiles';
import { registerQueryCommand } from './commands/query';
import { registerRulesCommand } from './commands/rules';
import { registerSchedulesCommand } from './commands/schedules';
import { registerServerCommand } from './commands/server';
import { registerSyncCommand } from './commands/sync';
import { registerTagsCommand } from './commands/tags';
import { registerTransactionsCommand } from './commands/transactions';
import { withConnection } from './connection';
import { readJsonInput } from './input';
import { operationPayloadSchema, validateJson } from './json-schema';
import { printOutput } from './output';
import { parseNonNegativeIntFlag } from './utils';

declare const __CLI_VERSION__: string;

const AGENT_SERVER_COMMANDS = [
  'bootstrap',
  'init',
  'start',
  'status',
  'stop',
  'logs',
];

export function wantsAgentOutput(program: Command, args: string[]): boolean {
  if (
    args.some(
      (arg, i) =>
        arg === '--output-version=2' ||
        (arg === '--output-version' && args[i + 1] === '2'),
    )
  ) {
    return true;
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      return (
        [
          'capabilities',
          'schema',
          'context',
          'profiles',
          'doctor',
          'connection',
          'backups',
          'changes',
        ].includes(arg) ||
        (arg === 'server' && AGENT_SERVER_COMMANDS.includes(args[i + 1])) ||
        (arg === 'sync' &&
          ['status', 'refresh', 'watch'].includes(args[i + 1])) ||
        (arg === 'budgets' &&
          [
            'create',
            'inspect',
            'select',
            'clone',
            'publish',
            'rename',
            'archive',
          ].includes(args[i + 1]))
      );
    }
    const option = program.options.find(
      o => o.long === arg.split('=')[0] || o.short === arg,
    );
    if (option?.required && !arg.includes('=')) i++;
  }
  return false;
}

export function createProgram(
  version = typeof __CLI_VERSION__ === 'undefined'
    ? 'development'
    : __CLI_VERSION__,
) {
  const program = new Command();

  program
    .name('actual')
    .description('CLI for Actual Budget')
    .version(version)
    .option('--profile <name>', 'Named device-local connection profile')
    .option('--profiles-file <path>', 'Path to the device-local profiles store')
    .option('--budget-id <id>', 'Explicit local budget ID (requires --offline)')
    .option(
      '--offline',
      'Use a local budget or cached sync budget without server access',
    )
    .option('--server-url <url>', 'Actual server URL (env: ACTUAL_SERVER_URL)')
    .option('--password <password>', 'Server password (env: ACTUAL_PASSWORD)')
    .option(
      '--session-token <token>',
      'Session token (env: ACTUAL_SESSION_TOKEN)',
    )
    .option('--sync-id <id>', 'Budget sync ID (env: ACTUAL_SYNC_ID)')
    .option('--data-dir <path>', 'Data directory (env: ACTUAL_DATA_DIR)')
    .option(
      '--encryption-password <password>',
      'E2E encryption password (env: ACTUAL_ENCRYPTION_PASSWORD)',
    )
    .option(
      '--cache-ttl <seconds>',
      'Cache TTL in seconds (env: ACTUAL_CACHE_TTL; default: 60)',
      value => parseNonNegativeIntFlag(value, '--cache-ttl'),
    )
    .option('--refresh', 'Force a sync on this call, ignoring the cache', false)
    .option(
      '--require-fresh',
      'Require successful synchronization before reading a remote budget',
      false,
    )
    .option('--no-cache', 'Alias for --refresh')
    .option(
      '--lock-timeout <seconds>',
      'How long to wait for another CLI process to release the lock (env: ACTUAL_LOCK_TIMEOUT; default: 10)',
      value => parseNonNegativeIntFlag(value, '--lock-timeout'),
    )
    .option(
      '--no-lock',
      'Disable the budget directory lock (use with care, env: ACTUAL_NO_LOCK)',
    )
    .addOption(
      new Option('--format <format>', 'Output format: json, table, csv')
        .choices(['json', 'table', 'csv'] as const)
        .default('json'),
    )
    .addOption(
      new Option('--output-version <version>', 'JSON result contract version')
        .choices(['1', '2'])
        .default('1'),
    )
    .option('--verbose', 'Show informational messages', false);

  registerAccountsCommand(program);
  registerAccountGroupsCommand(program);
  registerBackupsCommand(program);
  registerBudgetsCommand(program);
  registerCategoriesCommand(program);
  registerCategoryGroupsCommand(program);
  registerTransactionsCommand(program);
  registerChangesCommand(program);
  registerPayeesCommand(program);
  registerTagsCommand(program);
  registerNotesCommand(program);
  registerPreferencesCommand(program);
  registerCashPlanningCommand(program);
  registerRulesCommand(program);
  registerSchedulesCommand(program);
  registerQueryCommand(program);
  registerServerCommand(program);
  registerDiagnosticsCommand(program);
  registerSyncCommand(program);
  registerProfilesCommand(program);
  program
    .command('context')
    .description('Inspect the selected budget and connection context')
    .action(async () => {
      await withConnection(
        program.opts(),
        async () => printOutput({ selected: true }),
        { mutates: false },
      );
    });

  program
    .command('capabilities')
    .description('Discover registered operations without connecting')
    .action(() =>
      printOutput(
        {
          schemaVersion: 2,
          money: { unit: 'cents', scale: 100 },
          operations: discoverOperations(program),
        },
        program.opts().format,
      ),
    );
  program
    .command('schema <operation>')
    .description('Show the input schema for an operation')
    .action((name: string) => {
      const operation = discoverOperations(program).find(o => o.name === name);
      if (!operation) {
        throw new AgentError(
          'INVALID_INPUT',
          'Unknown operation. Run capabilities to discover operations.',
        );
      }
      printOutput(operation, program.opts().format);
    });
  program.hook('preAction', (_root, command) => {
    const opts = program.opts();
    if (
      opts.outputVersion === '2' ||
      ['capabilities', 'schema', 'context', 'doctor'].includes(
        command.name(),
      ) ||
      command.parent?.name() === 'connection' ||
      (command.parent?.name() === 'sync' &&
        ['status', 'refresh', 'watch'].includes(command.name())) ||
      (command.parent?.name() === 'budgets' &&
        [
          'create',
          'inspect',
          'select',
          'clone',
          'publish',
          'rename',
          'archive',
        ].includes(command.name())) ||
      (command.parent?.name() === 'server' &&
        AGENT_SERVER_COMMANDS.includes(command.name())) ||
      command.parent?.name() === 'profiles' ||
      command.parent?.name() === 'backups' ||
      command.parent?.name() === 'changes'
    ) {
      beginAgentOutput(operationName(command));
      program.setOptionValue('outputVersion', '2');
      if (opts.format !== 'json') {
        throw new AgentError(
          'INVALID_INPUT',
          'Output version 2 requires --format json.',
        );
      }
      validateCommandInput(command, command.opts());
      const payloadSchema = operationPayloadSchema(operationName(command));
      if (
        payloadSchema &&
        (command.opts().data !== undefined || command.opts().file !== undefined)
      ) {
        try {
          validateJson(readJsonInput(command.opts()), payloadSchema);
        } catch (error) {
          if (error instanceof AgentError) throw error;
          throw new AgentError(
            'INVALID_INPUT',
            'Cannot read valid JSON input. Check the input file or --data.',
          );
        }
      }
    }
  });
  program.hook('postAction', () => flushAgentOutput());
  return program;
}
