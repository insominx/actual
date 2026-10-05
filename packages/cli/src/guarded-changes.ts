import { resolve } from 'node:path';

import * as api from '@actual-app/api';

import { AgentError, updateAgentContext } from './agent-output';
import { readBackupArtifact } from './backup-artifacts';
import {
  validateBackupArchive,
  withBackupCancellation,
} from './backup-validation';
import { captureBudgetSnapshot } from './budget-snapshot';
import { getMetaDir } from './cache';
import { validateOperationId, withChangeJournal } from './change-journal';
import type { ChangeReceipt } from './change-journal';
import { resolveConfig } from './config';
import type { CliConfig, CliGlobalOpts } from './config';
import { withConnection } from './connection';
import { readJsonInput } from './input';
import { acquireExclusive } from './lock';
import { isRecord, stableJson } from './utils';

function publicationAcknowledged(
  outcome: ChangeReceipt['outcome'],
): outcome is Extract<
  api.BudgetPublicationOutcome,
  { status: 'committed-local' }
> {
  return outcome?.status === 'committed-local' && 'publication' in outcome;
}

export async function executeBudgetPublication(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  id: string,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 publication requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const config = await resolveGuardConfig({ ...opts, offline: false }, true);
  const prepared = await previewGuardedChange(opts, 'budgets.publish', id, {
    operationId,
    data: JSON.stringify({ encrypted: Boolean(config.encryptionPassword) }),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('publication' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Publication has no acknowledged remote identity.',
      false,
      { operationId },
    );
  }
  const identity = await withGuardedConnection(
    opts,
    config,
    'budgets.publish',
    async () => api.inspectBudget(),
    { mutates: false },
    id,
  );
  return {
    ...identity,
    ...receipt.outcome.publication,
    published: true,
    receipt,
  };
}

function matchesReceiptIdentity(
  receipt: ChangeReceipt,
  identity: Awaited<ReturnType<typeof api.inspectBudget>> | null,
  config: CliConfig,
) {
  if (receipt.proposal.operation === 'budgets.publish') {
    return (
      identity?.id === receipt.proposal.budget.id &&
      (!publicationAcknowledged(receipt.outcome) ||
        (identity.cloudFileId === receipt.outcome.publication.cloudFileId &&
          identity.syncId === receipt.outcome.publication.syncId)) &&
      config.serverUrl.replace(/\/$/, '') ===
        receipt.proposal.references.serverUrl &&
      Boolean(config.encryptionPassword) === receipt.proposal.request.encrypted
    );
  }
  return (
    stableJson(
      identity
        ? {
            id: identity.id,
            syncId: identity.syncId,
            cloudFileId: identity.cloudFileId,
          }
        : null,
    ) === stableJson(receipt.proposal.budget)
  );
}

export async function executeBudgetCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.BudgetCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'budgets.create',
    undefined,
    {
      operationId,
      data: JSON.stringify(request),
    },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !receipt.outcome.affectedIds[0]
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Creation has no acknowledged destination identity.',
      false,
      { operationId },
    );
  }
  const identity = await withConnection(
    { ...opts, budgetId: receipt.outcome.affectedIds[0], syncId: undefined },
    async () => api.inspectBudget(),
    { mutates: false },
  );
  return { ...identity, published: false, receipt };
}

export async function executeBudgetClone(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  name: string,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 cloning requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'budgets.clone',
    undefined,
    { operationId, data: JSON.stringify({ name }) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.proposal.operation !== 'budgets.clone' ||
    receipt.outcome?.status !== 'committed-local' ||
    !receipt.outcome.affectedIds[0]
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Clone has no acknowledged destination identity.',
      false,
      { operationId },
    );
  }
  const identity = await withConnection(
    { ...opts, budgetId: receipt.outcome.affectedIds[0], syncId: undefined },
    async () => api.inspectBudget(),
    { mutates: false },
  );
  return {
    ...identity,
    sourceBudgetId: receipt.proposal.budget.id,
    published: false,
    receipt,
  };
}

export async function executeBudgetRestore(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  path: string,
  name: string,
  timeout: number,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 restore requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'backups.restore',
    undefined,
    { operationId, data: JSON.stringify({ path, name, timeout }) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.proposal.operation !== 'backups.restore' ||
    receipt.outcome?.status !== 'committed-local' ||
    !receipt.outcome.affectedIds[0]
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Restore has no acknowledged destination identity.',
      false,
      { operationId },
    );
  }
  const restored = await withConnection(
    { ...opts, budgetId: receipt.outcome.affectedIds[0], syncId: undefined },
    async () => ({
      ...(await api.inspectBudget()),
      snapshot: await captureBudgetSnapshot(),
    }),
    { mutates: false },
  );
  updateAgentContext({ commit: 'committed-local' });
  return {
    ...restored,
    sourceBudgetId: receipt.proposal.before.sourceId,
    published: false,
    receipt,
  };
}

