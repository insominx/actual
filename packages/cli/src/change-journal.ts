import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  AccountCloseOutcome,
  AccountCreationOutcome,
  AccountDeletionOutcome,
  AccountGroupCreationOutcome,
  BudgetPublicationOutcome,
  CategoryCreationOutcome,
  CategoryGroupCreationOutcome,
  ChangeProposal,
  PayeeCreationOutcome,
  PayeeMergeOutcome,
  RuleCreationOutcome,
  ScheduleCreationOutcome,
  TagCreationOutcome,
  TransactionAdditionOutcome,
  TransactionImportOutcome,
  TransactionMergeOutcome,
  TransactionSplitOutcome,
  TransactionUpdateOutcome,
  TransferRepairOutcome,
  ImportFileOutcome,
  RuleApplyOutcome,
} from '@actual-app/api';

import { AgentError } from './agent-output';
import { GUARDED_OPERATIONS } from './guarded-operations';
import { acquireExclusive } from './lock';
import { isRecord, stableJson } from './utils';

export type ChangeReceipt = {
  schemaVersion: 1;
  operationId: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  state:
    | 'prepared'
    | 'uncertain'
    | 'committed-local'
    | 'synced'
    | 'failed-before-commit';
  proposal: ChangeProposal;
  outcome?:
    | TransactionUpdateOutcome
    | BudgetPublicationOutcome
    | CategoryGroupCreationOutcome
    | CategoryCreationOutcome
    | PayeeCreationOutcome
    | PayeeMergeOutcome
    | TagCreationOutcome
    | RuleCreationOutcome
    | ScheduleCreationOutcome
    | TransactionAdditionOutcome
    | TransactionImportOutcome
    | AccountCreationOutcome
    | AccountDeletionOutcome
    | AccountCloseOutcome
    | AccountGroupCreationOutcome
    | TransactionMergeOutcome
    | TransactionSplitOutcome
    | TransferRepairOutcome
    | ImportFileOutcome
    | RuleApplyOutcome;
  artifact?: { path: string; timeout: number };
};

function canExpireDeletion(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'accounts.delete') {
    return true;
  }
  const outcome = receipt.outcome;
  if (
    outcome?.status !== 'committed-local' ||
    !('accountClosure' in outcome) ||
    !isRecord(outcome.accountClosure)
  ) {
    return false;
  }
  const closure = outcome.accountClosure;
  const after = receipt.proposal.after;
  return (
    closure.accountId === receipt.proposal.request.id &&
    closure.action === after.action &&
    Array.isArray(closure.addedTransactionIds) &&
    closure.addedTransactionIds.length === 0 &&
    (
      [
        'deletedTransactionIds',
        'updatedTransactionIds',
        'deletedPayeeIds',
      ] satisfies Array<keyof typeof closure & keyof typeof after>
    ).every(
      key =>
        Array.isArray(closure[key]) &&
        closure[key].every(id => typeof id === 'string' && Boolean(id)) &&
        stableJson([...closure[key]].sort()) ===
          stableJson([...after[key]].sort()),
    ) &&
    isRecord(closure.unlink) &&
    typeof closure.unlink.localChanged === 'boolean' &&
    [
      'not-required',
      'skipped-no-token',
      'skipped-other-accounts',
      'acknowledged',
    ].includes(String(closure.unlink.remoteStatus))
  );
}

function canExpireClosure(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'accounts.close') {
    return true;
  }
  const outcome = receipt.outcome;
  if (
    outcome?.status !== 'committed-local' ||
    !('accountClosure' in outcome) ||
    !isRecord(outcome.accountClosure)
  ) {
    return false;
  }
  const closure = outcome.accountClosure;
  const added = closure.addedTransactionIds;
  return (
    closure.accountId === receipt.proposal.request.id &&
    closure.action === receipt.proposal.after.action &&
    Array.isArray(added) &&
    added.every(id => typeof id === 'string' && Boolean(id)) &&
    (receipt.proposal.after.source
      ? added.length === 2 &&
        new Set(added).size === 2 &&
        added.includes(receipt.proposal.after.source.id)
      : added.length === 0) &&
    [
      closure.deletedTransactionIds,
      closure.updatedTransactionIds,
      closure.deletedPayeeIds,
    ].every(ids => Array.isArray(ids) && ids.length === 0) &&
    isRecord(closure.unlink) &&
    typeof closure.unlink.localChanged === 'boolean' &&
    [
      'not-required',
      'skipped-no-token',
      'skipped-other-accounts',
      'acknowledged',
    ].includes(String(closure.unlink.remoteStatus))
  );
}

function canExpireCategoryCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'categories.create') {
    return true;
  }
  const outcome = receipt.outcome;
  if (
    outcome?.status !== 'committed-local' ||
    !('categoryCreation' in outcome) ||
    !isRecord(outcome.categoryCreation)
  ) {
    return false;
  }
  const created = outcome.categoryCreation;
  return (
    typeof created.categoryId === 'string' &&
    Boolean(created.categoryId) &&
    created.mappingId === created.categoryId &&
    Array.isArray(created.updatedCategoryIds) &&
    created.updatedCategoryIds.every(
      id => typeof id === 'string' && Boolean(id),
    ) &&
    stableJson(
      [...created.updatedCategoryIds].sort((left, right) =>
        left.localeCompare(right),
      ),
    ) ===
      stableJson(
        receipt.proposal.after.updatedCategories
          .map(row => row.id)
          .sort((left, right) => left.localeCompare(right)),
      )
  );
}

function canExpireGroupCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'category-groups.create') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'groupCreation' in outcome &&
    isRecord(outcome.groupCreation) &&
    typeof outcome.groupCreation.groupId === 'string' &&
    Boolean(outcome.groupCreation.groupId) &&
    outcome.affectedIds.length === 1 &&
    outcome.affectedIds[0] === outcome.groupCreation.groupId
  );
}

function canExpireTagCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'tags.create') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'tagCreation' in outcome &&
    isRecord(outcome.tagCreation) &&
    typeof outcome.tagCreation.tagId === 'string' &&
    Boolean(outcome.tagCreation.tagId) &&
    outcome.affectedIds.length === 1 &&
    outcome.affectedIds[0] === outcome.tagCreation.tagId
  );
}

function canExpireAccountGroupCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'account-groups.create') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'accountGroupCreation' in outcome &&
    isRecord(outcome.accountGroupCreation) &&
    typeof outcome.accountGroupCreation.groupId === 'string' &&
    Boolean(outcome.accountGroupCreation.groupId) &&
    outcome.affectedIds.length === 1 &&
    outcome.affectedIds[0] === outcome.accountGroupCreation.groupId
  );
}

function canExpireRuleCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'rules.create') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'ruleCreation' in outcome &&
    isRecord(outcome.ruleCreation) &&
    typeof outcome.ruleCreation.ruleId === 'string' &&
    Boolean(outcome.ruleCreation.ruleId) &&
    outcome.affectedIds.length === 1 &&
    outcome.affectedIds[0] === outcome.ruleCreation.ruleId
  );
}

function canExpireScheduleCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'schedules.create') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'scheduleCreation' in outcome &&
    isRecord(outcome.scheduleCreation) &&
    typeof outcome.scheduleCreation.scheduleId === 'string' &&
    Boolean(outcome.scheduleCreation.scheduleId) &&
    typeof outcome.scheduleCreation.ruleId === 'string' &&
    Boolean(outcome.scheduleCreation.ruleId) &&
    outcome.affectedIds.length === 1 &&
    outcome.affectedIds[0] === outcome.scheduleCreation.scheduleId
  );
}

function canExpireTransactionAddition(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'transactions.add') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'transactionAddition' in outcome &&
    isRecord(outcome.transactionAddition) &&
    Array.isArray(outcome.transactionAddition.transactionIds) &&
    outcome.transactionAddition.transactionIds.length > 0 &&
    outcome.transactionAddition.transactionIds.every(
      id => typeof id === 'string' && Boolean(id),
    ) &&
    stableJson(outcome.affectedIds) ===
      stableJson(outcome.transactionAddition.transactionIds)
  );
}

