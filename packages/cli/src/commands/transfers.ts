import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
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
}
