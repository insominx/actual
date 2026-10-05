import { send } from '@actual-app/core/platform/client/connection';
import type {
  APIAccountEntity,
  APIAccountGroupEntity,
  APICategoryEntity,
  APICategoryGroupEntity,
  APIFileEntity,
  APIPayeeEntity,
  APIRuleEntity,
  APIScheduleEntity,
  APITagEntity,
} from '@actual-app/core/server/api-models';
import {
  describeQuerySchema,
  validateQuery as validateCoreQuery,
} from '@actual-app/core/server/aql/schema-metadata';
import type {
  QuerySchemaMetadata,
  QueryValidation,
} from '@actual-app/core/server/aql/schema-metadata';
import type { ImportableBudgetType } from '@actual-app/core/server/importers/index';
import type { Query } from '@actual-app/core/shared/query';
import type { ImportTransactionsOpts } from '@actual-app/core/types/api-handlers';
import type {
  AccountCloseProposal,
  AccountCloseRequest,
  AccountCreationOutcome,
  AccountCreationProposal,
  AccountCreationRequest,
  AccountDeletionProposal,
  AccountDeletionRequest,
  AccountGroupCreationProposal,
  AccountGroupCreationRequest,
  AccountGroupDeletionProposal,
  AccountGroupDeletionRequest,
  AccountGroupUpdateProposal,
  AccountGroupUpdateRequest,
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
  CategoryCreationProposal,
  CategoryCreationRequest,
  CategoryDeletionProposal,
  CategoryDeletionRequest,
  CategoryGroupCreationProposal,
  CategoryGroupCreationRequest,
  CategoryGroupDeletionProposal,
  CategoryGroupDeletionRequest,
  CategoryGroupUpdateProposal,
  CategoryGroupUpdateRequest,
  CategoryUpdateProposal,
  CategoryUpdateRequest,
  NoteSetProposal,
  NoteSetRequest,
  PayeeCreationProposal,
  PayeeCreationRequest,
  PayeeDeletionProposal,
  PayeeDeletionRequest,
  PayeeMergeProposal,
  PayeeMergeRequest,
  PayeeUpdateProposal,
  PayeeUpdateRequest,
  PreferenceSetProposal,
  PreferenceSetRequest,
  RuleCreationProposal,
  RuleCreationRequest,
  RuleDeletionProposal,
  RuleDeletionRequest,
  RuleUpdateProposal,
  RuleUpdateRequest,
  ScheduleCreationProposal,
  ScheduleCreationRequest,
  ScheduleDeletionProposal,
  ScheduleDeletionRequest,
  ScheduleUpdateProposal,
  ScheduleUpdateRequest,
  TagCreationProposal,
  TagCreationRequest,
  TagDeletionProposal,
  TagDeletionRequest,
  TagUpdateProposal,
  TagUpdateRequest,
  TransactionAdditionProposal,
  TransactionAdditionRequest,
  TransactionCategorizationProposal,
  TransactionCategorizationRequest,
  TransactionDeletionProposal,
  TransactionDeletionRequest,
  TransactionImportProposal,
  TransactionImportRequest,
  TransactionMergeProposal,
  TransactionMergeRequest,
  TransactionSplitProposal,
  TransactionSplitRequest,
  TransactionUpdateProposal,
  TransactionUpdateRequest,
} from '@actual-app/core/types/change-proposals';
import type {
  ImportTransactionEntity,
  NoteEntity,
  RuleEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';
import type { SyncedPrefs } from '@actual-app/core/types/prefs';

export { q } from './app/query';
export type {
  CategoryCreationOutcome,
  TransactionImportRequest,
  TransactionImportProposal,
  TransactionImportOutcome,
  TransactionAdditionRequest,
  TransactionAdditionProposal,
  TransactionAdditionOutcome,
  TransactionDeletionRequest,
  TransactionDeletionProposal,
  TransactionCategorizationRequest,
  TransactionCategorizationProposal,
  TransactionMergeRequest,
  TransactionMergeProposal,
  TransactionMergeOutcome,
  TransactionSplitRequest,
  TransactionSplitProposal,
  TransactionSplitOutcome,
  ScheduleCreationRequest,
  ScheduleUpdateRequest,
  ScheduleDeletionRequest,
  ScheduleCreationProposal,
  ScheduleUpdateProposal,
  ScheduleDeletionProposal,
  ScheduleCreationOutcome,
  RuleCreationRequest,
  RuleUpdateRequest,
  RuleDeletionRequest,
  RuleCreationProposal,
  RuleUpdateProposal,
  RuleDeletionProposal,
  RuleCreationOutcome,
  PayeeUpdateRequest,
  PayeeUpdateProposal,
  PayeeDeletionRequest,
  PayeeDeletionProposal,
  PayeeMergeRequest,
  PayeeMergeProposal,
  TagCreationRequest,
  TagCreationProposal,
  TagUpdateRequest,
  TagUpdateProposal,
  TagDeletionRequest,
  TagDeletionProposal,
  NoteSetRequest,
  NoteSetProposal,
  NoteTarget,
  AccountGroupCreationRequest,
  AccountGroupCreationProposal,
  AccountGroupCreationOutcome,
  AccountGroupUpdateRequest,
  AccountGroupUpdateProposal,
  AccountGroupDeletionRequest,
  AccountGroupDeletionProposal,
  PreferenceSetRequest,
  PreferenceSetProposal,
  PayeeMergeOutcome,
  TagCreationOutcome,
  PayeeCreationOutcome,
  PayeeCreationProposal,
  PayeeCreationRequest,
  CategoryGroupCreationOutcome,
  CategoryGroupDeletionProposal,
  CategoryGroupDeletionRequest,
  CategoryGroupUpdateProposal,
  CategoryGroupUpdateRequest,
  CategoryGroupCreationProposal,
  CategoryGroupCreationRequest,
  CategoryCreationProposal,
  CategoryCreationRequest,
  CategoryDeletionProposal,
  CategoryDeletionRequest,
  CategoryUpdateProposal,
  CategoryUpdateRequest,
  AccountCloseProposal,
  AccountCloseRequest,
  AccountCloseOutcome,
  AccountCloseSeed,
  AccountDeletionRequest,
  AccountDeletionProposal,
  AccountDeletionOutcome,
  AccountCreationOutcome,
  AccountCreationProposal,
  AccountCreationRequest,
  AccountUpdateProposal,
  AccountUpdateRequest,
  AccountReopenProposal,
  AccountReopenRequest,
  BudgetCloneProposal,
  BudgetCloneRequest,
  BudgetCreationProposal,
  BudgetCreationRequest,
  BudgetAmountProposal,
  BudgetAmountRequest,
  ChangeProposal,
  BudgetHoldProposal,
  BudgetHoldRequest,
  BudgetCarryoverProposal,
  BudgetCarryoverRequest,
  BudgetMetadataProposal,
  BudgetMetadataRequest,
  BudgetRestoreProposal,
  BudgetRestoreRequest,
  BudgetPublicationOutcome,
  BudgetPublicationProposal,
  BudgetPublicationRequest,
  TransactionUpdateRequest,
  TransactionUpdateProposal,
  TransactionUpdateOutcome,
} from '@actual-app/core/types/change-proposals';

/** Preview initial publication without preparing a remote identity. */
export function previewBudgetPublication(request: BudgetPublicationRequest) {
  return send('api/budget-preview-publication', request);
}
/** Publish the exact source and mode. Credentials never enter the proposal. */
export function applyBudgetPublication(
  proposal: BudgetPublicationProposal,
  { encryptionPassword }: { encryptionPassword?: string } = {},
): Promise<BudgetPublicationOutcome> {
  return send('api/budget-apply-publication', { proposal, encryptionPassword });
}
/** Recover only a remotely accepted retained identity; never submit an initial upload. */
export function recoverBudgetPublication(
  proposal: BudgetPublicationProposal,
  { encryptionPassword }: { encryptionPassword?: string } = {},
): Promise<BudgetPublicationOutcome> {
  return send('api/budget-recover-publication', {
    proposal,
    encryptionPassword,
  });
}

/** Preview an archive-bound restore without creating a destination. */
export function previewBudgetRestore(
  input: ArrayBuffer | Uint8Array,
  request: BudgetRestoreRequest,
) {
  return send('api/budget-preview-restore', {
    buffer: toArrayBuffer(input),
    request,
  });
}

/** Restore the exact previewed archive as a new local identity. */
export function applyBudgetRestore(
  proposal: BudgetRestoreProposal,
  input: ArrayBuffer | Uint8Array,
) {
  return send('api/budget-apply-restore', {
    proposal,
    buffer: toArrayBuffer(input),
  });
}

/** Preview a local clone against the complete copied source state. */
export function previewBudgetClone(request: BudgetCloneRequest) {
  return send('api/budget-preview-clone', request);
}

/** Clone only if the selected identity and copied source still match. */
export function applyBudgetClone(proposal: BudgetCloneProposal) {
  return send('api/budget-apply-clone', proposal);
}

/** Preview a new local budget without creating or loading a destination. */
export function previewBudgetCreation(request: BudgetCreationRequest) {
  return send('api/budget-preview-creation', request);
}

/** Create the previewed local budget and acknowledge its actual new identity. */
export function applyBudgetCreation(proposal: BudgetCreationProposal) {
  return send('api/budget-apply-creation', proposal);
}

export function previewBudgetAmount(request: BudgetAmountRequest) {
  return send('api/budget-preview-amount', request);
}
export function previewCategoryGroupDeletion(
  request: CategoryGroupDeletionRequest,
) {
  return send('api/category-group-preview-deletion', request);
}
export function applyCategoryGroupDeletion(
  proposal: CategoryGroupDeletionProposal,
) {
  return send('api/category-group-apply-deletion', proposal);
}
export function previewCategoryGroupUpdate(
  request: CategoryGroupUpdateRequest,
) {
  return send('api/category-group-preview-update', request);
}
export function applyCategoryGroupUpdate(
  proposal: CategoryGroupUpdateProposal,
) {
  return send('api/category-group-apply-update', proposal);
}
export function previewPayeeCreation(request: PayeeCreationRequest) {
  return send('api/payee-preview-creation', request);
}
export function applyPayeeCreation(proposal: PayeeCreationProposal) {
  return send('api/payee-apply-creation', proposal);
}
export function previewPayeeUpdate(request: PayeeUpdateRequest) {
  return send('api/payee-preview-update', request);
}
export function applyPayeeUpdate(proposal: PayeeUpdateProposal) {
  return send('api/payee-apply-update', proposal);
}
export function previewPayeeDeletion(request: PayeeDeletionRequest) {
  return send('api/payee-preview-deletion', request);
}
export function applyPayeeDeletion(proposal: PayeeDeletionProposal) {
  return send('api/payee-apply-deletion', proposal);
}
export function previewPayeeMerge(request: PayeeMergeRequest) {
  return send('api/payee-preview-merge', request);
}
export function applyPayeeMerge(proposal: PayeeMergeProposal) {
  return send('api/payee-apply-merge', proposal);
}
export function previewTagCreation(request: TagCreationRequest) {
  return send('api/tag-preview-creation', request);
}
export function applyTagCreation(proposal: TagCreationProposal) {
  return send('api/tag-apply-creation', proposal);
}
export function previewTagUpdate(request: TagUpdateRequest) {
  return send('api/tag-preview-update', request);
}
export function applyTagUpdate(proposal: TagUpdateProposal) {
  return send('api/tag-apply-update', proposal);
}
export function previewTagDeletion(request: TagDeletionRequest) {
  return send('api/tag-preview-deletion', request);
}
export function applyTagDeletion(proposal: TagDeletionProposal) {
  return send('api/tag-apply-deletion', proposal);
}
export function previewNoteSet(request: NoteSetRequest) {
  return send('api/note-preview-set', request);
}
export function applyNoteSet(proposal: NoteSetProposal) {
  return send('api/note-apply-set', proposal);
}
export function previewAccountGroupCreation(
  request: AccountGroupCreationRequest,
) {
  return send('api/account-group-preview-creation', request);
}
export function applyAccountGroupCreation(
  proposal: AccountGroupCreationProposal,
) {
  return send('api/account-group-apply-creation', proposal);
}
export function previewAccountGroupUpdate(request: AccountGroupUpdateRequest) {
  return send('api/account-group-preview-update', request);
}
export function applyAccountGroupUpdate(proposal: AccountGroupUpdateProposal) {
  return send('api/account-group-apply-update', proposal);
}
export function previewAccountGroupDeletion(
  request: AccountGroupDeletionRequest,
) {
  return send('api/account-group-preview-deletion', request);
}
export function applyAccountGroupDeletion(
  proposal: AccountGroupDeletionProposal,
) {
  return send('api/account-group-apply-deletion', proposal);
}
export function previewPreferenceSet(request: PreferenceSetRequest) {
  return send('api/preference-preview-set', request);
}
export function applyPreferenceSet(proposal: PreferenceSetProposal) {
  return send('api/preference-apply-set', proposal);
}
export function previewRuleCreation(request: RuleCreationRequest) {
  return send('api/rule-preview-creation', request);
}
export function applyRuleCreation(proposal: RuleCreationProposal) {
  return send('api/rule-apply-creation', proposal);
}
export function previewRuleUpdate(request: RuleUpdateRequest) {
  return send('api/rule-preview-update', request);
}
export function applyRuleUpdate(proposal: RuleUpdateProposal) {
  return send('api/rule-apply-update', proposal);
}
export function previewRuleDeletion(request: RuleDeletionRequest) {
  return send('api/rule-preview-deletion', request);
}
export function applyRuleDeletion(proposal: RuleDeletionProposal) {
  return send('api/rule-apply-deletion', proposal);
}
export function previewScheduleCreation(request: ScheduleCreationRequest) {
  return send('api/schedule-preview-creation', request);
}
export function applyScheduleCreation(proposal: ScheduleCreationProposal) {
  return send('api/schedule-apply-creation', proposal);
}
export function previewScheduleUpdate(request: ScheduleUpdateRequest) {
  return send('api/schedule-preview-update', request);
}
export function applyScheduleUpdate(proposal: ScheduleUpdateProposal) {
  return send('api/schedule-apply-update', proposal);
}
export function previewScheduleDeletion(request: ScheduleDeletionRequest) {
  return send('api/schedule-preview-deletion', request);
}
export function applyScheduleDeletion(proposal: ScheduleDeletionProposal) {
  return send('api/schedule-apply-deletion', proposal);
}
export function previewTransactionCategorization(
  request: TransactionCategorizationRequest,
) {
  return send('api/transactions-preview-categorization', request);
}
export function applyTransactionCategorization(
  proposal: TransactionCategorizationProposal,
) {
  return send('api/transactions-apply-categorization', proposal);
}
export function previewTransactionMerge(request: TransactionMergeRequest) {
  return send('api/transactions-preview-merge', request);
}
export function applyTransactionMerge(proposal: TransactionMergeProposal) {
  return send('api/transactions-apply-merge', proposal);
}
export function previewTransactionSplit(request: TransactionSplitRequest) {
  return send('api/transactions-preview-split', request);
}
export function applyTransactionSplit(proposal: TransactionSplitProposal) {
  return send('api/transactions-apply-split', proposal);
}
export function previewTransactionDeletion(
  request: TransactionDeletionRequest,
) {
  return send('api/transaction-preview-deletion', request);
}
export function applyTransactionDeletion(
  proposal: TransactionDeletionProposal,
) {
  return send('api/transaction-apply-deletion', proposal);
}
export function previewTransactionAddition(
  request: TransactionAdditionRequest,
) {
  return send('api/transactions-preview-addition', request);
}
export function applyTransactionAddition(
  proposal: TransactionAdditionProposal,
) {
  return send('api/transactions-apply-addition', proposal);
}
export function previewTransactionImport(request: TransactionImportRequest) {
  return send('api/transactions-preview-import', request);
}
export function applyTransactionImport(proposal: TransactionImportProposal) {
  return send('api/transactions-apply-import', proposal);
}
export function previewCategoryGroupCreation(
  request: CategoryGroupCreationRequest,
) {
  return send('api/category-group-preview-creation', request);
}
export function applyCategoryGroupCreation(
  proposal: CategoryGroupCreationProposal,
) {
  return send('api/category-group-apply-creation', proposal);
}
export function previewCategoryCreation(request: CategoryCreationRequest) {
  return send('api/category-preview-creation', request);
}
export function applyCategoryCreation(proposal: CategoryCreationProposal) {
  return send('api/category-apply-creation', proposal);
}
export function previewCategoryDeletion(request: CategoryDeletionRequest) {
  return send('api/category-preview-deletion', request);
}
export function applyCategoryDeletion(proposal: CategoryDeletionProposal) {
  return send('api/category-apply-deletion', proposal);
}
export function previewCategoryUpdate(request: CategoryUpdateRequest) {
  return send('api/category-preview-update', request);
}
export function applyCategoryUpdate(proposal: CategoryUpdateProposal) {
  return send('api/category-apply-update', proposal);
}
export function previewAccountClosure(request: AccountCloseRequest) {
  return send('api/account-preview-closure', request);
}
export function applyAccountClosure(proposal: AccountCloseProposal) {
  return send('api/account-apply-closure', proposal);
}
export function previewAccountDeletion(request: AccountDeletionRequest) {
  return send('api/account-preview-deletion', request);
}
export function applyAccountDeletion(proposal: AccountDeletionProposal) {
  return send('api/account-apply-deletion', proposal);
}
export function previewAccountReopen(request: AccountReopenRequest) {
  return send('api/account-preview-reopen', request);
}
export function applyAccountReopen(proposal: AccountReopenProposal) {
  return send('api/account-apply-reopen', proposal);
}
export function previewAccountUpdate(request: AccountUpdateRequest) {
  return send('api/account-preview-update', request);
}
export function applyAccountUpdate(proposal: AccountUpdateProposal) {
  return send('api/account-apply-update', proposal);
}
export function previewAccountCreation(request: AccountCreationRequest) {
  return send('api/account-preview-creation', request);
}

export function applyAccountCreation(
  proposal: AccountCreationProposal,
): Promise<AccountCreationOutcome> {
  return send('api/account-apply-creation', proposal);
}
export function previewBudgetCarryover(request: BudgetCarryoverRequest) {
  return send('api/budget-preview-carryover', request);
}
export function previewBudgetHold(request: BudgetHoldRequest) {
  return send('api/budget-preview-hold', request);
}

export function applyBudgetHold(proposal: BudgetHoldProposal) {
  return send('api/budget-apply-hold', proposal);
}

export function applyBudgetCarryover(proposal: BudgetCarryoverProposal) {
  return send('api/budget-apply-carryover', proposal);
}

export function previewBudgetMetadata(request: BudgetMetadataRequest) {
  return send('api/budget-preview-metadata', request);
}

export function applyBudgetMetadata(proposal: BudgetMetadataProposal) {
  return send('api/budget-apply-metadata', proposal);
}

export function applyBudgetAmount(proposal: BudgetAmountProposal) {
  return send('api/budget-apply-amount', proposal);
}

export function previewTransactionUpdate(request: TransactionUpdateRequest) {
  return send('api/transaction-preview-update', request);
}

export function applyTransactionUpdate(proposal: TransactionUpdateProposal) {
  return send('api/transaction-apply-update', proposal);
}

export async function runImport(
  budgetName: APIFileEntity['name'],
  func: () => Promise<void>,
) {
  await send('api/start-import', { budgetName });
  try {
    await func();
  } catch (e) {
    await send('api/abort-import');
    throw e;
  }
  await send('api/finish-import');
}

export async function loadBudget(
  budgetId: string,
  { offline = false }: { offline?: boolean } = {},
) {
  return send('api/load-budget', { id: budgetId, offline });
}

export async function downloadBudget(
  syncId: string,
  { password }: { password?: string } = {},
) {
  return send('api/download-budget', { syncId, password });
}

export async function getBudgets() {
  return send('api/get-budgets');
}

/** Create and load a local budget. This never publishes it to a server. */
export async function createBudget({
  name,
  currency,
}: {
  name: string;
  currency?: string;
}): Promise<{ id: string }> {
  return send('api/create-budget', { name, currency });
}

/** Inspect the currently loaded budget without publishing or changing it. */
export function inspectBudget() {
  return send('api/inspect-budget');
}

/** Clone the loaded budget locally. Initialize without a server before cloning. */
export function cloneBudget({
  name,
}: {
  name: string;
}): Promise<{ id: string }> {
  return send('api/clone-budget', { name });
}

/** Rename the loaded budget through the synced metadata writer. */
export function renameBudget(name: string) {
  return send('api/rename-budget', { name });
}

/** Mark the loaded budget archived on this device, without deleting any files. */
export function archiveBudget(archived = true) {
  return send('api/archive-budget', { archived });
}

/** Explicitly publish a local budget to the authenticated server. */
export function publishBudget(
  id: string,
  { encryptionPassword }: { encryptionPassword?: string } = {},
) {
  return send('api/publish-budget', { id, encryptionPassword });
}

/**
 * Import a budget from an exported file — an Actual `.zip` export, or a
 * YNAB4/YNAB5 export. Accepts either a path to the file on the engine's
 * filesystem, or the raw file contents. Loads the imported budget and
 * returns its id.
 */
export async function importBudget(
  input: string | ArrayBuffer | Uint8Array,
  {
    type = 'actual',
    filename,
  }: { type?: ImportableBudgetType; filename?: string } = {},
): Promise<{ id: string }> {
  const result =
    typeof input === 'string'
      ? await send('import-budget', { filepath: input, type })
      : await send('import-budget', {
          buffer: toArrayBuffer(input),
          filename,
          type,
        });

  if (result.error) {
    throw new Error(`Error importing budget: ${result.error}`);
  }
  if (!result.id) {
    throw new Error('Error importing budget: no budget was loaded');
  }
  return { id: result.id };
}

/** Restore an Actual archive as a new local identity without publishing it. */
export function restoreBudget(
  input: ArrayBuffer | Uint8Array,
  { name }: { name: string },
): Promise<{ id: string }> {
  return send('api/restore-budget', { buffer: toArrayBuffer(input), name });
}

/** Export the currently-loaded budget as a zip buffer. */
export async function exportBudget(): Promise<Uint8Array> {
  const result = await send('export-budget');

  if ('error' in result) {
    throw new Error(`Error exporting budget: ${result.error}`);
  }
  if (!result.data) {
    throw new Error('Error exporting budget: no data was returned');
  }
  return new Uint8Array(result.data);
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    // Copy into a fresh ArrayBuffer so that views into a larger (possibly
    // shared) buffer are not sent across the worker boundary as-is.
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }
  return data;
}

