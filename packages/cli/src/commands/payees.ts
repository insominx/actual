import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { api } from '#engine';
import { executeCatalogChange, executePayeeCreation } from '#guarded-changes';
import { printOutput } from '#output';
import { findDuplicatePayees } from '#payee-duplicates';
import { filterByName, plainInteger } from '#utils';

export function registerPayeesCommand(program: Command) {
  const payees = program.command('payees').description('Manage payees');

  payees
    .command('list')
    .description('List all payees')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getPayees();
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  payees
    .command('common')
    .description('List frequently used payees')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getCommonPayees();
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  payees
    .command('inspect')
    .description(
      'Inspect payees with IDs, hidden/deleted status, merge targets, transaction counts and same-name duplicates',
    )
    .option(
      '--include-deleted',
      'Include deleted rows and where they now resolve',
      false,
    )
    .option(
      '--name <text>',
      'Only rows whose name contains this text (case-insensitive)',
    )
    .action(async (cmdOpts: { includeDeleted: boolean; name?: string }) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(
            filterByName(
              await api.inspectCatalog('payees', {
                includeDeleted: cmdOpts.includeDeleted,
              }),
              cmdOpts.name,
            ),
            opts.format,
          );
        },
        { mutates: false },
      );
    });

  payees
    .command('duplicates')
    .description(
      'Suggest merges for payees whose names differ only by bank noise (processor prefixes, store numbers, reference codes, locations); read-only',
    )
    .option(
      '--name <text>',
      'Only groups whose key or a member name contains this text (case-insensitive)',
    )
    .option('--limit <n>', 'Maximum groups to return (1-1000)', '200')
    .action(async (cmdOpts: { name?: string; limit: string }) => {
      const limit = plainInteger(cmdOpts.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new AgentError(
          'INVALID_INPUT',
          '--limit must be an integer from 1 to 1000.',
          false,
          { field: 'limit' },
        );
      }
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const rows = await api.inspectCatalog('payees', {
            includeDeleted: false,
          });
          // Transfer payees name accounts, not merchants; unused payees
          // change nothing when merged.
          const candidates = rows.filter(
            row =>
              !row.deleted &&
              !row.mappedTo &&
              !row.transferAccount &&
              row.transactionCount > 0,
          );
          const needle = cmdOpts.name?.toLowerCase();
          const groups = findDuplicatePayees(candidates).filter(
            group =>
              !needle ||
              group.key.includes(needle) ||
              [group.target, ...group.merge].some(payee =>
                payee.name.toLowerCase().includes(needle),
              ),
          );
          printOutput(
            {
              readOnly: true,
              total: groups.length,
              payeesToMerge: groups.reduce(
                (sum, group) => sum + group.merge.length,
                0,
              ),
              truncated: groups.length > limit,
              groups: groups.slice(0, limit).map(group => ({
                ...group,
                mergeCommand: `payees merge --target ${group.target.id} --ids ${group.merge.map(payee => payee.id).join(',')}`,
              })),
            },
            opts.format,
          );
        },
        { mutates: false },
      );
    });

  payees
    .command('create')
    .description('Create a new payee')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .requiredOption('--name <name>', 'Payee name')
    .action(async cmdOpts => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executePayeeCreation(opts, cmdOpts.operationId, {
            name: cmdOpts.name,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          const id = await api.createPayee({ name: cmdOpts.name });
          printOutput({ id }, opts.format);
        },
        { mutates: true },
      );
    });

  payees
    .command('update <id>')
    .description('Update a payee')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .option('--name <name>', 'New payee name')
    .action(async (id: string, cmdOpts) => {
      const fields: Record<string, unknown> = {};
      if (cmdOpts.name) fields.name = cmdOpts.name;
      if (Object.keys(fields).length === 0) {
        throw new AgentError(
          'INVALID_INPUT',
          'No fields to update. Use --name to specify a new name.',
        );
      }
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'payees.update',
            id,
            fields,
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.updatePayee(id, fields);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });

  payees
    .command('delete <id>')
    .description('Delete a payee')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (id: string, cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'payees.delete',
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
          await api.deletePayee(id);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });

  payees
    .command('merge')
    .description('Merge payees into a target payee')
    .requiredOption('--target <id>', 'Target payee ID')
    .requiredOption('--ids <ids>', 'Comma-separated payee IDs to merge')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(
      async (cmdOpts: {
        target: string;
        ids: string;
        operationId?: string;
      }) => {
        const mergeIds = cmdOpts.ids
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0);
        if (mergeIds.length === 0) {
          throw new AgentError(
            'INVALID_INPUT',
            'No valid payee IDs provided in --ids. Provide comma-separated IDs.',
          );
        }
        const opts = program.opts();
        if (opts.outputVersion === '2') {
          printOutput(
            await executeCatalogChange(
              opts,
              cmdOpts.operationId,
              'payees.merge',
              cmdOpts.target,
              { mergeIds },
            ),
            opts.format,
          );
          return;
        }
        await withConnection(
          opts,
          async () => {
            await api.mergePayees(cmdOpts.target, mergeIds);
            printOutput({ success: true }, opts.format);
          },
          { mutates: true },
        );
      },
    );
}
