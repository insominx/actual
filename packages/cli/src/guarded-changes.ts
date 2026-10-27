import { resolve } from 'node:path';

import type * as Api from '@actual-app/api';

import { api } from '#engine';

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
import {
  GUARDED_OPERATIONS,
  isGuardedOperation,
  PAYLOAD_SCOPED_OPERATIONS,
} from './guarded-operations';
import { readJsonInput } from './input';
import { acquireExclusive } from './lock';
import { isEngineAmount, isRecord, stableJson } from './utils';

function publicationAcknowledged(
  outcome: ChangeReceipt['outcome'],
): outcome is Extract<
  Api.BudgetPublicationOutcome,
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
  request: Api.BudgetCreationRequest,
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
    {
      ...opts,
      budgetId: receipt.outcome.affectedIds[0],
      syncId: undefined,
      offline: true,
      refresh: false,
      requireFresh: false,
      cache: true,
    },
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
    {
      ...opts,
      budgetId: receipt.outcome.affectedIds[0],
      syncId: undefined,
      offline: true,
      refresh: false,
      requireFresh: false,
      cache: true,
    },
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
    {
      ...opts,
      budgetId: receipt.outcome.affectedIds[0],
      syncId: undefined,
      offline: true,
      refresh: false,
      requireFresh: false,
      cache: true,
    },
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
  proposal?: Api.BudgetRestoreProposal,
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
    if (validated.archiveId !== artifact.manifest.source.id) {
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
  request: Api.BudgetAmountRequest,
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
  request: Api.CategoryGroupCreationRequest,
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
  request: Api.CategoryCreationRequest,
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

export async function executePayeeCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: Api.PayeeCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 payee creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'payees.create',
    undefined,
    { operationId, data: JSON.stringify(request) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('payeeCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Payee creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.payeeCreation.payeeId, receipt };
}

// Shared direct version 2 path for payee and tag catalog writes. The command
// supplies the exact change ID and payload the changes command would accept.
export async function executeCatalogChange(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  operation:
    | 'payees.update'
    | 'payees.delete'
    | 'payees.merge'
    | 'tags.update'
    | 'tags.delete'
    | 'notes.set'
    | 'preferences.set'
    | 'account-groups.update'
    | 'account-groups.delete'
    | 'rules.update'
    | 'rules.delete'
    | 'schedules.update'
    | 'schedules.delete'
    | 'transactions.delete'
    | 'transactions.split',
  id: string,
  payload: Record<string, unknown>,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      `Version 2 ${operation} requires --operation-id for durable retry.`,
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(opts, operation, id, {
    operationId,
    data: JSON.stringify(payload),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, id, receipt };
}

// Direct version 2 path for guarded operations scoped by their payload, such
// as batch categorization over frozen transaction IDs.
export async function executeScopedChange(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  operation:
    | 'transactions.categorize'
    | 'transactions.update-many'
    | 'transactions.clear'
    | 'transfers.match'
    | 'transfers.unmatch'
    | 'transfers.repair'
    | 'transfers.create'
    | 'imports.mapping-save'
    | 'imports.file'
    | 'rules.apply'
    | 'schedules.post'
    | 'schedules.skip'
    | 'budgets.move'
    | 'budgets.apply-templates'
    | 'reconcile.finish'
    | 'reconcile.adjust'
    | 'transactions.merge'
    | 'budgets.set-type'
    | 'cash-planning.save',
  payload: Record<string, unknown>,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      `Version 2 ${operation} requires --operation-id for durable retry.`,
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(opts, operation, undefined, {
    operationId,
    data: JSON.stringify(payload),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  return { success: true, receipt };
}

export async function executeTagCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: Api.TagCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 tag creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(opts, 'tags.create', undefined, {
    operationId,
    data: JSON.stringify(request),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('tagCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Tag creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.tagCreation.tagId, receipt };
}

export async function executeAccountGroupCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: Api.AccountGroupCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Account group creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'account-groups.create',
    undefined,
    { operationId, data: JSON.stringify(request) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('accountGroupCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Account group creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.accountGroupCreation.groupId, receipt };
}

export async function executeTransactionAddition(
  opts: CliGlobalOpts,
  operationId: string,
  request: Api.TransactionAdditionRequest,
) {
  const prepared = await previewGuardedChange(
    opts,
    'transactions.add',
    request.accountId,
    { operationId, data: JSON.stringify(request.transactions) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('transactionAddition' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Transaction addition has no acknowledged engine identities.',
      false,
      { operationId },
    );
  }
  return { ids: receipt.outcome.transactionAddition.transactionIds, receipt };
}

export async function executeTransactionImport(
  opts: CliGlobalOpts,
  operationId: string,
  request: Api.TransactionImportRequest,
) {
  const prepared = await previewGuardedChange(
    opts,
    'transactions.import',
    request.accountId,
    { operationId, data: JSON.stringify(request.transactions) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('transactionImport' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Transaction import has no acknowledged engine identities.',
      false,
      { operationId },
    );
  }
  return { ...receipt.outcome.transactionImport, receipt };
}

export async function executeScheduleCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: Api.ScheduleCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 schedule creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(
    opts,
    'schedules.create',
    undefined,
    { operationId, data: JSON.stringify(request) },
  );
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('scheduleCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Schedule creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.scheduleCreation.scheduleId, receipt };
}

export async function executeRuleCreation(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: Api.RuleCreationRequest,
) {
  if (!operationId) {
    throw new AgentError(
      'INVALID_INPUT',
      'Version 2 rule creation requires --operation-id for durable retry.',
      false,
      { field: 'operationId' },
    );
  }
  const prepared = await previewGuardedChange(opts, 'rules.create', undefined, {
    operationId,
    data: JSON.stringify(request),
  });
  const receipt = await applyGuardedChange(opts, operationId, {
    token: prepared.token,
  });
  if (
    receipt.outcome?.status !== 'committed-local' ||
    !('ruleCreation' in receipt.outcome)
  ) {
    throw new AgentError(
      'PARTIAL_COMPLETION',
      'Rule creation has no acknowledged engine identity.',
      false,
      { operationId },
    );
  }
  return { id: receipt.outcome.ruleCreation.ruleId, receipt };
}

export async function executeCategoryDeletion(
  opts: CliGlobalOpts,
  operationId: string | undefined,
  request: Api.CategoryDeletionRequest,
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
  request: Api.CategoryGroupDeletionRequest,
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
  request: Api.CategoryUpdateRequest,
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
  request: Api.CategoryGroupUpdateRequest,
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
  request: Api.AccountCloseRequest,
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
  request: Api.AccountUpdateRequest,
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
  request: Api.AccountCreationRequest,
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
  request: Api.BudgetCarryoverRequest,
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
  request: Api.BudgetHoldRequest,
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
  localOnly = false,
) {
  const resolved = await resolveConfig(opts, { connectionOnly, localOnly });
  if (resolved.noLock) {
    throw new AgentError(
      'INVALID_INPUT',
      'Guarded changes require the local cache lock. Remove --no-lock.',
    );
  }
  return resolved;
}

type DomainAdapter = {
  preview: (request: unknown) => Promise<Api.ChangeProposal>;
  apply: (
    proposal: Api.ChangeProposal,
  ) => Promise<NonNullable<ChangeReceipt['outcome']>>;
};

// Explicit per-operation public API methods. Each entry names its canonical
// preview and apply endpoints; there is no universal execute operation.
const DOMAIN_ADAPTERS: Record<string, DomainAdapter> = {
  'transactions.update': {
    preview: r =>
      api.previewTransactionUpdate(r as Api.TransactionUpdateRequest),
    apply: p => api.applyTransactionUpdate(p as Api.TransactionUpdateProposal),
  },
  'category-groups.delete': {
    preview: r =>
      api.previewCategoryGroupDeletion(r as Api.CategoryGroupDeletionRequest),
    apply: p =>
      api.applyCategoryGroupDeletion(p as Api.CategoryGroupDeletionProposal),
  },
  'category-groups.update': {
    preview: r =>
      api.previewCategoryGroupUpdate(r as Api.CategoryGroupUpdateRequest),
    apply: p =>
      api.applyCategoryGroupUpdate(p as Api.CategoryGroupUpdateProposal),
  },
  'category-groups.create': {
    preview: r =>
      api.previewCategoryGroupCreation(r as Api.CategoryGroupCreationRequest),
    apply: p =>
      api.applyCategoryGroupCreation(p as Api.CategoryGroupCreationProposal),
  },
  'categories.create': {
    preview: r => api.previewCategoryCreation(r as Api.CategoryCreationRequest),
    apply: p => api.applyCategoryCreation(p as Api.CategoryCreationProposal),
  },
  'categories.delete': {
    preview: r => api.previewCategoryDeletion(r as Api.CategoryDeletionRequest),
    apply: p => api.applyCategoryDeletion(p as Api.CategoryDeletionProposal),
  },
  'categories.update': {
    preview: r => api.previewCategoryUpdate(r as Api.CategoryUpdateRequest),
    apply: p => api.applyCategoryUpdate(p as Api.CategoryUpdateProposal),
  },
  'payees.create': {
    preview: r => api.previewPayeeCreation(r as Api.PayeeCreationRequest),
    apply: p => api.applyPayeeCreation(p as Api.PayeeCreationProposal),
  },
  'payees.update': {
    preview: r => api.previewPayeeUpdate(r as Api.PayeeUpdateRequest),
    apply: p => api.applyPayeeUpdate(p as Api.PayeeUpdateProposal),
  },
  'payees.delete': {
    preview: r => api.previewPayeeDeletion(r as Api.PayeeDeletionRequest),
    apply: p => api.applyPayeeDeletion(p as Api.PayeeDeletionProposal),
  },
  'payees.merge': {
    preview: r => api.previewPayeeMerge(r as Api.PayeeMergeRequest),
    apply: p => api.applyPayeeMerge(p as Api.PayeeMergeProposal),
  },
  'tags.create': {
    preview: r => api.previewTagCreation(r as Api.TagCreationRequest),
    apply: p => api.applyTagCreation(p as Api.TagCreationProposal),
  },
  'tags.update': {
    preview: r => api.previewTagUpdate(r as Api.TagUpdateRequest),
    apply: p => api.applyTagUpdate(p as Api.TagUpdateProposal),
  },
  'tags.delete': {
    preview: r => api.previewTagDeletion(r as Api.TagDeletionRequest),
    apply: p => api.applyTagDeletion(p as Api.TagDeletionProposal),
  },
  'notes.set': {
    preview: r => api.previewNoteSet(r as Api.NoteSetRequest),
    apply: p => api.applyNoteSet(p as Api.NoteSetProposal),
  },
  'preferences.set': {
    preview: r => api.previewPreferenceSet(r as Api.PreferenceSetRequest),
    apply: p => api.applyPreferenceSet(p as Api.PreferenceSetProposal),
  },
  'account-groups.create': {
    preview: r =>
      api.previewAccountGroupCreation(r as Api.AccountGroupCreationRequest),
    apply: p =>
      api.applyAccountGroupCreation(p as Api.AccountGroupCreationProposal),
  },
  'account-groups.update': {
    preview: r =>
      api.previewAccountGroupUpdate(r as Api.AccountGroupUpdateRequest),
    apply: p =>
      api.applyAccountGroupUpdate(p as Api.AccountGroupUpdateProposal),
  },
  'account-groups.delete': {
    preview: r =>
      api.previewAccountGroupDeletion(r as Api.AccountGroupDeletionRequest),
    apply: p =>
      api.applyAccountGroupDeletion(p as Api.AccountGroupDeletionProposal),
  },
  'rules.create': {
    preview: r => api.previewRuleCreation(r as Api.RuleCreationRequest),
    apply: p => api.applyRuleCreation(p as Api.RuleCreationProposal),
  },
  'rules.update': {
    preview: r => api.previewRuleUpdate(r as Api.RuleUpdateRequest),
    apply: p => api.applyRuleUpdate(p as Api.RuleUpdateProposal),
  },
  'rules.delete': {
    preview: r => api.previewRuleDeletion(r as Api.RuleDeletionRequest),
    apply: p => api.applyRuleDeletion(p as Api.RuleDeletionProposal),
  },
  'schedules.create': {
    preview: r => api.previewScheduleCreation(r as Api.ScheduleCreationRequest),
    apply: p => api.applyScheduleCreation(p as Api.ScheduleCreationProposal),
  },
  'schedules.update': {
    preview: r => api.previewScheduleUpdate(r as Api.ScheduleUpdateRequest),
    apply: p => api.applyScheduleUpdate(p as Api.ScheduleUpdateProposal),
  },
  'schedules.delete': {
    preview: r => api.previewScheduleDeletion(r as Api.ScheduleDeletionRequest),
    apply: p => api.applyScheduleDeletion(p as Api.ScheduleDeletionProposal),
  },
  'transactions.delete': {
    preview: r =>
      api.previewTransactionDeletion(r as Api.TransactionDeletionRequest),
    apply: p =>
      api.applyTransactionDeletion(p as Api.TransactionDeletionProposal),
  },
  'transactions.update-many': {
    preview: r =>
      api.previewTransactionUpdateMany(r as Api.TransactionUpdateManyRequest),
    apply: p =>
      api.applyTransactionUpdateMany(p as Api.TransactionUpdateManyProposal),
  },
  'transactions.categorize': {
    preview: r =>
      api.previewTransactionCategorization(
        r as Api.TransactionCategorizationRequest,
      ),
    apply: p =>
      api.applyTransactionCategorization(
        p as Api.TransactionCategorizationProposal,
      ),
  },
  'transactions.clear': {
    preview: r =>
      api.previewTransactionClearing(r as Api.TransactionClearingRequest),
    apply: p =>
      api.applyTransactionClearing(p as Api.TransactionClearingProposal),
  },
  'imports.mapping-save': {
    preview: r =>
      api.previewImportMappingSave(r as Api.ImportMappingSaveRequest),
    apply: p => api.applyImportMappingSave(p as Api.ImportMappingSaveProposal),
  },
  'rules.apply': {
    preview: r => api.previewRuleApply(r as Api.RuleApplyRequest),
    apply: p => api.applyRuleApply(p as Api.RuleApplyProposal),
  },
  'schedules.post': {
    preview: r => api.previewSchedulePost(r as Api.ScheduleOccurrenceRequest),
    apply: p => api.applySchedulePost(p as Api.SchedulePostProposal),
  },
  'schedules.skip': {
    preview: r => api.previewScheduleSkip(r as Api.ScheduleOccurrenceRequest),
    apply: p => api.applyScheduleSkip(p as Api.ScheduleSkipProposal),
  },
  'budgets.move': {
    preview: r => api.previewBudgetMove(r as Api.BudgetMoveRequest),
    apply: p => api.applyBudgetMove(p as Api.BudgetMoveProposal),
  },
  'budgets.apply-templates': {
    preview: r =>
      api.previewTemplateApplication(r as Api.BudgetTemplatesRequest),
    apply: p => api.applyTemplateApplication(p as Api.BudgetTemplatesProposal),
  },
  'reconcile.finish': {
    preview: r => api.previewReconcileFinish(r as Api.ReconcileFinishRequest),
    apply: p => api.applyReconcileFinish(p as Api.ReconcileFinishProposal),
  },
  'reconcile.adjust': {
    preview: r => api.previewReconcileAdjust(r as Api.ReconcileAdjustRequest),
    apply: p => api.applyReconcileAdjust(p as Api.ReconcileAdjustProposal),
  },
  'imports.file': {
    preview: r => api.previewFileImport(r as Api.ImportFileRequest),
    apply: p => api.applyFileImport(p as Api.ImportFileProposal),
  },
  'transfers.match': {
    preview: r => api.previewTransferMatch(r as Api.TransferMatchRequest),
    apply: p => api.applyTransferMatch(p as Api.TransferMatchProposal),
  },
  'transfers.unmatch': {
    preview: r => api.previewTransferUnmatch(r as Api.TransferUnmatchRequest),
    apply: p => api.applyTransferUnmatch(p as Api.TransferUnmatchProposal),
  },
  'transfers.repair': {
    preview: r => api.previewTransferRepair(r as Api.TransferRepairRequest),
    apply: p => api.applyTransferRepair(p as Api.TransferRepairProposal),
  },
  'transfers.create': {
    preview: r => api.previewTransferCreate(r as Api.TransferCreateRequest),
    apply: p => api.applyTransferCreate(p as Api.TransferCreateProposal),
  },
  'transactions.merge': {
    preview: r => api.previewTransactionMerge(r as Api.TransactionMergeRequest),
    apply: p => api.applyTransactionMerge(p as Api.TransactionMergeProposal),
  },
  'transactions.split': {
    preview: r => api.previewTransactionSplit(r as Api.TransactionSplitRequest),
    apply: p => api.applyTransactionSplit(p as Api.TransactionSplitProposal),
  },
  'cash-planning.save': {
    preview: r => api.previewCashPlanSave(r as Api.CashPlanSaveRequest),
    apply: p => api.applyCashPlanSave(p as Api.CashPlanSaveProposal),
  },
  'transactions.add': {
    preview: r =>
      api.previewTransactionAddition(r as Api.TransactionAdditionRequest),
    apply: p =>
      api.applyTransactionAddition(p as Api.TransactionAdditionProposal),
  },
  'transactions.import': {
    preview: r =>
      api.previewTransactionImport(r as Api.TransactionImportRequest),
    apply: p => api.applyTransactionImport(p as Api.TransactionImportProposal),
  },
  'accounts.close': {
    preview: r => api.previewAccountClosure(r as Api.AccountCloseRequest),
    apply: p => api.applyAccountClosure(p as Api.AccountCloseProposal),
  },
  'accounts.delete': {
    preview: r => api.previewAccountDeletion(r as Api.AccountDeletionRequest),
    apply: p => api.applyAccountDeletion(p as Api.AccountDeletionProposal),
  },
  'accounts.reopen': {
    preview: r => api.previewAccountReopen(r as Api.AccountReopenRequest),
    apply: p => api.applyAccountReopen(p as Api.AccountReopenProposal),
  },
  'accounts.update': {
    preview: r => api.previewAccountUpdate(r as Api.AccountUpdateRequest),
    apply: p => api.applyAccountUpdate(p as Api.AccountUpdateProposal),
  },
  'accounts.create': {
    preview: r => api.previewAccountCreation(r as Api.AccountCreationRequest),
    apply: p => api.applyAccountCreation(p as Api.AccountCreationProposal),
  },
  'budgets.set-amount': {
    preview: r => api.previewBudgetAmount(r as Api.BudgetAmountRequest),
    apply: p => api.applyBudgetAmount(p as Api.BudgetAmountProposal),
  },
  'budgets.set-carryover': {
    preview: r => api.previewBudgetCarryover(r as Api.BudgetCarryoverRequest),
    apply: p => api.applyBudgetCarryover(p as Api.BudgetCarryoverProposal),
  },
  'budgets.hold-next-month': {
    preview: r => api.previewBudgetHold(r as Api.BudgetHoldRequest),
    apply: p => api.applyBudgetHold(p as Api.BudgetHoldProposal),
  },
  'budgets.reset-hold': {
    preview: r => api.previewBudgetHold(r as Api.BudgetHoldRequest),
    apply: p => api.applyBudgetHold(p as Api.BudgetHoldProposal),
  },
  'budgets.set-type': {
    preview: r => api.previewBudgetType(r as Api.BudgetTypeRequest),
    apply: p => api.applyBudgetType(p as Api.BudgetTypeProposal),
  },
  'budgets.rename': {
    preview: r => api.previewBudgetMetadata(r as Api.BudgetMetadataRequest),
    apply: p => api.applyBudgetMetadata(p as Api.BudgetMetadataProposal),
  },
  'budgets.archive': {
    preview: r => api.previewBudgetMetadata(r as Api.BudgetMetadataRequest),
    apply: p => api.applyBudgetMetadata(p as Api.BudgetMetadataProposal),
  },
  'budgets.clone': {
    preview: r => api.previewBudgetClone(r as Api.BudgetCloneRequest),
    apply: p => api.applyBudgetClone(p as Api.BudgetCloneProposal),
  },
};

function domainAdapter(operation: string): DomainAdapter {
  const adapter = Object.prototype.hasOwnProperty.call(
    DOMAIN_ADAPTERS,
    operation,
  )
    ? DOMAIN_ADAPTERS[operation]
    : undefined;
  if (!adapter) {
    throw new AgentError('INVALID_INPUT', 'Unsupported guarded operation.');
  }
  return adapter;
}

function changeRequest(
  operation: string,
  id: string,
  payload: unknown,
):
  | Api.CategoryGroupUpdateRequest
  | Api.CategoryGroupCreationRequest
  | Api.CategoryCreationRequest
  | Api.PayeeCreationRequest
  | Api.PayeeUpdateRequest
  | Api.PayeeDeletionRequest
  | Api.PayeeMergeRequest
  | Api.TagCreationRequest
  | Api.TagUpdateRequest
  | Api.TagDeletionRequest
  | Api.NoteSetRequest
  | Api.PreferenceSetRequest
  | Api.AccountGroupCreationRequest
  | Api.AccountGroupUpdateRequest
  | Api.AccountGroupDeletionRequest
  | Api.RuleCreationRequest
  | Api.RuleUpdateRequest
  | Api.RuleDeletionRequest
  | Api.ScheduleCreationRequest
  | Api.ScheduleUpdateRequest
  | Api.ScheduleDeletionRequest
  | Api.TransactionDeletionRequest
  | Api.TransactionCategorizationRequest
  | Api.TransactionUpdateManyRequest
  | Api.TransactionClearingRequest
  | Api.TransferMatchRequest
  | Api.ImportMappingSaveRequest
  | Api.ImportFileRequest
  | Api.RuleApplyRequest
  | Api.ScheduleOccurrenceRequest
  | Api.BudgetMoveRequest
  | Api.BudgetTemplatesRequest
  | Api.ReconcileFinishRequest
  | Api.ReconcileAdjustRequest
  | Api.TransferUnmatchRequest
  | Api.TransferRepairRequest
  | Api.TransferCreateRequest
  | Api.TransactionMergeRequest
  | Api.TransactionSplitRequest
  | Api.CashPlanSaveRequest
  | Api.TransactionAdditionRequest
  | Api.TransactionImportRequest
  | Api.CategoryGroupDeletionRequest
  | Api.CategoryDeletionRequest
  | Api.CategoryUpdateRequest
  | Api.TransactionUpdateRequest
  | Api.AccountCreationRequest
  | Api.AccountUpdateRequest
  | Api.AccountCloseRequest
  | Api.AccountDeletionRequest
  | Api.AccountReopenRequest
  | Api.BudgetAmountRequest
  | Api.BudgetCarryoverRequest
  | Api.BudgetHoldRequest
  | Api.BudgetTypeRequest
  | Api.BudgetMetadataRequest
  | Api.BudgetCloneRequest
  | Api.BudgetPublicationRequest {
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
    return payload as Api.CategoryGroupCreationRequest;
  }
  if (operation === 'categories.create') {
    return payload as Api.CategoryCreationRequest;
  }
  if (operation === 'payees.create') {
    return payload as Api.PayeeCreationRequest;
  }
  if (operation === 'payees.update') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'name') ||
      typeof payload.name !== 'string'
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Payee update accepts only a name.',
      );
    }
    return { id, fields: { name: payload.name } };
  }
  if (operation === 'payees.merge') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'mergeIds') ||
      !Array.isArray(payload.mergeIds) ||
      !payload.mergeIds.every(value => typeof value === 'string')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Payee merge requires only a mergeIds array; the target is the change ID.',
      );
    }
    return { targetId: id, mergeIds: payload.mergeIds as string[] };
  }
  if (operation === 'cash-planning.save') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'config') ||
      !('config' in payload) ||
      !(payload.config === null || isRecord(payload.config))
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Cash plan save takes only a config object, or null to reset.',
      );
    }
    return payload as Api.CashPlanSaveRequest;
  }
  if (operation === 'transactions.split') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['subtransactions', 'allowReconciled'].includes(key),
      ) ||
      !Array.isArray(payload.subtransactions) ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Split takes a subtransactions array and optional allowReconciled; the transaction is the change ID.',
      );
    }
    return {
      id,
      subtransactions:
        payload.subtransactions as Api.TransactionSplitRequest['subtransactions'],
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'transactions.merge') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['ids', 'allowReconciled'].includes(key),
      ) ||
      !Array.isArray(payload.ids) ||
      payload.ids.length !== 2 ||
      !payload.ids.every(value => typeof value === 'string') ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Merge takes exactly two ids and optional allowReconciled.',
      );
    }
    return {
      ids: [payload.ids[0], payload.ids[1]] as [string, string],
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'imports.mapping-save') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['account', 'format', 'settings', 'reset'].includes(key),
      ) ||
      typeof payload.account !== 'string' ||
      typeof payload.format !== 'string' ||
      !(payload.settings === undefined || isRecord(payload.settings)) ||
      !(payload.reset === undefined || typeof payload.reset === 'boolean')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Import mapping save takes account, format, and settings (object) or reset.',
      );
    }
    return {
      account: payload.account,
      format: payload.format,
      ...(payload.settings === undefined ? {} : { settings: payload.settings }),
      ...(payload.reset === undefined ? {} : { reset: payload.reset }),
    };
  }
  if (operation === 'reconcile.finish') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key =>
          !['accountId', 'statementBalance', 'statementDate', 'ids'].includes(
            key,
          ),
      ) ||
      typeof payload.accountId !== 'string' ||
      !isEngineAmount(payload.statementBalance) ||
      !(
        payload.statementDate === undefined ||
        typeof payload.statementDate === 'string'
      ) ||
      !Array.isArray(payload.ids) ||
      !payload.ids.every(value => typeof value === 'string')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Reconciliation finish takes accountId, statementBalance (stored integer at the budget currency scale), ids (candidate IDs) and optional statementDate.',
      );
    }
    return {
      accountId: payload.accountId,
      statementBalance: payload.statementBalance as number,
      ...(payload.statementDate === undefined
        ? {}
        : { statementDate: payload.statementDate }),
      ids: payload.ids as string[],
    };
  }
  if (operation === 'reconcile.adjust') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['accountId', 'amount', 'date'].includes(key),
      ) ||
      typeof payload.accountId !== 'string' ||
      !isEngineAmount(payload.amount) ||
      !(payload.date === undefined || typeof payload.date === 'string')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Reconciliation adjustment takes accountId, amount (stored integer at the budget currency scale) and optional date.',
      );
    }
    return {
      accountId: payload.accountId,
      amount: payload.amount as number,
      ...(payload.date === undefined ? {} : { date: payload.date }),
    };
  }
  if (operation === 'budgets.move') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key =>
          !['month', 'from', 'to', 'amount', 'allowOverspend'].includes(key),
      ) ||
      typeof payload.month !== 'string' ||
      typeof payload.from !== 'string' ||
      typeof payload.to !== 'string' ||
      !isEngineAmount(payload.amount) ||
      !(
        payload.allowOverspend === undefined ||
        typeof payload.allowOverspend === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Allocation move takes month, from, to (category IDs or to-budget), amount (stored integer at the budget currency scale) and optional allowOverspend.',
      );
    }
    return {
      month: payload.month,
      from: payload.from,
      to: payload.to,
      amount: payload.amount as number,
      ...(payload.allowOverspend === undefined
        ? {}
        : { allowOverspend: payload.allowOverspend }),
    };
  }
  if (operation === 'budgets.apply-templates') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['month', 'categoryIds', 'force'].includes(key),
      ) ||
      typeof payload.month !== 'string' ||
      !(
        payload.categoryIds === undefined ||
        (Array.isArray(payload.categoryIds) &&
          payload.categoryIds.every(value => typeof value === 'string'))
      ) ||
      !(payload.force === undefined || typeof payload.force === 'boolean')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Template application takes month, optional categoryIds and optional force.',
      );
    }
    return {
      month: payload.month,
      ...(payload.categoryIds === undefined
        ? {}
        : { categoryIds: payload.categoryIds as string[] }),
      ...(payload.force === undefined ? {} : { force: payload.force }),
    };
  }
  if (operation === 'schedules.post' || operation === 'schedules.skip') {
    const post = operation === 'schedules.post';
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['id', 'date', ...(post ? ['today'] : [])].includes(key),
      ) ||
      typeof payload.id !== 'string' ||
      typeof payload.date !== 'string' ||
      !(
        payload.today === undefined ||
        (post && typeof payload.today === 'boolean')
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        post
          ? 'Schedule post takes id, date (the next occurrence) and optional today.'
          : 'Schedule skip takes id and date (the next occurrence).',
      );
    }
    return {
      id: payload.id,
      date: payload.date,
      ...(payload.today === undefined ? {} : { today: payload.today }),
    };
  }
  if (operation === 'rules.apply') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['ruleId', 'ids', 'allowReconciled'].includes(key),
      ) ||
      typeof payload.ruleId !== 'string' ||
      !Array.isArray(payload.ids) ||
      !payload.ids.every(value => typeof value === 'string') ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Rule application takes ruleId, ids (transaction IDs) and optional allowReconciled.',
      );
    }
    return {
      ruleId: payload.ruleId,
      ids: payload.ids as string[],
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'imports.file') {
    const opts = isRecord(payload) ? payload.opts : undefined;
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key =>
          ![
            'path',
            'accountId',
            'settings',
            'useSaved',
            'sha256',
            'invalidRows',
            'opts',
            'maxFuzzyDayGap',
            'updateMatched',
          ].includes(key),
      ) ||
      typeof payload.path !== 'string' ||
      typeof payload.accountId !== 'string' ||
      !(payload.settings === undefined || isRecord(payload.settings)) ||
      !(
        payload.useSaved === undefined || typeof payload.useSaved === 'boolean'
      ) ||
      !(payload.sha256 === undefined || typeof payload.sha256 === 'string') ||
      !(
        payload.invalidRows === undefined ||
        payload.invalidRows === 'reject' ||
        payload.invalidRows === 'skip'
      ) ||
      !(opts === undefined || isRecord(opts)) ||
      !(
        payload.maxFuzzyDayGap === undefined ||
        typeof payload.maxFuzzyDayGap === 'number'
      ) ||
      !(
        payload.updateMatched === undefined ||
        typeof payload.updateMatched === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'File import takes path, accountId and optional settings, useSaved, sha256, invalidRows (reject or skip), opts, maxFuzzyDayGap and updateMatched.',
      );
    }
    return payload as Api.ImportFileRequest;
  }
  if (operation === 'transfers.match') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['ids', 'allowReconciled'].includes(key),
      ) ||
      !Array.isArray(payload.ids) ||
      payload.ids.length !== 2 ||
      !payload.ids.every(value => typeof value === 'string') ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Transfer match takes ids (two transaction IDs) and optional allowReconciled.',
      );
    }
    return {
      ids: payload.ids as string[],
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'transfers.create') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['id', 'account', 'allowReconciled'].includes(key),
      ) ||
      typeof payload.id !== 'string' ||
      typeof payload.account !== 'string' ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Transfer create takes id, account and optional allowReconciled.',
      );
    }
    return {
      id: payload.id,
      account: payload.account,
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'transfers.unmatch' || operation === 'transfers.repair') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['id', 'allowReconciled'].includes(key),
      ) ||
      typeof payload.id !== 'string' ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Transfer unmatch and repair take id and optional allowReconciled.',
      );
    }
    return {
      id: payload.id,
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'transactions.clear') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['ids', 'cleared', 'unlock'].includes(key),
      ) ||
      !Array.isArray(payload.ids) ||
      !payload.ids.every(value => typeof value === 'string') ||
      typeof payload.cleared !== 'boolean' ||
      !(payload.unlock === undefined || typeof payload.unlock === 'boolean')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Clearing takes ids, cleared (boolean) and optional unlock.',
      );
    }
    return {
      ids: payload.ids as string[],
      cleared: payload.cleared,
      ...(payload.unlock === undefined ? {} : { unlock: payload.unlock }),
    };
  }
  if (operation === 'transactions.categorize') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['ids', 'category', 'allowReconciled'].includes(key),
      ) ||
      !Array.isArray(payload.ids) ||
      !payload.ids.every(value => typeof value === 'string') ||
      !(payload.category === null || typeof payload.category === 'string') ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Categorization takes ids, category (ID or null) and optional allowReconciled.',
      );
    }
    return {
      ids: payload.ids as string[],
      category: payload.category,
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'transactions.update-many') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['rows', 'allowReconciled'].includes(key),
      ) ||
      !Array.isArray(payload.rows) ||
      !payload.rows.every(isRecord) ||
      !(
        payload.allowReconciled === undefined ||
        typeof payload.allowReconciled === 'boolean'
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Batch update takes rows [{id, notes?, category?, payee?, cleared?}] and optional allowReconciled.',
      );
    }
    return {
      rows: payload.rows as Api.TransactionUpdateManyRequest['rows'],
      ...(payload.allowReconciled === undefined
        ? {}
        : { allowReconciled: payload.allowReconciled }),
    };
  }
  if (operation === 'transactions.add' || operation === 'transactions.import') {
    if (!Array.isArray(payload)) {
      throw new AgentError(
        'INVALID_INPUT',
        'Transaction addition and import take a transactions array; the account is the change ID.',
      );
    }
    return {
      accountId: id,
      transactions: payload as Array<Record<string, unknown>>,
    };
  }
  if (operation === 'schedules.create') {
    return payload as Api.ScheduleCreationRequest;
  }
  if (operation === 'schedules.update') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(
        key => !['fields', 'resetNextDate'].includes(key),
      ) ||
      !isRecord(payload.fields)
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Schedule update takes { fields, resetNextDate? }; the schedule is the change ID.',
      );
    }
    return {
      id,
      fields: payload.fields,
      ...(payload.resetNextDate === undefined
        ? {}
        : { resetNextDate: payload.resetNextDate as boolean }),
    };
  }
  if (operation === 'rules.create') {
    return payload as Api.RuleCreationRequest;
  }
  if (operation === 'rules.update') {
    if (!isRecord(payload) || 'id' in payload) {
      throw new AgentError(
        'INVALID_INPUT',
        'Rule update takes rule fields; the rule is the change ID.',
      );
    }
    return { id, fields: payload as Api.RuleUpdateRequest['fields'] };
  }
  if (
    operation === 'payees.delete' ||
    operation === 'tags.delete' ||
    operation === 'rules.delete' ||
    operation === 'schedules.delete' ||
    operation === 'transactions.delete'
  ) {
    if (isRecord(payload) && Object.keys(payload).length) {
      throw new AgentError(
        'INVALID_INPUT',
        'Deletion takes only the target ID and no payload.',
      );
    }
    return { id };
  }
  if (operation === 'tags.create') {
    return payload as Api.TagCreationRequest;
  }
  if (operation === 'tags.update') {
    if (
      !isRecord(payload) ||
      !Object.keys(payload).length ||
      Object.keys(payload).some(
        key => !['tag', 'color', 'description'].includes(key),
      )
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Tag update requires tag, color or description.',
      );
    }
    return { id, fields: payload as Api.TagUpdateRequest['fields'] };
  }
  if (operation === 'account-groups.create') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'name') ||
      typeof payload.name !== 'string'
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Account group creation takes {"name":"<name>"} and no target ID.',
      );
    }
    return { name: payload.name };
  }
  if (operation === 'account-groups.update') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'name') ||
      typeof payload.name !== 'string'
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Account group update takes {"name":"<name>"}; the group is the change ID.',
      );
    }
    return { id, fields: { name: payload.name } };
  }
  if (operation === 'account-groups.delete') {
    if (isRecord(payload) && Object.keys(payload).length) {
      throw new AgentError(
        'INVALID_INPUT',
        'Deletion takes only the target ID and no payload.',
      );
    }
    return { id };
  }
  if (operation === 'preferences.set') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'value') ||
      !(typeof payload.value === 'string' || payload.value === null)
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Preference change takes {"value":"<text>"} or {"value":null} to reset; the key is the change ID.',
      );
    }
    return { id, value: payload.value };
  }
  if (operation === 'notes.set') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'note') ||
      typeof payload.note !== 'string'
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Note change takes {"note":"<text>"}; the note ID is the change ID.',
      );
    }
    return { id, note: payload.note };
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
      ...(payload as Pick<Api.CategoryDeletionRequest, 'transferCategoryId'>),
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
    return { id, fields: payload as Api.CategoryGroupUpdateRequest['fields'] };
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
    return { id, fields: payload as Api.CategoryUpdateRequest['fields'] };
  }
  if (operation === 'transactions.update') {
    return { id, fields: payload as Api.TransactionUpdateRequest['fields'] };
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
    return { id, fields: payload as Api.AccountUpdateRequest['fields'] };
  }
  if (operation === 'accounts.create') {
    return payload as Api.AccountCreationRequest;
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
  if (operation === 'budgets.set-type') {
    if (
      !isRecord(payload) ||
      Object.keys(payload).some(key => key !== 'type') ||
      (payload.type !== 'envelope' && payload.type !== 'tracking')
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Budget type change accepts only type: envelope or tracking.',
      );
    }
    return { type: payload.type };
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
  if (!isGuardedOperation(operation)) {
    throw new AgentError(
      'INVALID_INPUT',
      `Supported operations: ${GUARDED_OPERATIONS.join(', ')}.`,
    );
  }
  const restores = operation === 'backups.restore';
  if (PAYLOAD_SCOPED_OPERATIONS.includes(operation) && id !== undefined) {
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
  const localOnlyOp = [
    'budgets.create',
    'budgets.clone',
    'budgets.archive',
    'backups.restore',
  ].includes(operation);
  const resolved = await resolveGuardConfig(
    operation === 'budgets.publish' ? { ...opts, offline: false } : opts,
    operation === 'budgets.publish',
    localOnlyOp,
  );
  if (localOnlyOp && !resolved.offline) {
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
          let proposal: Api.ChangeProposal;
          try {
            proposal =
              restores && restore
                ? await api.previewBudgetRestore(
                    await loadRestoreArchive(restore.artifact),
                    restore.request,
                  )
                : creates
                  ? await api.previewBudgetCreation(
                      request as Api.BudgetCreationRequest,
                    )
                  : operation === 'budgets.publish'
                    ? await api.previewBudgetPublication(
                        request as Api.BudgetPublicationRequest,
                      )
                    : await domainAdapter(operation).preview(request);
          } catch (error) {
            // Failures the CLI itself raised while loading and validating a
            // restore archive already carry a specific, safe message.
            if (error instanceof AgentError) {
              throw error;
            }
            // Planner refusals are deliberate APIError objects written for
            // the caller; other failures stay generic to avoid leaking internals.
            const reason =
              isRecord(error) &&
              error.type === 'APIError' &&
              typeof error.message === 'string'
                ? error.message.slice(0, 500)
                : null;
            throw new AgentError(
              'INVALID_INPUT',
              reason
                ? `Cannot preview this change: ${reason}`
                : 'Cannot preview this change. Check the identity, fields, and supported operation scope.',
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
  let resolved = await resolveGuardConfig(opts, true, true);
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
      const localOnlyOp = [
        'budgets.create',
        'budgets.clone',
        'budgets.archive',
        'backups.restore',
      ].includes(receipt.proposal.operation);
      if (receipt.proposal.operation !== 'budgets.publish') {
        resolved = await resolveGuardConfig(opts, false, localOnlyOp);
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
              let recovered: Api.BudgetPublicationOutcome;
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
          if (
            !['budgets.publish', 'budgets.create', 'backups.restore'].includes(
              receipt.proposal.operation,
            )
          ) {
            // Resolve the adapter before recording intent, so an unsupported
            // operation can never become an uncertain receipt.
            domainAdapter(receipt.proposal.operation);
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
                    : await domainAdapter(receipt.proposal.operation).apply(
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
