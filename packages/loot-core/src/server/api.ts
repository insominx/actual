// @ts-strict-ignore
import { getClock } from '@actual-app/crdt';
import { v4 as uuidv4 } from 'uuid';

import * as asyncStorage from '#platform/server/asyncStorage';
import * as connection from '#platform/server/connection';
import { fetch } from '#platform/server/fetch';
import { logger } from '#platform/server/log';
import * as sqlite from '#platform/server/sqlite';
import { canonicalJson } from '#shared/canonical-json';
import {
  getBankSyncError,
  getDownloadError,
  getSyncError,
  getTestKeyError,
} from '#shared/errors';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import {
  deleteTransaction,
  ungroupTransactions,
  updateTransaction,
} from '#shared/transactions';
import { amountToInteger, integerToAmount } from '#shared/util';
import type {
  AccountCloseOutcome,
  AccountCloseProposal,
  AccountCloseRequest,
  AccountCloseSeed,
  AccountCreationOutcome,
  AccountCreationProposal,
  AccountCreationRequest,
  AccountDeletionOutcome,
  AccountDeletionProposal,
  AccountDeletionRequest,
  AccountReopenProposal,
  AccountReopenRequest,
  AccountUpdateProposal,
  AccountUpdateRequest,
  BudgetAmountProposal,
  BudgetAmountRequest,
  BudgetCarryoverProposal,
  BudgetCarryoverRequest,
  BudgetCloneProposal,
  BudgetCloneRequest,
  BudgetCreationProposal,
  BudgetCreationRequest,
  BudgetHoldProposal,
  BudgetHoldRequest,
  BudgetMetadataProposal,
  BudgetMetadataRequest,
  BudgetPublicationOutcome,
  BudgetPublicationProposal,
  BudgetPublicationRequest,
  BudgetRestoreProposal,
  BudgetRestoreRequest,
  CategoryCreationOutcome,
  CategoryCreationProposal,
  CategoryCreationRequest,
  CategoryDeletionProposal,
  CategoryDeletionRequest,
  CategoryGroupCreationOutcome,
  CategoryGroupCreationProposal,
  CategoryGroupCreationRequest,
  CategoryGroupDeletionProposal,
  CategoryGroupDeletionRequest,
  CategoryGroupUpdateProposal,
  CategoryGroupUpdateRequest,
  CategoryUpdateProposal,
  CategoryUpdateRequest,
  ChangeProposal,
  PayeeCreationOutcome,
  PayeeCreationProposal,
  PayeeCreationRequest,
  TransactionUpdateOutcome,
  TransactionUpdateProposal,
  TransactionUpdateRequest,
} from '#types/change-proposals';
import type { Handlers } from '#types/handlers';
import type {
  AccountEntity,
  CategoryGroupEntity,
  ScheduleEntity,
  TransactionEntity,
} from '#types/models';
import type { ServerHandlers } from '#types/server-handlers';

import {
  inspectAccountClosure,
  makeAccountClosingTransaction,
  performAccountClosure,
} from './accounts/app';
import { inspectStartingBalancePayee } from './accounts/payees';
import { addTransactions } from './accounts/sync';
import {
  accountGroupModel,
  accountModel,
  budgetModel,
  categoryGroupModel,
  categoryModel,
  payeeModel,
  remoteFileModel,
  ruleModel,
  scheduleModel,
  tagModel,
} from './api-models';
import type { APIAccountEntity, APIScheduleEntity } from './api-models';
import { aqlQuery } from './aql';
import {
  inspectBudgetAmount,
  inspectBudgetHold,
  inspectCategoryCarryover,
  isTrackingBudget,
} from './budget/actions';
import {
  inspectCategoryCreation,
  inspectCategoryDeletion,
  inspectCategoryGroupCreation,
  inspectCategoryGroupDeletion,
  createCategory as performCategoryCreation,
  deleteCategory as performCategoryDeletion,
  createCategoryGroup as performCategoryGroupCreation,
  deleteCategoryGroup as performCategoryGroupDeletion,
  updateCategoryGroup as performCategoryGroupUpdate,
  updateCategory as performCategoryUpdate,
  prepareCategoryGroupUpdate,
  prepareCategoryUpdate,
} from './budget/app';
import {
  copySourceIgnoredTables,
  inspectCopySource,
} from './budgetfiles/copy-source';
import { inspectCatalog } from './catalog-inspect';
import * as cloudStorage from './cloud-storage';
import type { RemoteFile } from './cloud-storage';
import * as db from './db';
import { APIError, withErrorCode } from './errors';
import { guardedApply, guardedSourceHash } from './guarded-proposal';
import { importActual } from './importers/actual';
import { runMutator } from './mutators';
import {
  performNoteSet,
  prepareNoteSet,
  readNote,
  resolveNoteTarget,
} from './notes/guarded';
import {
  inspectPayeeCreation,
  createPayee as performPayeeCreation,
} from './payees/app';
import {
  performPayeeDeletion,
  performPayeeMerge,
  performPayeeUpdate,
  preparePayeeDeletion,
  preparePayeeMerge,
  preparePayeeUpdate,
} from './payees/guarded';
import {
  inspectPreferences,
  performPreferenceSet,
  preparePreferenceSet,
} from './preferences/catalog';
import * as prefs from './prefs';
import {
  performRuleCreation,
  performRuleDeletion,
  performRuleUpdate,
  prepareRuleCreation,
  prepareRuleDeletion,
  prepareRuleUpdate,
} from './rules/guarded';
import { applyApiScheduleFields } from './schedules/api-fields';
import {
  performScheduleCreation,
  performScheduleDeletion,
  performScheduleUpdate,
  prepareScheduleCreation,
  prepareScheduleDeletion,
  prepareScheduleUpdate,
} from './schedules/guarded';
import { getServer } from './server-config';
import * as sheet from './sheet';
import { batchMessages, getSyncStatus, setSyncingMode } from './sync';
import {
  performTagCreation,
  performTagDeletion,
  performTagUpdate,
  prepareTagCreation,
  prepareTagDeletion,
  prepareTagUpdate,
} from './tags/guarded';
import {
  performTransactionAddition,
  prepareTransactionAddition,
} from './transactions/guarded-add';
import {
  performTransactionDeletion,
  prepareTransactionDeletion,
} from './transactions/guarded-delete';
import {
  performTransactionImport,
  prepareTransactionImport,
} from './transactions/guarded-import';
import { planLinkedTransferUpdate } from './transactions/linked-transfer-plan';
import {
  getTransferredAccount,
  inspectTransferUpdate,
  prepareTransferTransaction,
  transferClearsCategory,
} from './transactions/transfer';

let IMPORT_MODE = false;

// The API is different in two ways: we never want undo enabled, and
// we also need to notify the UI manually if stuff has changed (if
// they are connecting to an already running instance, the UI should
// update). The wrapper handles that.
function withMutation<Params extends Array<unknown>, ReturnType>(
  handler: (...args: Params) => Promise<ReturnType>,
) {
  return (...args: Params) => {
    return runMutator(
      async () => {
        const latestTimestamp = getClock().timestamp.toString();
        const result = await handler(...args);

        const rows = await db.all<Pick<db.DbCrdtMessage, 'dataset'>>(
          'SELECT DISTINCT dataset FROM messages_crdt WHERE timestamp > ?',
          [latestTimestamp],
        );

        // Only send the sync event if anybody else is connected
        if (connection.getNumClients() > 1) {
          connection.send('sync-event', {
            type: 'success',
            tables: rows.map(row => row.dataset),
          });
        }

        return result;
      },
      { undoDisabled: true },
    );
  };
}

let handlers = {} as unknown as Handlers;

async function validateMonth(month) {
  if (!month.match(/^\d{4}-\d{2}$/)) {
    throw APIError('Invalid month format, use YYYY-MM: ' + month);
  }

  if (!IMPORT_MODE) {
    const { start, end } = await handlers['get-budget-bounds']();
    const range = monthUtils.range(start, end);
    if (!range.includes(month)) {
      throw APIError('No budget exists for month: ' + month);
    }
  }
}

async function validateExpenseCategory(debug, id) {
  if (id == null) {
    throw APIError(`${debug}: category id is required`);
  }

  const row = await db.first<Pick<db.DbCategory, 'is_income'>>(
    'SELECT is_income FROM categories WHERE id = ?',
    [id],
  );

  if (!row) {
    throw APIError(`${debug}: category "${id}" does not exist`);
  }

  if (row.is_income !== 0) {
    throw APIError(`${debug}: category "${id}" is not an expense category`);
  }
}

function checkFileOpen() {
  if (!(prefs.getPrefs() || {}).id) {
    throw APIError('No budget file is open');
  }
}

let batchPromise = null;

handlers['api/batch-budget-start'] = async function () {
  if (batchPromise) {
    throw APIError('Cannot start a batch process: batch already started');
  }

  // If we are importing, all we need to do is start a raw database
  // transaction. Updating spreadsheet cells doesn't go through the
  // syncing layer in that case.
  if (IMPORT_MODE) {
    void db.asyncTransaction(() => {
      return new Promise((resolve, reject) => {
        batchPromise = { resolve, reject };
      });
    });
  } else {
    void batchMessages(() => {
      return new Promise((resolve, reject) => {
        batchPromise = { resolve, reject };
      });
    });
  }
};

handlers['api/batch-budget-end'] = async function () {
  if (!batchPromise) {
    throw APIError('Cannot end a batch process: no batch started');
  }

  batchPromise.resolve();
  batchPromise = null;
};

handlers['api/load-budget'] = async function ({ id, offline = false }) {
  if (offline && getServer()) {
    throw APIError(
      'Offline budget loading requires initialization without a server',
    );
  }
  const { id: currentId } = prefs.getPrefs() || {};

  if (currentId !== id) {
    connection.send('start-load');
    const { error } = await handlers['load-budget']({ id });

    if (!error) {
      // The budgetfile loader disables synchronization without a server.
      // API offline sessions must still record CRDT messages for later sync.
      connection.send('finish-load');
    } else {
      connection.send('show-budgets');

      throw withErrorCode(new Error(getSyncError(error, id)), error);
    }
  }
  if (offline) setSyncingMode('offline');
};

handlers['api/download-budget'] = async function ({ syncId, password }) {
  const { id: currentId } = prefs.getPrefs() || {};
  if (currentId) {
    await handlers['close-budget']();
  }

  const budgets = await handlers['get-budgets']();
  const localBudget = budgets.find(b => b.groupId === syncId);
  let remoteBudget: RemoteFile;

  // Load a remote file if we could not find the file locally
  if (!localBudget) {
    const files = await handlers['get-remote-files']();
    if (!files) {
      throw withErrorCode(
        new Error('Could not get remote files'),
        'network-failure',
      );
    }
    const file = files.find(f => f.groupId === syncId);
    if (!file) {
      throw withErrorCode(
        new Error(
          `Budget "${syncId}" not found. Check the sync id of your budget in the Advanced section of the settings page.`,
        ),
        'budget-not-found',
      );
    }

    remoteBudget = file;
  }

  const activeFile = remoteBudget ? remoteBudget : localBudget;

  // Set the e2e encryption keys
  if (activeFile.encryptKeyId) {
    if (!password) {
      throw withErrorCode(
        new Error(
          `File ${activeFile.name} is encrypted. Please provide a password.`,
        ),
        'missing-key',
      );
    }

    const result = await handlers['key-test']({
      cloudFileId: remoteBudget ? remoteBudget.fileId : localBudget.cloudFileId,
      password,
    });
    if (result.error) {
      throw withErrorCode(
        new Error(getTestKeyError(result.error)),
        result.error.reason,
      );
    }
  }

  // Sync the local budget file
  if (localBudget) {
    await handlers['load-budget']({ id: localBudget.id });
    const result = await handlers['sync-budget']();
    if (result.error) {
      throw withErrorCode(
        new Error(
          getSyncError(result.error.reason, localBudget.id, result.error.meta),
        ),
        result.error.reason,
      );
    }
    return;
  }

  // Download the remote file (no need to perform a sync as the file will already be up-to-date)
  const result = await handlers['download-budget']({
    cloudFileId: remoteBudget.fileId,
  });
  if (result.error) {
    logger.log('Full error details', result.error);
    throw withErrorCode(
      new Error(getDownloadError(result.error)),
      result.error.reason,
    );
  }
  await handlers['load-budget']({ id: result.id });
};

handlers['api/get-budgets'] = async function () {
  const budgets = await handlers['get-budgets']();
  const files = (await handlers['get-remote-files']()) || [];
  return [
    ...budgets.map(file => budgetModel.toExternal(file)),
    ...files.map(file => remoteFileModel.toExternal(file)).filter(file => file),
  ];
};

async function performBudgetCreation({
  name,
  currency,
}: BudgetCreationRequest) {
  if (typeof name !== 'string') {
    throw APIError('Budget name must be a string');
  }
  const { valid, message } = await handlers['validate-budget-name']({ name });
  if (!valid) {
    throw withErrorCode(new Error(message), 'invalid-budget-name');
  }
  if (
    currency !== undefined &&
    (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
  ) {
    throw APIError('Currency must be an uppercase three-letter code');
  }

  await handlers['close-budget']();
  const result = await handlers['create-budget']({
    budgetName: name.trim(),
    avoidUpload: true,
  });
  if (result.error) {
    throw withErrorCode(
      new Error('Local budget creation failed'),
      result.error,
    );
  }
  const { id } = prefs.getPrefs();
  try {
    if (!getServer()) setSyncingMode('offline');
    if (currency !== undefined) {
      await handlers['preferences/save']({
        id: 'defaultCurrencyCode',
        value: currency,
      });
    }
    return { id };
  } catch (error) {
    await handlers['close-budget']();
    const cleanup = await handlers['delete-budget']({ id });
    if (cleanup !== 'ok') {
      throw withErrorCode(
        new Error('Budget creation failed and local cleanup was incomplete'),
        'creation-cleanup-failed',
      );
    }
    throw error;
  }
}

// Creation switches the loaded database. It cannot use withMutation's
// before/after query on one existing database, or nest a currency mutator.
handlers['api/create-budget'] = request =>
  runMutator(() => performBudgetCreation(request), { undoDisabled: true });

async function prepareBudgetCreation(
  request: BudgetCreationRequest,
): Promise<BudgetCreationProposal> {
  if (getServer()) {
    throw APIError(
      'Guarded local creation requires initialization without a server',
    );
  }
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some(key => !['name', 'currency'].includes(key)) ||
    typeof request.name !== 'string' ||
    (request.currency !== undefined &&
      (typeof request.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(request.currency)))
  ) {
    throw APIError('Invalid budget creation request');
  }
  const { valid, message } = await handlers['validate-budget-name']({
    name: request.name,
  });
  if (!valid) throw withErrorCode(new Error(message), 'invalid-budget-name');
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'budgets.create',
      delivery: 'local-only',
      budget: null,
      request,
      before: { exists: false },
      after: {
        name: request.name.trim(),
        currency: request.currency ?? null,
        published: false,
      },
      references: { nameAvailable: true },
      sideEffects: [
        'new local budget directory and identity; destination becomes loaded; no remote publication',
      ],
    }),
  );
}
handlers['api/budget-preview-creation'] = request =>
  runMutator(() => prepareBudgetCreation(request), { undoDisabled: true });
