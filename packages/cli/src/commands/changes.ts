import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { validateOperationId, withChangeJournal } from '#change-journal';
import {
  applyGuardedChange,
  previewGuardedChange,
  resolveGuardConfig,
} from '#guarded-changes';
import { printOutput } from '#output';

export function registerChangesCommand(program: Command) {
  const changes = program
    .command('changes')
    .description('Preview guarded domain changes and inspect local receipts');
  const config = () => resolveGuardConfig(program.opts());
  changes
    .command('preview <operation> [id]')
    .description(
      'Prepare a guarded transaction, allocation, or budget lifecycle change',
    )
    .requiredOption('--operation-id <id>', 'Unique device-local operation ID')
    .option('--data <json>', 'Fields to update')
    .option('--file <path>', 'Read fields from JSON file (use - for stdin)')
    .action(
      async (
        operation: string,
        id: string | undefined,
        input: { operationId: string; data?: string; file?: string },
      ) => {
        if (
          ![
            'budgets.create',
            'accounts.create',
            'category-groups.create',
            'categories.create',
            'backups.restore',
            'budgets.hold-next-month',
            'budgets.reset-hold',
          ].includes(operation) &&
          !id
        ) {
          throw new AgentError(
            'INVALID_INPUT',
            'This operation requires an explicit target ID.',
          );
        }
        printOutput(
          await previewGuardedChange(program.opts(), operation, id, input),
          'json',
        );
      },
    );
  changes
    .command('apply <operation-id>')
    .description(
      'Apply an exact prepared token; never replay uncertain operations',
    )
    .requiredOption('--token <hash>', 'Exact token returned by preview')
    .action(async (id: string, input: { token: string }) => {
      printOutput(await applyGuardedChange(program.opts(), id, input), 'json');
    });
  changes
    .command('status <operation-id>')
    .description('Read a local receipt without replaying or synchronizing')
    .action(async (id: string) => {
      validateOperationId(id);
      const resolved = await config();
      await withChangeJournal(
        resolved.dataDir,
        resolved.lockTimeout,
        async journal => {
          const receipt = await journal.read(id);
          if (!receipt) {
            throw new AgentError(
              'MISSING_CONTEXT',
              'Operation ID was not found in this local journal.',
            );
          }
          printOutput(receipt, 'json');
        },
      );
    });
  changes
    .command('list')
    .description('List local receipts with disclosed truncation')
    .option('--limit <count>', 'Maximum receipts to return (1-500)', '100')
    .action(async (input: { limit: string }) => {
      const limit = Number(input.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new AgentError(
          'INVALID_INPUT',
          'limit must be an integer from 1 to 500.',
        );
      }
      const resolved = await config();
      await withChangeJournal(
        resolved.dataDir,
        resolved.lockTimeout,
        async journal => printOutput(await journal.list(limit), 'json'),
      );
    });
}
