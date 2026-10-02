import * as api from '@actual-app/api';

import { AgentError, updateAgentContext } from './agent-output';
import type { CacheState } from './cache';
import {
  CACHE_VERSION,
  decideSyncAction,
  getMetaDir,
  readCacheState,
  writeCacheState,
} from './cache';
import type { CliConfig, CliGlobalOpts } from './config';
import { resolveConfig } from './config';
import { acquireExclusive, acquireShared } from './lock';
import type { Release } from './lock';

type ConnectionOptions = {
  mutates: boolean;
  skipBudget?: boolean;
};

function info(message: string, verbose?: boolean) {
  if (verbose) process.stderr.write(message + '\n');
}

async function resolveBudgetIdForSyncId(syncId: string): Promise<string> {
  const budgets = await api.getBudgets();
  const match = budgets.find(
    b =>
      typeof b.id === 'string' &&
      (b.groupId === syncId || b.cloudFileId === syncId),
  );
  if (!match?.id) {
    throw new Error(
      `Could not resolve on-disk budget id for syncId ${syncId} after download.`,
    );
  }
  return match.id;
}

export async function withConnection<T>(
  globalOpts: CliGlobalOpts,
  fn: (config: CliConfig) => Promise<T>,
  { mutates, skipBudget = false }: ConnectionOptions,
): Promise<T> {
  const config = await resolveConfig(globalOpts);

  if (config.offline) {
    let cached = config.syncId
      ? readCacheState(getMetaDir(config.dataDir, config.syncId))
      : null;
    if (cached && config.serverUrl && cached.serverUrl !== config.serverUrl) {
      throw new AgentError(
        'MISSING_CONTEXT',
        'The cached budget belongs to a different server.',
      );
    }
    const id = config.budgetId ?? cached?.budgetId;
    if (!id && !skipBudget) {
      throw new AgentError(
        'MISSING_CONTEXT',
        'Offline access needs a local budget ID or a previously downloaded sync budget.',
      );
    }
    await api.init({ dataDir: config.dataDir, verbose: globalOpts.verbose });
    let release: Release | null = null;
    try {
      if (skipBudget) return await fn(config);
      const budgets = await api.getBudgets();
      const selected = budgets.find(b => b.id === id);
      if (!selected?.id) {
        throw new AgentError(
          'MISSING_CONTEXT',
          'The selected budget does not exist in this data directory.',
        );
      }
      const identity =
        selected.groupId ?? config.syncId ?? `local-${selected.id}`;
      const meta = getMetaDir(config.dataDir, identity);
      if (!config.noLock) {
        release = await (mutates ? acquireExclusive : acquireShared)(meta, {
          timeoutMs: config.lockTimeout * 1000,
        });
      }
      cached = readCacheState(meta);
      await api.loadBudget(selected.id, { offline: true });
      const prefs = await api.getPreferences();
      updateAgentContext({
        budgetId: selected.id,
        syncId: selected.groupId ?? null,
        serverUrl: null,
        mode: 'offline-local',
        currency: prefs.defaultCurrencyCode ?? null,
        lastSyncedAt: cached?.lastSyncedAt ?? null,
        freshness: 'unknown',
      });
      const result = await fn(config);
      if (mutates) {
        updateAgentContext({ commit: 'committed-local' });
        if (cached) writeCacheState(meta, { ...cached, lastSyncedAt: 0 });
      }
      return result;
    } finally {
      try {
        await api.shutdown();
      } finally {
        await release?.();
      }
    }
  }

  updateAgentContext({
    syncId: config.syncId ?? null,
    serverUrl: new URL(config.serverUrl).origin,
  });

  info(`Connecting to ${config.serverUrl}...`, globalOpts.verbose);

  if (config.sessionToken) {
    await api.init({
      serverURL: config.serverUrl,
      dataDir: config.dataDir,
      sessionToken: config.sessionToken,
      verbose: globalOpts.verbose,
    });
  } else if (config.password) {
    await api.init({
      serverURL: config.serverUrl,
      dataDir: config.dataDir,
      password: config.password,
      verbose: globalOpts.verbose,
    });
  } else {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Authentication required. Provide --password or --session-token, or set ACTUAL_PASSWORD / ACTUAL_SESSION_TOKEN.',
    );
  }

  try {
    if (skipBudget) return await fn(config);
    if (!config.syncId) {
      throw new AgentError(
        'MISSING_CONTEXT',
        'Sync ID is required for this command. Set --sync-id or ACTUAL_SYNC_ID.',
      );
    }

    const meta = getMetaDir(config.dataDir, config.syncId);
    let release: Release | null = null;
    if (!config.noLock) {
      release = mutates
        ? await acquireExclusive(meta, {
            timeoutMs: config.lockTimeout * 1000,
          })
        : await acquireShared(meta, {
            timeoutMs: config.lockTimeout * 1000,
          });
    }

    try {
      const cachedState = readCacheState(meta);
      const decision = decideSyncAction({
        state: cachedState,
        config: { syncId: config.syncId, serverUrl: config.serverUrl },
        now: Date.now(),
        ttlMs: config.cacheTtl * 1000,
        mutates,
        refresh: config.refresh,
        encrypted: Boolean(config.encryptionPassword),
      });

      let state: CacheState;
      if (decision.action === 'download') {
        info(
          cachedState === null
            ? `Downloading budget ${config.syncId} for the first time...`
            : `Re-downloading budget ${config.syncId} (cache invalidated)...`,
          globalOpts.verbose,
        );
        await api.downloadBudget(config.syncId, {
          password: config.encryptionPassword,
        });
        const budgetId = await resolveBudgetIdForSyncId(config.syncId);
        const now = Date.now();
        state = {
          version: CACHE_VERSION,
          syncId: config.syncId,
          budgetId,
          serverUrl: config.serverUrl,
          lastSyncedAt: now,
          lastDownloadedAt: now,
        };
        writeCacheState(meta, state);
      } else if (decision.action === 'skip') {
        const age = Math.round(
          (Date.now() - decision.state.lastSyncedAt) / 1000,
        );
        info(`Using cached budget (synced ${age}s ago)...`, globalOpts.verbose);
        await api.loadBudget(decision.state.budgetId);
        state = decision.state;
      } else if (config.encryptionPassword) {
        info(`Syncing budget ${config.syncId}...`, globalOpts.verbose);
        // `loadBudget` does not register the end-to-end encryption key, so a
        // later push fails with `encrypt-failure` / `isMissingKey`. Reads still
        // work, which makes the failure look like a broken budget file rather
        // than a missing key. `downloadBudget` registers the key via `key-test`
        // and, when the budget already exists locally, just loads and syncs it
        // instead of re-downloading, so this costs nothing extra.
        await api.downloadBudget(config.syncId, {
          password: config.encryptionPassword,
        });
        state = { ...decision.state, lastSyncedAt: Date.now() };
        writeCacheState(meta, state);
      } else {
        info(`Syncing budget ${config.syncId}...`, globalOpts.verbose);
        await api.loadBudget(decision.state.budgetId);
        await api.sync();
        state = { ...decision.state, lastSyncedAt: Date.now() };
        writeCacheState(meta, state);
      }

      updateAgentContext({
        budgetId: state.budgetId,
        mode: 'remote-cache',
        lastSyncedAt: state.lastSyncedAt,
        freshness: 'observed',
      });
      if (globalOpts.outputVersion === '2') {
        const prefs = await api.getPreferences();
        updateAgentContext({ currency: prefs.defaultCurrencyCode ?? null });
      }
      const result = await fn(config);

      if (mutates) {
        updateAgentContext({ commit: 'committed-local' });
        info(`Pushing changes for ${config.syncId}...`, globalOpts.verbose);
        try {
          await api.sync();
        } catch (error) {
          if (globalOpts.outputVersion !== '2') throw error;
          throw new AgentError(
            'PARTIAL_COMPLETION',
            'Local changes committed, but synchronization failed. Retry synchronization rather than the mutation.',
            true,
          );
        }
        updateAgentContext({ commit: 'synced' });
        state = { ...state, lastSyncedAt: Date.now() };
        writeCacheState(meta, state);
      }

      updateAgentContext({ lastSyncedAt: state.lastSyncedAt });
      return result;
    } finally {
      if (release) await release();
    }
  } finally {
    await api.shutdown();
  }
}