handlers['api/budget-apply-creation'] = proposal =>
  runMutator(
    async (): Promise<TransactionUpdateOutcome> => {
      if (
        !proposal ||
        proposal.schemaVersion !== 1 ||
        proposal.operation !== 'budgets.create' ||
        proposal.delivery !== 'local-only' ||
        proposal.budget !== null
      ) {
        return {
          status: 'rejected',
          code: 'INVALID_INPUT',
          message: 'Unsupported budget creation proposal',
        };
      }
      let current: BudgetCreationProposal;
      try {
        current = await prepareBudgetCreation(proposal.request);
      } catch {
        return {
          status: 'rejected',
          code: 'STALE_PREVIEW',
          message:
            'Budget creation context or name availability changed after preview',
        };
      }
      if (canonicalJson(current) !== canonicalJson(proposal)) {
        return {
          status: 'rejected',
          code: 'STALE_PREVIEW',
          message: 'Budget creation proposal changed after preview',
        };
      }
      const created = await performBudgetCreation(current.request);
      return {
        status: 'committed-local',
        changed: true,
        checkpoint: getClock().timestamp.toString(),
        affectedIds: [created.id],
      };
    },
    { undoDisabled: true },
  );

handlers['api/inspect-budget'] = async function () {
  checkFileOpen();
  const metadata = prefs.getPrefs();
  const preferences = await handlers['preferences/get']();
  return {
    id: metadata.id,
    name: metadata.budgetName,
    syncId: metadata.groupId ?? null,
    cloudFileId: metadata.cloudFileId ?? null,
    encryptKeyId: metadata.encryptKeyId ?? null,
    currency: preferences.defaultCurrencyCode ?? null,
    archived: metadata.archived ?? false,
    publicationStatus: metadata.publication?.status ?? null,
  };
};

async function performBudgetRestore({
  buffer,
  name,
}: {
  buffer: ArrayBuffer;
  name: string;
}) {
  if (getServer()) {
    throw APIError('Local restore requires initialization without a server');
  }
  if (typeof name !== 'string') throw APIError('Budget name must be a string');
  const { valid, message } = await handlers['validate-budget-name']({ name });
  if (!valid) throw withErrorCode(new Error(message), 'invalid-budget-name');
  const result = await importActual('', Buffer.from(buffer), {
    newName: name.trim(),
  });
  if (result.error) throw new Error('Restore failed: ' + result.error);
  return { id: result.id };
}
handlers['api/restore-budget'] = request =>
  runMutator(() => performBudgetRestore(request), { undoDisabled: true });

async function prepareBudgetRestore(
  buffer: ArrayBuffer,
  request: BudgetRestoreRequest,
): Promise<BudgetRestoreProposal> {
  if (getServer()) {
    throw APIError(
      'Guarded local restore requires initialization without a server',
    );
  }
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some(key => key !== 'name') ||
    typeof request.name !== 'string'
  ) {
    throw APIError('Invalid budget restore request');
  }
  const { valid, message } = await handlers['validate-budget-name']({
    name: request.name,
  });
  if (!valid) throw withErrorCode(new Error(message), 'invalid-budget-name');
  const bytes = new Uint8Array(buffer).slice();
  const { dbContent, meta } = cloudStorage.readBudgetArchive(bytes);
  if (
    !meta ||
    typeof meta !== 'object' ||
    typeof meta.id !== 'string' ||
    !meta.id
  ) {
    throw APIError('Archive has no source identity');
  }
  const database = await sqlite.openDatabase(dbContent);
  try {
    const integrity = sqlite.runQuery(database, 'PRAGMA quick_check', [], true);
    if (
      !Array.isArray(integrity) ||
      integrity.length !== 1 ||
      Object.values(integrity[0]).some(value => value !== 'ok')
    ) {
      throw APIError('Archive database integrity check failed');
    }
    // The canonical restore clears these tables before loading the destination.
    sqlite.execQuery(
      database,
      'SELECT count(*) FROM kvcache; SELECT count(*) FROM kvcache_key;',
    );
  } finally {
    sqlite.closeDatabase(database);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'backups.restore',
      delivery: 'local-only',
      budget: null,
      request,
      before: {
        sha256,
        bytes: bytes.byteLength,
        sourceId: meta.id,
      },
      after: { name: request.name.trim(), published: false },
      references: { nameAvailable: true },
      sideEffects: [
        'new local restored directory and identity; destination becomes loaded; original budgets preserved; no remote publication',
      ],
    }),
  );
}
handlers['api/budget-preview-restore'] = ({ buffer, request }) =>
  runMutator(() => prepareBudgetRestore(buffer, request), {
    undoDisabled: true,
  });
handlers['api/budget-apply-restore'] = ({ buffer, proposal }) =>
  runMutator(
    async (): Promise<TransactionUpdateOutcome> => {
      if (
        !proposal ||
        proposal.schemaVersion !== 1 ||
        proposal.operation !== 'backups.restore' ||
        proposal.delivery !== 'local-only' ||
        proposal.budget !== null
      ) {
        return {
          status: 'rejected',
          code: 'INVALID_INPUT',
          message: 'Unsupported budget restore proposal',
        };
      }
      const snapshot = buffer.slice(0);
      let current: BudgetRestoreProposal;
      try {
        current = await prepareBudgetRestore(snapshot, proposal.request);
      } catch {
        return {
          status: 'rejected',
          code: 'STALE_PREVIEW',
          message:
            'Restore input or destination name availability changed after preview',
        };
      }
      if (canonicalJson(current) !== canonicalJson(proposal)) {
        return {
          status: 'rejected',
          code: 'STALE_PREVIEW',
          message: 'Restore archive or proposal changed after preview',
        };
      }
      const restored = await performBudgetRestore({
        buffer: snapshot,
        name: current.request.name,
      });
      return {
        status: 'committed-local',
        changed: true,
        checkpoint: getClock().timestamp.toString(),
        affectedIds: [restored.id],
      };
    },
    { undoDisabled: true },
  );

async function performBudgetClone({ name }: { name: string }) {
  checkFileOpen();
  if (getServer()) {
    throw APIError('Local cloning requires initialization without a server');
  }
  if (typeof name !== 'string') throw APIError('Budget name must be a string');
  const { valid, message } = await handlers['validate-budget-name']({ name });
  if (!valid) {
    throw withErrorCode(new Error(message), 'invalid-budget-name');
  }
  const { id: originalId } = prefs.getPrefs();
  // Close the source so duplication copies a complete SQLite snapshot.
  await handlers['close-budget']();
  const id = await handlers['duplicate-budget']({
    id: originalId,
    newName: name.trim(),
    cloudSync: false,
    open: 'copy',
  });
  setSyncingMode('offline');
  return { id };
}

handlers['api/clone-budget'] = request =>
  runMutator(() => performBudgetClone(request), { undoDisabled: true });

async function prepareBudgetClone(
  request: BudgetCloneRequest,
): Promise<BudgetCloneProposal> {
  checkFileOpen();
  if (getServer()) {
    throw APIError(
      'Guarded local cloning requires initialization without a server',
    );
  }
  const metadata = prefs.getPrefs();
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some(key => !['id', 'name'].includes(key)) ||
    request.id !== metadata.id ||
    typeof request.name !== 'string'
  ) {
    throw APIError(
      'Clone requires the selected source identity and a destination name',
    );
  }
  const { valid, message } = await handlers['validate-budget-name']({
    name: request.name,
  });
  if (!valid) throw withErrorCode(new Error(message), 'invalid-budget-name');
  const preferences = await handlers['preferences/get']();
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'budgets.clone',
      delivery: 'local-only',
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before: {
        sourceHash: await inspectCopySource(request.name.trim()),
        name: metadata.budgetName,
        currency: preferences.defaultCurrencyCode ?? null,
        archived: metadata.archived ?? false,
      },
      after: { name: request.name.trim(), published: false },
      references: {
        nameAvailable: true,
        ignoredTables: [...copySourceIgnoredTables],
      },
      sideEffects: [
        'new local copy and identity; destination becomes loaded; no remote publication',
      ],
    }),
  );
}
handlers['api/budget-preview-clone'] = request =>
  runMutator(() => prepareBudgetClone(request), { undoDisabled: true });
handlers['api/budget-apply-clone'] = proposal =>
  runMutator(
    async (): Promise<TransactionUpdateOutcome> => {
      checkFileOpen();
      const metadata = prefs.getPrefs();
      if (
        !proposal ||
        proposal.schemaVersion !== 1 ||
        proposal.operation !== 'budgets.clone' ||
        proposal.delivery !== 'local-only'
      ) {
        return {
          status: 'rejected',
          code: 'INVALID_INPUT',
          message: 'Unsupported clone proposal',
        };
      }
      if (
        canonicalJson(proposal.budget) !==
        canonicalJson({
          id: metadata.id,
          syncId: metadata.groupId ?? null,
          cloudFileId: metadata.cloudFileId ?? null,
        })
      ) {
        return {
          status: 'rejected',
          code: 'MISSING_CONTEXT',
          message: 'Clone proposal belongs to another source identity',
        };
      }
      let current: BudgetCloneProposal;
      try {
        current = await prepareBudgetClone(proposal.request);
      } catch {
        return {
          status: 'rejected',
          code: 'STALE_PREVIEW',
          message:
            'Clone source context or destination name availability changed after preview',
        };
      }
      if (canonicalJson(current) !== canonicalJson(proposal)) {
        return {
          status: 'rejected',
          code: 'STALE_PREVIEW',
          message: 'Copied source state changed after preview',
        };
      }
      const destination = await performBudgetClone(current.request);
      return {
        status: 'committed-local',
        changed: true,
        checkpoint: getClock().timestamp.toString(),
        affectedIds: [destination.id],
      };
    },
    { undoDisabled: true },
  );

async function performBudgetRename({ name }: { name: string }) {
  checkFileOpen();
  if (typeof name !== 'string') throw APIError('Budget name must be a string');
  if (name.trim() === prefs.getPrefs().budgetName) return;
  const { valid, message } = await handlers['validate-budget-name']({ name });
  if (!valid) throw withErrorCode(new Error(message), 'invalid-budget-name');
  await prefs.savePrefs({ budgetName: name.trim() });
  connection.send('prefs-updated');
}
handlers['api/rename-budget'] = withMutation(performBudgetRename);

async function performBudgetArchive({ archived }: { archived: boolean }) {
  checkFileOpen();
  if (typeof archived !== 'boolean') {
    throw APIError('Archive state must be a boolean');
  }
  await prefs.savePrefs({ archived }, { avoidSync: true });
}
handlers['api/archive-budget'] = withMutation(performBudgetArchive);

async function prepareBudgetMetadata(
  request: BudgetMetadataRequest,
): Promise<BudgetMetadataProposal> {
  checkFileOpen();
  const metadata = prefs.getPrefs();
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    request.id !== metadata.id
  ) {
    throw APIError('Metadata changes require the selected budget identity');
  }
  const before = {
    name: metadata.budgetName,
    archived: metadata.archived ?? false,
  };
  let after = before;
  if (request.operation === 'budgets.rename') {
    if (
      Object.keys(request).some(
        key => !['operation', 'id', 'name'].includes(key),
      ) ||
      typeof request.name !== 'string'
    ) {
      throw APIError('Invalid rename request');
    }
    if (request.name.trim() !== before.name) {
      const { valid, message } = await handlers['validate-budget-name']({
        name: request.name,
      });
      if (!valid) {
        throw withErrorCode(new Error(message), 'invalid-budget-name');
      }
    }
    after = { ...before, name: request.name.trim() };
  } else if (request.operation === 'budgets.archive') {
    if (
      Object.keys(request).some(
        key => !['operation', 'id', 'archived'].includes(key),
      ) ||
      typeof request.archived !== 'boolean'
    ) {
      throw APIError('Invalid archive request');
    }
    after = { ...before, archived: request.archived };
  } else {
    throw APIError('Unsupported budget metadata operation');
  }
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: request.operation,
      delivery: request.operation === 'budgets.archive' ? 'local-only' : 'sync',
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before,
      after,
      references: { nameAvailable: true },
      sideEffects:
        request.operation === 'budgets.rename'
          ? ['synced budget name update']
          : [
              'device-local archive marker update; no remote deletion or synchronization',
            ],
    }),
  );
}
handlers['api/budget-preview-metadata'] = withMutation(prepareBudgetMetadata);
handlers['api/budget-apply-metadata'] = withMutation(async function (proposal) {
  checkFileOpen();
  const metadata = prefs.getPrefs();
  if (
    !proposal ||
    proposal.schemaVersion !== 1 ||
    !['budgets.rename', 'budgets.archive'].includes(proposal.operation) ||
    proposal.request?.operation !== proposal.operation
  ) {
    return {
      status: 'rejected',
      code: 'INVALID_INPUT',
      message: 'Unsupported budget metadata proposal',
    };
  }
  if (
    canonicalJson(proposal.budget) !==
    canonicalJson({
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    })
  ) {
    return {
      status: 'rejected',
      code: 'MISSING_CONTEXT',
      message: 'The proposal belongs to another budget identity',
    };
  }
  let current: BudgetMetadataProposal;
  try {
    current = await prepareBudgetMetadata(proposal.request);
  } catch {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'Budget metadata or name availability changed after preview',
    };
  }
  if (canonicalJson(current) !== canonicalJson(proposal)) {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'Budget metadata changed after preview',
    };
  }
  const changed =
    canonicalJson(current.before) !== canonicalJson(current.after);
  if (changed) {
    if (current.request.operation === 'budgets.rename') {
      await performBudgetRename(current.request);
    } else {
      await performBudgetArchive(current.request);
    }
  }
  return {
    status: 'committed-local',
    changed,
    checkpoint: getClock().timestamp.toString(),
    affectedIds: [metadata.id],
  };
});

async function publicationFingerprint(
  proposal: BudgetPublicationProposal,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(proposal)),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
function guardedPublicationServer(): string {
  const server = getServer();
  if (!server) throw APIError('Publication requires an authenticated server');
  const url = new URL(server.BASE_SERVER);
  if (url.username || url.password || url.search || url.hash) {
    throw APIError(
      'Guarded publication requires a server URL without embedded credentials or query parameters',
    );
  }
  return server.BASE_SERVER.replace(/\/$/, '');
}
async function prepareBudgetPublication(
  request: BudgetPublicationRequest,
): Promise<BudgetPublicationProposal> {
  checkFileOpen();
  const serverUrl = guardedPublicationServer();
  const metadata = prefs.getPrefs();
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    Object.keys(request).some(key => !['id', 'encrypted'].includes(key)) ||
    typeof request.id !== 'string' ||
    request.id !== metadata.id ||
    typeof request.encrypted !== 'boolean'
  ) {
    throw APIError(
      'Publication requires the selected source ID and encryption mode',
    );
  }
  const intent = metadata.publication;
  if (
    (!intent && (metadata.cloudFileId || metadata.groupId)) ||
    intent?.status === 'published'
  ) {
    throw APIError('Budget is already published; use synchronization');
  }
  if (
    intent &&
    (intent.serverUrl !== serverUrl || intent.encrypted !== request.encrypted)
  ) {
    throw APIError('Publication context does not match its retained identity');
  }
  if (request.encrypted) {
    const health = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const capabilities = health.ok
      ? (await health.json()).capabilities
      : undefined;
    if (
      !Array.isArray(capabilities) ||
      !capabilities.includes('encrypted-initial-publication')
    ) {
      throw withErrorCode(
        new Error('Server does not support encrypted initial publication'),
        'unsupported-publication',
      );
    }
  }
  const preferences = await handlers['preferences/get']();
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'budgets.publish',
      delivery: 'publication',
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before: {
        sourceHash: await inspectCopySource(metadata.budgetName),
        name: metadata.budgetName,
        currency: preferences.defaultCurrencyCode ?? null,
        publication: intent
          ? {
              serverUrl: intent.serverUrl,
              cloudFileId: intent.cloudFileId,
              encrypted: intent.encrypted,
              status: intent.status,
              guardHash: intent.guardHash ?? null,
            }
          : null,
      },
      after: { published: true, encrypted: request.encrypted },
      references: { serverUrl, encryptedInitialSupported: request.encrypted },
      sideEffects: [
        'prepare retained local remote identity and encryption mode; publish initial source snapshot; synchronize; no new local budget',
      ],
    }),
  );
}
handlers['api/budget-preview-publication'] = request =>
  runMutator(() => prepareBudgetPublication(request), { undoDisabled: true });
