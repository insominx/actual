import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { executeScopedChange } from '#guarded-changes';
import { printOutput } from '#output';

function parseInteger(value: string, field: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new AgentError(
      'INVALID_INPUT',
      `${field} must be an integer.`,
      false,
      { field },
    );
  }
  return parsed;
}

export function registerTransfersCommand(program: Command) {
  const transfers = program
    .command('transfers')
    .description(
      'Review transfer candidates and links between accounts (internal, off-budget and budget-boundary transfers)',
    );

  transfers
    .command('candidates')
    .description(
      'List unlinked transactions in different accounts whose amounts cancel within a date window, with evidence and ambiguity',
    )
    .option('--account <id>', 'Only pairs with one side in this account')
    .option('--start <date>', 'First day YYYY-MM-DD')
    .option('--end <date>', 'Last day YYYY-MM-DD')
    .option('--days <n>', 'Maximum date gap in days (0-31)', '3')
    .option('--limit <n>', 'Maximum pairs to return (1-1000)', '200')
    .action(
      async (cmdOpts: {
        account?: string;
        start?: string;
        end?: string;
        days: string;
        limit: string;
      }) => {
        const opts = program.opts();
        const days = parseInteger(cmdOpts.days, 'days');
        const limit = parseInteger(cmdOpts.limit, 'limit');
        await withConnection(
          opts,
          async () => {
            printOutput(
              await api.findTransferCandidates({
                ...(cmdOpts.account ? { account: cmdOpts.account } : {}),
                ...(cmdOpts.start ? { start: cmdOpts.start } : {}),
                ...(cmdOpts.end ? { end: cmdOpts.end } : {}),
                days,
                limit,
              }),
              opts.format,
            );
          },
          { mutates: false },
        );
      },
    );

  transfers
    .command('inspect <id>')
    .description(
      "Check one transaction's transfer link from both sides: counterpart, classification, issues and the repair that applies",
    )
    .action(async (id: string) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(await api.inspectTransfer(id), opts.format);
        },
        { mutates: false },
      );
    });

  transfers
    .command('check')
    .description('List transfer links with issues across the budget')
    .option('--account <id>', 'Only transactions in this account')
    .action(async (cmdOpts: { account?: string }) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(
            await api.auditTransfers(
              cmdOpts.account ? { account: cmdOpts.account } : {},
            ),
            opts.format,
          );
        },
        { mutates: false },
      );
    });

  transfers
    .command('match')
    .description(
      'Link two existing opposite transactions in different accounts as one transfer (guarded; adds no transaction)',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--ids <ids>', 'The two transaction IDs, comma-separated')
    .option(
      '--allow-reconciled',
      'Allow linking reconciled transactions',
      false,
    )
    .action(
      async (cmdOpts: {
        operationId?: string;
        ids: string;
        allowReconciled: boolean;
      }) => {
        const opts = program.opts();
        const ids = cmdOpts.ids
          .split(',')
          .map(id => id.trim())
          .filter(Boolean);
        if (ids.length !== 2) {
          throw new Error(
            'Invalid --ids: provide exactly two transaction IDs.',
          );
        }
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'transfers.match',
            {
              ids,
              ...(cmdOpts.allowReconciled ? { allowReconciled: true } : {}),
            },
          ),
          opts.format,
        );
      },
    );

  for (const [verb, description] of [
    [
      'unmatch',
      'Unlink a transfer; both transactions stay as ordinary transactions without a payee (guarded; deletes nothing)',
    ],
    [
      'repair',
      'Repair one broken transfer link: unlink a missing or non-reciprocal link, resync a drifted counterpart, or recreate a missing counterpart (guarded)',
    ],
  ] as const) {
    transfers
      .command(`${verb} <id>`)
      .description(description)
      .option('--operation-id <id>', 'Required; durable retry ID')
      .option(
        '--allow-reconciled',
        'Allow changing reconciled transactions',
        false,
      )
      .action(
        async (
          id: string,
          cmdOpts: { operationId?: string; allowReconciled: boolean },
        ) => {
          const opts = program.opts();
          printOutput(
            await executeScopedChange(
              opts,
              cmdOpts.operationId,
              `transfers.${verb}`,
              {
                id,
                ...(cmdOpts.allowReconciled ? { allowReconciled: true } : {}),
              },
            ),
            opts.format,
          );
        },
      );
  }
}
