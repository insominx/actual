import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { executeScopedChange } from '#guarded-changes';
import { printOutput } from '#output';
import { parseIntFlag } from '#utils';

function ids(value: string) {
  return value
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

export function registerReconcileCommand(program: Command) {
  const reconcile = program
    .command('reconcile')
    .description(
      'Reconcile an account against a statement: status, zero-difference finish and explicit adjustments',
    );

  reconcile
    .command('status <accountId>')
    .description(
      "Cleared balance (the app's reconcile definition, optionally cut off at the statement date), difference from the statement balance, and the cleared unreconciled candidates a finish would lock; read-only",
    )
    .option('--balance <cents>', 'Statement ending balance in cents')
    .option('--date <date>', 'Statement date YYYY-MM-DD (cutoff)')
    .action(
      async (
        accountId: string,
        cmdOpts: { balance?: string; date?: string },
      ) => {
        const opts = program.opts();
        const request: api.ReconciliationStatusRequest = {
          accountId,
          ...(cmdOpts.balance === undefined
            ? {}
            : { statementBalance: parseIntFlag(cmdOpts.balance, '--balance') }),
          ...(cmdOpts.date === undefined
            ? {}
            : { statementDate: cmdOpts.date }),
        };
        await withConnection(
          opts,
          async () => {
            let result;
            try {
              result = await api.getReconciliationStatus(request);
            } catch (error) {
              throw new AgentError(
                'INVALID_INPUT',
                error instanceof Error ? error.message : String(error),
              );
            }
            printOutput(result, opts.format);
          },
          { mutates: false },
        );
      },
    );

  reconcile
    .command('finish <accountId>')
    .description(
      'Lock the frozen set of cleared transactions through a guarded change when the statement difference is zero, and set last reconciled',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--balance <cents>', 'Statement ending balance in cents')
    .option('--date <date>', 'Statement date YYYY-MM-DD (cutoff)')
    .requiredOption(
      '--ids <ids>',
      'Comma-separated candidate IDs from reconcile status (use "" for none)',
    )
    .action(
      async (
        accountId: string,
        cmdOpts: {
          operationId?: string;
          balance: string;
          date?: string;
          ids: string;
        },
      ) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'reconcile.finish',
            {
              accountId,
              statementBalance: parseIntFlag(cmdOpts.balance, '--balance'),
              ...(cmdOpts.date === undefined
                ? {}
                : { statementDate: cmdOpts.date }),
              ids: ids(cmdOpts.ids),
            },
          ),
          opts.format,
        );
      },
    );

  reconcile
    .command('adjust <accountId>')
    .description(
      "Add an explicit cleared 'Reconciliation balance adjustment' transaction through a guarded change, as the app's adjustment does",
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--amount <cents>', 'Signed adjustment in cents')
    .option('--date <date>', 'Transaction date YYYY-MM-DD (default today)')
    .action(
      async (
        accountId: string,
        cmdOpts: { operationId?: string; amount: string; date?: string },
      ) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'reconcile.adjust',
            {
              accountId,
              amount: parseIntFlag(cmdOpts.amount, '--amount'),
              ...(cmdOpts.date === undefined ? {} : { date: cmdOpts.date }),
            },
          ),
          opts.format,
        );
      },
    );
}
