import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import {
  executeCatalogChange,
  executeRuleCreation,
  executeScopedChange,
} from '#guarded-changes';
import { readJsonInput } from '#input';
import { printOutput } from '#output';

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
            readJsonInput(cmdOpts) as api.RuleCreationRequest,
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
      'Run the rules on a sample transaction as an import would, without writing: result, changed fields, rules that ran in order and payees an import would create',
    )
    .option(
      '--data <json>',
      'Sample: {"account":"<id>","date":"2026-10-04","amount":-1250,"payee_name":"Coffee Bar","imported_payee":"...","notes":"...","category":"<id>"}',
    )
    .option(
      '--file <path>',
      'Read the sample from a JSON file (use - for stdin)',
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
        const transaction = readJsonInput(
          cmdOpts,
        ) as api.RuleTestRequest['transaction'];
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
        await withConnection(
          opts,
          async () => {
            let result;
            try {
              result = await api.testRules({
                transaction,
                ...(cmdOpts.payeeNames
                  ? {
                      payeeNameNormalization: cmdOpts.payeeNames as
                        | 'original'
                        | 'title-case',
                    }
                  : {}),
              });
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

  rules
    .command('matches <ruleId>')
    .description(
      "List the transactions a rule's conditions select now (newest first), the candidates for rules apply",
    )
    .option('--limit <n>', 'Maximum IDs to return (1-500)', '500')
    .action(async (ruleId: string, cmdOpts: { limit: string }) => {
      const opts = program.opts();
      const limit = Number(cmdOpts.limit);
      if (!Number.isInteger(limit)) {
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