export async function sync() {
  return send('api/sync');
}

/** Observe unsynchronized messages and deferred received messages without a network request. */
export function getSyncStatus() {
  return send('api/sync-status');
}

export async function runBankSync(args?: {
  accountId: APIAccountEntity['id'];
}) {
  return send('api/bank-sync', args);
}

export async function batchBudgetUpdates(func: () => Promise<void>) {
  await send('api/batch-budget-start');
  try {
    await func();
  } finally {
    await send('api/batch-budget-end');
  }
}

/**
 * @deprecated Please use `aqlQuery` instead.
 * This function will be removed in a future release.
 */
export function runQuery(query: Query) {
  return send('api/query', { query: query.serialize() });
}

export function aqlQuery(query: Query) {
  return send('api/query', { query: query.serialize() });
}

/**
 * Read-only table, field, operator and function metadata from the core AQL
 * schema. Does not require a loaded budget.
 */
export function getQuerySchema(): QuerySchemaMetadata {
  return describeQuerySchema();
}

/**
 * Compiles a query against the core schema without executing it and reports
 * unsupported tables, fields, operators or functions.
 */
export function validateQuery(query: Query): QueryValidation {
  return validateCoreQuery(query.serialize());
}

export type { QuerySchemaMetadata, QueryValidation };

