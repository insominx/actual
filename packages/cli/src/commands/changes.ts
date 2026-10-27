import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import type { ChangeReceipt } from '#change-journal';
import { validateOperationId, withChangeJournal } from '#change-journal';
import { withConnection } from '#connection';
import { api } from '#engine';
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
import type { FieldRow, LedgerRow } from '#receipt-resolution';
import {
  checkFieldsLanded,
  checkImportLanded,
  fieldScope,
  isImportReceipt,
  resolutionScope,
  resolvable,
  resolvedOutcome,
} from '#receipt-resolution';
import {
  BACKUP_RECOVERY,
  diagnoseReceipt,
  planReversal,
  reversalConflicts,
} from '#reversal';
import { plainInteger } from '#utils';

export function registerChangesCommand(program: Command) {
  const changes = program
    .command('changes')
    .description('Preview guarded domain changes and inspect local receipts');
  const config = () => resolveGuardConfig(program.opts(), false, true);
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
    .command('resolve <operation-id>')
    .description(
      'Close an uncertain receipt after checking the ledger shows its planned result (imports, batch categorization and updates, transfer match and create); never replays the change',
    )
    .option(
      '--dry-run',
      'Check the ledger and report without updating the receipt',
    )
    .action(async (id: string, input: { dryRun?: boolean }) => {
      validateOperationId(id);
      const resolved = await config();
      const receipt = await withChangeJournal(
        resolved.dataDir,
        resolved.lockTimeout,
        async journal => journal.read(id),
      );
      if (!receipt) {
        throw new AgentError(
          'MISSING_CONTEXT',
          'Operation ID was not found in this local journal.',
        );
      }
      if (!resolvable(receipt)) {
        throw new AgentError(
          'INVALID_INPUT',
          receipt.state !== 'uncertain'
            ? `The receipt is ${receipt.state}, not uncertain; there is nothing to resolve.`
            : `No ledger check exists for ${receipt.proposal.operation}; restore a backup or inspect it by hand.`,
          false,
          { state: receipt.state, operation: receipt.proposal.operation },
        );
      }
      const check = await withConnection(
        program.opts(),
        async () => {
          if (!isImportReceipt(receipt)) {
            const select = [
              'id',
              'account',
              'category',
              'notes',
              'payee',
              'cleared',
              'transfer_id',
            ];
            const read = async (ids: string[]) =>
              ids.length
                ? (
                    (await api.aqlQuery(
                      api
                        .q('transactions')
                        .filter({ id: { $oneof: ids } })
                        .select(select)
                        .options({ splits: 'all' }),
                    )) as { data: FieldRow[] }
                  ).data
                : [];
            const rows = await read(fieldScope(receipt));
            const counterparts = await read(
              rows
                .map(row => row.transfer_id)
                .filter((linked): linked is string => !!linked),
            );
            return checkFieldsLanded(receipt, rows, counterparts);
          }
          const scope = resolutionScope(receipt);
          const ledger: LedgerRow[] = [];
          for (const account of scope.accounts) {
            const { data } = (await api.aqlQuery(
              api
                .q('transactions')
                .filter({
                  account,
                  ...(scope.from && scope.to
                    ? { date: [{ $gte: scope.from }, { $lte: scope.to }] }
                    : {}),
                })
                .select([
                  'id',
                  'account',
                  'date',
                  'amount',
                  'imported_id',
                  'imported_payee',
                ])
                .options({ splits: 'all' }),
            )) as { data: LedgerRow[] };
            ledger.push(...data);
          }
          let updated: Array<{ id: string }> = [];
          if (scope.updatedIds.length) {
            const result = (await api.aqlQuery(
              api
                .q('transactions')
                .filter({ id: { $oneof: scope.updatedIds } })
                .select(['id'])
                .options({ splits: 'all' }),
            )) as { data: Array<{ id: string }> };
            updated = result.data;
          }
          return checkImportLanded(
            receipt,
            ledger,
            updated.map(row => row.id),
          );
        },
        { mutates: false },
      );
      if (!check.verified || input.dryRun) {
        printOutput(
          {
            operationId: id,
            state: receipt.state,
            verified: check.verified,
            missing: check.missing,
            ...(check.verified
              ? { next: `actual changes resolve ${id}` }
              : {
                  next: 'The change did not fully land. The receipt stays uncertain; redo the missing part as a new change, or restore a backup.',
                }),
          },
          'json',
        );
        return;
      }
      const updatedReceipt = await withChangeJournal(
        resolved.dataDir,
        resolved.lockTimeout,
        async journal => {
          const current = await journal.read(id);
          if (
            !current ||
            current.state !== 'uncertain' ||
            current.token !== receipt.token
          ) {
            throw new AgentError(
              'STALE_PREVIEW',
              'The receipt changed while it was being checked; run resolve again.',
            );
          }
          const at = new Date().toISOString();
          const next = {
            ...current,
            state: 'committed-local' as const,
            updatedAt: at,
            outcome: resolvedOutcome(
              current,
              check,
              at,
            ) as ChangeReceipt['outcome'],
          };
          await journal.write(next);
          return next;
        },
      );
      printOutput(updatedReceipt, 'json');
    });
  changes
    .command('list')
    .description('List local receipts with disclosed truncation')
    .option('--limit <count>', 'Maximum receipts to return (1-500)', '100')
    .action(async (input: { limit: string }) => {
      const limit = plainInteger(input.limit);
      if (limit === null || limit < 1 || limit > 500) {
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
