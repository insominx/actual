import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { withConnection } from '#connection';
import {
  executeAccountGroupCreation,
  executeCatalogChange,
} from '#guarded-changes';
import { printOutput } from '#output';

export function registerAccountGroupsCommand(program: Command) {
  const groups = program
    .command('account-groups')
    .description('Manage account groups');

  groups
    .command('list')
    .description('List account groups')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(await api.getAccountGroups(), opts.format);
        },
        { mutates: false },
      );
    });

  groups
    .command('create')
    .description('Create an account group through a guarded change')
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--name <name>', 'Group name')
    .action(async (cmdOpts: { operationId?: string; name: string }) => {
      const opts = program.opts();
      printOutput(
        await executeAccountGroupCreation(opts, cmdOpts.operationId, {
          name: cmdOpts.name,
        }),
        opts.format,
      );
    });

  groups
    .command('update <id>')
    .description('Rename an account group through a guarded change')
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--name <name>', 'New group name')
    .action(
      async (id: string, cmdOpts: { operationId?: string; name: string }) => {
        const opts = program.opts();
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'account-groups.update',
            id,
            { name: cmdOpts.name },
          ),
          opts.format,
        );
      },
    );

  groups
    .command('delete <id>')
    .description(
      'Delete an account group; its member accounts become ungrouped',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .action(async (id: string, cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      printOutput(
        await executeCatalogChange(
          opts,
          cmdOpts.operationId,
          'account-groups.delete',
          id,
          {},
        ),
        opts.format,
      );
    });
}