function canExpireTransactionImport(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'transactions.import') return true;
  const outcome = receipt.outcome;
  if (
    outcome?.status !== 'committed-local' ||
    !('transactionImport' in outcome) ||
    !isRecord(outcome.transactionImport)
  ) {
    return false;
  }
  const { addedIds, updatedIds } = outcome.transactionImport;
  return (
    Array.isArray(addedIds) &&
    Array.isArray(updatedIds) &&
    [...addedIds, ...updatedIds].every(
      id => typeof id === 'string' && Boolean(id),
    ) &&
    stableJson(outcome.affectedIds) === stableJson([...addedIds, ...updatedIds])
  );
}

function canExpirePayeeCreation(receipt: ChangeReceipt) {
  if (receipt.proposal.operation !== 'payees.create') return true;
  const outcome = receipt.outcome;
  return (
    outcome?.status === 'committed-local' &&
    'payeeCreation' in outcome &&
    isRecord(outcome.payeeCreation) &&
    typeof outcome.payeeCreation.payeeId === 'string' &&
    Boolean(outcome.payeeCreation.payeeId) &&
    outcome.payeeCreation.mappingId === outcome.payeeCreation.payeeId &&
    outcome.affectedIds.length === 1 &&
    outcome.affectedIds[0] === outcome.payeeCreation.payeeId
  );
}

export function validateOperationId(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) {
    throw new AgentError(
      'INVALID_INPUT',
      'Operation ID must contain 1-80 letters, digits, underscores, or hyphens.',
    );
  }
}

function tokenFor(
  operationId: string,
  proposal: ChangeProposal,
  artifact?: ChangeReceipt['artifact'],
) {
  return createHash('sha256')
    .update(
      stableJson({ operationId, proposal, ...(artifact ? { artifact } : {}) }),
    )
    .digest('hex');
}

export async function withChangeJournal<T>(
  dataDir: string,
  timeout: number,
  fn: (journal: ChangeJournal) => Promise<T>,
) {
  const directory = join(resolve(dataDir), '.actual-cli', 'changes');
  await mkdir(directory, { recursive: true });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    (await realpath(directory)) !== directory
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'The change journal must use a direct local directory.',
    );
  }
  const release = await acquireExclusive(directory, {
    timeoutMs: timeout * 1000,
  });
  try {
    const journal = new ChangeJournal(directory);
    await journal.reconcileStaging();
    return await fn(journal);
  } finally {
    await release();
  }
}

// The caller holds the journal lock for the full preview/apply operation.
export class ChangeJournal {
  constructor(readonly directory: string) {}

  async read(id: string): Promise<ChangeReceipt | null> {
    validateOperationId(id);
    const path = join(this.directory, id + '.json');
    return this.readPath(path, id);
  }

