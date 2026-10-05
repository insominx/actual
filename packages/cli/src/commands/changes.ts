import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import type { ChangeReceipt } from '#change-journal';
import { validateOperationId, withChangeJournal } from '#change-journal';
import {
  applyGuardedChange,
  previewGuardedChange,
  resolveGuardConfig,
} from '#guarded-changes';
import {
  BUDGET_CREATING_OPERATIONS,
  PAYLOAD_SCOPED_OPERATIONS,
} from '#guarded-operations';
import { printOutput } from '#output';
import {
  BACKUP_RECOVERY,
  diagnoseReceipt,
  planReversal,
  reversalConflicts,
} from '#reversal';

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
          !PAYLOAD_SCOPED_OPERATIONS.includes(operation) &&
          !BUDGET_CREATING_OPERATIONS.includes(operation) &&
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
    .command('inspect <operation-id>')
    .description(
      'Diagnose a local receipt (state, meaning, safe next steps) and whether it can be reversed; read-only',
    )
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
          printOutput(diagnoseReceipt(receipt), 'json');
        },
      );
    });
  changes
    .command('reverse <original-operation-id>')
    .description(
      'Compensate a committed categorization, allocation move or cash plan save with a new guarded change from the receipt before-values; refuses when records changed since',
    )
    .requiredOption(
      '--operation-id <id>',
      'New unique operation ID for the reversal (retry with the same ID)',
    )
    .option('--preview', 'Prepare and check the reversal without applying it')
    .action(
      async (
        originalId: string,
        input: { operationId: string; preview?: boolean },
      ) => {
        validateOperationId(originalId);
        validateOperationId(input.operationId);
        if (originalId === input.operationId) {
          throw new AgentError(
            'INVALID_INPUT',
            'The reversal needs its own new operation ID.',
            false,
            { field: 'operationId' },
          );
        }
        const resolved = await config();
        const original = await withChangeJournal(
          resolved.dataDir,
          resolved.lockTimeout,
          async journal => journal.read(originalId),
        );
        if (!original) {
          throw new AgentError(
            'MISSING_CONTEXT',
            'Operation ID was not found in this local journal.',
          );
        }
        const plan = planReversal(original);
        if (!plan.supported) {
          throw new AgentError('INVALID_INPUT', plan.reason, false, {
            reason: plan.reason,
            recovery: plan.recovery,
          });
        }
        let prepared: ChangeReceipt;
        try {
          prepared = await previewGuardedChange(
            program.opts(),
            plan.operation,
            undefined,
            {
              operationId: input.operationId,
              data: JSON.stringify(plan.request),
            },
          );
        } catch (error) {
          if (error instanceof AgentError && error.code === 'INVALID_INPUT') {
            throw new AgentError(
              'INVALID_INPUT',
              `Cannot prepare the reversal: ${error.message} The records may now be reconciled, deleted, split or otherwise ineligible.`,
              false,
              { recovery: BACKUP_RECOVERY },
            );
          }
          throw error;
        }
        const conflicts = reversalConflicts(original, prepared.proposal);
        if (conflicts.length) {
          throw new AgentError(
            'STALE_PREVIEW',
            'The reversal would overwrite changes made after the original operation.',
            false,
            { conflicts, recovery: BACKUP_RECOVERY },
          );
        }
        if (input.preview) {
          printOutput(
            {
              reverses: originalId,
              preconditions: plan.preconditions,
              reversal: prepared,
              apply: `actual changes apply ${input.operationId} --token ${prepared.token}`,
            },
            'json',
          );
          return;
        }
        const receipt = await applyGuardedChange(
          program.opts(),
          input.operationId,
          { token: prepared.token },
        );
        printOutput(
          {
            reverses: originalId,
            preconditions: plan.preconditions,
            reversal: receipt,
          },
          'json',
        );
      },
    );
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