function restoreInput(payload: unknown) {
  if (
    !isRecord(payload) ||
    Object.keys(payload).some(
      key => !['path', 'name', 'timeout'].includes(key),
    ) ||
    typeof payload.name !== 'string' ||
    typeof payload.path !== 'string' ||
    !payload.path.trim() ||
    payload.path.includes('\0')
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'Restore requires a backup path and destination name.',
    );
  }
  const timeout = payload.timeout ?? 60;
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'Restore validation timeout must be 1 to 120 seconds.',
    );
  }
  return {
    request: { name: payload.name },
    artifact: { path: resolve(payload.path), timeout },
  };
}

async function loadRestoreArchive(
  locator: NonNullable<ChangeReceipt['artifact']>,
  proposal?: api.BudgetRestoreProposal,
) {
  return withBackupCancellation(async signal => {
    const artifact = await readBackupArtifact(locator.path);
    if (
      proposal &&
      (artifact.manifest.sha256 !== proposal.before.sha256 ||
        artifact.manifest.bytes !== proposal.before.bytes ||
        artifact.manifest.source.id !== proposal.before.sourceId)
    ) {
      throw new AgentError(
        'STALE_PREVIEW',
        'The restore archive changed after preview.',
      );
    }
    const validated = await validateBackupArchive(
      artifact.archive,
      locator.timeout,
      signal,
    );
    if (validated.identity.id !== artifact.manifest.source.id) {
      throw new AgentError(
        'INVALID_INPUT',
        'The archive identity differs from its backup manifest.',
      );
    }
    if (signal.aborted) {
      throw new AgentError(
        'INVALID_INPUT',
        'Restore was cancelled before writing.',
      );
    }
    return artifact.archive;
  });
}

async function withGuardedConnection<T>(
  opts: CliGlobalOpts,
  resolved: CliConfig,
  operation: string,
  fn: (config: CliConfig) => Promise<T>,
  options: Parameters<typeof withConnection>[2],
  publicationId?: string,
): Promise<T> {
  if (operation === 'budgets.publish') {
    let server: URL;
    try {
      server = new URL(resolved.serverUrl);
    } catch {
      throw new AgentError(
        'INVALID_INPUT',
        'Publication requires a valid server URL.',
      );
    }
    if (
      server.username ||
      server.password ||
      server.search ||
      server.hash ||
      !['http:', 'https:'].includes(server.protocol)
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Publication server URLs cannot contain user information, query parameters, or fragments.',
      );
    }
    if (
      resolved.offline ||
      opts.offline ||
      !publicationId ||
      opts.syncId ||
      (opts.budgetId && opts.budgetId !== publicationId)
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Publication requires an explicit local ID and online access.',
      );
    }
    let sourceRelease: Awaited<ReturnType<typeof acquireExclusive>> | undefined;
    let lifecycleRelease:
      | Awaited<ReturnType<typeof acquireExclusive>>
      | undefined;
    try {
      return await withConnection(
        opts,
        async config => {
          const source = (await api.getBudgets()).find(
            budget => budget.id === publicationId,
          );
          if (!source?.id) {
            throw new AgentError(
              'MISSING_CONTEXT',
              'Publication source is not in this local data directory.',
            );
          }
          sourceRelease = await acquireExclusive(
            getMetaDir(config.dataDir, source.groupId ?? `local-${source.id}`),
            { timeoutMs: config.lockTimeout * 1000 },
          );
          lifecycleRelease = await acquireExclusive(
            getMetaDir(config.dataDir, 'budget-lifecycle'),
            { timeoutMs: config.lockTimeout * 1000 },
          );
          await api.loadBudget(publicationId);
          const identity = await api.inspectBudget();
          updateAgentContext({
            budgetId: identity.id,
            syncId: identity.syncId,
            serverUrl: config.serverUrl.replace(/\/$/, ''),
            mode: 'remote-cache',
            currency: identity.currency,
            freshness: 'unknown',
            lastSyncedAt: null,
          });
          return fn(config);
        },
        { mutates: false, skipBudget: true, onlineOnly: true },
      );
    } finally {
      await lifecycleRelease?.();
      await sourceRelease?.();
    }
  }
  if (
    !['budgets.create', 'budgets.clone', 'backups.restore'].includes(operation)
  ) {
    return withConnection(opts, fn, options);
  }
  let release: Awaited<ReturnType<typeof acquireExclusive>> | undefined;
  try {
    return await withConnection(
      opts,
      async config => {
        // Match the existing source-lock -> lifecycle-lock order. Keep the
        // lifecycle lock until connection shutdown has finished too.
        release = await acquireExclusive(
          getMetaDir(resolved.dataDir, 'budget-lifecycle'),
          { timeoutMs: resolved.lockTimeout * 1000 },
        );
        return fn(config);
      },
      {
        ...options,
        skipBudget: ['budgets.create', 'backups.restore'].includes(operation),
      },
    );
  } finally {
    await release?.();
  }
}

