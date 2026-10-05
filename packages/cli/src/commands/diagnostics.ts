import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError, updateAgentContext } from '#agent-output';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { printOutput } from '#output';
import { serverRequest } from '#server-http';
import { isRecord } from '#utils';

export function diagnosticIssue(error: unknown): string {
  const code = isRecord(error) ? (error.code ?? error.reason) : undefined;
  if (
    ['invalid-password', 'token-expired', 'unauthorized'].includes(String(code))
  ) {
    return 'authentication-failed';
  }
  if (
    [
      'encrypt-failure',
      'decrypt-failure',
      'invalid-key',
      'key-not-found',
      'missing-key',
    ].includes(String(code))
  ) {
    return 'encryption-failed';
  }
  if (
    [
      'client-old',
      'client-new',
      'version-mismatch',
      'out-of-sync-migrations',
    ].includes(String(code))
  ) {
    return 'server-incompatible';
  }
  if (['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(String(code))) {
    return 'module-unavailable';
  }
  if (code === 'network-failure') return 'server-unreachable';
  if (code === 'ERR_DLOPEN_FAILED') return 'native-module-unavailable';
  if (
    error instanceof Error &&
    /Could not locate the bindings file|NODE_MODULE_VERSION|invalid ELF header/.test(
      error.message,
    )
  ) {
    return 'native-module-unavailable';
  }
  return 'engine-failed';
}

export function registerDiagnosticsCommand(program: Command) {
  program
    .command('connection')
    .description('Inspect server connectivity')
    .command('test')
    .description(
      'Authenticate and read the server version without selecting a budget',
    )
    .action(async () => {
      await withConnection(
        program.opts(),
        async () => {
          printOutput({
            authenticated: true,
            version: await api.getServerVersion(),
          });
        },
        { mutates: false, skipBudget: true },
      );
    });
  program
    .command('doctor')
    .description(
      'Check connection and the selected budget without ledger mutations',
    )
    .action(async () => {
      const config = await resolveConfig(program.opts());
      try {
        if (!config.offline) {
          const info = await serverRequest(config.serverUrl, '/info');
          if (
            !isRecord(info) ||
            !isRecord(info.build) ||
            info.build.name !== '@actual-app/sync-server' ||
            typeof info.build.version !== 'string'
          ) {
            throw new AgentError(
              'ENGINE_FAILURE',
              'The endpoint does not expose compatible Actual server metadata.',
              false,
              { issue: 'server-incompatible' },
            );
          }
        }
        await withConnection(
          program.opts(),
          async () => {
            updateAgentContext({ commit: 'none' });
            printOutput({
              healthy: true,
              authenticated: !config.offline,
              budgetChecked: Boolean(config.syncId || config.budgetId),
              version: config.offline ? null : await api.getServerVersion(),
            });
          },
          { mutates: false, skipBudget: !config.syncId && !config.budgetId },
        );
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError(
          'ENGINE_FAILURE',
          'The diagnostic check failed. Use the issue field to select a recovery step.',
          false,
          { issue: diagnosticIssue(error) },
        );
      }
    });
}
