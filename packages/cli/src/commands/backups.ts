import { mkdir } from 'node:fs/promises';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError, updateAgentContext } from '#agent-output';
import {
  createBackupArtifact,
  listBackupArtifacts,
  readBackupArtifact,
} from '#backup-artifacts';
import { pruneBackupArtifacts } from '#backup-retention';
import {
  validateBackupArchive,
  withBackupCancellation,
} from '#backup-validation';
import { captureBudgetSnapshot } from '#budget-snapshot';
import { getMetaDir, readCacheState } from '#cache';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { executeBudgetRestore } from '#guarded-changes';
import { acquireExclusive } from '#lock';
import { printOutput } from '#output';

export function registerBackupsCommand(program: Command) {
  const backups = program
    .command('backups')
    .description('Create and inspect explicit budget backup artifacts');
  backups
    .command('prune')
    .description(
      'Preview retention per source budget; --apply removes only older validated managed artifacts',
    )
    .requiredOption('--directory <path>', 'Explicit backup directory')
    .requiredOption(
      '--keep <count>',
      'Newest valid artifacts to retain per source (1-1000)',
    )
    .option(
      '--limit <count>',
      'Maximum artifacts to scan; larger inventories fail (1-1000)',
      '100',
    )
    .option(
      '--timeout <seconds>',
      'Total retention deadline including validation (1-120 seconds)',
      '60',
    )
    .option(
      '--apply',
      'Apply the newly calculated policy and delete its candidates',
    )
    .action(
      async (input: {
        directory: string;
        keep: string;
        limit: string;
        timeout: string;
        apply?: boolean;
      }) => {
        const keep = Number(input.keep);
        const limit = Number(input.limit);
        const timeout = Number(input.timeout);
        if (
          !Number.isSafeInteger(keep) ||
          keep < 1 ||
          keep > 1000 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 1000 ||
          !Number.isSafeInteger(timeout) ||
          timeout < 1 ||
          timeout > 120
        ) {
          throw new AgentError(
            'INVALID_INPUT',
            'keep and limit must be integers from 1 to 1000; timeout must be an integer from 1 to 120.',
          );
        }
        await withBackupCancellation(async signal =>
          printOutput(
            await pruneBackupArtifacts(
              input.directory,
              keep,
              limit,
              timeout,
              Boolean(input.apply),
              signal,
            ),
            program.opts().format,
          ),
        );
      },
    );
  backups
    .command('restore <path>')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .description(
      'Validate an artifact and restore a new local identity without publishing it',
    )
    .requiredOption('--name <name>', 'Unique name for the new local budget')
    .option(
      '--timeout <seconds>',
      'Isolated validation deadline (1-120 seconds)',
      '60',
    )
    .action(
      async (
        path: string,
        input: { name: string; timeout: string; operationId?: string },
      ) => {
        const opts = program.opts();
        const timeout = Number(input.timeout);
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120) {
          throw new AgentError(
            'INVALID_INPUT',
            'timeout must be an integer from 1 to 120.',
          );
        }
        if (!input.name.trim() || input.name.trim().length > 100) {
          throw new AgentError(
            'INVALID_INPUT',
            'Provide a budget name containing 1 to 100 characters.',
          );
        }
        if (opts.outputVersion === '2') {
          printOutput(
            await executeBudgetRestore(
              opts,
              input.operationId,
              path,
              input.name,
              timeout,
            ),
            opts.format,
          );
          return;
        }
        const config = await resolveConfig(opts);
        if (!config.offline) {
          throw new AgentError(
            'INVALID_INPUT',
            'Restore creates a local budget and requires --offline.',
          );
        }
        await withBackupCancellation(async signal => {
          const artifact = await readBackupArtifact(path);
          const validated = await validateBackupArchive(
            artifact.archive,
            timeout,
            signal,
          );
          if (validated.identity.id !== artifact.manifest.source.id) {
            throw new AgentError(
              'INVALID_INPUT',
              'The archive identity differs from its backup manifest.',
            );
          }
          await mkdir(config.dataDir, { recursive: true });
          await withConnection(
            opts,
            async config => {
              const release = await acquireExclusive(
                getMetaDir(config.dataDir, 'budget-lifecycle'),
                {
                  timeoutMs: config.lockTimeout * 1000,
                },
              );
              try {
                if (signal.aborted) {
                  throw new AgentError(
                    'INVALID_INPUT',
                    'Backup restore was cancelled before writing.',
                  );
                }
                const restored = await api
                  .restoreBudget(artifact.archive, {
                    name: input.name,
                  })
                  .catch(error => {
                    if (error?.code === 'invalid-budget-name') {
                      throw new AgentError(
                        'INVALID_INPUT',
                        'Budget name already exists or is invalid. Choose another name.',
                      );
                    }
                    if (error?.code === 'creation-cleanup-failed') {
                      throw new AgentError(
                        'PARTIAL_COMPLETION',
                        'Restore failed and new local files could remain. Inspect the data directory before retrying.',
                        false,
                        { dataDir: config.dataDir },
                      );
                    }
                    throw error;
                  });
                updateAgentContext({
                  budgetId: restored.id,
                  syncId: null,
                  serverUrl: null,
                  mode: 'offline-local',
                  freshness: 'unknown',
                  commit: 'committed-local',
                });
                try {
                  const inspection = await api.inspectBudget();
                  updateAgentContext({ currency: inspection.currency });
                  printOutput(
                    {
                      ...inspection,
                      sourceBudgetId: artifact.manifest.source.id,
                      published: false,
                      snapshot: await captureBudgetSnapshot(),
                    },
                    opts.format,
                  );
                } catch {
                  throw new AgentError(
                    'PARTIAL_COMPLETION',
                    'The new local budget was restored, but its final inspection failed. Inspect the returned budget ID before retrying.',
                    false,
                    { budgetId: restored.id },
                  );
                }
              } finally {
                try {
                  await api.shutdown();
                } finally {
                  await release();
                }
              }
            },
            { mutates: true, skipBudget: true },
          );
        });
      },
    );
  backups
    .command('list')
    .description(
      'List backup manifests without opening a budget or claiming import validation',
    )
    .requiredOption('--directory <path>', 'Explicit backup directory')
    .option('--limit <count>', 'Maximum artifacts to return (1-1000)', '100')
    .action(async (input: { directory: string; limit: string }) => {
      const limit = Number(input.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new AgentError(
          'INVALID_INPUT',
          'limit must be an integer from 1 to 1000.',
        );
      }
      printOutput(
        await listBackupArtifacts(input.directory, limit),
        program.opts().format,
      );
    });
  backups
    .command('validate <path>')
    .description(
      'Verify the hash, then import and read domain state in an isolated offline worker',
    )
    .option(
      '--timeout <seconds>',
      'Isolated worker deadline (1-120 seconds)',
      '60',
    )
    .action(async (path: string, input: { timeout: string }) => {
      const timeout = Number(input.timeout);
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120) {
        throw new AgentError(
          'INVALID_INPUT',
          'timeout must be an integer from 1 to 120.',
        );
      }
      await withBackupCancellation(async signal => {
        const artifact = await readBackupArtifact(path);
        const result = await validateBackupArchive(
          artifact.archive,
          timeout,
          signal,
        );
        if (result.identity.id !== artifact.manifest.source.id) {
          throw new AgentError(
            'INVALID_INPUT',
            'The archive identity differs from its backup manifest.',
          );
        }
        printOutput(
          {
            path: artifact.path,
            valid: true,
            isolated: true,
            sha256: artifact.manifest.sha256,
            snapshot: result.snapshot,
          },
          program.opts().format,
        );
      });
    });
  backups
    .command('create')
    .description(
      'Export an atomic plaintext backup and identity/freshness manifest',
    )
    .requiredOption(
      '--directory <path>',
      'Explicit directory for uniquely named backup artifacts',
    )
    .action(async (input: { directory: string }) => {
      if (!input.directory.trim() || input.directory.includes('\0')) {
        throw new AgentError(
          'INVALID_INPUT',
          'Provide an explicit backup directory.',
        );
      }
      const opts = program.opts();
      await withConnection(
        opts,
        async config => {
          const inspection = await api.inspectBudget();
          const status = await api.getSyncStatus();
          const archive = await api.exportBudget();
          const result = await createBackupArtifact(
            input.directory,
            archive,
            {
              source: {
                id: inspection.id,
                name: inspection.name,
                syncId: inspection.syncId,
                cloudFileId: inspection.cloudFileId,
                currency: inspection.currency,
              },
              sourceEncrypted: Boolean(inspection.encryptKeyId),
              remoteFreshness: config.offline ? 'unknown' : 'observed',
              lastSyncedTimestamp: status.lastSyncedTimestamp,
              pendingMessages: status.pendingMessages,
              lastSyncedAt: inspection.syncId
                ? readCacheState(getMetaDir(config.dataDir, inspection.syncId))
                    ?.lastSyncedAt || null
                : null,
            },
            config.lockTimeout * 1000,
          );
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });
}
