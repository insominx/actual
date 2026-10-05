import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { printOutput } from '#output';
import {
  addStatement,
  listStatements,
  removeStatement,
} from '#statement-evidence';
import { parseIntFlag } from '#utils';

async function budgetKey(program: Command) {
  const resolved = await resolveConfig(program.opts());
  const budget = resolved.syncId ?? resolved.budgetId;
  if (!budget) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Statement evidence is stored per budget. Select a budget with --sync-id or --budget-id.',
    );
  }
  return { dataDir: resolved.dataDir, budget };
}

export function registerCheckupCommand(program: Command) {
  const checkup = program
    .command('checkup')
    .description(
      'Read-only data-quality findings and history coverage, plus device-local statement evidence',
    );

  checkup
    .command('data-quality')
    .description(
      'Uncategorized rows, deleted categories, duplicate candidates, transfer link problems, statement discrepancies and month coverage; never repairs anything',
    )
    .requiredOption('--from-month <month>', 'First month YYYY-MM')
    .requiredOption(
      '--to-month <month>',
      'Last month YYYY-MM (at most 60 months)',
    )
    .option(
      '--accounts <ids>',
      'Comma-separated account IDs (default: open accounts)',
    )
    .option(
      '--duplicate-window <days>',
      'Days between same-amount rows to flag as duplicate candidates (0-14)',
      '3',
    )
    .option('--limit <count>', 'Maximum findings (1-500)', '200')
    .action(
      async (cmdOpts: {
        fromMonth: string;
        toMonth: string;
        accounts?: string;
        duplicateWindow: string;
        limit: string;
      }) => {
        const opts = program.opts();
        const { dataDir, budget } = await budgetKey(program);
        const statements = (await listStatements(dataDir, budget)).map(s => ({
          accountId: s.accountId,
          month: s.month,
          endingBalance: s.endingBalance,
          noActivity: s.noActivity,
          source: s.source,
        }));
        const request: api.DataQualityRequest = {
          start: cmdOpts.fromMonth,
          end: cmdOpts.toMonth,
          ...(cmdOpts.accounts === undefined
            ? {}
            : {
                accountIds: cmdOpts.accounts
                  .split(',')
                  .map(id => id.trim())
                  .filter(Boolean),
              }),
          statements,
          duplicateWindowDays: parseIntFlag(
            cmdOpts.duplicateWindow,
            '--duplicate-window',
          ),
          limit: parseIntFlag(cmdOpts.limit, '--limit'),
        };
        await withConnection(
          opts,
          async () => {
            let result;
            try {
              result = await api.getDataQualityCheckup(request);
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

  const statement = checkup
    .command('statement')
    .description(
      'Device-local, user-declared statement evidence used for coverage (not bank verification)',
    );

  statement
    .command('add')
    .description(
      'Record a statement ending balance or a verified no-activity month for an account',
    )
    .requiredOption('--account <id>', 'Account ID')
    .requiredOption('--month <month>', 'Statement month YYYY-MM')
    .option('--ending-balance <cents>', 'Statement ending balance in cents')
    .option('--no-activity', 'The statement shows no activity this month')
    .option('--source <text>', 'Where the evidence came from')
    .option(
      '--import-operation <id>',
      'Operation ID of the import receipt this statement belongs to',
    )
    .option('--replace', 'Replace existing evidence for this month')
    .action(
      async (cmdOpts: {
        account: string;
        month: string;
        endingBalance?: string;
        activity?: boolean;
        source?: string;
        importOperation?: string;
        replace?: boolean;
      }) => {
        const opts = program.opts();
        const { dataDir, budget } = await budgetKey(program);
        const result = await addStatement(
          dataDir,
          budget,
          {
            accountId: cmdOpts.account,
            month: cmdOpts.month,
            endingBalance:
              cmdOpts.endingBalance === undefined
                ? null
                : parseIntFlag(cmdOpts.endingBalance, '--ending-balance'),
            noActivity: cmdOpts.activity === false,
            source: cmdOpts.source ?? null,
            importOperationId: cmdOpts.importOperation ?? null,
          },
          Boolean(cmdOpts.replace),
        );
        printOutput(result, opts.format);
      },
    );

  statement
    .command('list')
    .description('List recorded statement evidence for the selected budget')
    .action(async () => {
      const opts = program.opts();
      const { dataDir, budget } = await budgetKey(program);
      printOutput(
        { statements: await listStatements(dataDir, budget) },
        opts.format,
      );
    });

  statement
    .command('remove')
    .description('Remove recorded statement evidence for an account and month')
    .requiredOption('--account <id>', 'Account ID')
    .requiredOption('--month <month>', 'Statement month YYYY-MM')
    .action(async (cmdOpts: { account: string; month: string }) => {
      const opts = program.opts();
      const { dataDir, budget } = await budgetKey(program);
      printOutput(
        await removeStatement(dataDir, budget, cmdOpts.account, cmdOpts.month),
        opts.format,
      );
    });
}
