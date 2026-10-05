import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { AgentError, updateAgentContext } from './agent-output';
import { getMetaDir, readCacheState, writeCacheState } from './cache';
import type { CliConfig, CliGlobalOpts } from './config';
import { isRecord } from './utils';

export type WatchOptions = {
  interval: number;
  timeout: number;
  samples: number;
  retries: number;
};

function attempt(
  config: CliConfig,
  signal: AbortSignal,
  timeout: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('ACTUAL_')),
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./sync-worker.js', import.meta.url))],
      {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const options: CliGlobalOpts = {
      ...config,
      offline: false,
      refresh: true,
      outputVersion: '2',
      verbose: false,
      lock: !config.noLock,
    };
    child.stdin.on('error', () => {
      /* An interrupted worker can close stdin first. */
    });
    child.stdin.end(JSON.stringify(options));
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.resume();
    const stop = () => {
      child.kill();
    };
    const timer = setTimeout(stop, timeout * 1000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    };
    child.once('error', error => {
      cleanup();
      reject(error);
    });
    child.once('close', code => {
      cleanup();
      if (code !== 0 || signal.aborted) {
        try {
          const failure: unknown = JSON.parse(output);
          if (
            isRecord(failure) &&
            isRecord(failure.error) &&
            typeof failure.error.code === 'string' &&
            [
              'INVALID_INPUT',
              'MISSING_CONTEXT',
              'budget-not-found',
              'missing-key',
              'decrypt-failure',
              'key-not-found',
              'invalid-password',
            ].includes(failure.error.code)
          ) {
            reject(
              new AgentError(
                'MISSING_CONTEXT',
                'Watch cannot open the selected budget. Check its sync ID, authentication, and encryption password.',
              ),
            );
            return;
          }
        } catch {
          /* A terminated worker may have no completed result. */
        }
        reject(new Error('Synchronization attempt ended.'));
        return;
      }
      try {
        const status: unknown = JSON.parse(output);
        if (
          !isRecord(status) ||
          typeof status.budgetId !== 'string' ||
          (status.syncId !== config.syncId &&
            status.cloudFileId !== config.syncId) ||
          typeof status.pendingMessages !== 'number'
        ) {
          throw new AgentError(
            'MISSING_CONTEXT',
            'Unexpected synchronization identity.',
          );
        }
        resolve(status);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function watchSync(
  config: CliConfig,
  options: WatchOptions,
  signal: AbortSignal,
) {
  const observations: Record<string, unknown>[] = [];
  let failures = 0;
  let reconnects = 0;
  let expectedBudgetId: unknown;
  let expectedSyncId: unknown;
  while (!signal.aborted && observations.length < options.samples) {
    let status: Record<string, unknown>;
    try {
      status = await attempt(config, signal, options.timeout);
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof AgentError) throw error;
      failures++;
      if (config.syncId) {
        const meta = getMetaDir(config.dataDir, config.syncId);
        const cached = readCacheState(meta);
        if (cached) writeCacheState(meta, { ...cached, lastSyncedAt: 0 });
      }
      updateAgentContext({ freshness: 'unknown' });
      process.stderr.write(
        JSON.stringify({
          event: 'reconnecting',
          attempt: failures,
          limit: options.retries,
        }) + '\n',
      );
      if (failures > options.retries) {
        throw new AgentError(
          'ENGINE_FAILURE',
          'Synchronization watch exhausted its retry limit. Existing writes were not replayed.',
          true,
        );
      }
      const backoff = Math.min(options.interval * 2 ** (failures - 1), 30);
      await delay(backoff * 1000, undefined, { signal }).catch(() => {
        /* Cancellation ends the wait. */
      });
      continue;
    }
    if (
      expectedBudgetId !== undefined &&
      (status.budgetId !== expectedBudgetId || status.syncId !== expectedSyncId)
    ) {
      throw new AgentError(
        'MISSING_CONTEXT',
        'The watched budget identity changed. Start a new watch for the selected budget.',
      );
    }
    expectedBudgetId = status.budgetId;
    expectedSyncId = status.syncId;
    if (failures > 0) reconnects++;
    failures = 0;
    observations.push(status);
    updateAgentContext({
      budgetId: String(status.budgetId),
      syncId: typeof status.syncId === 'string' ? status.syncId : null,
      mode: 'remote-cache',
      serverUrl: new URL(config.serverUrl).origin,
      freshness: 'observed',
      lastSyncedAt: Number(status.observedAt),
    });
    process.stderr.write(
      JSON.stringify({
        event: 'synced',
        sample: observations.length,
        pendingMessages: status.pendingMessages,
      }) + '\n',
    );
    if (observations.length < options.samples) {
      await delay(options.interval * 1000, undefined, { signal }).catch(() => {
        /* Cancellation ends the wait. */
      });
    }
  }
  return { cancelled: signal.aborted, reconnects, observations };
}