/**
 * Read-only marker of the loaded budget's change history. Two equal markers
 * mean no local or synchronized change happened between the reads.
 */
export function getQuerySnapshot() {
  return send('api/query-snapshot');
}

export function getBudgetMonths() {
  return send('api/budget-months');
}

export function getBudgetMonth(month: string) {
  return send('api/budget-month', { month });
}

export function setBudgetAmount(
  month: string,
  categoryId: APICategoryEntity['id'],
  value: number,
) {
  return send('api/budget-set-amount', { month, categoryId, amount: value });
}

export function setBudgetCarryover(
  month: string,
  categoryId: APICategoryEntity['id'],
  flag: boolean,
) {
  return send('api/budget-set-carryover', { month, categoryId, flag });
}

export function addTransactions(
  accountId: APIAccountEntity['id'],
  transactions: Omit<ImportTransactionEntity, 'account'>[],
  {
    learnCategories = false,
    runTransfers = false,
  }: { learnCategories?: boolean; runTransfers?: boolean } = {},
) {
  return send('api/transactions-add', {
    accountId,
    transactions,
    learnCategories,
    runTransfers,
  });
}

export function importTransactions(
  accountId: APIAccountEntity['id'],
  transactions: ImportTransactionEntity[],
  opts: ImportTransactionsOpts = {
    defaultCleared: true,
    dryRun: false,
  },
) {
  return send('api/transactions-import', {
    accountId,
    transactions,
    isPreview: opts.dryRun,
    opts,
  });
}

