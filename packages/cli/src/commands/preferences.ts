import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { withConnection } from '#connection';
import { executeCatalogChange } from '#guarded-changes';
import { printOutput } from '#output';

export function registerPreferencesCommand(program: Command) {
  const preferences = program
    .command('preferences')
    .description('Inspect and change synced budget preferences');

  preferences
    .command('inspect [key]')
    .description(
      'List synced preferences with scope, authority, allowed values and current value; unset values are null and nothing is written',
    )
    .action(async (key: string | undefined) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(await api.inspectPreferences(key), opts.format);
        },
        { mutates: false },
      );
    });

  preferences
    .command('set <key> <value>')
    .description(
      'Set an allowlisted synced preference through a guarded change with a durable receipt',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .action(
      async (key: string, value: string, cmdOpts: { operationId?: string }) => {
        const opts = program.opts();
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'preferences.set',
            key,
            { value },
          ),
          opts.format,
        );
      },
    );

  preferences
    .command('reset <key>')
    .description(
      'Clear an allowlisted synced preference so the app uses its default',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .action(async (key: string, cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      printOutput(
        await executeCatalogChange(
          opts,
          cmdOpts.operationId,
          'preferences.set',
          key,
          { value: null },
        ),
        opts.format,
      );
    });
}