export async function executeBudgetAmount(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.BudgetAmountRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 allocation writes require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const { categoryId, ...payload } = request;
  const prepared = await previewGuardedChange(
    opts,
    'budgets.set-amount',
    categoryId,
    { operationId, data: JSON.stringify(payload) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, receipt };
}

export async function executeCategoryGroupCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.CategoryGroupCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 category group creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'category-groups.create',
    undefined,
    { operationId, data: JSON.stringify(request) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('groupCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Category group creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.groupCreation.groupId, receipt };
}

export async function executeCategoryCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.CategoryCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 category creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'categories.create',
    undefined,
    { operationId, data: JSON.stringify(request) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('categoryCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Category creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.categoryCreation.categoryId, receipt };
}

export async function executeCategoryDeletion(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.CategoryDeletionRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 category deletion requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'categories.delete',
    request.id,
    {
      operationId,
      data: JSON.stringify({ transferCategoryId: request.transferCategoryId }),
    },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id: request.id, receipt };
}

export async function executeCategoryGroupDeletion(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.CategoryGroupDeletionRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 category group deletion requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'category-groups.delete',
    request.id,
    {
      operationId,
      data: JSON.stringify({ transferCategoryId: request.transferCategoryId }),
    },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id: request.id, receipt };
}

export async function executeCategoryUpdate(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.CategoryUpdateRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 category updates require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'categories.update',
    request.id,
    { operationId, data: JSON.stringify(request.fields) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id: request.id, receipt };
}

export async function executeCategoryGroupUpdate(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.CategoryGroupUpdateRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 category group updates require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'category-groups.update',
    request.id,
    { operationId, data: JSON.stringify(request.fields) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id: request.id, receipt };
}

export async function executeAccountClosure(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.AccountCloseRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 account closure requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'accounts.close',
    request.id,
    {
      operationId,
      data: JSON.stringify({
        transferAccount: request.transferAccountId,
        transferCategory: request.categoryId,
      }),
    },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('accountClosure' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Account closure has no acknowledged engine outcome.',
      false,
      { operationId },
    );
  }
  return {
    success: true,
    id: request.id,
    providerRemovalStatus: receipt.outcome.accountClosure.unlink.remoteStatus,
    receipt,
  };
}

export async function executeAccountDeletion(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  id: string,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 account deletion requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(opts, 'accounts.delete', id, {
    operationId,
    data: '{}',
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('accountClosure' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Account deletion has no acknowledged engine outcome.',
      false,
      { operationId },
    );
  }
  return {
    success: true,
    id,
    providerRemovalStatus: receipt.outcome.accountClosure.unlink.remoteStatus,
    receipt,
  };
}

export async function executeAccountReopen(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  id: string,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 account reopening requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(opts, 'accounts.reopen', id, {
    operationId,
    data: '{}',
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id, receipt };
}

export async function executeAccountUpdate(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.AccountUpdateRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 account updates require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'accounts.update',
    request.id,
    {
      operationId,
      data: JSON.stringify(request.fields),
    },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id: request.id, receipt };
}

export async function executeAccountCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.AccountCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 account creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'accounts.create',
    undefined,
    { operationId, data: JSON.stringify(request) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('accountCreation' in receipt.outcome) ||
    !receipt.outcome.accountCreation.accountId ||
    !receipt.outcome.accountCreation.transferPayeeId
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Account creation has no acknowledged identities. Inspect its receipt before retrying.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.accountCreation.accountId, receipt };
}