export function getTransactions(
  accountId: APIAccountEntity['id'],
  startDate: string,
  endDate: string,
) {
  return send('api/transactions-get', { accountId, startDate, endDate });
}

export function updateTransaction(
  id: TransactionEntity['id'],
  fields: Partial<TransactionEntity>,
) {
  return send('api/transaction-update', { id, fields });
}

export function deleteTransaction(id: TransactionEntity['id']) {
  return send('api/transaction-delete', { id });
}

export function mergeTransactions(
  ids: [TransactionEntity['id'], TransactionEntity['id']],
) {
  return send('api/transactions-merge', { ids });
}

export function getAccounts() {
  return send('api/accounts-get');
}

export function createAccount(
  account: Omit<APIAccountEntity, 'id'>,
  initialBalance?: number,
) {
  return send('api/account-create', { account, initialBalance });
}

export function updateAccount(
  id: APIAccountEntity['id'],
  fields: Partial<APIAccountEntity>,
) {
  return send('api/account-update', { id, fields });
}

export function closeAccount(
  id: APIAccountEntity['id'],
  transferAccountId?: APIAccountEntity['id'],
  transferCategoryId?: APICategoryEntity['id'],
) {
  return send('api/account-close', {
    id,
    transferAccountId,
    transferCategoryId,
  });
}