async function applyGuardedPublication(
  proposal: BudgetPublicationProposal,
  encryptionPassword?: string,
  recoveryOnly = false,
): Promise<BudgetPublicationOutcome> {
  if (
    !proposal ||
    proposal.schemaVersion !== 1 ||
    proposal.operation !== 'budgets.publish' ||
    proposal.delivery !== 'publication' ||
    !proposal.request ||
    typeof proposal.request.encrypted !== 'boolean' ||
    Boolean(encryptionPassword) !== proposal.request.encrypted ||
    (encryptionPassword !== undefined &&
      (typeof encryptionPassword !== 'string' || !encryptionPassword))
  ) {
    return {
      status: 'rejected',
      code: 'INVALID_INPUT',
      message: 'Invalid publication proposal or encryption mode',
    };
  }
  try {
    if (
      guardedPublicationServer() !== proposal.references.serverUrl ||
      prefs.getPrefs()?.id !== proposal.budget.id
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'Publication belongs to another source or server',
      };
    }
    const published = await performBudgetPublication(
      { id: proposal.request.id, encryptionPassword },
      { proposal, recoveryOnly },
    );
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [published.id],
      publication: {
        serverUrl: proposal.references.serverUrl,
        syncId: published.syncId,
        cloudFileId: published.cloudFileId,
        encrypted: proposal.request.encrypted,
      },
    };
  } catch (error) {
    if (error?.code === 'publication-stale-preview') {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: error.message,
      };
    }
    throw error;
  }
}
handlers['api/budget-apply-publication'] = ({ proposal, encryptionPassword }) =>
  applyGuardedPublication(proposal, encryptionPassword);
handlers['api/budget-recover-publication'] = ({
  proposal,
  encryptionPassword,
}) => applyGuardedPublication(proposal, encryptionPassword, true);

async function performBudgetPublication(
  { id, encryptionPassword }: { id: string; encryptionPassword?: string },
  options: {
    proposal?: BudgetPublicationProposal;
    recoveryOnly?: boolean;
  } = {},
) {
  const server = getServer();
  if (!server) throw APIError('Publication requires an authenticated server');
  if (
    encryptionPassword !== undefined &&
    (typeof encryptionPassword !== 'string' || !encryptionPassword)
  ) {
    throw APIError('Encryption password must not be empty');
  }
  const budgets = await handlers['get-budgets']();
  const local = budgets.find(b => b.id === id);
  if (!local) throw APIError('Local budget ID does not exist');
  const serverUrl = server.BASE_SERVER.replace(/\/$/, '');
  if (local.publicationServerUrl && local.publicationServerUrl !== serverUrl) {
    throw APIError('Publication server must match the prepared operation');
  }
  if (!local.publicationServerUrl && (local.cloudFileId || local.groupId)) {
    throw APIError(
      'Budget already has a remote identity; use synchronization instead',
    );
  }
  // Loading an unpublished local file does not upload it automatically.
  await handlers['api/load-budget']({ id });
  const metadata = prefs.getPrefs();
  let publication = metadata.publication;
  if (
    publication &&
    (publication.serverUrl !== serverUrl ||
      publication.encrypted !== Boolean(encryptionPassword))
  ) {
    throw APIError(
      'Publication server and encryption mode must match the prepared operation',
    );
  }
  if (!publication && (metadata.cloudFileId || metadata.groupId)) {
    throw APIError(
      'Budget already has a remote identity; use synchronization instead',
    );
  }
  if (encryptionPassword) {
    const health = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const capabilities = health.ok
      ? (await health.json()).capabilities
      : undefined;
    if (
      !Array.isArray(capabilities) ||
      !capabilities.includes('encrypted-initial-publication')
    ) {
      throw withErrorCode(
        new Error('Server does not support encrypted initial publication'),
        'unsupported-publication',
      );
    }
  }
  const guardHash = options.proposal
    ? await publicationFingerprint(options.proposal)
    : undefined;
  const prepareIdentity = async () => {
    if (options.proposal) {
      if (options.recoveryOnly) {
        if (
          metadata.id !== options.proposal.budget.id ||
          !publication ||
          publication.guardHash !== guardHash ||
          publication.cloudFileId !== metadata.cloudFileId
        ) {
          throw withErrorCode(
            new Error(
              'Retained publication intent does not match this proposal',
            ),
            'publication-stale-preview',
          );
        }
      } else {
        const current = await prepareBudgetPublication(
          options.proposal.request,
        );
        if (canonicalJson(current) !== canonicalJson(options.proposal)) {
          throw withErrorCode(
            new Error('Publication source or context changed after preview'),
            'publication-stale-preview',
          );
        }
        if (publication?.guardHash && publication.guardHash !== guardHash) {
          throw withErrorCode(
            new Error(
              'Another guarded publication owns this retained identity',
            ),
            'publication-stale-preview',
          );
        }
      }
    }
    if (options.recoveryOnly) return;
    if (!publication) {
      publication = {
        serverUrl,
        cloudFileId: uuidv4(),
        encrypted: Boolean(encryptionPassword),
        status: 'prepared',
      };
      await prefs.savePrefs(
        {
          cloudFileId: publication.cloudFileId,
          publication: { ...publication, ...(guardHash ? { guardHash } : {}) },
        },
        { avoidSync: true },
      );
      publication = prefs.getPrefs().publication;
    } else if (guardHash && !publication.guardHash) {
      await prefs.savePrefs(
        { publication: { ...publication, guardHash } },
        { avoidSync: true },
      );
      publication = prefs.getPrefs().publication;
    }
  };
  if (options.proposal) {
    await runMutator(prepareIdentity, { undoDisabled: true });
  } else {
    await prepareIdentity();
  }
  // Inspect the retained identity before retrying a possibly accepted upload.
  let remote;
  try {
    remote = (await handlers['get-remote-files']()).find(
      file => file.fileId === publication.cloudFileId && !file.deleted,
    );
  } catch {
    throw withErrorCode(
      new Error('Remote publication state could not be inspected'),
      'publication-uncertain',
    );
  }
  if (remote) {
    if (
      !remote.groupId ||
      (remote.encryptKeyId ?? null) !== (metadata.encryptKeyId ?? null)
    ) {
      throw withErrorCode(
        new Error('Remote publication identity does not match local state'),
        'publication-uncertain',
      );
    }
    await prefs.savePrefs({ groupId: remote.groupId }, { avoidSync: true });
    if (encryptionPassword) {
      const tested = await handlers['key-test']({
        cloudFileId: publication.cloudFileId,
        password: encryptionPassword,
      });
      if (tested.error) {
        throw withErrorCode(
          new Error('Publication encryption key could not be verified'),
          'publication-uncertain',
        );
      }
    }
    // A lost upload response also loses the local cadence acknowledgement.
    // The proven retained remote file must not immediately trigger another
    // periodic upload when the recovered budget is loaded again.
    if (!prefs.getPrefs().lastUploaded) {
      await prefs.savePrefs(
        { lastUploaded: monthUtils.currentDay() },
        { avoidSync: true },
      );
    }
  } else {
    if (options.recoveryOnly || publication.status === 'published') {
      throw withErrorCode(
        new Error('Previously published file is missing from this server'),
        'publication-uncertain',
      );
    }
    let initialKey;
    if (encryptionPassword) {
      initialKey = await handlers['key-prepare-publication']({
        password: encryptionPassword,
      });
    }
    try {
      await cloudStorage.upload(
        initialKey,
        options.proposal
          ? async () => {
              const observed = prefs.getPrefs();
              if (
                observed.id !== options.proposal.budget.id ||
                observed.publication?.guardHash !== guardHash ||
                getServer()?.BASE_SERVER.replace(/\/$/, '') !==
                  options.proposal.references.serverUrl ||
                (await inspectCopySource(options.proposal.before.name)) !==
                  options.proposal.before.sourceHash
              ) {
                throw new Error('Publication source changed before export');
              }
            }
          : undefined,
      );
    } catch {
      throw withErrorCode(
        new Error(
          'Publication outcome is uncertain; inspect or retry this retained identity',
        ),
        'publication-uncertain',
      );
    }
  }
  try {
    await handlers['api/sync']();
    await prefs.savePrefs(
      {
        publication: { ...prefs.getPrefs().publication, status: 'published' },
        userId: await asyncStorage.getItem('user-token'),
      },
      { avoidSync: true },
    );
  } catch {
    throw withErrorCode(
      new Error(
        'Publication reached the server but synchronization or local acknowledgement failed',
      ),
      'publication-uncertain',
    );
  }
  return handlers['api/inspect-budget']();
}
handlers['api/publish-budget'] = request => performBudgetPublication(request);

handlers['api/sync-status'] = async function () {
  checkFileOpen();
  return getSyncStatus();
};

handlers['api/sync'] = async function () {
  const { id } = prefs.getPrefs();
  const result = await handlers['sync-budget']();
  if (result.error) {
    throw withErrorCode(
      new Error(getSyncError(result.error.reason, id, result.error.meta)),
      result.error.reason,
    );
  }
};

handlers['api/bank-sync'] = async function (args) {
  const batchSync = args?.accountId == null;
  const allErrors = [];

  if (!batchSync) {
    const { errors } = await handlers['accounts-bank-sync']({
      ids: [args.accountId],
    });

    allErrors.push(...errors);
  } else {
    const accountsData = await handlers['accounts-get']();
    const accountIdsToSync = accountsData.map(a => a.id);
    const simpleFinAccounts = accountsData.filter(
      a => a.account_sync_source === 'simpleFin',
    );
    const simpleFinAccountIds = simpleFinAccounts.map(a => a.id);

    if (simpleFinAccounts.length >= 1) {
      const res = await handlers['simplefin-batch-sync']({
        ids: simpleFinAccountIds,
      });

      res.forEach(a => allErrors.push(...a.res.errors));
    }

    const { errors } = await handlers['accounts-bank-sync']({
      ids: accountIdsToSync.filter(a => !simpleFinAccountIds.includes(a)),
    });

    allErrors.push(...errors);
  }

  const errors = allErrors.filter(e => e != null);
  if (errors.length > 0) {
    throw withErrorCode(new Error(getBankSyncError(errors[0])), errors[0].code);
  }
};

handlers['api/start-import'] = async function ({ budgetName }) {
  // Notify UI to close budget
  await handlers['close-budget']();

  // Create the budget
  await handlers['create-budget']({ budgetName, avoidUpload: true });

  // Clear out the default expense categories
  db.runQuery('DELETE FROM categories WHERE is_income = 0');
  db.runQuery('DELETE FROM category_groups WHERE is_income = 0');

  // Turn syncing off
  setSyncingMode('import');

  connection.send('start-import');
  IMPORT_MODE = true;
};

handlers['api/finish-import'] = async function () {
  checkFileOpen();

  sheet.get().markCacheDirty();

  // We always need to fully reload the app. Importing doesn't touch
  // the spreadsheet, but we can't just recreate the spreadsheet
  // either; there is other internal state that isn't created
  const { id } = prefs.getPrefs();
  await handlers['close-budget']();
  await handlers['load-budget']({ id });

  await handlers['get-budget-bounds']();
  await sheet.waitOnSpreadsheet();

  await cloudStorage.upload().catch(err => {
    logger.warn('cloudStorage.upload failed during finish-import', err);
  });

  connection.send('finish-import');
  IMPORT_MODE = false;
};

handlers['api/abort-import'] = async function () {
  if (IMPORT_MODE) {
    checkFileOpen();

    const { id } = prefs.getPrefs();

    await handlers['close-budget']();
    await handlers['delete-budget']({ id });
    connection.send('show-budgets');
  }

  IMPORT_MODE = false;
};

handlers['api/query'] = async function ({ query }) {
  checkFileOpen();
  return aqlQuery(query);
};

// Read-only fingerprint of the persistent budget tables (the same source
// fingerprint guarded previews bind). Any committed change, local-only or
// synchronized, changes it.
handlers['api/query-snapshot'] = async function () {
  checkFileOpen();
  return { marker: await guardedSourceHash() };
};

handlers['api/budget-months'] = async function () {
  checkFileOpen();
  const { start, end } = await handlers['get-budget-bounds']();
  return monthUtils.range(start, end);
};

handlers['api/budget-month'] = async function ({ month }) {
  checkFileOpen();
  await validateMonth(month);

  const { data: groups }: { data: CategoryGroupEntity[] } = await aqlQuery(
    q('category_groups').select('*'),
  );
  const sheetName = monthUtils.sheetForMonth(month);

  function value(name) {
    const v = sheet.get().getCellValue(sheetName, name);
    return v === '' ? 0 : v;
  }

  // This is duplicated from main.js because the return format is
  // different (for now)
  return {
    month,
    incomeAvailable: value('available-funds') as number,
    lastMonthOverspent: value('last-month-overspent') as number,
    forNextMonth: value('buffered') as number,
    totalBudgeted: value('total-budgeted') as number,
    toBudget: value('to-budget') as number,

    fromLastMonth: value('from-last-month') as number,
    totalIncome: value('total-income') as number,
    totalSpent: value('total-spent') as number,
    totalBalance: value('total-leftover') as number,

    categoryGroups: groups.map(group => {
      if (group.is_income) {
        if (isTrackingBudget()) {
          return {
            ...categoryGroupModel.toExternal(group),
            budgeted: value(`group-budget-${group.id}`),
            received: value(`group-sum-amount-${group.id}`),
            balance: value(`group-leftover-${group.id}`),

            categories: group.categories.map(cat => ({
              ...categoryModel.toExternal(cat),
              budgeted: value(`budget-${cat.id}`),
              received: value(`sum-amount-${cat.id}`),
              balance: value(`leftover-${cat.id}`),
              carryover: value(`carryover-${cat.id}`),
            })),
          };
        }

        return {
          ...categoryGroupModel.toExternal(group),
          received: value('total-income'),

          categories: group.categories.map(cat => ({
            ...categoryModel.toExternal(cat),
            received: value(`sum-amount-${cat.id}`),
          })),
        };
      }

      return {
        ...categoryGroupModel.toExternal(group),
        budgeted: value(`group-budget-${group.id}`),
        spent: value(`group-sum-amount-${group.id}`),
        balance: value(`group-leftover-${group.id}`),

        categories: group.categories.map(cat => ({
          ...categoryModel.toExternal(cat),
          budgeted: value(`budget-${cat.id}`),
          spent: value(`sum-amount-${cat.id}`),
          balance: value(`leftover-${cat.id}`),
          carryover: value(`carryover-${cat.id}`),
        })),
      };
    }),
  };
};

handlers['api/budget-set-amount'] = withMutation(async function ({
  month,
  categoryId,
  amount,
}) {
  checkFileOpen();
  return handlers['budget/budget-amount']({
    month,
    category: categoryId,
    amount,
  });
});