export async function executeBudgetCarryover(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.BudgetCarryoverRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 carryover writes require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const { categoryId, ...payload } = request;
  const prepared = await previewGuardedChange(
    opts,
    'budgets.set-carryover',
    categoryId,
    { operationId, data: JSON.stringify(payload) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, receipt };
}

export async function executeBudgetHold(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: api.BudgetHoldRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 hold writes require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const { operation, ...payload } = request;
  const prepared = await previewGuardedChange(opts, operation, undefined, {
    operationId,
    data: JSON.stringify(payload),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, receipt };
}

export async function executeBudgetMetadata(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request:
    | { operation: 'budgets.rename'; name: string }
    | { operation: 'budgets.archive'; archived: boolean },
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 metadata writes require --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const { operation, ...payload } = request;
  const prepared = await previewGuardedChange(opts, operation, undefined, {
    operationId,
    data: JSON.stringify(payload),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  const identity = await withConnection(opts, async () => api.inspectBudget(), {
    mutates: false,
  });
  return { ...identity, receipt };
}

export async function resolveGuardConfig(
  opts: CliGlobalOpts,
  connectionOnly = false,
) {
  const resolved = await resolveConfig(opts, { connectionOnly });
  if (resolved.noLock) {
    throw new AgentError(
      'INVALID_INPUT',
      'Guarded changes require the local cache lock. Remove --no-lock.',
    );
  }
  return resolved;
}

function changeRequest(
  operation: string,
  id: string,
  payload: unknown,
):
  | api.CategoryGroupUpdateRequest
  | api.CategoryGroupCreationRequest
  | api.CategoryCreationRequest
  | api.CategoryGroupDeletionRequest
  | api.CategoryDeletionRequest
  | api.CategoryUpdateRequest
  | api.TransactionUpdateRequest
  | api.AccountCreationRequest
  | api.AccountUpdateRequest
  | api.AccountCloseRequest
  | api.AccountDeletionRequest
  | api.AccountReopenRequest
  | api.BudgetAmountRequest
  | api.BudgetCarryoverRequest
  | api.BudgetHoldRequest
  | api.BudgetMetadataRequest
  | api.BudgetCloneRequest
  | api.BudgetPublicationRequest {
  if (operation === 'budgets.publish') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'encrypted') ||
      typeof payload.encrypted !== 'boolean'
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Publication requires only an encrypted boolean. Provide credentials separately.',
      );
    }
    return { id, encrypted: payload.encrypted };
  }
  if (operation === 'category-groups.create') {
    return payload as api.CategoryGroupCreationRequest;
  }
  if (operation === 'categories.create') {
    return payload as api.CategoryCreationRequest;
  }
  if (
    operation === 'categories.delete' ||
    operation === 'category-groups.delete'
  ) {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'transferCategoryId') ||
      (payload.transferCategoryId !== undefined &&
        (typeof payload.transferCategoryId !== 'string' ||
          !payload.transferCategoryId.trim()))
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Category deletion accepts only an optional transferCategoryId.',
      );
    }
    return {
      id,
      ...(payload as Pick<api.CategoryDeletionRequest, 'transferCategoryId'>),
    };
  }
  if (operation === 'category-groups.update') {
    if (
      !isRecord(payload) ||
      !Object.keys(payload).length ||
      Object.keys(payload).some(
        key =>
          !['id', 'name', 'hidden', 'is_income', 'categories'].includes(key),
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Category group update requires supported group fields.',
      );
    }
    return { id, fields: payload as api.CategoryGroupUpdateRequest['fields'] };
  }
  if (operation === 'categories.update') {
    if (
      !isRecord(payload) ||
      !Object.keys(payload).length ||
      Object.keys(payload).some(
        key => !['id', 'name', 'group_id', 'hidden', 'is_income'].includes(key),
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Category update requires supported category fields.',
      );
    }
    return { id, fields: payload as api.CategoryUpdateRequest['fields'] };
  }
  if (operation === 'transactions.update') {
    return { id, fields: payload as api.TransactionUpdateRequest['fields'] };
  }
  if (operation === 'accounts.close') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['transferAccount', 'transferCategory'].includes(key),
      ) ||
      [payload.transferAccount, payload.transferCategory].some(
        value =>
          value !== undefined && (typeof value !== 'string' || !value.trim()),
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Account closure accepts only optional transferAccount and transferCategory IDs.',
      );
    }
    return {
      id,
      ...(payload.transferAccount === undefined
        ? {}
        : { transferAccountId: String(payload.transferAccount) }),
      ...(payload.transferCategory === undefined
        ? {}
        : { categoryId: String(payload.transferCategory) }),
    };
  }
  if (operation === 'accounts.reopen' || operation === 'accounts.delete') {
    if (!isRecord(payload) || Object.keys(payload).length !== 0) {
      throw new AgentError(
        'INVALID_INPUT',
        'Account reopening and deletion require an empty payload object.',
      );
    }
    return { id };
  }
  if (operation === 'accounts.update') {
    return { id, fields: payload as api.AccountUpdateRequest['fields'] };
  }
  if (operation === 'accounts.create') {
    return payload as api.AccountCreationRequest;
  }
  if (operation === 'budgets.set-amount') {
    return {
      ...(payload as { month: string; amount: number }),
      categoryId: id,
    };
  }
  if (operation === 'budgets.set-carryover') {
    return { ...(payload as { month: string; flag: boolean }), categoryId: id };
  }
  if (operation === 'budgets.clone') {
    return { ...(payload as { name: string }), id };
  }
  if (operation === 'budgets.hold-next-month') {
    return { ...(payload as { month: string; amount: number }), operation };
  }
  if (operation === 'budgets.reset-hold') {
    return { ...(payload as { month: string }), operation };
  }
  if (operation === 'budgets.rename') {
    return { ...(payload as { name: string }), operation, id };
  }
  if (operation === 'budgets.archive') {
    return { ...(payload as { archived: boolean }), operation, id };
  }
  throw new AgentError('INVALID_INPUT', 'Unsupported guarded operation.');
}

