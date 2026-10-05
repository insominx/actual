import { mkdir } from 'node:fs/promises';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError, updateAgentContext } from '#agent-output';
import { withBackupCancellation } from '#backup-validation';
import { compareBudgets } from '#budget-comparison';
import { getMetaDir } from '#cache';
import type { CliGlobalOpts } from '#config';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import {
  executeBudgetAmount,
  executeBudgetCarryover,
  executeBudgetClone,
  executeBudgetCreation,
  executeBudgetHold,
  executeBudgetMetadata,
  executeBudgetPublication,
} from '#guarded-changes';
import { acquireExclusive } from '#lock';
import { printOutput } from '#output';
import { readProfiles, saveProfiles, validateProfile } from '#profiles';
import { parseBoolFlag, parseIntFlag } from '#utils';

export function registerBudgetsCommand(program: Command) {
  const budgets = program.command('budgets').description('Manage budgets');
  budgets
    .command('compare <left-id> <right-id>')
    .description(
      'Compare isolated domain snapshots of two explicit local budgets',
    )
    .option('--limit <count>', 'Maximum differences to return (1-1000)', '100')
    .option(
      '--timeout <seconds>',
      'Isolated worker deadline (1-120 seconds)',
      '60',
    )
    .action(
      async (
        left: string,
        right: string,
        input: { limit: string; timeout: string },
      ) => {
        const limit = Number(input.limit);
        const timeout = Number(input.timeout);
        if (
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 1000 ||
          !Number.isSafeInteger(timeout) ||
          timeout < 1 ||
          timeout > 120
        ) {
          throw new AgentError(
            'INVALID_INPUT',
            'limit must be 1 to 1000 and timeout must be 1 to 120, both integers.',
          );
        }
        await withBackupCancellation(async signal => {
          const result = await compareBudgets(
            program.opts(),
            left,
            right,
            limit,
            timeout,
            signal,
          );
          updateAgentContext({
            budgetId: null,
            syncId: null,
            serverUrl: null,
            currency: null,
            mode: 'offline-local',
            freshness: 'unknown',
            lastSyncedAt: null,
            commit: 'none',
          });
          printOutput(result, program.opts().format);
        });
      },
    );

  budgets
    .command('publish <id>')
    .description(
      'Explicitly publish a local budget to the authenticated server',
    )
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (id: string, input: { operationId?: string }) => {
      const opts = program.opts();
      if (opts.offline || opts.budgetId || opts.syncId) {
        throw new AgentError(
          'INVALID_INPUT',
          'Publication selects a local ID by argument and requires online access.',
        );
      }
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetPublication(opts, input.operationId, id),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async config => {
          const local = (await api.getBudgets()).find(b => b.id === id);
          if (!local?.id) {
            throw new AgentError(
              'MISSING_CONTEXT',
              'Local budget ID does not exist in this data directory.',
            );
          }
          const budgetRelease = await acquireExclusive(
            getMetaDir(config.dataDir, local.groupId ?? `local-${local.id}`),
            {
              timeoutMs: config.lockTimeout * 1000,
            },
          );
          let release;
          try {
            release = await acquireExclusive(
              getMetaDir(config.dataDir, 'budget-lifecycle'),
              {
                timeoutMs: config.lockTimeout * 1000,
              },
            );
            const result = await api
              .publishBudget(id, {
                encryptionPassword: config.encryptionPassword,
              })
              .catch(error => {
                if (error?.code === 'publication-uncertain') {
                  updateAgentContext({
                    budgetId: id,
                    commit: 'committed-local',
                  });
                  throw new AgentError(
                    'PARTIAL_COMPLETION',
                    'Publication could have reached the server. Inspect the retained identity or retry publication with the same server and encryption mode.',
                    true,
                  );
                }
                if (error?.code === 'unsupported-publication') {
                  throw new AgentError(
                    'INVALID_INPUT',
                    'This server does not support encrypted initial publication. Upgrade the server before publishing.',
                  );
                }
                throw error;
              });
            updateAgentContext({
              budgetId: result.id,
              syncId: result.syncId,
              mode: 'remote-cache',
              currency: result.currency,
              commit: 'synced',
              freshness: 'observed',
              lastSyncedAt: Date.now(),
            });
            printOutput({ ...result, published: true }, opts.format);
          } finally {
            await release?.();
            await budgetRelease();
          }
        },
        { mutates: false, skipBudget: true, onlineOnly: true },
      );
    });

  budgets
    .command('rename')
    .description('Rename the selected budget without changing its identity')
    .requiredOption('--name <name>', 'New budget name')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (cmdOpts: { name: string; operationId?: string }) => {
      if (!cmdOpts.name.trim() || cmdOpts.name.trim().length > 100) {
        throw new AgentError(
          'INVALID_INPUT',
          'Budget name must contain 1 to 100 characters.',
        );
      }
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetMetadata(opts, cmdOpts.operationId, {
            operation: 'budgets.rename',
            name: cmdOpts.name,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.renameBudget(cmdOpts.name).catch(error => {
            if (error?.code === 'invalid-budget-name') {
              throw new AgentError(
                'INVALID_INPUT',
                'Budget name already exists or is invalid.',
              );
            }
            throw error;
          });
          printOutput(await api.inspectBudget(), opts.format);
        },
        { mutates: true },
      );
    });

  budgets
    .command('archive')
    .description(
      'Mark the selected budget archived on this device without deleting it',
    )
    .option('--restore', 'Remove the local archive marker')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (cmdOpts: { restore?: boolean; operationId?: string }) => {
      const opts = program.opts();
      if (!(await resolveConfig(opts)).offline) {
        throw new AgentError(
          'INVALID_INPUT',
          'Device-local archiving requires --offline.',
        );
      }
      if (opts.outputVersion === '2') {
        const result = await executeBudgetMetadata(opts, cmdOpts.operationId, {
          operation: 'budgets.archive',
          archived: !cmdOpts.restore,
        });
        printOutput({ ...result, remoteDeleted: false }, opts.format);
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.archiveBudget(!cmdOpts.restore);
          updateAgentContext({ commit: 'committed-local' });
          printOutput(
            { ...(await api.inspectBudget()), remoteDeleted: false },
            opts.format,
          );
        },
        { mutates: true },
      );
    });

  budgets
    .command('inspect')
    .description('Inspect the selected budget identity and currency')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(await api.inspectBudget(), opts.format);
        },
        { mutates: false },
      );
    });

  budgets
    .command('select <id>')
    .description('Select an explicit local budget in a saved offline profile')
    .requiredOption('--save-profile <name>', 'Profile to create or update')
    .action(async (id: string, cmdOpts: { saveProfile: string }) => {
      if (!cmdOpts.saveProfile.trim()) {
        throw new AgentError(
          'INVALID_INPUT',
          'Profile name must not be empty.',
        );
      }
      const opts: CliGlobalOpts = {
        ...program.opts(),
        offline: true,
        budgetId: id,
        syncId: undefined,
      };
      await withConnection(
        opts,
        async config => {
          const budget = await api.inspectBudget();
          const release = await acquireExclusive(
            getMetaDir(config.dataDir, 'budget-lifecycle'),
            {
              timeoutMs: config.lockTimeout * 1000,
            },
          );
          try {
            const store = await readProfiles(opts.profilesFile);
            const {
              syncId: _syncId,
              budgetId: _budgetId,
              ...previous
            } = Object.keys(store.profiles).includes(cmdOpts.saveProfile)
              ? store.profiles[cmdOpts.saveProfile]
              : {};
            const profile = validateProfile({
              ...previous,
              dataDir: config.dataDir,
              offline: true,
              budgetId: id,
            });
            Object.defineProperty(store.profiles, cmdOpts.saveProfile, {
              value: profile,
              configurable: true,
              enumerable: true,
              writable: true,
            });
            store.selected = cmdOpts.saveProfile;
            await saveProfiles(store, opts.profilesFile);
            printOutput(
              { ...budget, profile: cmdOpts.saveProfile, selected: true },
              opts.format,
            );
          } finally {
            await release();
          }
        },
        { mutates: false },
      );
    });

  budgets
    .command('clone')
    .description(
      'Clone the selected budget with a separate identity (requires --offline)',
    )
    .requiredOption('--name <name>', 'Name of the new local budget')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (cmdOpts: { name: string; operationId?: string }) => {
      if (!cmdOpts.name.trim() || cmdOpts.name.trim().length > 100) {
        throw new AgentError(
          'INVALID_INPUT',
          'Budget name must contain 1 to 100 characters.',
        );
      }
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetClone(opts, cmdOpts.operationId, cmdOpts.name),
          opts.format,
        );
        return;
      }
      if (!(await resolveConfig(opts)).offline) {
        throw new AgentError(
          'INVALID_INPUT',
          'Local cloning requires --offline. Publication is a separate operation.',
        );
      }
      await withConnection(
        opts,
        async config => {
          const original = await api.inspectBudget();
          const release = await acquireExclusive(
            getMetaDir(config.dataDir, 'budget-lifecycle'),
            {
              timeoutMs: config.lockTimeout * 1000,
            },
          );
          try {
            await api.cloneBudget({ name: cmdOpts.name }).catch(error => {
              if (error?.code === 'invalid-budget-name') {
                throw new AgentError(
                  'INVALID_INPUT',
                  'Budget name already exists or is invalid. Choose another name.',
                );
              }
              if (error?.code === 'creation-cleanup-failed') {
                throw new AgentError(
                  'PARTIAL_COMPLETION',
                  'Clone failed and local files could remain. Inspect the data directory before retrying.',
                );
              }
              throw error;
            });
            const clone = await api.inspectBudget();
            updateAgentContext({
              budgetId: clone.id,
              syncId: null,
              serverUrl: null,
              currency: clone.currency,
              mode: 'offline-local',
              commit: 'committed-local',
            });
            printOutput(
              { ...clone, sourceBudgetId: original.id, published: false },
              opts.format,
            );
          } finally {
            await release();
          }
        },
        { mutates: false },
      );
    });

  budgets
    .command('create')
    .description(
      'Create a local budget without publishing it (requires --offline)',
    )
    .requiredOption('--name <name>', 'Budget name (maximum 100 characters)')
    .option('--currency <code>', 'Uppercase three-letter currency code')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(
      async (cmdOpts: {
        name: string;
        currency?: string;
        operationId?: string;
      }) => {
        const opts = program.opts();
        if (
          !cmdOpts.name.trim() ||
          cmdOpts.name.trim().length > 100 ||
          (cmdOpts.currency !== undefined &&
            !/^[A-Z]{3}$/.test(cmdOpts.currency))
        ) {
          throw new AgentError(
            'INVALID_INPUT',
            'Provide a valid name and uppercase three-letter currency code.',
          );
        }
        if (opts.outputVersion === '2') {
          printOutput(
            await executeBudgetCreation(opts, cmdOpts.operationId, {
              name: cmdOpts.name,
              currency: cmdOpts.currency,
            }),
            opts.format,
          );
          return;
        }
        const config = await resolveConfig(opts);
        if (!config.offline) {
          throw new AgentError(
            'INVALID_INPUT',
            'Local creation requires --offline. Publication is a separate operation.',
          );
        }
        await mkdir(config.dataDir, { recursive: true });
        await withConnection(
          opts,
          async resolved => {
            const release = await acquireExclusive(
              getMetaDir(resolved.dataDir, 'budget-lifecycle'),
              {
                timeoutMs: resolved.lockTimeout * 1000,
              },
            );
            try {
              const result = await api
                .createBudget({
                  name: cmdOpts.name,
                  currency: cmdOpts.currency,
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
                      'Creation failed and local files could remain. Inspect the data directory before retrying.',
                    );
                  }
                  throw error;
                });
              updateAgentContext({
                budgetId: result.id,
                syncId: null,
                serverUrl: null,
                mode: 'offline-local',
                currency: cmdOpts.currency ?? null,
                commit: 'committed-local',
              });
              printOutput(
                { ...result, name: cmdOpts.name.trim(), published: false },
                opts.format,
              );
            } finally {
              await release();
            }
          },
          { mutates: true, skipBudget: true },
        );
      },
    );

  budgets
    .command('list')
    .description('List all available budgets')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getBudgets();
          printOutput(result, opts.format);
        },
        { mutates: false, skipBudget: true },
      );
    });

  budgets
    .command('download <syncId>')
    .description('Download a budget by sync ID')
    .option('--encryption-password <password>', 'Encryption password')
    .action(async (syncId: string, cmdOpts) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async config => {
          const password =
            cmdOpts.encryptionPassword ?? config.encryptionPassword;
          await api.downloadBudget(syncId, {
            password,
          });
          printOutput({ success: true, syncId }, opts.format);
        },
        { mutates: false, skipBudget: true },
      );
    });

  budgets
    .command('months')
    .description('List available budget months')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getBudgetMonths();
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  budgets
    .command('month <month>')
    .description('Get budget data for a specific month (YYYY-MM)')
    .action(async (month: string) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getBudgetMonth(month);
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  budgets
    .command('set-amount')
    .description('Set budget amount for a category in a month')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .requiredOption('--month <month>', 'Budget month (YYYY-MM)')
    .requiredOption('--category <id>', 'Category ID')
    .requiredOption(
      '--amount <amount>',
      'Amount in cents (e.g. 50000 = 500.00)',
    )
    .action(async cmdOpts => {
      const amount = parseIntFlag(cmdOpts.amount, '--amount');
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetAmount(opts, cmdOpts.operationId, {
            month: cmdOpts.month,
            categoryId: cmdOpts.category,
            amount,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.setBudgetAmount(cmdOpts.month, cmdOpts.category, amount);
          printOutput({ success: true }, opts.format);
        },
        { mutates: true },
      );
    });

  budgets
    .command('set-carryover')
    .description('Enable/disable carryover for a category')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .requiredOption('--month <month>', 'Budget month (YYYY-MM)')
    .requiredOption('--category <id>', 'Category ID')
    .requiredOption('--flag <bool>', 'Enable (true) or disable (false)')
    .action(async cmdOpts => {
      const flag = parseBoolFlag(cmdOpts.flag, '--flag');
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetCarryover(opts, cmdOpts.operationId, {
            month: cmdOpts.month,
            categoryId: cmdOpts.category,
            flag,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.setBudgetCarryover(cmdOpts.month, cmdOpts.category, flag);
          printOutput({ success: true }, opts.format);
        },
        { mutates: true },
      );
    });

  budgets
    .command('hold-next-month')
    .description('Hold budget amount for next month')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .requiredOption('--month <month>', 'Budget month (YYYY-MM)')
    .requiredOption(
      '--amount <amount>',
      'Amount in cents (e.g. 50000 = 500.00)',
    )
    .action(async cmdOpts => {
      const parsedAmount = parseIntFlag(cmdOpts.amount, '--amount');
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetHold(opts, cmdOpts.operationId, {
            operation: 'budgets.hold-next-month',
            month: cmdOpts.month,
            amount: parsedAmount,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.holdBudgetForNextMonth(cmdOpts.month, parsedAmount);
          printOutput({ success: true }, opts.format);
        },
        { mutates: true },
      );
    });

  budgets
    .command('reset-hold')
    .description('Reset budget hold for a month')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .requiredOption('--month <month>', 'Budget month (YYYY-MM)')
    .action(async cmdOpts => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeBudgetHold(opts, cmdOpts.operationId, {
            operation: 'budgets.reset-hold',
            month: cmdOpts.month,
          }),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.resetBudgetHold(cmdOpts.month);
          printOutput({ success: true }, opts.format);
        },
        { mutates: true },
      );
    });
}
