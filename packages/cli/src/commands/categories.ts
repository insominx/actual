import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { withConnection } from '#connection';
import {
  executeCategoryCreation,
  executeCategoryDeletion,
  executeCategoryUpdate,
} from '#guarded-changes';
import { printOutput } from '#output';
import { filterByName, parseBoolFlag } from '#utils';

export function registerCategoriesCommand(program: Command) {
  const categories = program
    .command('categories')
    .description('Manage categories');

  categories
    .command('list')
    .description('List categories (excludes hidden by default)')
    .option('--include-hidden', 'Include hidden categories', false)
    .action(async cmdOpts => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getCategories(
            cmdOpts.includeHidden ? {} : { hidden: false },
          );
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  categories
    .command('inspect')
    .description(
      'Inspect categories with IDs, hidden/deleted status, merge targets, transaction counts and same-name duplicates',
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
              await api.inspectCatalog('categories', {
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

  categories
    .command('create')
    .description('Create a new category')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .requiredOption('--name <name>', 'Category name')
    .requiredOption('--group-id <id>', 'Category group ID')
    .option('--is-income', 'Mark as income category', false)
    .action(async cmdOpts => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCategoryCreation(opts, cmdOpts.operationId, {
            name: cmdOpts.name,
            group_id: cmdOpts.groupId,
            is_income: cmdOpts.isIncome,
            hidden: false,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          const id = await api.createCategory({
            name: cmdOpts.name,
            group_id: cmdOpts.groupId,
            is_income: cmdOpts.isIncome,
            hidden: false,
          });
          printOutput({ id }, opts.format);
        },
        { mutates: true },
      );
    });

  categories
    .command('update <id>')
    .description('Update a category')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .option('--name <name>', 'New category name')
    .option('--hidden <bool>', 'Set hidden status')
    .action(async (id: string, cmdOpts) => {
      const fields: api.CategoryUpdateRequest['fields'] = {};
      if (cmdOpts.name !== undefined) fields.name = cmdOpts.name;
      if (cmdOpts.hidden !== undefined) {
        fields.hidden = parseBoolFlag(cmdOpts.hidden, '--hidden');
      }
      if (Object.keys(fields).length === 0) {
        throw new Error('No update fields provided. Use --name or --hidden.');
      }
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCategoryUpdate(opts, cmdOpts.operationId, {
            id,
            fields,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.updateCategory(id, fields);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });

  categories
    .command('delete <id>')
    .description('Delete a category')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .option('--transfer-to <id>', 'Transfer transactions to this category')
    .action(async (id: string, cmdOpts) => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCategoryDeletion(opts, cmdOpts.operationId, {
            id,
            transferCategoryId: cmdOpts.transferTo,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.deleteCategory(id, cmdOpts.transferTo);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });
}