export async function previewGuardedChange(
  opts: CliGlobalOpts,
  operation: string,
  id: string | undefined,
  input: { operationId: string; data?: string; file?: string },
): Promise<ChangeReceipt> {
  validateOperationId(input.operationId);
  if (
    ![
      'budgets.create',
      'budgets.clone',
      'backups.restore',
      'budgets.publish',
      'transactions.update',
      'category-groups.delete',
      'categories.delete',
      'category-groups.update',
      'categories.update',
      'category-groups.create',
      'categories.create',
      'accounts.update',
      'accounts.reopen',
      'accounts.delete',
      'accounts.close',
      'accounts.create',
      'budgets.set-amount',
      'budgets.set-carryover',
      'budgets.hold-next-month',
      'budgets.reset-hold',
      'budgets.rename',
      'budgets.archive',
    ].includes(operation)
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'Supported operations: category-groups.delete, category-groups.update, category-groups.create, categories.create, categories.update, categories.delete, accounts.close, accounts.delete, accounts.reopen, accounts.update, accounts.create, budgets.create, budgets.clone, budgets.publish, backups.restore, transactions.update, budgets.set-amount, budgets.set-carryover, budgets.hold-next-month, budgets.reset-hold, budgets.rename, and budgets.archive.',
    );
  }
  const restores = operation === 'backups.restore';
  if (
    [
      'accounts.create',
      'category-groups.create',
      'categories.create',
      'budgets.hold-next-month',
      'budgets.reset-hold',
    ].includes(operation) &&
    id !== undefined
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'This operation selects its scope through the payload. Omit the ID argument.',
    );
  }
  const creates = operation === 'budgets.create' || restores;
  if (creates && id !== undefined) {
    throw new AgentError(
      'INVALID_INPUT',
      'This operation creates a destination. Omit the ID argument.',
    );
  }
  const payload = readJsonInput(input);
  const restore = restores ? restoreInput(payload) : undefined;
  const resolved = await resolveGuardConfig(
    operation === 'budgets.publish' ? { ...opts, offline: false } : opts,
    operation === 'budgets.publish',
  );
  if (
    [
      'budgets.create',
      'budgets.clone',
      'budgets.archive',
      'backups.restore',
    ].includes(operation) &&
    !resolved.offline
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'Local creation, cloning, archiving, and restoration require --offline.',
    );
  }
  return await withChangeJournal(
    resolved.dataDir,
    resolved.lockTimeout,
    async journal => {
      const receipt = await withGuardedConnection(
        { ...opts, refresh: !resolved.offline },
        resolved,
        operation,
        async () => {
          const identity = creates ? null : await api.inspectBudget();
          const request = creates
            ? (restore?.request ?? payload)
            : changeRequest(operation, id ?? identity?.id ?? '', payload);
          const existing = await journal.read(input.operationId);
          if (existing) {
            if (
              !matchesReceiptIdentity(existing, identity, resolved) ||
              stableJson(existing.artifact ?? null) !==
                stableJson(restore?.artifact ?? null) ||
              existing.proposal.operation !== operation ||
              stableJson(existing.proposal.request) !== stableJson(request)
            ) {
              throw new AgentError(
                'INVALID_INPUT',
                'The operation ID already names another budget or request.',
              );
            }
            return existing;
          }
          let proposal: api.ChangeProposal;
          try {
            proposal =
              restores && restore
                ? await api.previewBudgetRestore(
                    await loadRestoreArchive(restore.artifact),
                    restore.request,
                  )
                : creates
                  ? await api.previewBudgetCreation(
                      request as api.BudgetCreationRequest,
                    )
                  : operation === 'budgets.publish'
                    ? await api.previewBudgetPublication(
                        request as api.BudgetPublicationRequest,
                      )
                    : operation === 'budgets.clone'
                      ? await api.previewBudgetClone(
                          request as api.BudgetCloneRequest,
                        )
                      : operation === 'transactions.update'
                        ? await api.previewTransactionUpdate(
                            request as api.TransactionUpdateRequest,
                          )
                        : operation === 'category-groups.delete'
                          ? await api.previewCategoryGroupDeletion(
                              request as api.CategoryGroupDeletionRequest,
                            )
                          : operation === 'category-groups.update'
                            ? await api.previewCategoryGroupUpdate(
                                request as api.CategoryGroupUpdateRequest,
                              )
                            : operation === 'category-groups.create'
                              ? await api.previewCategoryGroupCreation(
                                  request as api.CategoryGroupCreationRequest,
                                )
                              : operation === 'categories.create'
                                ? await api.previewCategoryCreation(
                                    request as api.CategoryCreationRequest,
                                  )
                                : operation === 'categories.delete'
                                  ? await api.previewCategoryDeletion(
                                      request as api.CategoryDeletionRequest,
                                    )
                                  : operation === 'categories.update'
                                    ? await api.previewCategoryUpdate(
                                        request as api.CategoryUpdateRequest,
                                      )
                                    : operation === 'accounts.close'
                                      ? await api.previewAccountClosure(
                                          request as api.AccountCloseRequest,
                                        )
                                      : operation === 'accounts.delete'
                                        ? await api.previewAccountDeletion(
                                            request as api.AccountDeletionRequest,
                                          )
                                        : operation === 'accounts.reopen'
                                          ? await api.previewAccountReopen(
                                              request as api.AccountReopenRequest,
                                            )
                                          : operation === 'accounts.update'
                                            ? await api.previewAccountUpdate(
                                                request as api.AccountUpdateRequest,
                                              )
                                            : operation === 'accounts.create'
                                              ? await api.previewAccountCreation(
                                                  request as api.AccountCreationRequest,
                                                )
                                              : operation ===
                                                  'budgets.set-amount'
                                                ? await api.previewBudgetAmount(
                                                    request as api.BudgetAmountRequest,
                                                  )
                                                : operation ===
                                                    'budgets.set-carryover'
                                                  ? await api.previewBudgetCarryover(
                                                      request as api.BudgetCarryoverRequest,
                                                    )
                                                  : operation ===
                                                        'budgets.hold-next-month' ||
                                                      operation ===
                                                        'budgets.reset-hold'
                                                    ? await api.previewBudgetHold(
                                                        request as api.BudgetHoldRequest,
                                                      )
                                                    : await api.previewBudgetMetadata(
                                                        request as api.BudgetMetadataRequest,
                                                      );
          } catch {
            throw new AgentError(
              'INVALID_INPUT',
              'Cannot preview this change. Check the identity, fields, and supported operation scope.',
            );
          }
          return journal.prepare(
            input.operationId,
            proposal,
            restore?.artifact,
          );
        },
        { mutates: false },
        operation === 'budgets.publish' ? id : undefined,
      );
      return receipt;
    },
  );
}

