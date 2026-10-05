import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { listRuns, newRunId, readRun, writeRun } from '#bank-sync-runs';
import type { BankSyncRun } from '#bank-sync-runs';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { printOutput } from '#output';

async function scope(program: Command) {
  const resolved = await resolveConfig(program.opts());
  const budget = resolved.syncId ?? resolved.budgetId;
  if (!budget) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Select a budget with --sync-id or --budget-id.',
    );
  }
  return { dataDir: resolved.dataDir, budget };
}

function engineError(error: unknown): never {
  throw new AgentError(
    'INVALID_INPUT',
    error instanceof Error ? error.message : String(error),
  );
}

export function registerBankSyncCommand(program: Command) {
  const bankSync = program
    .command('bank-sync')
    .description(
      'Bank sync status, refresh of already-linked accounts, and device-local run results; never creates provider connections',
    );

  bankSync
    .command('status')
    .description(
      'Linked accounts, last sync, persisted sync status and provider configuration (no secrets); read-only',
    )
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          let result;
          try {
            result = await api.getBankSyncStatus();
          } catch (error) {
            engineError(error);
          }
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  bankSync
    .command('refresh')
    .description(
      'Run bank sync for linked accounts with one outcome per account (imported, no-new-transactions, not-linked, auth-required, rate-limited, attention-required, account-missing, provider-error)',
    )
    .option(
      '--accounts <ids>',
      'Comma-separated account IDs (default: all linked)',
    )
    .action(async (cmdOpts: { accounts?: string }) => {
      const opts = program.opts();
      const { dataDir, budget } = await scope(program);
      const runId = newRunId();
      const request =
        cmdOpts.accounts === undefined
          ? undefined
          : {
              accountIds: cmdOpts.accounts
                .split(',')
                .map(id => id.trim())
                .filter(Boolean),
            };
      let run: BankSyncRun | null = null;
      try {
        await withConnection(
          opts,
          async () => {
            let result;
            try {
              result = await api.refreshBankSync(request);
            } catch (error) {
              engineError(error);
            }
            const now = new Date().toISOString();
            run = {
              schemaVersion: 1,
              runId,
              budget,
              createdAt: now,
              updatedAt: now,
              commit: 'committed-local',
              result,
            };
            await writeRun(dataDir, run);
          },
          {
            mutates: true,
            onSynced: async () => {
              if (run) {
                run = {
                  ...run,
                  commit: 'synced',
                  updatedAt: new Date().toISOString(),
                };
                await writeRun(dataDir, run);
              }
            },
          },
        );
      } catch (error) {
        if (
          error instanceof AgentError &&
          error.code === 'PARTIAL_COMPLETION' &&
          run
        ) {
          throw new AgentError(error.code, error.message, true, {
            runId,
            commit: 'committed-local',
            results: `actual bank-sync results ${runId}`,
          });
        }
        throw error;
      }
      printOutput(run, opts.format);
    });

  bankSync
    .command('results [run-id]')
    .description(
      'Read device-local bank sync run records (latest first) without contacting the server',
    )
    .option('--limit <count>', 'Maximum runs to list (1-100)', '10')
    .action(async (runId: string | undefined, cmdOpts: { limit: string }) => {
      const opts = program.opts();
      const { dataDir, budget } = await scope(program);
      if (runId) {
        printOutput(await readRun(dataDir, runId), opts.format);
        return;
      }
      const limit = Number(cmdOpts.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new AgentError(
          'INVALID_INPUT',
          'limit must be an integer from 1 to 100.',
        );
      }
      printOutput(await listRuns(dataDir, budget, limit), opts.format);
    });
}