async function prepareBudgetAmount(
  request: BudgetAmountRequest,
): Promise<BudgetAmountProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.month !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month) ||
    typeof request.categoryId !== 'string' ||
    !Number.isSafeInteger(request.amount) ||
    Object.keys(request).some(
      key => !['month', 'categoryId', 'amount'].includes(key),
    )
  ) {
    throw APIError('Invalid allocation request');
  }
  await validateMonth(request.month);
  const category = await db.first<db.DbCategory>(
    'SELECT * FROM categories WHERE id = ? AND tombstone = 0',
    [request.categoryId],
  );
  if (!category || (category.is_income && !isTrackingBudget())) {
    throw APIError('Allocation category is unavailable for this budget mode');
  }
  const group = await db.first('SELECT * FROM category_groups WHERE id = ?', [
    category.cat_group,
  ]);
  const inspection = inspectBudgetAmount({
    category: request.categoryId,
    month: request.month,
  });
  const metadata = prefs.getPrefs();
  const proposal: BudgetAmountProposal = {
    schemaVersion: 1,
    operation: 'budgets.set-amount',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: { amount: inspection.amount, row: inspection.row },
    after: { amount: request.amount },
    references: { category, group, table: inspection.table },
    sideEffects: ['allocation amount update', 'engine budget recalculation'],
  };
  return JSON.parse(canonicalJson(proposal));
}
handlers['api/budget-preview-amount'] = withMutation(prepareBudgetAmount);
handlers['api/budget-apply-amount'] = withMutation(async function (proposal) {
  checkFileOpen();
  const metadata = prefs.getPrefs();
  if (
    !proposal ||
    proposal.schemaVersion !== 1 ||
    proposal.operation !== 'budgets.set-amount'
  ) {
    return {
      status: 'rejected',
      code: 'INVALID_INPUT',
      message: 'Unsupported allocation proposal',
    };
  }
  if (
    canonicalJson(proposal.budget) !==
    canonicalJson({
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    })
  ) {
    return {
      status: 'rejected',
      code: 'MISSING_CONTEXT',
      message: 'The proposal belongs to another budget identity',
    };
  }
  let current: BudgetAmountProposal;
  try {
    current = await prepareBudgetAmount(proposal.request);
  } catch {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'The proposed allocation scope is no longer available',
    };
  }
  if (canonicalJson(current) !== canonicalJson(proposal)) {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'Allocation or reference state changed after preview',
    };
  }
  const changed = current.before.amount !== current.after.amount;
  if (changed) {
    await handlers['budget/budget-amount']({
      month: current.request.month,
      category: current.request.categoryId,
      amount: current.request.amount,
    });
  }
  return {
    status: 'committed-local',
    changed,
    checkpoint: getClock().timestamp.toString(),
    affectedIds: [current.request.categoryId],
  };
});

async function performBudgetCarryover({
  month,
  categoryId,
  flag,
}: BudgetCarryoverRequest) {
  checkFileOpen();
  await validateMonth(month);
  await validateExpenseCategory('budget-set-carryover', categoryId);
  return handlers['budget/set-carryover']({
    startMonth: month,
    category: categoryId,
    flag,
  });
}
handlers['api/budget-set-carryover'] = withMutation(performBudgetCarryover);

async function prepareBudgetCarryover(
  request: BudgetCarryoverRequest,
): Promise<BudgetCarryoverProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.month !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month) ||
    typeof request.categoryId !== 'string' ||
    typeof request.flag !== 'boolean' ||
    Object.keys(request).some(
      key => !['month', 'categoryId', 'flag'].includes(key),
    )
  ) {
    throw APIError('Invalid carryover request');
  }
  await validateMonth(request.month);
  await validateExpenseCategory('budget-set-carryover', request.categoryId);
  const category = await db.first<db.DbCategory>(
    'SELECT * FROM categories WHERE id = ? AND tombstone = 0',
    [request.categoryId],
  );
  const group = await db.first('SELECT * FROM category_groups WHERE id = ?', [
    category.cat_group,
  ]);
  const inspection = inspectCategoryCarryover(
    request.month,
    request.categoryId,
  );
  const metadata = prefs.getPrefs();
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'budgets.set-carryover',
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before: { months: inspection.months },
      after: {
        months: inspection.months.map(({ month }) => ({
          month,
          carryover: request.flag,
        })),
      },
      references: { category, group, table: inspection.table },
      sideEffects: [
        'carryover update across the engine month range',
        'engine budget recalculation',
      ],
    }),
  );
}
handlers['api/budget-preview-carryover'] = withMutation(prepareBudgetCarryover);
handlers['api/budget-apply-carryover'] = withMutation(
  async function (proposal) {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'budgets.set-carryover'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported carryover proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: BudgetCarryoverProposal;
    try {
      current = await prepareBudgetCarryover(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'The carryover scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Carryover months, allocation or reference state changed after preview',
      };
    }
    const changed = current.before.months.some(
      ({ row, carryover }) =>
        row === null || carryover !== current.request.flag,
    );
    if (changed) {
      await performBudgetCarryover(current.request);
    }
    return {
      status: 'committed-local',
      changed,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [current.request.categoryId],
    };
  },
);

function performBudgetHold(
  request: Extract<BudgetHoldRequest, { operation: 'budgets.hold-next-month' }>,
): Promise<boolean>;
function performBudgetHold(
  request: Extract<BudgetHoldRequest, { operation: 'budgets.reset-hold' }>,
): Promise<void>;
function performBudgetHold(request: BudgetHoldRequest): Promise<boolean | void>;
async function performBudgetHold(
  request: BudgetHoldRequest,
): Promise<boolean | void> {
  checkFileOpen();
  await validateMonth(request.month);
  if (request.operation === 'budgets.reset-hold') {
    return handlers['budget/reset-hold']({ month: request.month });
  }
  if (request.amount <= 0) {
    throw APIError('Amount to hold needs to be greater than 0');
  }
  return handlers['budget/hold-for-next-month']({
    month: request.month,
    amount: request.amount,
  });
}
handlers['api/budget-hold-for-next-month'] = withMutation(({ month, amount }) =>
  performBudgetHold({ operation: 'budgets.hold-next-month', month, amount }),
);
handlers['api/budget-reset-hold'] = withMutation(({ month }) =>
  performBudgetHold({ operation: 'budgets.reset-hold', month }),
);

async function prepareBudgetHold(
  request: BudgetHoldRequest,
): Promise<BudgetHoldProposal> {
  checkFileOpen();
  if (
    !request ||
    !['budgets.hold-next-month', 'budgets.reset-hold'].includes(
      request.operation,
    ) ||
    typeof request.month !== 'string' ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month) ||
    Object.keys(request).some(
      key =>
        ![
          'operation',
          'month',
          ...(request.operation === 'budgets.hold-next-month'
            ? ['amount']
            : []),
        ].includes(key),
    ) ||
    (request.operation === 'budgets.hold-next-month' &&
      (!Number.isSafeInteger(request.amount) || request.amount <= 0))
  ) {
    throw APIError('Invalid budget hold request');
  }
  await validateMonth(request.month);
  const inspection = await inspectBudgetHold(
    request.month,
    request.operation === 'budgets.hold-next-month' ? request.amount : 0,
  );
  const metadata = prefs.getPrefs();
  const resets = request.operation === 'budgets.reset-hold';
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: request.operation,
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before: { buffered: inspection.buffered, row: inspection.row },
      after: {
        buffered: resets ? 0 : inspection.heldBuffer,
        willWrite: resets
          ? inspection.row === null || inspection.buffered !== 0
          : inspection.toBudget > 0,
      },
      references: {
        toBudget: inspection.toBudget,
        tracking: inspection.tracking,
        sourceHash: await inspectCopySource(metadata.budgetName),
      },
      sideEffects: ['month hold update', 'engine budget recalculation'],
    }),
  );
}
handlers['api/budget-preview-hold'] = withMutation(prepareBudgetHold);
handlers['api/budget-apply-hold'] = withMutation(async function (proposal) {
  checkFileOpen();
  if (
    !proposal ||
    proposal.schemaVersion !== 1 ||
    !['budgets.hold-next-month', 'budgets.reset-hold'].includes(
      proposal.operation,
    )
  ) {
    return {
      status: 'rejected',
      code: 'INVALID_INPUT',
      message: 'Unsupported hold proposal',
    };
  }
  const metadata = prefs.getPrefs();
  if (
    canonicalJson(proposal.budget) !==
    canonicalJson({
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    })
  ) {
    return {
      status: 'rejected',
      code: 'MISSING_CONTEXT',
      message: 'The proposal belongs to another budget identity',
    };
  }
  let current: BudgetHoldProposal;
  try {
    current = await prepareBudgetHold(proposal.request);
  } catch {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'The hold scope is no longer available',
    };
  }
  if (canonicalJson(current) !== canonicalJson(proposal)) {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'Hold, available funds, mode or source changed after preview',
    };
  }
  if (current.after.willWrite) await performBudgetHold(current.request);
  return {
    status: 'committed-local',
    changed: current.after.willWrite,
    checkpoint: getClock().timestamp.toString(),
    affectedIds: [current.request.month],
  };
});

handlers['api/transactions-export'] = async function ({
  transactions,
  categoryGroups,
  payees,
  accounts,
}) {
  checkFileOpen();
  return handlers['transactions-export']({
    transactions,
    categoryGroups,
    payees,
    accounts,
  });
};

handlers['api/transactions-import'] = withMutation(async function ({
  accountId,
  transactions,
  isPreview = false,
  opts,
}) {
  checkFileOpen();
  return handlers['transactions-import']({
    accountId,
    transactions,
    isPreview,
    opts,
  });
});

handlers['api/transactions-add'] = withMutation(async function ({
  accountId,
  transactions,
  runTransfers = false,
  learnCategories = false,
}) {
  checkFileOpen();
  await addTransactions(accountId, transactions, {
    runTransfers,
    learnCategories,
  });
  return 'ok' as const;
});

handlers['api/transactions-get'] = async function ({
  accountId,
  startDate,
  endDate,
}) {
  checkFileOpen();
  const { data } = await aqlQuery(
    q('transactions')
      .filter({
        $and: [
          accountId && { account: accountId },
          startDate && { date: { $gte: startDate } },
          endDate && { date: { $lte: endDate } },
        ].filter(Boolean),
      })
      .select('*')
      .options({ splits: 'grouped' }),
  );
  return data;
};

async function inspectTransactionReferences(transactions: TransactionEntity[]) {
  return Promise.all(
    transactions.map(async row => ({
      id: row.id,
      account: await db.first('SELECT * FROM accounts WHERE id = ?', [
        row.account,
      ]),
      payee: row.payee
        ? await db.first<db.DbPayee>('SELECT * FROM payees WHERE id = ?', [
            row.payee,
          ])
        : null,
      category: row.category
        ? await db.first('SELECT * FROM categories WHERE id = ?', [
            row.category,
          ])
        : null,
    })),
  );
}

// Category and payee edits stay inside the existing transfer-free plan: a
// payee change that would link or unlink a transfer, a category on a transfer,
// split parent or off-budget row, and unknown or deleted references are
// rejected before any plan is built.
async function inspectGuardedClassification(
  transaction: TransactionEntity,
  fields: TransactionUpdateRequest['fields'],
) {
  if (fields.category !== undefined) {
    if (transaction.is_parent || transaction.transfer_id) {
      throw APIError(
        'Category edits are not supported on split parents or transfers',
      );
    }
    const account = await db.first<Pick<db.DbAccount, 'offbudget'>>(
      'SELECT offbudget FROM accounts WHERE id = ?',
      [transaction.account],
    );
    if (fields.category !== null && account?.offbudget) {
      throw APIError('Off-budget transactions cannot carry a category');
    }
    if (
      fields.category !== null &&
      !(await db.first(
        'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
        [fields.category],
      ))
    ) {
      throw APIError('Category does not exist');
    }
  }
  if (fields.payee !== undefined) {
    if (transaction.transfer_id) {
      throw APIError('Changing a transfer payee requires a repair operation');
    }
    const payee = await db.first<Pick<db.DbPayee, 'transfer_acct'>>(
      'SELECT transfer_acct FROM payees WHERE id = ? AND tombstone = 0',
      [fields.payee],
    );
    if (!payee) {
      throw APIError('Payee does not exist');
    }
    if (payee.transfer_acct) {
      throw APIError('Transfer linking requires a separate repair operation');
    }
  }
}

async function prepareTransactionUpdate(
  request: TransactionUpdateRequest,
): Promise<TransactionUpdateProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id ||
    !request.fields ||
    typeof request.fields !== 'object' ||
    Array.isArray(request.fields)
  ) {
    throw APIError('Invalid transaction update request');
  }
  const fields = Object.entries(request.fields);
  if (
    fields.length === 0 ||
    fields.some(([key, value]) => {
      switch (key) {
        case 'notes':
          return typeof value !== 'string';
        case 'amount':
          return !Number.isSafeInteger(value);
        case 'cleared':
          return typeof value !== 'boolean';
        case 'category':
          return value !== null && (typeof value !== 'string' || !value);
        case 'payee':
          return typeof value !== 'string' || !value;
        case 'date':
          return (
            typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value
          );
        default:
          return true;
      }
    })
  ) {
    throw APIError(
      'This guarded update supports notes, amount, date, cleared, category, and payee only',
    );
  }
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: request.id })
      .select('*')
      .options({ splits: 'grouped' }),
  );
  const transactions = ungroupTransactions(data);
  const transaction = transactions.find(row => row.id === request.id);
  if (!transaction) throw APIError('Transaction not found');
  await inspectGuardedClassification(transaction, request.fields);
  const splitReferences = await inspectTransactionReferences(transactions);
  const linked = new Map<
    string,
    Awaited<ReturnType<typeof inspectTransferUpdate>>
  >();
  const closure = new Map<string, TransactionEntity>(
    transactions.map(row => [row.id, row]),
  );
  for (const row of transactions) {
    if (row.is_parent) {
      if (row.transfer_id) {
        throw APIError('A split parent cannot carry a transfer link');
      }
      continue;
    }
    const transferredAccount = await getTransferredAccount(row);
    if (!row.transfer_id) {
      if (transferredAccount) {
        throw APIError('Transfer linking requires a separate repair operation');
      }
      continue;
    }
    if (!transferredAccount) {
      throw APIError('Transfer unlinking requires a separate repair operation');
    }
    const observedTransfer = await inspectTransferUpdate(
      row,
      transferredAccount,
    );
    const counterpart = observedTransfer.before.find(
      other => other.id === row.transfer_id,
    );
    if (
      counterpart?.transfer_id !== row.id ||
      counterpart.is_parent ||
      counterpart.account !== transferredAccount
    ) {
      throw APIError(
        'Transfer link is not reciprocal or points to an invalid counterpart',
      );
    }
    linked.set(row.id, observedTransfer);
    for (const counterpartRow of observedTransfer.before) {
      closure.set(counterpartRow.id, counterpartRow);
    }
  }
  const observed =
    transaction.is_parent || transaction.is_child || linked.size > 0
      ? transactions
      : data;
  const planned = updateTransaction(observed, {
    ...transaction,
    ...request.fields,
  });
  let before = observed;
  let after = planned.data;
  const reference = splitReferences.find(row => row.id === request.id)!;
  let references: unknown =
    transactions.length > 1
      ? { records: splitReferences }
      : {
          account: reference.account,
          payee: reference.payee,
          category: reference.category,
        };
  if (linked.size > 0) {
    before = [...closure.values()];
    const afterById = new Map<string, TransactionEntity>(
      before.map(row => [row.id, row]),
    );
    for (const row of planned.data) afterById.set(row.id, row);
    for (const update of planned.diff.updated) {
      const transfer = update.id ? linked.get(update.id) : undefined;
      if (!transfer || !update.id) continue;
      const source = afterById.get(update.id)!;
      const counterpartGroup = transfer.before.map(row =>
        afterById.get(row.id)!,
      );
      const transferPlan = planLinkedTransferUpdate(
        counterpartGroup,
        source,
        transfer.context,
      );
      for (const row of transferPlan.data) afterById.set(row.id, row);
      if (transfer.context.clearCategory) {
        afterById.set(source.id, { ...source, category: null });
      }
    }
    after = before.map(row => afterById.get(row.id)!);
    references = {
      records: await inspectTransactionReferences(before),
      transfers: [...linked.entries()].map(([id, transfer]) => ({
        id,
        ...transfer.references,
      })),
    };
  }
  const metadata = prefs.getPrefs();
  const proposal: TransactionUpdateProposal = {
    schemaVersion: 1,
    operation: 'transactions.update',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before,
    after,
    references,
    sideEffects: [
      'transaction update',
      ...(linked.size > 0
        ? ['engine linked transfer update and category clearing']
        : []),
      ...(before.some(row => row.is_parent)
        ? ['engine split inheritance and error recalculation']
        : []),
      ...(request.fields.amount !== undefined ||
      request.fields.date !== undefined
        ? ['engine balance and budget recalculation']
        : []),
    ],
  };
  // AQL may return cached objects. Detach observed values from later writes.
  return JSON.parse(canonicalJson(proposal));
}