export function reopenAccount(id: APIAccountEntity['id']) {
  return send('api/account-reopen', { id });
}

export function deleteAccount(id: APIAccountEntity['id']) {
  return send('api/account-delete', { id });
}

export function getAccountBalance(id: APIAccountEntity['id'], cutoff?: Date) {
  return send('api/account-balance', { id, cutoff });
}

export function getAccountGroups() {
  return send('api/account-groups-get');
}

export function createAccountGroup(group: Omit<APIAccountGroupEntity, 'id'>) {
  return send('api/account-group-create', { group });
}

export function updateAccountGroup(
  id: APIAccountGroupEntity['id'],
  fields: Partial<Omit<APIAccountGroupEntity, 'id'>>,
) {
  return send('api/account-group-update', { id, fields });
}

export function deleteAccountGroup(id: APIAccountGroupEntity['id']) {
  return send('api/account-group-delete', { id });
}

export function getCategoryGroups(options: { hidden?: boolean } = {}) {
  return send('api/category-groups-get', options);
}

export function createCategoryGroup(group: Omit<APICategoryGroupEntity, 'id'>) {
  return send('api/category-group-create', { group });
}

export function updateCategoryGroup(
  id: APICategoryGroupEntity['id'],
  fields: Partial<APICategoryGroupEntity>,
) {
  return send('api/category-group-update', { id, fields });
}

