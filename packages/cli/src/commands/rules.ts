import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { executeCatalogChange, executeRuleCreation } from '#guarded-changes';
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
}