handlers['api/transaction-preview-update'] = withMutation(
  prepareTransactionUpdate,
);
handlers['api/transaction-apply-update'] = withMutation(
  async function (proposal) {
    checkFileOpen();
    const metadata = prefs.getPrefs();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'transactions.update'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported transaction proposal',
      };
    }
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: TransactionUpdateProposal;
    try {
      current = await prepareTransactionUpdate(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'The proposed transaction scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Affected transaction or reference state changed after preview',
      };
    }
    const changed =
      canonicalJson(current.before) !== canonicalJson(current.after);
    if (changed) await performTransactionUpdate(current.request);
    return {
      status: 'committed-local',
      changed,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: current.before.map(row => row.id),
    };
  },
);

async function performTransactionUpdate({
  id,
  fields,
}: Parameters<Handlers['api/transaction-update']>[0]) {
  checkFileOpen();
  const { data } = await aqlQuery(
    q('transactions').filter({ id }).select('*').options({ splits: 'grouped' }),
  );
  const transactions = ungroupTransactions(data);

  if (transactions.length === 0) {
    return [];
  }

  const transaction = transactions.find(row => row.id === id);
  if (!transaction) return [];
  const { diff } = updateTransaction(transactions, {
    ...transaction,
    ...fields,
    id,
  });
  const result = await handlers['transactions-batch-update'](diff);
  return result.updated;
}
handlers['api/transaction-update'] = withMutation(performTransactionUpdate);

handlers['api/transaction-delete'] = withMutation(async function ({ id }) {
  checkFileOpen();
  const { data } = await aqlQuery(
    q('transactions').filter({ id }).select('*').options({ splits: 'grouped' }),
  );
  const transactions = ungroupTransactions(data);

  if (transactions.length === 0) {
    return [];
  }

  const { diff } = deleteTransaction(transactions, id);
  return handlers['transactions-batch-update'](diff)['deleted'];
});

handlers['api/transactions-merge'] = withMutation(async function ({ ids }) {
  checkFileOpen();
  return handlers['transactions-merge'](ids.map(id => ({ id })));
});

handlers['api/accounts-get'] = async function () {
  checkFileOpen();
  const accounts: AccountEntity[] = await handlers['accounts-get']();
  return accounts.map(account => accountModel.toExternal(account));
};

async function performAccountCreation({
  account,
  initialBalance = null,
  openingDate,
}: {
  account: { name: string; offbudget?: boolean; closed?: boolean };
  initialBalance?: number | null;
  openingDate?: string;
}) {
  checkFileOpen();
  return handlers['account-create']({
    name: account.name,
    offBudget: account.offbudget,
    closed: account.closed,
    // Current the API expects an amount but it really should expect
    // an integer
    balance: initialBalance != null ? integerToAmount(initialBalance) : null,
    openingDate,
  });
}
handlers['api/account-create'] = withMutation(performAccountCreation);

async function prepareAccountCreation(
  request: AccountCreationRequest,
): Promise<AccountCreationProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.name !== 'string' ||
    !request.name.trim() ||
    typeof request.offbudget !== 'boolean' ||
    !Number.isSafeInteger(request.initialBalance) ||
    (request.closed !== undefined && typeof request.closed !== 'boolean') ||
    Object.keys(request).some(
      key => !['name', 'offbudget', 'initialBalance', 'closed'].includes(key),
    )
  ) {
    throw APIError('Invalid account creation request');
  }
  const opening =
    request.initialBalance !== 0 ? await inspectStartingBalancePayee() : null;
  const metadata = prefs.getPrefs();
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'accounts.create',
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before: { sourceHash: await inspectCopySource(metadata.budgetName) },
      after: {
        account: {
          name: request.name,
          offbudget: request.offbudget,
          closed: request.closed ?? false,
        },
        transferPayee: { creates: true },
        openingTransaction: opening
          ? {
              amount: amountToInteger(integerToAmount(request.initialBalance)),
              date: monthUtils.currentDay(),
              cleared: true,
              categoryId: request.offbudget
                ? null
                : (opening.category?.id ?? null),
              payeeId: opening.payee?.id ?? null,
              createsPayee: opening.payee === null,
            }
          : null,
      },
      references: opening,
      sideEffects: [
        'account creation',
        'transfer payee creation',
        ...(opening
          ? [
              'cleared opening transaction',
              ...(opening.payee === null
                ? ['starting balance payee creation']
                : []),
            ]
          : []),
        'engine budget recalculation',
      ],
    }),
  );
}
handlers['api/account-preview-creation'] = withMutation(prepareAccountCreation);
handlers['api/account-apply-creation'] = withMutation(
  async function (proposal): Promise<AccountCreationOutcome> {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'accounts.create'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported account creation proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: AccountCreationProposal;
    try {
      current = await prepareAccountCreation(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'The account creation scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Account creation source, references or opening date changed after preview',
      };
    }
    const id = await performAccountCreation({
      account: current.after.account,
      initialBalance: current.request.initialBalance,
      openingDate: current.after.openingTransaction?.date,
    });
    const transfer = await db.first<db.DbPayee>(
      'SELECT * FROM payees WHERE transfer_acct = ? AND tombstone = 0',
      [id],
    );
    const opening = current.after.openingTransaction
      ? await db.first<db.DbTransaction>(
          'SELECT * FROM transactions WHERE acct = ? AND starting_balance_flag = 1 AND tombstone = 0',
          [id],
        )
      : null;
    if (
      !transfer ||
      (current.after.openingTransaction && !opening?.description)
    ) {
      throw APIError('Created account identities could not be acknowledged');
    }
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [
        id,
        transfer.id,
        ...(opening ? [opening.id] : []),
        ...(opening?.description ? [opening.description] : []),
      ],
      accountCreation: {
        accountId: id,
        transferPayeeId: transfer.id,
        openingTransactionId: opening?.id ?? null,
        startingBalancePayeeId: opening?.description ?? null,
      },
    };
  },
);

async function performAccountUpdate({
  id,
  fields,
}: {
  id: string;
  fields: Partial<APIAccountEntity>;
}) {
  checkFileOpen();
  // @ts-expect-error - fix me
  return db.updateAccount({ id, ...accountModel.fromExternal(fields) });
}
handlers['api/account-update'] = withMutation(performAccountUpdate);

async function prepareAccountUpdate(
  request: AccountUpdateRequest,
): Promise<AccountUpdateProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !request.fields ||
    typeof request.fields !== 'object' ||
    Array.isArray(request.fields) ||
    Object.keys(request.fields).length === 0
  ) {
    throw APIError('Invalid account update request');
  }
  for (const [key, value] of Object.entries(request.fields)) {
    const valid =
      key === 'name'
        ? typeof value === 'string' && Boolean(value.trim())
        : key === 'offbudget' || key === 'closed'
          ? typeof value === 'boolean'
          : key === 'balance_current'
            ? value === null || Number.isSafeInteger(value)
            : key === 'account_group_id'
              ? value === null ||
                (typeof value === 'string' && Boolean(value.trim()))
              : false;
    if (!valid) throw APIError('Invalid account update fields');
  }
  const account = await db.getAccount(request.id);
  if (!account || account.tombstone) throw APIError('Account does not exist');
  const groupId = request.fields.account_group_id;
  const group = groupId
    ? await db.first<db.DbAccountGroup>(
        'SELECT * FROM account_groups WHERE id = ? AND tombstone = 0',
        [groupId],
      )
    : null;
  if (groupId && !group) throw APIError('Account group does not exist');
  const external = accountModel.toExternal(account);
  const before = {
    ...external,
    offbudget: external.offbudget ?? false,
    closed: external.closed ?? false,
    balance_current: external.balance_current ?? null,
    account_group_id: external.account_group_id ?? null,
  };
  const transferPayees = (await db.getPayees())
    .filter(payee => payee.transfer_acct === request.id)
    .map(payee => ({ id: payee.id, name: payee.name }));
  const metadata = prefs.getPrefs();
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'accounts.update',
      budget: {
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      },
      request,
      before: {
        sourceHash: await inspectCopySource(metadata.budgetName),
        account: before,
        transferPayees,
      },
      after: {
        account: { ...before, ...request.fields },
        transferPayees: transferPayees.map(payee => ({
          ...payee,
          name: request.fields.name ?? before.name,
        })),
      },
      references: { account, group },
      sideEffects: [
        'account fields update',
        ...(request.fields.name !== undefined &&
        request.fields.name !== before.name
          ? ['derived transfer payee names change without payee writes']
          : []),
        ...(request.fields.offbudget !== undefined &&
        request.fields.offbudget !== before.offbudget
          ? [
              'engine budget classification changes for existing ledger transactions',
            ]
          : []),
        ...(request.fields.closed !== undefined &&
        request.fields.closed !== before.closed
          ? [
              'account visibility changes without bank unlink or a balance transfer',
            ]
          : []),
        ...(request.fields.balance_current !== undefined
          ? ['stored bank balance update; ledger balance unchanged']
          : []),
        ...(request.fields.account_group_id !== undefined
          ? ['account group assignment']
          : []),
      ],
    }),
  );
}
handlers['api/account-preview-update'] = withMutation(prepareAccountUpdate);
async function performAccountReopen({ id }: AccountReopenRequest) {
  checkFileOpen();
  return handlers['account-reopen']({ id });
}
async function prepareAccountReopen(
  request: AccountReopenRequest,
): Promise<AccountReopenProposal> {
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(key => key !== 'id')
  ) {
    throw APIError('Invalid account reopening request');
  }
  const inspected = await prepareAccountUpdate({
    id: request.id,
    fields: { closed: false },
  });
  return {
    ...inspected,
    operation: 'accounts.reopen',
    request: { id: request.id },
    sideEffects: [
      'account reopening',
      'account visibility changes without bank linking or a balance transfer',
    ],
  };
}
handlers['api/account-preview-reopen'] = withMutation(prepareAccountReopen);
async function applyAccountFields(
  proposal: AccountUpdateProposal | AccountReopenProposal,
  operation: 'accounts.update' | 'accounts.reopen',
): Promise<TransactionUpdateOutcome> {
  checkFileOpen();
  if (
    !proposal ||
    proposal.schemaVersion !== 1 ||
    proposal.operation !== operation
  ) {
    return {
      status: 'rejected',
      code: 'INVALID_INPUT',
      message: 'Unsupported account change proposal',
    };
  }
  const metadata = prefs.getPrefs();
  if (
    canonicalJson(proposal.budget) !==
    canonicalJson({
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    })
  ) {
    return {
      status: 'rejected',
      code: 'MISSING_CONTEXT',
      message: 'The proposal belongs to another budget identity',
    };
  }
  let current: AccountUpdateProposal | AccountReopenProposal;
  try {
    current =
      proposal.operation === 'accounts.reopen'
        ? await prepareAccountReopen(proposal.request)
        : await prepareAccountUpdate(proposal.request);
  } catch {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'Account update scope is no longer available',
    };
  }
  if (canonicalJson(current) !== canonicalJson(proposal)) {
    return {
      status: 'rejected',
      code: 'STALE_PREVIEW',
      message: 'Account, ledger or references changed after preview',
    };
  }
  if (current.operation === 'accounts.reopen') {
    await performAccountReopen(current.request);
  } else {
    await performAccountUpdate(current.request);
  }
  return {
    status: 'committed-local',
    changed:
      canonicalJson(current.before.account) !==
      canonicalJson(current.after.account),
    checkpoint: getClock().timestamp.toString(),
    affectedIds: [current.request.id],
  };
}
handlers['api/account-apply-update'] = withMutation(proposal =>
  applyAccountFields(proposal, 'accounts.update'),
);
handlers['api/account-apply-reopen'] = withMutation(proposal =>
  applyAccountFields(proposal, 'accounts.reopen'),
);

async function prepareGuardedCategoryGroupUpdate(
  request: CategoryGroupUpdateRequest,
): Promise<CategoryGroupUpdateProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !request.fields ||
    typeof request.fields !== 'object' ||
    Array.isArray(request.fields) ||
    !Object.keys(request.fields).length
  ) {
    throw APIError('Invalid category group update request');
  }
  for (const [key, value] of Object.entries(request.fields)) {
    const valid =
      key === 'id'
        ? value === request.id
        : key === 'name'
          ? typeof value === 'string' && Boolean(value.trim())
          : key === 'hidden' || key === 'is_income'
            ? typeof value === 'boolean'
            : key === 'categories'
              ? Array.isArray(value) &&
                value.every(
                  category =>
                    category &&
                    typeof category === 'object' &&
                    !Array.isArray(category) &&
                    ['id', 'name', 'group_id'].every(
                      field => typeof category[field] === 'string',
                    ) &&
                    [category.hidden, category.is_income].every(
                      flag => flag === undefined || typeof flag === 'boolean',
                    ) &&
                    Object.keys(category).every(field =>
                      [
                        'id',
                        'name',
                        'group_id',
                        'is_income',
                        'hidden',
                      ].includes(field),
                    ),
                )
              : false;
    if (!valid) throw APIError('Invalid category group update fields');
  }
  const group = await db.first<db.DbCategoryGroup>(
    'SELECT * FROM category_groups WHERE id = ?',
    [request.id],
  );
  if (!group || group.tombstone) {
    throw APIError('Category group is no longer available');
  }
  const fields = categoryGroupModel.fromExternal({
    ...request.fields,
    id: request.id,
  });
  const patch = await db.inspectCategoryGroupUpdate(
    prepareCategoryGroupUpdate(fields),
  );
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'category-groups.update',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: {
      sourceHash: await inspectCopySource(metadata.budgetName),
      group: { ...group },
    },
    after: { ...group, ...patch },
    references: {
      groups: await db.all('SELECT * FROM category_groups ORDER BY id'),
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
    },
    sideEffects: [
      'update supplied category group fields through the canonical owner; preserve child categories, mappings, allocations and ledger rows',
    ],
  };
}
handlers['api/category-group-preview-update'] = withMutation(
  prepareGuardedCategoryGroupUpdate,
);
handlers['api/category-group-apply-update'] = withMutation(
  async (proposal): Promise<TransactionUpdateOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'category-groups.update'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported category group update proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: CategoryGroupUpdateProposal;
    try {
      current = await prepareGuardedCategoryGroupUpdate(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category group update scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category group or source references changed after preview',
      };
    }
    await performCategoryGroupUpdate(
      categoryGroupModel.fromExternal({
        ...current.request.fields,
        id: current.request.id,
      }),
    );
    const actual = await db.first<db.DbCategoryGroup>(
      'SELECT * FROM category_groups WHERE id = ?',
      [current.request.id],
    );
    if (canonicalJson(actual) !== canonicalJson(current.after)) {
      throw new Error(
        'Category group update acknowledgement does not match canonical plan',
      );
    }
    return {
      status: 'committed-local',
      changed: canonicalJson(current.before.group) !== canonicalJson(actual),
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [current.request.id],
    };
  },
);