  private async readPath(
    path: string,
    id: string,
  ): Promise<ChangeReceipt | null> {
    try {
      const entry = await lstat(path);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        entry.size > 1024 * 1024
      ) {
        throw new AgentError(
          'INVALID_INPUT',
          'Invalid or oversized change receipt.',
        );
      }
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        value.operationId !== id ||
        typeof value.token !== 'string' ||
        typeof value.createdAt !== 'string' ||
        typeof value.updatedAt !== 'string' ||
        ![
          'prepared',
          'uncertain',
          'committed-local',
          'synced',
          'failed-before-commit',
        ].includes(String(value.state)) ||
        !isRecord(value.proposal) ||
        value.proposal.schemaVersion !== 1 ||
        !GUARDED_OPERATIONS.includes(String(value.proposal.operation))
      ) {
        throw new AgentError(
          'INVALID_INPUT',
          'The change receipt has an unsupported schema.',
        );
      }
      if (
        value.artifact !== undefined &&
        (!isRecord(value.artifact) ||
          Object.keys(value.artifact).some(
            key => !['path', 'timeout'].includes(key),
          ) ||
          typeof value.artifact.path !== 'string' ||
          !value.artifact.path ||
          resolve(value.artifact.path) !== value.artifact.path ||
          typeof value.artifact.timeout !== 'number' ||
          !Number.isSafeInteger(value.artifact.timeout) ||
          value.artifact.timeout < 1 ||
          value.artifact.timeout > 120)
      ) {
        throw new AgentError(
          'INVALID_INPUT',
          'The restore artifact locator is invalid.',
        );
      }
      if (
        (value.proposal.operation === 'backups.restore') !==
        (value.artifact !== undefined)
      ) {
        throw new AgentError(
          'INVALID_INPUT',
          'Artifact locators are required only for restore receipts.',
        );
      }
      const receipt = value as ChangeReceipt;
      if (receipt.token !== tokenFor(id, receipt.proposal, receipt.artifact)) {
        throw new AgentError(
          'INVALID_INPUT',
          'The proposal fingerprint does not match its receipt.',
        );
      }
      return receipt;
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null;
      if (error instanceof AgentError) throw error;
      throw new AgentError(
        'INVALID_INPUT',
        'Cannot read a valid change receipt.',
      );
    }
  }

  async reconcileStaging(limit = 500) {
    if ((await realpath(this.directory)) !== this.directory) {
      throw new AgentError('INVALID_INPUT', 'The change journal path changed.');
    }
    const names = (await readdir(this.directory))
      .filter(name => name.endsWith('.pending'))
      .sort();
    const unresolved: Array<{ path: string; reason: string }> = [];
    let removed = 0;
    // Only this exact generated filename format is eligible for cleanup.
    for (const name of names.slice(0, 500)) {
      const path = join(this.directory, name);
      const match =
        /^([A-Za-z0-9][A-Za-z0-9_-]{0,79})\.([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.pending$/.exec(
          name,
        );
      if (!match) {
        unresolved.push({
          path,
          reason: 'Unmanaged staging filename; preserved.',
        });
        continue;
      }
      try {
        const staged = await this.readPath(path, match[1]);
        const published = await this.read(match[1]);
        if (!staged || !published || staged.token !== published.token) {
          unresolved.push({
            path,
            reason:
              'No matching published proposal; preserved without inferring commit.',
          });
          continue;
        }
        // The published state stays authoritative, even when staged bytes say
        // committed-local. Never infer an acknowledged write from staging.
        await unlink(path);
        removed++;
      } catch (error) {
        if (!(error instanceof AgentError)) throw error;
        unresolved.push({ path, reason: error.message });
      }
    }
    const total = names.length - removed;
    return {
      items: unresolved.slice(0, limit),
      total,
      limit,
      truncated: total > Math.min(limit, unresolved.length),
      blocksMutations: total > 0,
    };
  }

  private async assertNoOrphanStaging() {
    const staging = await this.reconcileStaging();
    if (staging.blocksMutations) {
      throw new AgentError(
        'INVALID_INPUT',
        'Unresolved journal staging files prevent new mutation intent. Inspect changes list before continuing.',
        false,
        { staging },
      );
    }
  }

  async list(limit: number) {
    const staging = await this.reconcileStaging(limit);
    const names = (await readdir(this.directory))
      .filter(name => name.endsWith('.json'))
      .sort();
    if (names.length > 500) {
      throw new AgentError(
        'INVALID_INPUT',
        'The change journal exceeds its 500-record retention bound.',
      );
    }
    const items = [];
    for (const name of names.slice(0, limit)) {
      const receipt = await this.read(name.slice(0, -5));
      if (receipt) items.push(receipt);
    }
    return {
      items,
      total: names.length,
      limit,
      truncated: names.length > limit,
      staging,
    };
  }

  async prepare(
    id: string,
    proposal: ChangeProposal,
    artifact?: ChangeReceipt['artifact'],
  ) {
    validateOperationId(id);
    const existing = await this.read(id);
    const token = tokenFor(id, proposal, artifact);
    if (existing) {
      if (existing.token !== token) {
        throw new AgentError(
          'INVALID_INPUT',
          'The operation ID already names a different proposal.',
        );
      }
      return existing;
    }
    const records = await this.list(500);
    await this.assertNoOrphanStaging();
    const terminal = records.items
      .filter(
        row =>
          (row.state === 'synced' &&
            canExpireDeletion(row) &&
            canExpireClosure(row) &&
            canExpireGroupCreation(row) &&
            canExpirePayeeCreation(row) &&
            canExpireTagCreation(row) &&
            canExpireAccountGroupCreation(row) &&
            canExpireRuleCreation(row) &&
            canExpireScheduleCreation(row) &&
            canExpireTransactionAddition(row) &&
            canExpireTransactionImport(row) &&
            canExpireCategoryCreation(row) &&
            (row.proposal.operation !== 'accounts.create' ||
              (row.outcome?.status === 'committed-local' &&
                'accountCreation' in row.outcome &&
                isRecord(row.outcome.accountCreation) &&
                typeof row.outcome.accountCreation.accountId === 'string' &&
                Boolean(row.outcome.accountCreation.accountId) &&
                typeof row.outcome.accountCreation.transferPayeeId ===
                  'string' &&
                Boolean(row.outcome.accountCreation.transferPayeeId) &&
                (!row.proposal.after.openingTransaction ||
                  (typeof row.outcome.accountCreation.openingTransactionId ===
                    'string' &&
                    Boolean(row.outcome.accountCreation.openingTransactionId) &&
                    typeof row.outcome.accountCreation
                      .startingBalancePayeeId === 'string' &&
                    Boolean(
                      row.outcome.accountCreation.startingBalancePayeeId,
                    ))))) &&
            (row.proposal.operation !== 'budgets.publish' ||
              (row.outcome?.status === 'committed-local' &&
                'publication' in row.outcome &&
                isRecord(row.outcome.publication) &&
                typeof row.outcome.publication.syncId === 'string' &&
                Boolean(row.outcome.publication.syncId) &&
                typeof row.outcome.publication.cloudFileId === 'string' &&
                Boolean(row.outcome.publication.cloudFileId)))) ||
          row.state === 'failed-before-commit' ||
          (row.state === 'committed-local' &&
            row.outcome?.status === 'committed-local' &&
            [
              'budgets.archive',
              'budgets.create',
              'budgets.clone',
              'backups.restore',
            ].includes(row.proposal.operation) &&
            'delivery' in row.proposal &&
            row.proposal.delivery === 'local-only'),
      )
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const expiredBefore = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let count = records.total;
    for (const receipt of terminal) {
      if (count < 500 && Date.parse(receipt.updatedAt) >= expiredBefore) {
        continue;
      }
      // Deleting a journal entry never deletes or reverses budget state.
      await unlink(join(this.directory, receipt.operationId + '.json'));
      count--;
    }
    if (count >= 500) {
      throw new AgentError(
        'INVALID_INPUT',
        'Unresolved receipts fill the journal. Resolve them before preparing another operation.',
      );
    }
    const now = new Date().toISOString();
    const receipt: ChangeReceipt = {
      schemaVersion: 1,
      operationId: id,
      token,
      createdAt: now,
      updatedAt: now,
      state: 'prepared',
      proposal,
      ...(artifact ? { artifact } : {}),
    };
    await this.write(receipt);
    return receipt;
  }

  async write(receipt: ChangeReceipt) {
    validateOperationId(receipt.operationId);
    if (receipt.state === 'prepared' || receipt.state === 'uncertain') {
      await this.assertNoOrphanStaging();
    }
    if ((await realpath(this.directory)) !== this.directory) {
      throw new AgentError('INVALID_INPUT', 'The change journal path changed.');
    }
    const content = JSON.stringify(receipt, null, 2) + '\n';
    if (Buffer.byteLength(content) > 1024 * 1024) {
      throw new AgentError('INVALID_INPUT', 'Change receipt exceeds one MiB.');
    }
    const temporary = join(
      this.directory,
      receipt.operationId + '.' + randomUUID() + '.pending',
    );
    const target = join(this.directory, receipt.operationId + '.json');
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(content);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary);
      throw error;
    }
  }
}
