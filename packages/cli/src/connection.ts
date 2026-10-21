import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import lockfile from 'proper-lockfile';

import { api } from '#engine';

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
  onlineOnly?: boolean;
  onSynced?: () => Promise<void>;
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

// The sync server counts a sign-in as an attempt while it is in flight and
// refuses more than five at once ("too-many-requests"); every refusal also
// stays counted for fifteen minutes, so retrying only deepens the lockout.
// Parallel CLI processes (agents running several tools at once) therefore take
// turns: one machine-wide lock per server covers only the sign-in request.
async function signInOneAtATime(options: Parameters<typeof api.init>[0]) {
  const directory = join(
    tmpdir(),
    `actual-cli-signin-${createHash('sha256')
      .update(String(options?.serverURL))
      .digest('hex')
      .slice(0, 16)}`,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(directory, {
      lockfilePath: join(directory, 'lock'),
      retries: { retries: 150, minTimeout: 50, maxTimeout: 200 },
      stale: 15_000,
    });
  } catch {
    // Could not take the turn (read-only temp directory, stale lock race):
    // sign in anyway, as before.
  }
  try {
    await api.init(options);
  } finally {
    await release?.().catch(() => undefined);
  }
}

// A damaged or unreadable local copy fails in the engine with a generic
// "unknown problem opening" error that the output layer would mask as a
// connection failure. Say what is wrong and what to remove instead. The copy
// is never deleted here: it may hold changes that were never pushed.
async function openCachedBudget(
  config: { dataDir: string; syncId?: string },
  budgetId: string | undefined,
  open: () => Promise<unknown>,
) {
  try {
    await open();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'out-of-sync-migrations' || code === 'out-of-sync-data') {
      throw new AgentError(
        'ENGINE_FAILURE',
        'This budget was last saved by a different version of Actual and cannot be loaded by this CLI. Update the CLI to the version that matches the server, then run the command again.',
        false,
        { issue: 'budget-version-mismatch' },
      );
    }
    if (
      budgetId === undefined ||
      (code !== 'loading-budget' && code !== 'opening-budget')
    ) {
      throw error;
    }
    throw new AgentError(
      'ENGINE_FAILURE',
      `The saved copy of this budget could not be opened and may be damaged. Move or delete the folder ${join(
        config.dataDir,
        budgetId,
      )} and the folder ${join(
        config.dataDir,
        '.actual-cli',
        String(config.syncId),
      )}, then run the command again to download a fresh copy. Changes that were never pushed exist only in the first folder.`,
      false,
      { issue: 'local-budget-unreadable' },
    );
  }
}

export async function withConnection<T>(
  globalOpts: CliGlobalOpts,
  fn: (config: CliConfig) => Promise<T>,
  {
    mutates,
    skipBudget = false,
    onlineOnly = false,
    onSynced,
  }: ConnectionOptions,
): Promise<T> {
  if (onlineOnly && !skipBudget) {
    throw new Error(
      'Online-only initialization requires an explicit lifecycle operation',
    );
  }
  const config = await resolveConfig(
    onlineOnly ? { ...globalOpts, offline: false } : globalOpts,
    { connectionOnly: onlineOnly },
  );

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
    await signInOneAtATime({
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

  let release: Release | null = null;
  try {
    if (skipBudget) return await fn(config);
    if (!config.syncId) {
      throw new AgentError(
        'MISSING_CONTEXT',
        'Sync ID is required for this command. Set --sync-id or ACTUAL_SYNC_ID.',
      );
    }

    const meta = getMetaDir(config.dataDir, config.syncId);
    if (!config.noLock) {
      release = mutates
        ? await acquireExclusive(meta, {
            timeoutMs: config.lockTimeout * 1000,
          })
        : await acquireShared(meta, {
            timeoutMs: config.lockTimeout * 1000,
          });
    }

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
      const { syncId: downloadSyncId } = config;
      await openCachedBudget(config, undefined, () =>
        api.downloadBudget(downloadSyncId, {
          password: config.encryptionPassword,
        }),
      );
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
      const age = Math.round((Date.now() - decision.state.lastSyncedAt) / 1000);
      info(`Using cached budget (synced ${age}s ago)...`, globalOpts.verbose);
      await openCachedBudget(config, decision.state.budgetId, () =>
        api.loadBudget(decision.state.budgetId),
      );
      state = decision.state;
    } else if (config.encryptionPassword) {
      info(`Syncing budget ${config.syncId}...`, globalOpts.verbose);
      // `loadBudget` does not register the end-to-end encryption key, so a
      // later push fails with `encrypt-failure` / `isMissingKey`. Reads still
      // work, which makes the failure look like a broken budget file rather
      // than a missing key. `downloadBudget` registers the key via `key-test`
      // and, when the budget already exists locally, just loads and syncs it
      // instead of re-downloading, so this costs nothing extra.
      const { syncId } = config;
      await openCachedBudget(config, decision.state.budgetId, () =>
        api.downloadBudget(syncId, {
          password: config.encryptionPassword,
        }),
      );
      state = { ...decision.state, lastSyncedAt: Date.now() };
      writeCacheState(meta, state);
    } else {
      info(`Syncing budget ${config.syncId}...`, globalOpts.verbose);
      await openCachedBudget(config, decision.state.budgetId, () =>
        api.loadBudget(decision.state.budgetId),
      );
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
    // Every output version formats amounts with the budget currency scale
    const prefs = await api.getPreferences();
    updateAgentContext({ currency: prefs.defaultCurrencyCode ?? null });
    const result = await fn(config);

    if (mutates) {
      updateAgentContext({ commit: 'committed-local' });
      info(`Pushing changes for ${config.syncId}...`, globalOpts.verbose);
      try {
        await api.sync();
      } catch (error) {
        writeCacheState(meta, { ...state, lastSyncedAt: 0 });
        updateAgentContext({ freshness: 'unknown' });
        if (globalOpts.outputVersion !== '2') throw error;
        throw new AgentError(
          'PARTIAL_COMPLETION',
          'Local changes committed, but synchronization failed. Retry synchronization rather than the mutation.',
          true,
        );
      }
      updateAgentContext({ commit: 'synced' });
      await onSynced?.();
      state = { ...state, lastSyncedAt: Date.now() };
      writeCacheState(meta, state);
    }

    updateAgentContext({ lastSyncedAt: state.lastSyncedAt });
    return result;
  } finally {
    try {
      await api.shutdown();
    } finally {
      await release?.();
    }
  }
}