async function prepareGuardedPayeeCreation(
  request: PayeeCreationRequest,
): Promise<PayeeCreationProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.name !== 'string' ||
    Object.keys(request).some(
      key => !['name', 'transfer_acct'].includes(key),
    ) ||
    (request.transfer_acct !== undefined &&
      typeof request.transfer_acct !== 'string')
  ) {
    throw APIError('Invalid payee creation request');
  }
  const payee = inspectPayeeCreation({ name: request.name });
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'payees.create',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: { sourceHash: await inspectCopySource(metadata.budgetName) },
    after: { payee: { ...payee }, mapping: { creates: true } },
    references: {
      payees: await db.all('SELECT * FROM payees ORDER BY id'),
      mappings: await db.all('SELECT * FROM payee_mapping ORDER BY id'),
    },
    sideEffects: [
      'create one payee and its self mapping through the canonical owner; preserve existing payees, mappings, ledger and allocations; supplied transfer_acct retains existing ignored creation semantics',
    ],
  };
}
handlers['api/payee-preview-creation'] = withMutation(
  prepareGuardedPayeeCreation,
);
handlers['api/payee-apply-creation'] = withMutation(
  async (proposal): Promise<PayeeCreationOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'payees.create'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported payee creation proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: PayeeCreationProposal;
    try {
      current = await prepareGuardedPayeeCreation(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Payee creation scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Payee or source references changed after preview',
      };
    }
    const id = await performPayeeCreation({
      name: current.request.name,
    });
    const actual = await db.first<db.DbPayee>(
      'SELECT * FROM payees WHERE id = ?',
      [id],
    );
    if (
      !actual ||
      Object.entries(current.after.payee).some(
        ([key, value]) => canonicalJson(actual[key]) !== canonicalJson(value),
      )
    ) {
      throw new Error('Payee creation acknowledgement is incomplete');
    }
    const mapping = await db.first<db.DbPayeeMapping>(
      'SELECT * FROM payee_mapping WHERE id = ?',
      [id],
    );
    if (!mapping || mapping.id !== id || mapping.targetId !== id) {
      throw new Error(
        'Payee creation self mapping acknowledgement is incomplete',
      );
    }
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [id],
      payeeCreation: { payeeId: id, mappingId: mapping.id },
    };
  },
);

// Guarded payee and tag catalog adapters. Owners provide read-only plans and
// canonical writers; guardedApply owns identity, staleness and receipts.
function guardedCatalogHandlers<
  Request,
  Proposal extends ChangeProposal,
  Outcome,
>(
  prepare: (request: Request) => Promise<Proposal>,
  apply: (proposal: Proposal) => Promise<Outcome>,
) {
  return {
    preview: withMutation(async (request: Request) => {
      checkFileOpen();
      return prepare(request);
    }),
    apply: withMutation(async (proposal: Proposal) => {
      checkFileOpen();
      return apply(proposal);
    }),
  };
}
{
  const payeeUpdate = guardedCatalogHandlers(
    preparePayeeUpdate,
    guardedApply({
      operation: 'payees.update',
      noun: 'Payee update',
      prepare: preparePayeeUpdate,
      perform: performPayeeUpdate,
    }),
  );
  handlers['api/payee-preview-update'] = payeeUpdate.preview;
  handlers['api/payee-apply-update'] = payeeUpdate.apply;
  const payeeDeletion = guardedCatalogHandlers(
    preparePayeeDeletion,
    guardedApply({
      operation: 'payees.delete',
      noun: 'Payee deletion',
      prepare: preparePayeeDeletion,
      perform: performPayeeDeletion,
    }),
  );
  handlers['api/payee-preview-deletion'] = payeeDeletion.preview;
  handlers['api/payee-apply-deletion'] = payeeDeletion.apply;
  const payeeMerge = guardedCatalogHandlers(
    preparePayeeMerge,
    guardedApply({
      operation: 'payees.merge',
      noun: 'Payee merge',
      prepare: preparePayeeMerge,
      perform: performPayeeMerge,
    }),
  );
  handlers['api/payee-preview-merge'] = payeeMerge.preview;
  handlers['api/payee-apply-merge'] = payeeMerge.apply;
  const tagCreation = guardedCatalogHandlers(
    prepareTagCreation,
    guardedApply({
      operation: 'tags.create',
      noun: 'Tag creation',
      prepare: prepareTagCreation,
      perform: performTagCreation,
    }),
  );
  handlers['api/tag-preview-creation'] = tagCreation.preview;
  handlers['api/tag-apply-creation'] = tagCreation.apply;
  const tagUpdate = guardedCatalogHandlers(
    prepareTagUpdate,
    guardedApply({
      operation: 'tags.update',
      noun: 'Tag update',
      prepare: prepareTagUpdate,
      perform: performTagUpdate,
    }),
  );
  handlers['api/tag-preview-update'] = tagUpdate.preview;
  handlers['api/tag-apply-update'] = tagUpdate.apply;
  const tagDeletion = guardedCatalogHandlers(
    prepareTagDeletion,
    guardedApply({
      operation: 'tags.delete',
      noun: 'Tag deletion',
      prepare: prepareTagDeletion,
      perform: performTagDeletion,
    }),
  );
  handlers['api/tag-preview-deletion'] = tagDeletion.preview;
  handlers['api/tag-apply-deletion'] = tagDeletion.apply;
  const noteSet = guardedCatalogHandlers(
    prepareNoteSet,
    guardedApply({
      operation: 'notes.set',
      noun: 'Note change',
      prepare: prepareNoteSet,
      perform: performNoteSet,
    }),
  );
  handlers['api/note-preview-set'] = noteSet.preview;
  handlers['api/note-apply-set'] = noteSet.apply;
  const preferenceSet = guardedCatalogHandlers(
    preparePreferenceSet,
    guardedApply({
      operation: 'preferences.set',
      noun: 'Preference change',
      prepare: preparePreferenceSet,
      perform: performPreferenceSet,
    }),
  );
  handlers['api/preference-preview-set'] = preferenceSet.preview;
  handlers['api/preference-apply-set'] = preferenceSet.apply;
  const transactionImport = guardedCatalogHandlers(
    prepareTransactionImport,
    guardedApply({
      operation: 'transactions.import',
      noun: 'Transaction import',
      prepare: prepareTransactionImport,
      perform: performTransactionImport,
    }),
  );
  handlers['api/transactions-preview-import'] = transactionImport.preview;
  handlers['api/transactions-apply-import'] = transactionImport.apply;
  const transactionAddition = guardedCatalogHandlers(
    prepareTransactionAddition,
    guardedApply({
      operation: 'transactions.add',
      noun: 'Transaction addition',
      prepare: prepareTransactionAddition,
      perform: performTransactionAddition,
    }),
  );
  handlers['api/transactions-preview-addition'] = transactionAddition.preview;
  handlers['api/transactions-apply-addition'] = transactionAddition.apply;
  const transactionDeletion = guardedCatalogHandlers(
    prepareTransactionDeletion,
    guardedApply({
      operation: 'transactions.delete',
      noun: 'Transaction deletion',
      prepare: prepareTransactionDeletion,
      perform: performTransactionDeletion,
    }),
  );
  handlers['api/transaction-preview-deletion'] = transactionDeletion.preview;
  handlers['api/transaction-apply-deletion'] = transactionDeletion.apply;
  const scheduleCreation = guardedCatalogHandlers(
    prepareScheduleCreation,
    guardedApply({
      operation: 'schedules.create',
      noun: 'Schedule creation',
      prepare: prepareScheduleCreation,
      perform: performScheduleCreation,
    }),
  );
  handlers['api/schedule-preview-creation'] = scheduleCreation.preview;
  handlers['api/schedule-apply-creation'] = scheduleCreation.apply;
  const scheduleUpdate = guardedCatalogHandlers(
    prepareScheduleUpdate,
    guardedApply({
      operation: 'schedules.update',
      noun: 'Schedule update',
      prepare: prepareScheduleUpdate,
      perform: performScheduleUpdate,
    }),
  );
  handlers['api/schedule-preview-update'] = scheduleUpdate.preview;
  handlers['api/schedule-apply-update'] = scheduleUpdate.apply;
  const scheduleDeletion = guardedCatalogHandlers(
    prepareScheduleDeletion,
    guardedApply({
      operation: 'schedules.delete',
      noun: 'Schedule deletion',
      prepare: prepareScheduleDeletion,
      perform: performScheduleDeletion,
    }),
  );
  handlers['api/schedule-preview-deletion'] = scheduleDeletion.preview;
  handlers['api/schedule-apply-deletion'] = scheduleDeletion.apply;
  const ruleCreation = guardedCatalogHandlers(
    prepareRuleCreation,
    guardedApply({
      operation: 'rules.create',
      noun: 'Rule creation',
      prepare: prepareRuleCreation,
      perform: performRuleCreation,
    }),
  );
  handlers['api/rule-preview-creation'] = ruleCreation.preview;
  handlers['api/rule-apply-creation'] = ruleCreation.apply;
  const ruleUpdate = guardedCatalogHandlers(
    prepareRuleUpdate,
    guardedApply({
      operation: 'rules.update',
      noun: 'Rule update',
      prepare: prepareRuleUpdate,
      perform: performRuleUpdate,
    }),
  );
  handlers['api/rule-preview-update'] = ruleUpdate.preview;
  handlers['api/rule-apply-update'] = ruleUpdate.apply;
  const ruleDeletion = guardedCatalogHandlers(
    prepareRuleDeletion,
    guardedApply({
      operation: 'rules.delete',
      noun: 'Rule deletion',
      prepare: prepareRuleDeletion,
      perform: performRuleDeletion,
    }),
  );
  handlers['api/rule-preview-deletion'] = ruleDeletion.preview;
  handlers['api/rule-apply-deletion'] = ruleDeletion.apply;
}

async function prepareGuardedCategoryGroupCreation(
  request: CategoryGroupCreationRequest,
): Promise<CategoryGroupCreationProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.name !== 'string' ||
    !request.name.trim() ||
    [request.is_income, request.hidden].some(
      value => value !== undefined && typeof value !== 'boolean',
    ) ||
    Object.keys(request).some(
      key => !['name', 'is_income', 'hidden', 'categories'].includes(key),
    ) ||
    (request.categories !== undefined &&
      (!Array.isArray(request.categories) ||
        request.categories.some(
          category =>
            !category ||
            typeof category !== 'object' ||
            Array.isArray(category) ||
            ['id', 'name', 'group_id'].some(
              key => typeof category[key] !== 'string',
            ) ||
            [category.is_income, category.hidden].some(
              value => value !== undefined && typeof value !== 'boolean',
            ) ||
            Object.keys(category).some(
              key =>
                !['id', 'name', 'group_id', 'is_income', 'hidden'].includes(
                  key,
                ),
            ),
        )))
  ) {
    throw APIError('Invalid category group creation request');
  }
  const group = await inspectCategoryGroupCreation({
    name: request.name,
    isIncome: request.is_income,
    hidden: request.hidden,
  });
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'category-groups.create',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: { sourceHash: await inspectCopySource(metadata.budgetName) },
    after: { group: { ...group } },
    references: {
      groups: await db.all('SELECT * FROM category_groups ORDER BY id'),
    },
    sideEffects: [
      'create one category group through the canonical owner; preserve existing groups, categories, mappings and allocations',
    ],
  };
}
handlers['api/category-group-preview-creation'] = withMutation(
  prepareGuardedCategoryGroupCreation,
);
handlers['api/category-group-apply-creation'] = withMutation(
  async (proposal): Promise<CategoryGroupCreationOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'category-groups.create'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported category group creation proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: CategoryGroupCreationProposal;
    try {
      current = await prepareGuardedCategoryGroupCreation(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category group creation scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Category group order or source references changed after preview',
      };
    }
    const id = await performCategoryGroupCreation({
      name: current.request.name,
      isIncome: current.request.is_income,
      hidden: current.request.hidden,
    });
    const actual = await db.first<db.DbCategoryGroup>(
      'SELECT * FROM category_groups WHERE id = ?',
      [id],
    );
    if (
      !actual ||
      Object.entries(current.after.group).some(
        ([key, value]) => canonicalJson(actual[key]) !== canonicalJson(value),
      )
    ) {
      throw new Error('Category group creation acknowledgement is incomplete');
    }
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [id],
      groupCreation: { groupId: id },
    };
  },
);

async function prepareGuardedCategoryCreation(
  request: CategoryCreationRequest,
): Promise<CategoryCreationProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.name !== 'string' ||
    !request.name.trim() ||
    typeof request.group_id !== 'string' ||
    !request.group_id.trim() ||
    [request.is_income, request.hidden].some(
      value => value !== undefined && typeof value !== 'boolean',
    ) ||
    Object.keys(request).some(
      key => !['name', 'group_id', 'is_income', 'hidden'].includes(key),
    )
  ) {
    throw APIError('Invalid category creation request');
  }
  const group = await db.first<db.DbCategoryGroup>(
    'SELECT * FROM category_groups WHERE id = ?',
    [request.group_id],
  );
  if (!group || group.tombstone) {
    throw APIError('Category group is no longer available');
  }
  const plan = await inspectCategoryCreation({
    name: request.name,
    groupId: request.group_id,
    isIncome: request.is_income,
    hidden: request.hidden,
  });
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'categories.create',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: { sourceHash: await inspectCopySource(metadata.budgetName) },
    after: {
      category: { ...plan.category },
      updatedCategories: plan.updates,
      mapping: { creates: true },
    },
    references: { group },
    sideEffects: [
      'create category and self mapping through the canonical budget/database owners',
      ...(plan.updates.length
        ? [
            'reorder existing category siblings according to canonical insertion order',
          ]
        : []),
    ],
  };
}
handlers['api/category-preview-creation'] = withMutation(
  prepareGuardedCategoryCreation,
);
handlers['api/category-apply-creation'] = withMutation(
  async (proposal): Promise<CategoryCreationOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'categories.create'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported category creation proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: CategoryCreationProposal;
    try {
      current = await prepareGuardedCategoryCreation(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category creation scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Category creation order or source references changed after preview',
      };
    }
    const id = await performCategoryCreation({
      name: current.request.name,
      groupId: current.request.group_id,
      isIncome: current.request.is_income,
      hidden: current.request.hidden,
    });
    const actual = await db.getCategory(id);
    const mapping = await db.first<{ id: string; transferId: string }>(
      'SELECT * FROM category_mapping WHERE id = ?',
      [id],
    );
    const siblings = await Promise.all(
      current.after.updatedCategories.map(row => db.getCategory(row.id)),
    );
    if (
      !actual ||
      !mapping ||
      mapping.transferId !== id ||
      Object.entries(current.after.category).some(
        ([key, value]) => canonicalJson(actual[key]) !== canonicalJson(value),
      ) ||
      current.after.updatedCategories.some(
        (row, index) => siblings[index]?.sort_order !== row.sort_order,
      )
    ) {
      throw new Error('Category creation acknowledgement is incomplete');
    }
    const updatedCategoryIds = current.after.updatedCategories.map(
      row => row.id,
    );
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [id, ...updatedCategoryIds],
      categoryCreation: {
        categoryId: id,
        mappingId: mapping.id,
        updatedCategoryIds,
      },
    };
  },
);