export function deleteCategoryGroup(
  id: APICategoryGroupEntity['id'],
  transferCategoryId?: APICategoryEntity['id'],
) {
  return send('api/category-group-delete', { id, transferCategoryId });
}

export function getCategories(options: { hidden?: boolean } = {}) {
  return send('api/categories-get', options);
}

export function createCategory(category: Omit<APICategoryEntity, 'id'>) {
  return send('api/category-create', { category });
}

export function updateCategory(
  id: APICategoryEntity['id'],
  fields: Partial<APICategoryEntity>,
) {
  return send('api/category-update', { id, fields });
}

export function deleteCategory(
  id: APICategoryEntity['id'],
  transferCategoryId?: APICategoryEntity['id'],
) {
  return send('api/category-delete', { id, transferCategoryId });
}

export function getNote(id: NoteEntity['id']) {
  return send('api/note-get', { id });
}

/**
 * Resolve a note ID (`account-<id>`, a category or group ID, `budget-<YYYY-MM>`
 * or `<categoryId>-<YYYY-MM>`) to its live target and read the stored text.
 * Returns `note: null` when no note exists; nothing is written.
 */
export function getNoteTarget(id: NoteEntity['id']) {
  return send('api/note-target', { id });
}

export function updateNote(id: NoteEntity['id'], note: NoteEntity['note']) {
  return send('api/note-update', { id, note });
}

