import { rmSync } from 'node:fs';
import { join } from 'node:path';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError, updateAgentContext } from '#agent-output';
import { CACHE_FILE_NAME, getMetaDir, readCacheState } from '#cache';
import type { CliConfig } from '#config';
import { resolveConfig } from '#config';
import { withConnection } from '#connection';
import { acquireExclusive } from '#lock';
import { printOutput } from '#output';
import { watchSync } from '#sync-watch';

type SyncCmdOpts = {
  status?: boolean;
  clear?: boolean;
};

async function requireSyncIdAndMeta(
  opts: Record<string, unknown>,
  flag: string,
): Promise<{ config: CliConfig; meta: string }> {
  const config = await resolveConfig(opts);
  if (!config.syncId) {
    throw new Error(
      `Sync ID is required for sync ${flag}. Set --sync-id or ACTUAL_SYNC_ID.`,
    );
  }
  return { config, meta: getMetaDir(config.dataDir, config.syncId) };
}

export function registerSyncCommand(program: Command) {
  const sync = program
    .command('sync')
    .description(
      'Sync the local cached budget with the server, print cache status, or clear the cache',
    )
    .option('--status', 'Print cache status without syncing', false)
    .option(
      '--clear',
      'Delete the local cache; next command re-downloads',
      false,
    )
    .action(async (cmdOpts: SyncCmdOpts) => {
      const opts = program.opts();

      if (cmdOpts.status) {
        const { config, meta } = await requireSyncIdAndMeta(opts, '--status');
        const state = readCacheState(meta);
        if (state === null) {
          printOutput(
            {
              neverSynced: true,
              syncId: config.syncId,
              ttlSeconds: config.cacheTtl,
            },
            opts.format,
          );
          return;
        }
        const rawAgeSeconds = Math.round(
          (Date.now() - state.lastSyncedAt) / 1000,
        );
        const ageSeconds = Math.max(0, rawAgeSeconds);
        printOutput(
          {
            neverSynced: false,
            syncId: state.syncId,
            budgetId: state.budgetId,
            syncedAt: new Date(state.lastSyncedAt).toISOString(),
            lastDownloadedAt: new Date(state.lastDownloadedAt).toISOString(),
            ageSeconds,
            ttlSeconds: config.cacheTtl,
            stale: rawAgeSeconds < 0 || rawAgeSeconds > config.cacheTtl,
          },
          opts.format,
        );
        return;
      }

      if (cmdOpts.clear) {
        const { config, meta } = await requireSyncIdAndMeta(opts, '--clear');
        // Serialize with concurrent writers so we don't rm a half-written
        // state.json that's about to be renamed into place.
        const release = config.noLock
          ? null
          : await acquireExclusive(meta, {
              timeoutMs: config.lockTimeout * 1000,
            });
        try {
          rmSync(join(meta, CACHE_FILE_NAME), { force: true });
        } finally {
          await release?.();
        }
        printOutput({ cleared: true, syncId: config.syncId }, opts.format);
        return;
      }

      if ((await resolveConfig(opts)).offline) {
        throw new AgentError(
          'INVALID_INPUT',
          'Synchronization requires an online connection. Omit --offline.',
        );
      }
      await withConnection(
        opts,
        async config => {
          const state = config.syncId
            ? readCacheState(getMetaDir(config.dataDir, config.syncId))
            : null;
          printOutput(
            {
              syncedAt: new Date(
                state?.lastSyncedAt ?? Date.now(),
              ).toISOString(),
              syncId: config.syncId,
              budgetId: state?.budgetId ?? config.syncId,
            },
            opts.format,
          );
        },
        { mutates: true },
      );
    });

  sync
    .command('watch')
    .description(
      'Observe synchronization with bounded retries; cancel with Ctrl+C or a cancel line on stdin',
    )
    .option('--interval <seconds>', 'Polling interval (1-300 seconds)', '5')
    .option(
      '--timeout <seconds>',
      'Maximum duration of each worker attempt (1-120 seconds)',
      '30',
    )
    .option(
      '--samples <count>',
      'Maximum successful observations (1-1000)',
      '100',
    )
    .option(
      '--retries <count>',
      'Maximum consecutive failed attempts to retry (0-20)',
      '5',
    )
    .action(
      async (input: {
        interval: string;
        timeout: string;
        samples: string;
        retries: string;
      }) => {
        const opts = program.opts();
        const options = {
          interval: Number(input.interval),
          timeout: Number(input.timeout),
          samples: Number(input.samples),
          retries: Number(input.retries),
        };
        for (const [key, min, max] of [
          ['interval', 1, 300],
          ['timeout', 1, 120],
          ['samples', 1, 1000],
          ['retries', 0, 20],
        ] as const) {
          if (
            !Number.isSafeInteger(options[key]) ||
            options[key] < min ||
            options[key] > max
          ) {
            throw new AgentError(
              'INVALID_INPUT',
              `${key} must be an integer from ${min} to ${max}.`,
            );
          }
        }
        const config = await resolveConfig(opts);
        if (config.offline || !config.syncId) {
          throw new AgentError(
            'INVALID_INPUT',
            'Watch requires an online connection and an explicit sync budget.',
          );
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        let inputLine = '';
        const onInput = (chunk: Buffer) => {
          inputLine = (inputLine + chunk.toString()).slice(-256);
          if (inputLine.split(/\r?\n/).some(line => line.trim() === 'cancel')) {
            cancel();
          }
        };
        process.on('SIGINT', cancel);
        process.on('SIGTERM', cancel);
        process.stdin.on('data', onInput);
        try {
          printOutput(
            await watchSync(config, options, controller.signal),
            opts.format,
          );
        } finally {
          process.off('SIGINT', cancel);
          process.off('SIGTERM', cancel);
          process.stdin.off('data', onInput);
          process.stdin.pause();
        }
      },
    );

  sync
    .command('status')
    .description(
      'Inspect engine pending writes without contacting the server (requires --offline)',
    )
    .action(async () => {
      const opts = program.opts();
      if (!(await resolveConfig(opts)).offline) {
        throw new AgentError(
          'INVALID_INPUT',
          'Read-only synchronization status requires --offline. Use sync refresh for online synchronization.',
        );
      }
      await withConnection(
        opts,
        async () => {
          const status = await api.getSyncStatus();
          printOutput(
            {
              ...status,
              remoteFreshness: 'unknown',
              note: 'Pending messages are local writes beyond the engine checkpoint. Deferred messages are received data requiring a newer schema.',
            },
            opts.format,
          );
        },
        { mutates: false },
      );
    });

  sync
    .command('refresh')
    .description('Synchronize existing writes and return engine pending status')
    .action(async () => {
      const opts = program.opts();
      if ((await resolveConfig(opts)).offline) {
        throw new AgentError(
          'INVALID_INPUT',
          'Refresh requires online access.',
        );
      }
      await withConnection(
        { ...opts, refresh: true },
        async () => {
          const status = await api.getSyncStatus();
          updateAgentContext({
            lastSyncedAt: status.observedAt,
            freshness: 'observed',
            commit: 'synced',
          });
          printOutput(status, opts.format);
        },
        { mutates: false },
      );
    });
}