async function prepareGuardedCategoryGroupDeletion(
  request: CategoryGroupDeletionRequest,
): Promise<CategoryGroupDeletionProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(
      key => !['id', 'transferCategoryId'].includes(key),
    ) ||
    (request.transferCategoryId !== undefined &&
      (typeof request.transferCategoryId !== 'string' ||
        !request.transferCategoryId.trim() ||
        request.transferCategoryId === request.id))
  ) {
    throw APIError('Invalid category group deletion request');
  }
  const plan = await inspectCategoryGroupDeletion({
    id: request.id,
    transferId: request.transferCategoryId,
  });
  if (
    plan.group.tombstone ||
    plan.transfer?.tombstone ||
    (plan.transfer && plan.transfer.cat_group === request.id)
  ) {
    throw APIError('Category group deletion scope is no longer available');
  }
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'category-groups.delete',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: {
      sourceHash: await inspectCopySource(metadata.budgetName),
      group: { ...plan.group },
    },
    after: {
      group: { ...plan.group, ...plan.deletion.group },
      categories: (
        await db.all<db.DbCategory>(
          'SELECT * FROM categories WHERE cat_group = ? ORDER BY id',
          [request.id],
        )
      ).map(category => ({ ...category, tombstone: 1 })),
      mappings: plan.deletion.categories.flatMap(category => category.mappings),
      budgetTransfers: plan.budgetTransfers.map(row => ({
        month: row.month,
        category: row.category,
        amount: row.amount,
        table: row.before.table,
        before: row.before.row ? { ...row.before.row } : null,
      })),
    },
    references: {
      transfer: plan.transfer,
      budgetSources: plan.budgetTransfers.map(row => ({
        month: row.month,
        sources: row.sources,
      })),
      mappings: await db.all<db.DbCategoryMapping>(
        'SELECT * FROM category_mapping ORDER BY id',
      ),
    },
    sideEffects: [
      request.transferCategoryId
        ? 'tombstone the group and all child categories and forward existing mappings through the canonical deletion owner; preserve raw transaction rows'
        : 'tombstone the group and all child categories through the canonical deletion owner; preserve mappings, allocations and raw transaction rows',
      ...(plan.budgetTransfers.length
        ? [
            'transfer live child allocations for income and expense groups for every created month; preserve source allocation rows',
          ]
        : []),
    ],
  };
}
handlers['api/category-group-preview-deletion'] = withMutation(
  prepareGuardedCategoryGroupDeletion,
);
handlers['api/category-group-apply-deletion'] = withMutation(
  async (proposal): Promise<TransactionUpdateOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'category-groups.delete'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported category group deletion proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: CategoryGroupDeletionProposal;
    try {
      current = await prepareGuardedCategoryGroupDeletion(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category group deletion scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Category group deletion source or references changed after preview',
      };
    }
    await performCategoryGroupDeletion({
      id: current.request.id,
      transferId: current.request.transferCategoryId,
    });
    const group = await db.first<db.DbCategoryGroup>(
      'SELECT * FROM category_groups WHERE id = ?',
      [current.request.id],
    );
    if (canonicalJson(group) !== canonicalJson(current.after.group)) {
      throw new Error(
        'Group deletion acknowledgement does not match canonical tombstone',
      );
    }
    const affectedIds = new Set([current.request.id]);
    for (const expected of current.after.categories) {
      const actual = await db.getCategory(expected.id);
      if (canonicalJson(actual) !== canonicalJson(expected)) {
        throw new Error(
          'Group deletion acknowledgement does not match canonical child tombstone',
        );
      }
      affectedIds.add(expected.id);
    }
    for (const expected of current.after.mappings) {
      const mapping = await db.first<db.DbCategoryMapping>(
        'SELECT * FROM category_mapping WHERE id = ?',
        [expected.id],
      );
      if (!mapping || canonicalJson(mapping) !== canonicalJson(expected)) {
        throw new Error(
          'Category group deletion acknowledgement does not match canonical mapping',
        );
      }
      affectedIds.add(mapping.id);
    }
    for (const expected of current.after.budgetTransfers) {
      const actual = inspectBudgetAmount({
        month: expected.month,
        category: expected.category,
      });
      if (
        actual.table !== expected.table ||
        !actual.row ||
        actual.amount !== expected.amount ||
        (expected.before &&
          canonicalJson(actual.row) !==
            canonicalJson({ ...expected.before, amount: expected.amount }))
      ) {
        throw new Error(
          'Category group deletion acknowledgement does not match canonical allocation',
        );
      }
      affectedIds.add(actual.row.id);
    }
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [...affectedIds],
    };
  },
);

async function prepareGuardedCategoryDeletion(
  request: CategoryDeletionRequest,
): Promise<CategoryDeletionProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(
      key => !['id', 'transferCategoryId'].includes(key),
    ) ||
    (request.transferCategoryId !== undefined &&
      (typeof request.transferCategoryId !== 'string' ||
        !request.transferCategoryId.trim() ||
        request.transferCategoryId === request.id))
  ) {
    throw APIError('Invalid category deletion request');
  }
  const plan = await inspectCategoryDeletion({
    id: request.id,
    transferId: request.transferCategoryId,
  });
  if (plan.category.tombstone || plan.transfer?.tombstone) {
    throw APIError('Category deletion scope is no longer available');
  }
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'categories.delete',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: {
      sourceHash: await inspectCopySource(metadata.budgetName),
      category: { ...plan.category },
    },
    after: {
      category: { ...plan.category, ...plan.deletion.category },
      mappings: plan.deletion.mappings,
      budgetTransfers: plan.budgetTransfers.map(row => ({
        month: row.month,
        category: row.category,
        amount: row.amount,
        table: row.before.table,
        before: row.before.row ? { ...row.before.row } : null,
      })),
    },
    references: {
      transfer: plan.transfer,
      budgetSources: plan.budgetTransfers.map(row => ({
        month: row.month,
        sources: row.sources,
      })),
      mappings: await db.all<db.DbCategoryMapping>(
        'SELECT * FROM category_mapping ORDER BY id',
      ),
    },
    sideEffects: [
      request.transferCategoryId
        ? 'tombstone the category and forward existing mappings through the canonical deletion owner; preserve raw transaction rows'
        : 'tombstone the category through the canonical deletion owner; preserve mappings, allocations and raw transaction rows',
      ...(plan.budgetTransfers.length
        ? [
            'transfer expense allocations for every created month; preserve source allocation rows',
          ]
        : []),
    ],
  };
}
handlers['api/category-preview-deletion'] = withMutation(
  prepareGuardedCategoryDeletion,
);
handlers['api/category-apply-deletion'] = withMutation(
  async (proposal): Promise<TransactionUpdateOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'categories.delete'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported category deletion proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: CategoryDeletionProposal;
    try {
      current = await prepareGuardedCategoryDeletion(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category deletion scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category deletion source or references changed after preview',
      };
    }
    await performCategoryDeletion({
      id: current.request.id,
      transferId: current.request.transferCategoryId,
    });
    const category = await db.getCategory(current.request.id);
    if (canonicalJson(category) !== canonicalJson(current.after.category)) {
      throw new Error(
        'Category deletion acknowledgement does not match canonical tombstone',
      );
    }
    const affectedIds = new Set([current.request.id]);
    for (const expected of current.after.mappings) {
      const mapping = await db.first<db.DbCategoryMapping>(
        'SELECT * FROM category_mapping WHERE id = ?',
        [expected.id],
      );
      if (!mapping || canonicalJson(mapping) !== canonicalJson(expected)) {
        throw new Error(
          'Category deletion acknowledgement does not match canonical mapping',
        );
      }
      affectedIds.add(mapping.id);
    }
    for (const expected of current.after.budgetTransfers) {
      const actual = inspectBudgetAmount({
        month: expected.month,
        category: expected.category,
      });
      if (
        actual.table !== expected.table ||
        !actual.row ||
        actual.amount !== expected.amount ||
        (expected.before &&
          canonicalJson(actual.row) !==
            canonicalJson({ ...expected.before, amount: expected.amount }))
      ) {
        throw new Error(
          'Category deletion acknowledgement does not match canonical allocation',
        );
      }
      affectedIds.add(actual.row.id);
    }
    return {
      status: 'committed-local',
      changed: true,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [...affectedIds],
    };
  },
);

async function prepareGuardedCategoryUpdate(
  request: CategoryUpdateRequest,
): Promise<CategoryUpdateProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !request.fields ||
    typeof request.fields !== 'object' ||
    Array.isArray(request.fields) ||
    !Object.keys(request.fields).length
  ) {
    throw APIError('Invalid category update request');
  }
  for (const [key, value] of Object.entries(request.fields)) {
    const valid =
      key === 'id'
        ? value === request.id
        : key === 'name' || key === 'group_id'
          ? typeof value === 'string' && Boolean(value.trim())
          : key === 'hidden' || key === 'is_income'
            ? typeof value === 'boolean'
            : false;
    if (!valid) {
      throw APIError('Invalid category update fields');
    }
  }
  const category = await db.getCategory(request.id);
  if (!category || category.tombstone) {
    throw APIError('Category is no longer available');
  }
  const destinationGroupId = request.fields.group_id ?? category.cat_group;
  const group = await db.first<db.DbCategoryGroup>(
    'SELECT * FROM category_groups WHERE id = ?',
    [destinationGroupId],
  );
  if (!group || group.tombstone) {
    throw APIError('Category group is no longer available');
  }
  const { group_id, ...fields } = request.fields;
  const patch = prepareCategoryUpdate({
    ...fields,
    id: request.id,
    ...(group_id === undefined ? {} : { group: group_id }),
  });
  const metadata = prefs.getPrefs();
  return {
    schemaVersion: 1,
    operation: 'categories.update',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request,
    before: {
      sourceHash: await inspectCopySource(metadata.budgetName),
      category: { ...category },
    },
    after: { ...category, ...patch },
    references: { group },
    sideEffects: [
      'update supplied category fields through the canonical budget owner; preserve allocations, mappings, templates and ledger rows',
    ],
  };
}
handlers['api/category-preview-update'] = withMutation(
  prepareGuardedCategoryUpdate,
);
handlers['api/category-apply-update'] = withMutation(
  async (proposal): Promise<TransactionUpdateOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'categories.update'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported category update proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: CategoryUpdateProposal;
    try {
      current = await prepareGuardedCategoryUpdate(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category update scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Category or source references changed after preview',
      };
    }
    const { group_id, ...fields } = current.request.fields;
    await performCategoryUpdate({
      ...fields,
      id: current.request.id,
      ...(group_id === undefined ? {} : { group: group_id }),
    });
    const actual = await db.getCategory(current.request.id);
    if (canonicalJson(actual) !== canonicalJson(current.after)) {
      throw new Error(
        'Category update acknowledgement does not match canonical plan',
      );
    }
    return {
      status: 'committed-local',
      changed: canonicalJson(current.before.category) !== canonicalJson(actual),
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [current.request.id],
    };
  },
);

async function prepareAccountClosure(
  request: AccountCloseRequest,
  seed: AccountCloseSeed = {
    id: uuidv4(),
    date: monthUtils.currentDay(),
    sortOrder: Date.now(),
  },
): Promise<AccountCloseProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(
      key => !['id', 'transferAccountId', 'categoryId'].includes(key),
    ) ||
    [request.transferAccountId, request.categoryId].some(
      value =>
        value !== undefined && (typeof value !== 'string' || !value.trim()),
    )
  ) {
    throw APIError('Invalid account closure request');
  }
  if (
    !seed ||
    typeof seed.id !== 'string' ||
    !seed.id.trim() ||
    typeof seed.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(seed.date) ||
    !Number.isFinite(Date.parse(`${seed.date}T00:00:00Z`)) ||
    new Date(`${seed.date}T00:00:00Z`).toISOString().slice(0, 10) !==
      seed.date ||
    !Number.isFinite(seed.sortOrder) ||
    Object.keys(seed).some(key => !['id', 'date', 'sortOrder'].includes(key)) ||
    (await db.first('SELECT id FROM transactions WHERE id = ?', [seed.id]))
  ) {
    throw APIError('Invalid closing transfer seed');
  }
  const inspected = await inspectAccountClosure(request);
  if (inspected.account.tombstone) {
    throw APIError('Account is no longer available');
  }
  const metadata = prefs.getPrefs();
  const sourceHash = await inspectCopySource(metadata.budgetName);
  const action =
    inspected.account.closed === 1
      ? 'unchanged'
      : inspected.numTransactions === 0
        ? 'deleted'
        : 'closed';
  let source: AccountCloseProposal['after']['source'] = null;
  let counterpart: AccountCloseProposal['after']['counterpart'] = null;
  if (
    action === 'closed' &&
    inspected.balance !== 0 &&
    request.transferAccountId
  ) {
    const closingTransaction = makeAccountClosingTransaction(
      inspected,
      request.categoryId,
      seed,
    );
    source = {
      ...closingTransaction,
      category:
        inspected.account.offbudget === 1
          ? null
          : (closingTransaction.category ?? null),
    };
    const prepared = await prepareTransferTransaction(
      closingTransaction,
      request.transferAccountId,
      { plannedTransactions: [closingTransaction] },
    );
    if (!prepared || !inspected.destinationAccount) {
      throw APIError('Closing transfer preparation is incomplete');
    }
    counterpart = {
      ...prepared,
      schedule: prepared.schedule ?? null,
      category: null,
    };
    if (prepared.schedule) {
      source.schedule = prepared.schedule;
    }
    if (
      transferClearsCategory(
        inspected.account.offbudget,
        inspected.destinationAccount.offbudget,
      )
    ) {
      source.category = null;
    }
  }
  return {
    schemaVersion: 1,
    operation: 'accounts.close',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request: {
      id: request.id,
      ...(request.transferAccountId === undefined
        ? {}
        : { transferAccountId: request.transferAccountId }),
      ...(request.categoryId === undefined
        ? {}
        : { categoryId: request.categoryId }),
    },
    seed,
    before: { sourceHash },
    after: {
      action,
      source,
      counterpart,
      unlink: {
        clearFields: inspected.account.bank
          ? [
              'account_id',
              'bank',
              'balance_current',
              'balance_available',
              'balance_limit',
              'account_sync_source',
              'bank_sync_status',
            ]
          : [],
        remoteRemoval: inspected.unlink.remoteRemoval,
        hasToken: inspected.unlink.hasToken,
      },
    },
    references: inspected,
    sideEffects: [
      'unlink local bank/provider fields when linked',
      ...(inspected.unlink.remoteRemoval
        ? [
            'attempt irreversible provider requisition removal; response failures remain uncertain',
          ]
        : []),
      ...(source
        ? [
            'insert closing source and reciprocal transfer through the canonical transaction owner; apply counterpart notes, cleared and schedule rules; clear categories according to account scope',
          ]
        : []),
      action === 'deleted'
        ? 'delete empty account'
        : action === 'closed'
          ? 'close account'
          : 'already-closed account preserves ledger and account after unlink',
    ],
  };
}
handlers['api/account-preview-closure'] = withMutation(
  (request: AccountCloseRequest) => prepareAccountClosure(request),
);
handlers['api/account-apply-closure'] = withMutation(
  async (proposal): Promise<AccountCloseOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'accounts.close'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported account closure proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: AccountCloseProposal;
    try {
      current = await prepareAccountClosure(proposal.request, proposal.seed);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Account closure scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message:
          'Account, ledger, rules or unlink references changed after preview',
      };
    }
    const accountClosure = await performAccountClosure({
      ...current.request,
      closingSeed: current.seed,
    });
    return {
      status: 'committed-local',
      changed:
        accountClosure.action !== 'unchanged' ||
        accountClosure.unlink.localChanged,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [
        ...new Set([
          accountClosure.accountId,
          ...accountClosure.addedTransactionIds,
        ]),
      ],
      accountClosure,
    };
  },
);