export function getCommonPayees() {
  return send('api/common-payees-get');
}

export function getPayees() {
  return send('api/payees-get');
}

export function createPayee(payee: Omit<APIPayeeEntity, 'id'>) {
  return send('api/payee-create', { payee });
}

export function updatePayee(
  id: APIPayeeEntity['id'],
  fields: Partial<APIPayeeEntity>,
) {
  return send('api/payee-update', { id, fields });
}

export function deletePayee(id: APIPayeeEntity['id']) {
  return send('api/payee-delete', { id });
}

export function getTags() {
  return send('api/tags-get');
}

export function createTag(tag: Omit<APITagEntity, 'id'>) {
  return send('api/tag-create', { tag });
}

export function updateTag(
  id: APITagEntity['id'],
  fields: Partial<Omit<APITagEntity, 'id'>>,
) {
  return send('api/tag-update', { id, fields });
}

export function deleteTag(id: APITagEntity['id']) {
  return send('api/tag-delete', { id });
}

export function mergePayees(
  targetId: APIPayeeEntity['id'],
  mergeIds: APIPayeeEntity['id'][],
) {
  return send('api/payees-merge', { targetId, mergeIds });
}

export function getRules() {
  return send('api/rules-get');
}

export function getPayeeRules(id: RuleEntity['id']) {
  return send('api/payee-rules-get', { id });
}