export async function applyGuardedChange(
  opts: CliGlobalOpts,
  id: string,
  input: { token: string },
): Promise<ChangeReceipt> {
  validateOperationId(id);
  if (!/^[a-f0-9]{64}$/.test(input.token)) {
    throw new AgentError('INVALID_INPUT', 'Provide the exact preview token.');
  }
  let resolved = await resolveGuardConfig(opts, true);
  return await withChangeJournal(
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
      if (receipt.proposal.operation !== 'budgets.publish') {
        resolved = await resolveGuardConfig(opts);
      } else {
        resolved = await resolveGuardConfig({ ...opts, offline: false }, true);
      }
      if (receipt.token !== input.token) {
        throw new AgentError(
          'STALE_PREVIEW',
          'The token does not match this operation.',
        );
      }
      const creates = ['budgets.create', 'backups.restore'].includes(
        receipt.proposal.operation,
      );
      if (
        [
          'budgets.create',
          'budgets.clone',
          'budgets.archive',
          'backups.restore',
        ].includes(receipt.proposal.operation) &&
        !resolved.offline
      ) {
        throw new AgentError(
          'INVALID_INPUT',
          'Local creation, cloning, archiving, and restoration require --offline.',
        );
      }
      const persist = async (state: ChangeReceipt['state']) => {
        receipt.state = state;
        receipt.updatedAt = new Date().toISOString();
        await journal.write(receipt);
      };
      await withGuardedConnection(
        { ...opts, refresh: !resolved.offline },
        resolved,
        receipt.proposal.operation,
        async () => {
          const identity = creates ? null : await api.inspectBudget();
          if (!matchesReceiptIdentity(receipt, identity, resolved)) {
            throw new AgentError(
              'MISSING_CONTEXT',
              'The proposal belongs to another selected budget.',
            );
          }
          if (
            receipt.proposal.operation === 'budgets.create' ||
            receipt.proposal.operation === 'budgets.clone' ||
            receipt.proposal.operation === 'backups.restore'
          ) {
            const proposal = receipt.proposal;
            const acknowledged =
              receipt.outcome?.status === 'committed-local'
                ? receipt.outcome
                : null;
            updateAgentContext({
              budgetId: acknowledged
                ? (acknowledged.affectedIds[0] ?? null)
                : (proposal.budget?.id ?? null),
              syncId: acknowledged ? null : (proposal.budget?.syncId ?? null),
              serverUrl: null,
              mode: 'offline-local',
              currency:
                proposal.operation === 'budgets.create'
                  ? (proposal.request.currency ?? null)
                  : proposal.operation === 'budgets.clone'
                    ? proposal.before.currency
                    : null,
              freshness: 'unknown',
              lastSyncedAt: null,
              commit:
                receipt.state === 'committed-local'
                  ? 'committed-local'
                  : 'none',
            });
          }
          if (receipt.state === 'uncertain') {
            if (receipt.proposal.operation === 'budgets.publish') {
              let recovered: api.BudgetPublicationOutcome;
              try {
                recovered = await api.recoverBudgetPublication(
                  receipt.proposal,
                  {
                    encryptionPassword:
                      resolved.encryptionPassword || undefined,
                  },
                );
              } catch {
                updateAgentContext({ commit: 'uncertain' });
                throw new AgentError(
                  'PARTIAL_COMPLETION',
                  'Remote publication acceptance could not be proven. This receipt remains uncertain without uploading.',
                  false,
                  { operationId: id },
                );
              }
              if (recovered.status === 'rejected') {
                updateAgentContext({ commit: 'uncertain' });
                throw new AgentError(recovered.code, recovered.message, false, {
                  operationId: id,
                });
              }
              receipt.outcome = recovered;
              await persist('synced');
              updateAgentContext({
                budgetId: receipt.proposal.budget.id,
                syncId: recovered.publication.syncId,
                serverUrl: recovered.publication.serverUrl,
                mode: 'remote-cache',
                currency: receipt.proposal.before.currency,
                commit: 'synced',
                freshness: 'observed',
              });
              return;
            }
            updateAgentContext({ commit: 'uncertain' });
            throw new AgentError(
              'PARTIAL_COMPLETION',
              'The prior apply outcome is uncertain. Inspect its receipt and budget; this ID will not replay.',
              false,
              { operationId: id, state: receipt.state },
            );
          }
          if (receipt.state === 'failed-before-commit') {
            throw new AgentError(
              'STALE_PREVIEW',
              'The prior proposal failed before commit. Prepare a new operation ID.',
            );
          }
          if (receipt.state !== 'prepared') {
            if (
              receipt.proposal.operation === 'budgets.publish' &&
              receipt.outcome?.status === 'committed-local' &&
              'publication' in receipt.outcome
            ) {
              if (receipt.state === 'committed-local') {
                try {
                  await persist('synced');
                } catch {
                  updateAgentContext({ commit: 'committed-local' });
                  throw new AgentError(
                    'PARTIAL_COMPLETION',
                    'Publication synchronization was acknowledged, but its final receipt could not be saved. Retry the same operation ID.',
                    false,
                    { operationId: id },
                  );
                }
              }
              updateAgentContext({
                budgetId: receipt.proposal.budget.id,
                syncId: receipt.outcome.publication.syncId,
                serverUrl: receipt.outcome.publication.serverUrl,
                mode: 'remote-cache',
                currency: receipt.proposal.before.currency,
                commit: 'synced',
                freshness: 'unknown',
              });
            }
            return;
          }
          let restoreArchive: Uint8Array | undefined;
          if (receipt.proposal.operation === 'backups.restore') {
            try {
              if (!receipt.artifact) {
                throw new Error('Missing restore artifact locator');
              }
              restoreArchive = await loadRestoreArchive(
                receipt.artifact,
                receipt.proposal,
              );
            } catch {
              await persist('failed-before-commit');
              throw new AgentError(
                'STALE_PREVIEW',
                'The restore input could not be verified before writing. Prepare a new operation ID.',
                false,
                { operationId: id },
              );
            }
          }
          await persist('uncertain');
          let outcome: NonNullable<ChangeReceipt['outcome']>;
          try {
            if (receipt.proposal.operation === 'backups.restore') {
              if (!restoreArchive) {
                throw new Error('Restore input was not validated');
              }
              outcome = await api.applyBudgetRestore(
                receipt.proposal,
                restoreArchive,
              );
            } else {
              outcome =
                receipt.proposal.operation === 'budgets.publish'
                  ? await api.applyBudgetPublication(receipt.proposal, {
                      encryptionPassword:
                        resolved.encryptionPassword || undefined,
                    })
                  : receipt.proposal.operation === 'budgets.create'
                    ? await api.applyBudgetCreation(receipt.proposal)
                    : receipt.proposal.operation === 'budgets.clone'
                      ? await api.applyBudgetClone(receipt.proposal)
                      : receipt.proposal.operation === 'transactions.update'
                        ? await api.applyTransactionUpdate(receipt.proposal)
                        : receipt.proposal.operation ===
                            'category-groups.delete'
                          ? await api.applyCategoryGroupDeletion(
                              receipt.proposal,
                            )
                          : receipt.proposal.operation ===
                              'category-groups.update'
                            ? await api.applyCategoryGroupUpdate(
                                receipt.proposal,
                              )
                            : receipt.proposal.operation ===
                                'category-groups.create'
                              ? await api.applyCategoryGroupCreation(
                                  receipt.proposal,
                                )
                              : receipt.proposal.operation ===
                                  'categories.create'
                                ? await api.applyCategoryCreation(
                                    receipt.proposal,
                                  )
                                : receipt.proposal.operation ===
                                    'categories.delete'
                                  ? await api.applyCategoryDeletion(
                                      receipt.proposal,
                                    )
                                  : receipt.proposal.operation ===
                                      'categories.update'
                                    ? await api.applyCategoryUpdate(
                                        receipt.proposal,
                                      )
                                    : receipt.proposal.operation ===
                                        'accounts.close'
                                      ? await api.applyAccountClosure(
                                          receipt.proposal,
                                        )
                                      : receipt.proposal.operation ===
                                          'accounts.delete'
                                        ? await api.applyAccountDeletion(
                                            receipt.proposal,
                                          )
                                        : receipt.proposal.operation ===
                                            'accounts.reopen'
                                          ? await api.applyAccountReopen(
                                              receipt.proposal,
                                            )
                                          : receipt.proposal.operation ===
                                              'accounts.update'
                                            ? await api.applyAccountUpdate(
                                                receipt.proposal,
                                              )
                                            : receipt.proposal.operation ===
                                                'accounts.create'
                                              ? await api.applyAccountCreation(
                                                  receipt.proposal,
                                                )
                                              : receipt.proposal.operation ===
                                                  'budgets.set-amount'
                                                ? await api.applyBudgetAmount(
                                                    receipt.proposal,
                                                  )
                                                : receipt.proposal.operation ===
                                                    'budgets.set-carryover'
                                                  ? await api.applyBudgetCarryover(
                                                      receipt.proposal,
                                                    )
                                                  : receipt.proposal
                                                        .operation ===
                                                        'budgets.hold-next-month' ||
                                                      receipt.proposal
                                                        .operation ===
                                                        'budgets.reset-hold'
                                                    ? await api.applyBudgetHold(
                                                        receipt.proposal,
                                                      )
                                                    : await api.applyBudgetMetadata(
                                                        receipt.proposal,
                                                      );
            }
          } catch {
            updateAgentContext({ commit: 'uncertain' });
            throw new AgentError(
              'PARTIAL_COMPLETION',
              'The engine response was not acknowledged. This operation remains uncertain and will not replay.',
              false,
              { operationId: id, state: 'uncertain' },
            );
          }
          receipt.outcome = outcome;
          if (outcome.status === 'rejected') {
            await persist('failed-before-commit');
            throw new AgentError(outcome.code, outcome.message, false, {
              operationId: id,
            });
          }
          updateAgentContext({
            commit: 'committed-local',
            ...(['budgets.create', 'budgets.clone', 'backups.restore'].includes(
              receipt.proposal.operation,
            )
              ? { budgetId: outcome.affectedIds[0] ?? null, syncId: null }
              : {}),
          });
          try {
            await persist('committed-local');
            if (
              receipt.proposal.operation === 'budgets.publish' &&
              publicationAcknowledged(outcome)
            ) {
              await persist('synced');
              updateAgentContext({
                budgetId: receipt.proposal.budget.id,
                syncId: outcome.publication.syncId,
                serverUrl: outcome.publication.serverUrl,
                mode: 'remote-cache',
                currency: receipt.proposal.before.currency,
                commit: 'synced',
                freshness: 'observed',
              });
            }
          } catch {
            throw new AgentError(
              'PARTIAL_COMPLETION',
              'Local commit was acknowledged, but the receipt update failed. Inspect the uncertain journal entry before retrying.',
              false,
              { operationId: id },
            );
          }
        },
        {
          mutates: true,
          onSynced: async () => {
            try {
              await persist('synced');
            } catch {
              throw new AgentError(
                'PARTIAL_COMPLETION',
                'Synchronization succeeded, but the receipt update failed. The operation will not replay.',
                false,
                { operationId: id },
              );
            }
          },
        },
        receipt.proposal.operation === 'budgets.publish'
          ? receipt.proposal.budget.id
          : undefined,
      );
      return receipt;
    },
  );
}