async function prepareAccountDeletion(
  request: AccountDeletionRequest,
): Promise<AccountDeletionProposal> {
  checkFileOpen();
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id.trim() ||
    Object.keys(request).some(key => key !== 'id')
  ) {
    throw APIError('Invalid account deletion request');
  }
  const inspected = await inspectAccountClosure({
    id: request.id,
    forced: true,
  });
  if (inspected.account.tombstone) {
    throw APIError('Account is no longer available');
  }
  const metadata = prefs.getPrefs();
  const source = await inspectCopySource(metadata.budgetName);
  const willDelete = inspected.account.closed !== 1;
  const deletesLedger = willDelete && inspected.numTransactions > 0;
  return {
    schemaVersion: 1,
    operation: 'accounts.delete',
    budget: {
      id: metadata.id,
      syncId: metadata.groupId ?? null,
      cloudFileId: metadata.cloudFileId ?? null,
    },
    request: { id: request.id },
    before: {
      sourceHash: source,
      account: inspected.account,
      transactions: inspected.transactions,
      counterparts: inspected.counterparts.map(row => row ?? null),
    },
    after: {
      action: willDelete ? 'deleted' : 'unchanged',
      deletedTransactionIds: deletesLedger
        ? inspected.transactions
            .map(row => row.id)
            .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        : [],
      updatedTransactionIds: deletesLedger
        ? inspected.transactions
            .flatMap(row => (row.transfer_id ? [row.transfer_id] : []))
            .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        : [],
      deletedPayeeIds:
        deletesLedger && inspected.sourceTransferPayee
          ? [inspected.sourceTransferPayee.id]
          : [],
      unlink: {
        clearFields: inspected.account.bank
          ? [
              'account_id',
              'bank',
              'balance_current',
              'balance_available',
              'balance_limit',
              'account_sync_source',
              'bank_sync_status',
            ]
          : [],
        remoteRemoval: inspected.unlink.remoteRemoval,
        hasToken: inspected.unlink.hasToken,
      },
    },
    references: inspected,
    sideEffects: [
      'unlink local bank/provider fields when linked',
      ...(inspected.unlink.remoteRemoval
        ? [
            'attempt irreversible provider requisition removal; response failures remain uncertain',
          ]
        : []),
      ...(deletesLedger
        ? [
            'delete source ledger rows and transfer payee; clear reciprocal payee and transfer references without changing counterpart amounts',
          ]
        : []),
      ...(willDelete
        ? ['delete account']
        : [
            'already-closed account preserves its ledger and account after unlink',
          ]),
    ],
  };
}
handlers['api/account-preview-deletion'] = withMutation(prepareAccountDeletion);
handlers['api/account-apply-deletion'] = withMutation(
  async (proposal): Promise<AccountDeletionOutcome> => {
    checkFileOpen();
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== 'accounts.delete'
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: 'Unsupported account deletion proposal',
      };
    }
    const metadata = prefs.getPrefs();
    if (
      canonicalJson(proposal.budget) !==
      canonicalJson({
        id: metadata.id,
        syncId: metadata.groupId ?? null,
        cloudFileId: metadata.cloudFileId ?? null,
      })
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: AccountDeletionProposal;
    try {
      current = await prepareAccountDeletion(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Account deletion scope is no longer available',
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: 'Account, ledger or unlink references changed after preview',
      };
    }
    const accountClosure = await performAccountClosure({
      id: current.request.id,
      forced: true,
    });
    return {
      status: 'committed-local',
      changed:
        accountClosure.action !== 'unchanged' ||
        accountClosure.unlink.localChanged,
      checkpoint: getClock().timestamp.toString(),
      affectedIds: [
        ...new Set([
          accountClosure.accountId,
          ...accountClosure.deletedTransactionIds,
          ...accountClosure.updatedTransactionIds,
          ...accountClosure.deletedPayeeIds,
        ]),
      ],
      accountClosure,
    };
  },
);

handlers['api/account-close'] = withMutation(async function ({
  id,
  transferAccountId,
  transferCategoryId,
}) {
  checkFileOpen();
  return handlers['account-close']({
    id,
    transferAccountId,
    categoryId: transferCategoryId,
  });
});

handlers['api/account-reopen'] = withMutation(performAccountReopen);

handlers['api/account-delete'] = withMutation(async function ({ id }) {
  checkFileOpen();
  return handlers['account-close']({ id, forced: true });
});

handlers['api/account-balance'] = withMutation(async function ({
  id,
  cutoff = new Date(),
}) {
  checkFileOpen();
  return handlers['account-balance']({ id, cutoff });
});

handlers['api/account-groups-get'] = async function () {
  checkFileOpen();
  const groups = await handlers['account-groups-get']();
  return groups.map(group => accountGroupModel.toExternal(group));
};

handlers['api/account-group-create'] = withMutation(async function ({ group }) {
  checkFileOpen();
  return handlers['account-group-create']({ name: group.name });
});

handlers['api/account-group-update'] = withMutation(async function ({
  id,
  fields,
}) {
  checkFileOpen();
  const group = accountGroupModel.fromExternal(fields);
  if (group.name == null) {
    throw APIError('Account group name is required');
  }
  return handlers['account-group-update']({ id, name: group.name });
});

handlers['api/account-group-delete'] = withMutation(async function ({ id }) {
  checkFileOpen();
  await handlers['account-group-delete']({ id });
});

handlers['api/categories-get'] = async function ({
  hidden,
}: { hidden?: boolean } = {}) {
  checkFileOpen();
  const result = await handlers['get-categories']({ hidden });
  return result.list.map(category => categoryModel.toExternal(category));
};

handlers['api/category-groups-get'] = async function ({
  hidden,
}: { hidden?: boolean } = {}) {
  checkFileOpen();
  const groups = await handlers['get-category-groups']({ hidden });
  return groups.map(group => categoryGroupModel.toExternal(group));
};

handlers['api/category-group-create'] = withMutation(async function ({
  group,
}) {
  checkFileOpen();
  return handlers['category-group-create']({
    name: group.name,
    isIncome: group.is_income,
    hidden: group.hidden,
  });
});

handlers['api/category-group-update'] = withMutation(async function ({
  id,
  fields,
}) {
  checkFileOpen();
  return handlers['category-group-update']({
    id,
    // @ts-expect-error - fix me
    ...categoryGroupModel.fromExternal(fields),
  });
});

handlers['api/category-group-delete'] = withMutation(async function ({
  id,
  transferCategoryId,
}) {
  checkFileOpen();
  return handlers['category-group-delete']({
    id,
    transferId: transferCategoryId,
  });
});

handlers['api/category-create'] = withMutation(async function ({ category }) {
  checkFileOpen();
  return handlers['category-create']({
    name: category.name,
    groupId: category.group_id,
    isIncome: category.is_income,
    hidden: category.hidden,
  });
});

handlers['api/category-update'] = withMutation(async function ({ id, fields }) {
  checkFileOpen();
  return handlers['category-update']({
    id,
    // @ts-expect-error - fix me
    ...categoryModel.fromExternal(fields),
  });
});

handlers['api/category-delete'] = withMutation(async function ({
  id,
  transferCategoryId,
}) {
  checkFileOpen();
  return handlers['category-delete']({
    id,
    transferId: transferCategoryId,
  });
});

handlers['api/note-get'] = async function ({ id }) {
  checkFileOpen();
  return handlers['notes-get']({ id });
};

// Read-only: resolves a note ID to its live target and returns the stored
// text, or null when no note exists. A missing note is never created.
handlers['api/note-target'] = async function ({ id }) {
  checkFileOpen();
  const target = await resolveNoteTarget(id);
  const row = await readNote(id);
  return { target, note: row?.note ?? null };
};

// Read-only typed preference catalog with current values; unset keys report
// null and nothing is written.
handlers['api/preferences-inspect'] = async function ({ key } = {}) {
  checkFileOpen();
  return inspectPreferences(key);
};

// Read-only catalog inspection with hidden/deleted status, mapping targets,
// resolved transaction counts and same-name duplicates.
handlers['api/catalog-inspect'] = async function (arg) {
  checkFileOpen();
  return inspectCatalog(arg);
};

handlers['api/note-update'] = withMutation(async function ({ id, note }) {
  checkFileOpen();
  return handlers['notes-save']({ id, note });
});

handlers['api/common-payees-get'] = async function () {
  checkFileOpen();
  const payees = await handlers['common-payees-get']();
  return payees.map(payee => payeeModel.toExternal(payee));
};

handlers['api/payees-get'] = async function () {
  checkFileOpen();
  const payees = await handlers['payees-get']();
  return payees.map(payee => payeeModel.toExternal(payee));
};

handlers['api/payee-create'] = withMutation(async function ({ payee }) {
  checkFileOpen();
  return handlers['payee-create']({ name: payee.name });
});

handlers['api/payee-update'] = withMutation(async function ({ id, fields }) {
  checkFileOpen();
  return handlers['payees-batch-change']({
    // @ts-expect-error - fix me
    updated: [{ id, ...payeeModel.fromExternal(fields) }],
  });
});

handlers['api/payee-delete'] = withMutation(async function ({ id }) {
  checkFileOpen();
  return handlers['payees-batch-change']({ deleted: [{ id }] });
});

handlers['api/payees-merge'] = withMutation(async function ({
  targetId,
  mergeIds,
}) {
  checkFileOpen();
  return handlers['payees-merge']({ targetId, mergeIds });
});

handlers['api/tags-get'] = async function () {
  checkFileOpen();
  const tags = await handlers['tags-get']();
  return tags.map(tag => tagModel.toExternal(tag));
};

handlers['api/tag-create'] = withMutation(async function ({ tag }) {
  checkFileOpen();
  const result = await handlers['tags-create']({
    tag: tag.tag,
    color: tag.color,
    description: tag.description,
  });
  return result.id;
});

handlers['api/tag-update'] = withMutation(async function ({ id, fields }) {
  checkFileOpen();
  await handlers['tags-update']({ id, ...tagModel.fromExternal(fields) });
});

handlers['api/tag-delete'] = withMutation(async function ({ id }) {
  checkFileOpen();
  await handlers['tags-delete']({ id });
});

handlers['api/payee-location-create'] = withMutation(async function ({
  payeeId,
  latitude,
  longitude,
}) {
  checkFileOpen();
  return handlers['payee-location-create']({ payeeId, latitude, longitude });
});

handlers['api/payee-locations-get'] = async function ({ payeeId }) {
  checkFileOpen();
  return handlers['payee-locations-get']({ payeeId });
};

handlers['api/payee-location-delete'] = withMutation(async function ({ id }) {
  checkFileOpen();
  return handlers['payee-location-delete']({ id });
});

handlers['api/payees-get-nearby'] = async function ({
  latitude,
  longitude,
  maxDistance,
}) {
  checkFileOpen();
  return handlers['payees-get-nearby']({ latitude, longitude, maxDistance });
};

handlers['api/rules-get'] = async function () {
  checkFileOpen();
  return handlers['rules-get']();
};

handlers['api/payee-rules-get'] = async function ({ id }) {
  checkFileOpen();
  return handlers['payees-get-rules']({ id });
};

handlers['api/rule-create'] = withMutation(async function ({ rule }) {
  checkFileOpen();
  const addedRule = await handlers['rule-add'](ruleModel.fromExternal(rule));

  if ('error' in addedRule) {
    throw APIError('Failed creating a new rule', addedRule.error);
  }

  return addedRule;
});

handlers['api/rule-update'] = withMutation(async function ({ rule }) {
  checkFileOpen();
  const updatedRule = await handlers['rule-update'](
    ruleModel.fromExternal(rule),
  );

  if ('error' in updatedRule) {
    throw APIError('Failed updating the rule', updatedRule.error);
  }

  return updatedRule;
});

handlers['api/rule-delete'] = withMutation(async function (id) {
  checkFileOpen();
  return handlers['rule-delete'](id);
});

handlers['api/schedules-get'] = async function () {
  checkFileOpen();
  const { data } = await aqlQuery(q('schedules').select('*'));
  const schedules = data as ScheduleEntity[];
  return schedules.map(schedule => scheduleModel.toExternal(schedule));
};

handlers['api/schedule-create'] = withMutation(async function (
  schedule: Omit<APIScheduleEntity, 'id'>,
) {
  checkFileOpen();
  const internalSchedule = scheduleModel.fromExternal({ ...schedule, id: '' });
  const partialSchedule = {
    name: internalSchedule.name,
    posts_transaction: internalSchedule.posts_transaction,
  };
  return handlers['schedule/create']({
    schedule: partialSchedule,
    conditions: internalSchedule._conditions,
  });
});

handlers['api/schedule-update'] = withMutation(async function ({
  id,
  fields,
  resetNextDate,
}) {
  checkFileOpen();
  const { data } = await aqlQuery(q('schedules').filter({ id }).select('*'));
  if (!data || data.length === 0) {
    throw APIError(`Schedule ${id} not found`);
  }

  const sched = data[0] as ScheduleEntity;
  const conditionsUpdated = await applyApiScheduleFields(sched, fields);

  if (conditionsUpdated) {
    return handlers['schedule/update']({
      schedule: {
        id: sched.id,
        posts_transaction: sched.posts_transaction,
        name: sched.name,
      },
      conditions: sched._conditions,
      resetNextDate,
    });
  } else {
    return sched.id;
  }
});

handlers['api/schedule-delete'] = withMutation(async function (id: string) {
  checkFileOpen();
  return handlers['schedule/delete']({ id });
});

handlers['api/get-id-by-name'] = async function ({ type, name }) {
  checkFileOpen();

  const allowedTypes = ['payees', 'categories', 'schedules', 'accounts'];

  if (!allowedTypes.includes(type)) {
    throw APIError('Provide a valid type');
  }

  const { data } = await aqlQuery(q(type).filter({ name }).select('*'));

  if (!data || data.length === 0) {
    throw APIError(`Not found: ${type} with name ${name}`);
  }

  return data[0].id;
};

handlers['api/get-server-version'] = async function () {
  return handlers['get-server-version']();
};

export function installAPI(serverHandlers: ServerHandlers) {
  const merged = Object.assign({}, serverHandlers, handlers);
  handlers = merged as Handlers;
  return merged;
}