export function createRule(rule: Omit<APIRuleEntity, 'id'>) {
  return send('api/rule-create', { rule });
}

export function updateRule(rule: APIRuleEntity) {
  return send('api/rule-update', { rule });
}

export function deleteRule(id: RuleEntity['id']) {
  return send('api/rule-delete', id);
}

export function holdBudgetForNextMonth(month: string, amount: number) {
  return send('api/budget-hold-for-next-month', { month, amount });
}

export function resetBudgetHold(month: string) {
  return send('api/budget-reset-hold', { month });
}

export function createSchedule(schedule: Omit<APIScheduleEntity, 'id'>) {
  return send('api/schedule-create', schedule);
}

export function updateSchedule(
  id: APIScheduleEntity['id'],
  fields: Partial<APIScheduleEntity>,
  resetNextDate?: boolean,
) {
  return send('api/schedule-update', {
    id,
    fields,
    resetNextDate,
  });
}

export function deleteSchedule(scheduleId: APIScheduleEntity['id']) {
  return send('api/schedule-delete', scheduleId);
}

export function getSchedules() {
  return send('api/schedules-get');
}

export function getIDByName(
  type: 'accounts' | 'schedules' | 'categories' | 'payees',
  name: string,
) {
  return send('api/get-id-by-name', { type, name });
}

export function getServerVersion() {
  return send('api/get-server-version');
}

/** Read the budget's synced preferences (number format, currency, etc.). */
export function getPreferences(): Promise<SyncedPrefs> {
  return send('preferences/get');
}

/**
 * Typed synced-preference catalog: scope, authority, whether the key is
 * settable here, allowed values, app default and current value (null when
 * unset). Pass a key to inspect one preference. Read-only.
 */
export function inspectPreferences(key?: string) {
  return send('api/preferences-inspect', key === undefined ? {} : { key });
}

/**
 * Inspect accounts as of a cutoff day (default today): engine balances split
 * into cleared, uncleared, reconciled and future activity, on-budget and
 * off-budget totals, groups, duplicate names, and closed accounts with a
 * balance that were not listed. Read-only.
 */
export function inspectAccounts(
  options: { cutoff?: string; includeClosed?: boolean } = {},
) {
  return send('api/accounts-inspect', options);
}

/**
 * Inspect categories or payees with stable IDs, hidden/deleted status, the
 * row a deleted entry now resolves to, live transaction counts through the
 * canonical mappings, and other rows sharing the same name. Read-only.
 */
export function inspectCatalog(
  kind: 'categories' | 'payees',
  options: { includeDeleted?: boolean } = {},
) {
  return send('api/catalog-inspect', { kind, ...options });
}

export function setPreference<T extends keyof SyncedPrefs>(
  id: T,
  value: SyncedPrefs[T] | undefined,
): Promise<void> {
  return send('preferences/save', { id, value });
}
