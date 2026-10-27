import type * as Api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { api } from '#engine';
import {
  executeCatalogChange,
  executeRuleCreation,
  executeScopedChange,
} from '#guarded-changes';
import { readJsonInput } from '#input';
import { printOutput } from '#output';
import type { CheckedTransaction, RuleTestResult } from '#rules-check';
import { RULE_CHECK_LIMIT, ruleDrift, ruleSample } from '#rules-check';
import { errorMessage, plainInteger } from '#utils';

const RULE_TEST_BATCH_LIMIT = 5000;

export function registerRulesCommand(program: Command) {
  const rules = program
    .command('rules')
    .description('Manage transaction rules');

  rules
    .command('list')
    .description('List all rules')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getRules();
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  rules
    .command('payee-rules <payeeId>')
    .description('List rules for a specific payee')
    .action(async (payeeId: string) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getPayeeRules(payeeId);
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  rules
    .command('create')
    .description('Create a new rule')
    .option('--data <json>', 'Rule definition as JSON')
    .option('--file <path>', 'Read rule from JSON file (use - for stdin)')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async cmdOpts => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        if (!cmdOpts.operationId) {
          throw new AgentError(
            'INVALID_INPUT',
            'Version 2 rule creation requires --operation-id for durable retry.',
            false,
            { field: 'operationId' },
          );
        }
        printOutput(
          await executeRuleCreation(
            opts,
            cmdOpts.operationId,
            readJsonInput(cmdOpts) as Api.RuleCreationRequest,
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          const rule = readJsonInput(cmdOpts) as Parameters<
            typeof api.createRule
          >[0];
          const id = await api.createRule(rule);
          printOutput({ id }, opts.format);
        },
        { mutates: true },
      );
    });

  rules
    .command('update')
    .description('Update a rule')
    .option('--data <json>', 'Rule data as JSON (must include id)')
    .option('--file <path>', 'Read rule from JSON file (use - for stdin)')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async cmdOpts => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        if (!cmdOpts.operationId) {
          throw new AgentError(
            'INVALID_INPUT',
            'Version 2 rule update requires --operation-id for durable retry.',
            false,
            { field: 'operationId' },
          );
        }
        const input = readJsonInput(cmdOpts);
        if (
          typeof input !== 'object' ||
          input === null ||
          typeof (input as { id?: unknown }).id !== 'string'
        ) {
          throw new AgentError('INVALID_INPUT', 'Rule update requires an id.');
        }
        const { id, ...fields } = input as Record<string, unknown>;
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'rules.update',
            id as string,
            fields,
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          const rule = readJsonInput(cmdOpts) as Parameters<
            typeof api.updateRule
          >[0];
          await api.updateRule(rule);
          printOutput({ success: true }, opts.format);
        },
        { mutates: true },
      );
    });

  rules
    .command('delete <id>')
    .description('Delete a rule')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (id: string, cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'rules.delete',
            id,
            {},
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.deleteRule(id);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });
  rules
    .command('test')
    .description(
      'Run the rules on a sample transaction as an import would, without writing: result, changed fields, rules that ran in order and payees an import would create. An array of samples returns one result per sample',
    )
    .option(
      '--data <json>',
      'Sample: {"account":"<id>","date":"2026-10-04","amount":-1250,"payee_name":"Coffee Bar","imported_payee":"...","notes":"...","category":"<id>"}, or an array of samples (at most 5000)',
    )
    .option(
      '--file <path>',
      'Read the sample or array of samples from a JSON file (use - for stdin)',
    )
    .option(
      '--payee-names <mode>',
      'Payee name normalization: title-case (default, as imports) or original',
    )
    .action(
      async (cmdOpts: {
        data?: string;
        file?: string;
        payeeNames?: string;
      }) => {
        const opts = program.opts();
        const input = readJsonInput(cmdOpts);
        if (Array.isArray(input) && input.length > RULE_TEST_BATCH_LIMIT) {
          throw new AgentError(
            'INVALID_INPUT',
            `At most ${RULE_TEST_BATCH_LIMIT} samples can be tested at once.`,
            false,
            { field: 'data', limit: RULE_TEST_BATCH_LIMIT },
          );
        }
        if (
          cmdOpts.payeeNames !== undefined &&
          cmdOpts.payeeNames !== 'original' &&
          cmdOpts.payeeNames !== 'title-case'
        ) {
          throw new AgentError(
            'INVALID_INPUT',
            '--payee-names must be original or title-case.',
            false,
            { field: 'payeeNames' },
          );
        }
        const normalization = cmdOpts.payeeNames
          ? {
              payeeNameNormalization: cmdOpts.payeeNames as
                | 'original'
                | 'title-case',
            }
          : {};
        await withConnection(
          opts,
          async () => {
            if (!Array.isArray(input)) {
              let result;
              try {
                result = await api.testRules({
                  transaction: input as Api.RuleTestRequest['transaction'],
                  ...normalization,
                });
              } catch (error) {
                throw new AgentError('INVALID_INPUT', errorMessage(error));
              }
              printOutput(result, opts.format);
              return;
            }
            // One connection for the whole batch; a sample that fails reports
            // its error in place so the other results still come back.
            const results: Array<
              Awaited<ReturnType<typeof api.testRules>> | { error: string }
            > = [];
            for (const sample of input) {
              try {
                results.push(
                  await api.testRules({
                    transaction: sample as Api.RuleTestRequest['transaction'],
                    ...normalization,
                  }),
                );
              } catch (error) {
                results.push({ error: errorMessage(error) });
              }
            }
            printOutput(results, opts.format);
          },
          { mutates: false },
        );
      },
    );

  rules
    .command('check')
    .description(
      'Read-only drift check: run existing transactions through the current rules as an import would and list those whose category or payee the rules would set differently',
    )
    .option('--ids <ids>', 'Comma-separated transaction IDs')
    .option('--account <id>', 'Check every transaction in this account')
    .option(
      '--since <date>',
      'With --account: only from this date (YYYY-MM-DD)',
    )
    .action(
      async (cmdOpts: { ids?: string; account?: string; since?: string }) => {
        const opts = program.opts();
        const ids = cmdOpts.ids
          ?.split(',')
          .map(id => id.trim())
          .filter(Boolean);
        if (!ids?.length === !cmdOpts.account) {
          throw new AgentError(
            'INVALID_INPUT',
            'Provide either --ids or --account.',
            false,
            { field: 'ids' },
          );
        }
        if (cmdOpts.since && !/^\d{4}-\d{2}-\d{2}$/.test(cmdOpts.since)) {
          throw new AgentError('INVALID_INPUT', '--since must be YYYY-MM-DD.');
        }
        await withConnection(
          opts,
          async () => {
            const filter: Record<string, unknown> = ids?.length
              ? { id: { $oneof: ids } }
              : {
                  account: cmdOpts.account,
                  ...(cmdOpts.since ? { date: { $gte: cmdOpts.since } } : {}),
                };
            const { data } = (await api.aqlQuery(
              api
                .q('transactions')
                .filter({ ...filter, transfer_id: null, is_parent: false })
                .select([
                  'id',
                  'account',
                  'date',
                  'amount',
                  'imported_payee',
                  'payee',
                  'notes',
                  'category',
                ])
                .options({ splits: 'inline' })
                .limit(RULE_CHECK_LIMIT + 1),
            )) as { data: CheckedTransaction[] };
            if (data.length > RULE_CHECK_LIMIT) {
              throw new AgentError(
                'INVALID_INPUT',
                `More than ${RULE_CHECK_LIMIT} transactions; narrow with --since or --ids.`,
              );
            }
            const results: Array<RuleTestResult | { error: string }> = [];
            for (const row of data) {
              try {
                results.push(
                  (await api.testRules({
                    transaction: ruleSample(
                      row,
                    ) as Api.RuleTestRequest['transaction'],
                  })) as RuleTestResult,
                );
              } catch (error) {
                results.push({ error: errorMessage(error) });
              }
            }
            const rules = await api.getRules();
            printOutput(ruleDrift(data, results, rules.length), opts.format);
          },
          { mutates: false },
        );
      },
    );

  rules
    .command('matches <ruleId>')
    .description(
      "List the transactions a rule's conditions select now (newest first), the candidates for rules apply",
    )
    .option('--limit <n>', 'Maximum IDs to return (1-500)', '500')
    .action(async (ruleId: string, cmdOpts: { limit: string }) => {
      const opts = program.opts();
      const limit = plainInteger(cmdOpts.limit);
      if (limit === null) {
        throw new AgentError(
          'INVALID_INPUT',
          'limit must be an integer.',
          false,
          {
            field: 'limit',
          },
        );
      }
      await withConnection(
        opts,
        async () => {
          printOutput(await api.findRuleMatches(ruleId, limit), opts.format);
        },
        { mutates: false },
      );
    });

  rules
    .command('apply <ruleId>')
    .description(
      "Apply one rule's actions to a frozen list of matching transactions through a guarded change (splits, formulas and deletes included; no other rules or learning run)",
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--ids <ids>', 'Comma-separated transaction IDs')
    .option(
      '--allow-reconciled',
      'Allow changing reconciled transactions (they are listed in the receipt)',
    )
    .action(
      async (
        ruleId: string,
        cmdOpts: {
          operationId?: string;
          ids: string;
          allowReconciled?: boolean;
        },
      ) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(opts, cmdOpts.operationId, 'rules.apply', {
            ruleId,
            ids: cmdOpts.ids
              .split(',')
              .map(id => id.trim())
              .filter(Boolean),
            ...(cmdOpts.allowReconciled ? { allowReconciled: true } : {}),
          }),
          opts.format,
        );
      },
    );
}
