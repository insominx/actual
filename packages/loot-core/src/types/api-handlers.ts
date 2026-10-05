// @ts-strict-ignore
import type { ImportTransactionsResult } from '#server/accounts/app';
import type { PayeeNameNormalization } from '#server/accounts/sync';
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
} from '#server/api-models';
import type { BudgetFileHandlers } from '#server/budgetfiles/app';
import type { batchUpdateTransactions } from '#server/transactions';
import type { QueryState } from '#shared/query';

import type {
  AccountCloseOutcome,
  AccountCloseProposal,
  AccountCloseRequest,
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
  PayeeCreationOutcome,
  PayeeCreationProposal,
  PayeeCreationRequest,
  PayeeDeletionProposal,
  PayeeDeletionRequest,
  PayeeMergeOutcome,
  PayeeMergeProposal,
  PayeeMergeRequest,
  PayeeUpdateProposal,
  PayeeUpdateRequest,
  RuleCreationOutcome,
  RuleCreationProposal,
  RuleCreationRequest,
  RuleDeletionProposal,
  RuleDeletionRequest,
  RuleUpdateProposal,
  RuleUpdateRequest,
  ScheduleCreationOutcome,
  ScheduleCreationProposal,
  ScheduleCreationRequest,
  ScheduleDeletionProposal,
  ScheduleDeletionRequest,
  ScheduleUpdateProposal,
  ScheduleUpdateRequest,
  TagCreationOutcome,
  TagCreationProposal,
  TagCreationRequest,
  TagDeletionProposal,
  NoteSetProposal,
  NoteSetRequest,
  NoteTarget,
  TagDeletionRequest,
  TagUpdateProposal,
  TagUpdateRequest,
  TransactionAdditionOutcome,
  TransactionAdditionProposal,
  TransactionAdditionRequest,
  TransactionDeletionProposal,
  TransactionDeletionRequest,
  TransactionImportOutcome,
  TransactionImportProposal,
  TransactionImportRequest,
  TransactionUpdateOutcome,
  TransactionUpdateProposal,
  TransactionUpdateRequest,
} from './change-proposals';
import type {
  AccountEntity,
  CategoryGroupEntity,
  ImportTransactionEntity,
  NearbyPayeeEntity,
  NoteEntity,
  PayeeEntity,
  PayeeLocationEntity,
  RuleEntity,
  ScheduleEntity,
  TransactionEntity,
} from './models';

export type ImportTransactionsOpts = {
  defaultCleared?: boolean;
  dryRun?: boolean;
  reimportDeleted?: boolean;
  payeeNameNormalization?: PayeeNameNormalization;
};

export type BudgetInspection = {
  id: string;
  name: string;
  syncId: string | null;
  cloudFileId: string | null;
  encryptKeyId: string | null;
  currency: string | null;
  archived: boolean;
  publicationStatus: 'prepared' | 'published' | null;
};

export type SyncStatus = {
  budgetId: string;
  syncId: string | null;
  cloudFileId: string | null;
  state: 'unpublished' | 'pending-sync' | 'observed-synced';
  pendingMessages: number;
  deferredMessages: number;
  lastSyncedTimestamp: string | null;
  observedAt: number;
};

export type ApiHandlers = {
  'api/budget-preview-publication': (
    arg: BudgetPublicationRequest,
  ) => Promise<BudgetPublicationProposal>;
  'api/budget-apply-publication': (arg: {
    proposal: BudgetPublicationProposal;
    encryptionPassword?: string;
  }) => Promise<BudgetPublicationOutcome>;
  'api/budget-recover-publication': (arg: {
    proposal: BudgetPublicationProposal;
    encryptionPassword?: string;
  }) => Promise<BudgetPublicationOutcome>;
  'api/budget-preview-restore': (arg: {
    buffer: ArrayBuffer;
    request: BudgetRestoreRequest;
  }) => Promise<BudgetRestoreProposal>;
  'api/budget-apply-restore': (arg: {
    buffer: ArrayBuffer;
    proposal: BudgetRestoreProposal;
  }) => Promise<TransactionUpdateOutcome>;
  'api/budget-preview-clone': (
    arg: BudgetCloneRequest,
  ) => Promise<BudgetCloneProposal>;
  'api/budget-apply-clone': (
    arg: BudgetCloneProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/budget-preview-creation': (
    arg: BudgetCreationRequest,
  ) => Promise<BudgetCreationProposal>;
  'api/budget-apply-creation': (
    arg: BudgetCreationProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/budget-preview-metadata': (
    arg: BudgetMetadataRequest,
  ) => Promise<BudgetMetadataProposal>;
  'api/budget-apply-metadata': (
    arg: BudgetMetadataProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/budget-preview-amount': (
    arg: BudgetAmountRequest,
  ) => Promise<BudgetAmountProposal>;
  'api/category-group-preview-deletion': (
    arg: CategoryGroupDeletionRequest,
  ) => Promise<CategoryGroupDeletionProposal>;
  'api/category-group-apply-deletion': (
    arg: CategoryGroupDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/category-group-preview-update': (
    arg: CategoryGroupUpdateRequest,
  ) => Promise<CategoryGroupUpdateProposal>;
  'api/category-group-apply-update': (
    arg: CategoryGroupUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/payee-preview-creation': (
    arg: PayeeCreationRequest,
  ) => Promise<PayeeCreationProposal>;
  'api/payee-apply-creation': (
    arg: PayeeCreationProposal,
  ) => Promise<PayeeCreationOutcome>;
  'api/payee-preview-update': (
    arg: PayeeUpdateRequest,
  ) => Promise<PayeeUpdateProposal>;
  'api/payee-apply-update': (
    arg: PayeeUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/payee-preview-deletion': (
    arg: PayeeDeletionRequest,
  ) => Promise<PayeeDeletionProposal>;
  'api/payee-apply-deletion': (
    arg: PayeeDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/payee-preview-merge': (
    arg: PayeeMergeRequest,
  ) => Promise<PayeeMergeProposal>;
  'api/payee-apply-merge': (
    arg: PayeeMergeProposal,
  ) => Promise<PayeeMergeOutcome>;
  'api/tag-preview-creation': (
    arg: TagCreationRequest,
  ) => Promise<TagCreationProposal>;
  'api/tag-apply-creation': (
    arg: TagCreationProposal,
  ) => Promise<TagCreationOutcome>;
  'api/tag-preview-update': (
    arg: TagUpdateRequest,
  ) => Promise<TagUpdateProposal>;
  'api/tag-apply-update': (
    arg: TagUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/tag-preview-deletion': (
    arg: TagDeletionRequest,
  ) => Promise<TagDeletionProposal>;
  'api/tag-apply-deletion': (
    arg: TagDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/note-preview-set': (arg: NoteSetRequest) => Promise<NoteSetProposal>;
  'api/note-apply-set': (
    arg: NoteSetProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/note-target': (arg: {
    id: string;
  }) => Promise<{ target: NoteTarget; note: string | null }>;
  'api/rule-preview-creation': (
    arg: RuleCreationRequest,
  ) => Promise<RuleCreationProposal>;
  'api/rule-apply-creation': (
    arg: RuleCreationProposal,
  ) => Promise<RuleCreationOutcome>;
  'api/rule-preview-update': (
    arg: RuleUpdateRequest,
  ) => Promise<RuleUpdateProposal>;
  'api/rule-apply-update': (
    arg: RuleUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/rule-preview-deletion': (
    arg: RuleDeletionRequest,
  ) => Promise<RuleDeletionProposal>;
  'api/rule-apply-deletion': (
    arg: RuleDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/schedule-preview-creation': (
    arg: ScheduleCreationRequest,
  ) => Promise<ScheduleCreationProposal>;
  'api/schedule-apply-creation': (
    arg: ScheduleCreationProposal,
  ) => Promise<ScheduleCreationOutcome>;
  'api/schedule-preview-update': (
    arg: ScheduleUpdateRequest,
  ) => Promise<ScheduleUpdateProposal>;
  'api/schedule-apply-update': (
    arg: ScheduleUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/schedule-preview-deletion': (
    arg: ScheduleDeletionRequest,
  ) => Promise<ScheduleDeletionProposal>;
  'api/schedule-apply-deletion': (
    arg: ScheduleDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/transaction-preview-deletion': (
    arg: TransactionDeletionRequest,
  ) => Promise<TransactionDeletionProposal>;
  'api/transaction-apply-deletion': (
    arg: TransactionDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/transactions-preview-addition': (
    arg: TransactionAdditionRequest,
  ) => Promise<TransactionAdditionProposal>;
  'api/transactions-apply-addition': (
    arg: TransactionAdditionProposal,
  ) => Promise<TransactionAdditionOutcome>;
  'api/transactions-preview-import': (
    arg: TransactionImportRequest,
  ) => Promise<TransactionImportProposal>;
  'api/transactions-apply-import': (
    arg: TransactionImportProposal,
  ) => Promise<TransactionImportOutcome>;
  'api/category-group-preview-creation': (
    arg: CategoryGroupCreationRequest,
  ) => Promise<CategoryGroupCreationProposal>;
  'api/category-group-apply-creation': (
    arg: CategoryGroupCreationProposal,
  ) => Promise<CategoryGroupCreationOutcome>;
  'api/category-preview-creation': (
    arg: CategoryCreationRequest,
  ) => Promise<CategoryCreationProposal>;
  'api/category-apply-creation': (
    arg: CategoryCreationProposal,
  ) => Promise<CategoryCreationOutcome>;
  'api/category-preview-deletion': (
    arg: CategoryDeletionRequest,
  ) => Promise<CategoryDeletionProposal>;
  'api/category-apply-deletion': (
    arg: CategoryDeletionProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/category-preview-update': (
    arg: CategoryUpdateRequest,
  ) => Promise<CategoryUpdateProposal>;
  'api/category-apply-update': (
    arg: CategoryUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/account-preview-closure': (
    arg: AccountCloseRequest,
  ) => Promise<AccountCloseProposal>;
  'api/account-apply-closure': (
    arg: AccountCloseProposal,
  ) => Promise<AccountCloseOutcome>;
  'api/account-preview-deletion': (
    arg: AccountDeletionRequest,
  ) => Promise<AccountDeletionProposal>;
  'api/account-apply-deletion': (
    arg: AccountDeletionProposal,
  ) => Promise<AccountDeletionOutcome>;
  'api/account-preview-reopen': (
    arg: AccountReopenRequest,
  ) => Promise<AccountReopenProposal>;
  'api/account-apply-reopen': (
    arg: AccountReopenProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/account-preview-update': (
    arg: AccountUpdateRequest,
  ) => Promise<AccountUpdateProposal>;
  'api/account-apply-update': (
    arg: AccountUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/account-preview-creation': (
    arg: AccountCreationRequest,
  ) => Promise<AccountCreationProposal>;
  'api/account-apply-creation': (
    arg: AccountCreationProposal,
  ) => Promise<AccountCreationOutcome>;
  'api/budget-preview-carryover': (
    arg: BudgetCarryoverRequest,
  ) => Promise<BudgetCarryoverProposal>;
  'api/budget-preview-hold': (
    arg: BudgetHoldRequest,
  ) => Promise<BudgetHoldProposal>;
  'api/budget-apply-hold': (
    arg: BudgetHoldProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/budget-apply-carryover': (
    arg: BudgetCarryoverProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/budget-apply-amount': (
    arg: BudgetAmountProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/transaction-preview-update': (
    arg: TransactionUpdateRequest,
  ) => Promise<TransactionUpdateProposal>;
  'api/transaction-apply-update': (
    arg: TransactionUpdateProposal,
  ) => Promise<TransactionUpdateOutcome>;
  'api/sync-status': () => Promise<SyncStatus>;
  'api/batch-budget-start': () => Promise<void>;

  'api/batch-budget-end': () => Promise<void>;

  'api/load-budget': (
    arg: Parameters<BudgetFileHandlers['load-budget']>[0] & {
      offline?: boolean;
    },
  ) => Promise<void>;

  'api/download-budget': (arg: {
    syncId: string;
    password?: string;
  }) => Promise<void>;

  'api/get-budgets': () => Promise<APIFileEntity[]>;

  'api/create-budget': (arg: {
    name: string;
    currency?: string;
  }) => Promise<{ id: string }>;

  'api/inspect-budget': () => Promise<BudgetInspection>;

  'api/clone-budget': (arg: { name: string }) => Promise<{ id: string }>;
  'api/restore-budget': (arg: {
    buffer: ArrayBuffer;
    name: string;
  }) => Promise<{ id: string }>;

  'api/rename-budget': (arg: { name: string }) => Promise<void>;
  'api/archive-budget': (arg: { archived: boolean }) => Promise<void>;
  'api/publish-budget': (arg: {
    id: string;
    encryptionPassword?: string;
  }) => Promise<BudgetInspection>;

  'api/start-import': (arg: { budgetName: string }) => Promise<void>;

  'api/finish-import': () => Promise<void>;

  'api/abort-import': () => Promise<void>;

  'api/query': (arg: { query: QueryState }) => Promise<unknown>;

  'api/query-snapshot': () => Promise<{ marker: string }>;

  'api/budget-months': () => Promise<string[]>;

  'api/budget-month': (arg: { month: string }) => Promise<{
    month: string;
    incomeAvailable: number;
    lastMonthOverspent: number;
    forNextMonth: number;
    totalBudgeted: number;
    toBudget: number;

    fromLastMonth: number;
    totalIncome: number;
    totalSpent: number;
    totalBalance: number;
    categoryGroups: Array<
      Record<string, unknown> & { categories?: Record<string, unknown>[] }
    >;
  }>;

  'api/budget-set-amount': (arg: {
    month: string;
    categoryId: string;
    amount: number;
  }) => Promise<void>;

  'api/budget-set-carryover': (arg: {
    month: string;
    categoryId: string;
    flag: boolean;
  }) => Promise<void>;

  'api/budget-hold-for-next-month': (arg: {
    month: string;
    amount: number;
  }) => Promise<boolean>;

  'api/budget-reset-hold': (arg: { month: string }) => Promise<void>;

  'api/transactions-export': (arg: {
    transactions: TransactionEntity[];
    categoryGroups: CategoryGroupEntity[];
    payees: PayeeEntity[];
    accounts: AccountEntity[];
  }) => Promise<unknown>;

  'api/transactions-import': (arg: {
    accountId: APIAccountEntity['id'];
    transactions: ImportTransactionEntity[];
    isPreview?: boolean;
    opts?: ImportTransactionsOpts;
  }) => Promise<ImportTransactionsResult>;

  'api/transactions-add': (arg: {
    accountId: APIAccountEntity['id'];
    transactions: Omit<ImportTransactionEntity, 'account'>[];
    runTransfers?: boolean;
    learnCategories?: boolean;
  }) => Promise<'ok'>;

  'api/transactions-get': (arg: {
    accountId?: APIAccountEntity['id'];
    startDate?: string;
    endDate?: string;
  }) => Promise<TransactionEntity[]>;

  'api/transaction-update': (arg: {
    id: TransactionEntity['id'];
    fields: Partial<TransactionEntity>;
  }) => Promise<Awaited<ReturnType<typeof batchUpdateTransactions>>['updated']>;

  'api/transaction-delete': (arg: {
    id: TransactionEntity['id'];
  }) => Promise<Awaited<ReturnType<typeof batchUpdateTransactions>>['deleted']>;

  'api/transactions-merge': (arg: {
    ids: [TransactionEntity['id'], TransactionEntity['id']];
  }) => Promise<TransactionEntity['id']>;

  'api/sync': () => Promise<void>;

  'api/bank-sync': (arg?: {
    accountId: APIAccountEntity['id'];
  }) => Promise<void>;

  'api/accounts-get': () => Promise<APIAccountEntity[]>;

  'api/account-create': (arg: {
    account: Omit<APIAccountEntity, 'id'>;
    initialBalance?: number;
  }) => Promise<string>;

  'api/account-update': (arg: {
    id: APIAccountEntity['id'];
    fields: Partial<APIAccountEntity>;
  }) => Promise<void>;

  'api/account-close': (arg: {
    id: APIAccountEntity['id'];
    transferAccountId?: APIAccountEntity['id'];
    transferCategoryId?: APICategoryEntity['id'];
  }) => Promise<void>;

  'api/account-reopen': (arg: { id: APIAccountEntity['id'] }) => Promise<void>;

  'api/account-delete': (arg: { id: APIAccountEntity['id'] }) => Promise<void>;

  'api/account-balance': (arg: {
    id: APIAccountEntity['id'];
    cutoff?: Date;
  }) => Promise<number>;

  'api/account-groups-get': () => Promise<APIAccountGroupEntity[]>;

  'api/account-group-create': (arg: {
    group: Omit<APIAccountGroupEntity, 'id'>;
  }) => Promise<APIAccountGroupEntity['id']>;

  'api/account-group-update': (arg: {
    id: APIAccountGroupEntity['id'];
    fields: Partial<Omit<APIAccountGroupEntity, 'id'>>;
  }) => Promise<void>;

  'api/account-group-delete': (arg: {
    id: APIAccountGroupEntity['id'];
  }) => Promise<void>;

  'api/categories-get': (arg: {
    hidden?: boolean;
  }) => Promise<APICategoryEntity[]>;

  'api/category-groups-get': (arg?: {
    hidden?: boolean;
  }) => Promise<APICategoryGroupEntity[]>;

  'api/category-group-create': (arg: {
    group: Omit<APICategoryGroupEntity, 'id'>;
  }) => Promise<APICategoryGroupEntity['id']>;

  'api/category-group-update': (arg: {
    id: APICategoryGroupEntity['id'];
    fields: Partial<APICategoryGroupEntity>;
  }) => Promise<void>;

  'api/category-group-delete': (arg: {
    id: APICategoryGroupEntity['id'];
    transferCategoryId?: APICategoryEntity['id'];
  }) => Promise<void>;

  'api/category-create': (arg: {
    category: Omit<APICategoryEntity, 'id'>;
  }) => Promise<APICategoryEntity['id']>;

  'api/category-update': (arg: {
    id: APICategoryEntity['id'];
    fields: Partial<APICategoryEntity>;
  }) => Promise<void>;

  'api/category-delete': (arg: {
    id: APICategoryEntity['id'];
    transferCategoryId?: APICategoryEntity['id'];
  }) => Promise<void>;

  'api/note-get': (arg: Pick<NoteEntity, 'id'>) => Promise<NoteEntity | null>;

  'api/note-update': (arg: NoteEntity) => Promise<void>;

  'api/payees-get': () => Promise<APIPayeeEntity[]>;

  'api/common-payees-get': () => Promise<APIPayeeEntity[]>;

  'api/payee-create': (arg: {
    payee: Omit<APIPayeeEntity, 'id'>;
  }) => Promise<APIPayeeEntity['id']>;

  'api/payee-update': (arg: {
    id: APIPayeeEntity['id'];
    fields: Partial<APIPayeeEntity>;
  }) => Promise<void>;

  'api/payee-delete': (arg: { id: APIPayeeEntity['id'] }) => Promise<void>;

  'api/payees-merge': (arg: {
    targetId: APIPayeeEntity['id'];
    mergeIds: string[];
  }) => Promise<void>;

  'api/tags-get': () => Promise<APITagEntity[]>;

  'api/tag-create': (arg: {
    tag: Omit<APITagEntity, 'id'>;
  }) => Promise<APITagEntity['id']>;

  'api/tag-update': (arg: {
    id: APITagEntity['id'];
    fields: Partial<Omit<APITagEntity, 'id'>>;
  }) => Promise<void>;

  'api/tag-delete': (arg: { id: APITagEntity['id'] }) => Promise<void>;

  'api/payee-location-create': (arg: {
    payeeId: string;
    latitude: number;
    longitude: number;
  }) => Promise<string>;

  'api/payee-locations-get': (arg: {
    payeeId: string;
  }) => Promise<PayeeLocationEntity[]>;

  'api/payee-location-delete': (arg: { id: string }) => Promise<void>;

  'api/payees-get-nearby': (arg: {
    latitude: number;
    longitude: number;
    maxDistance?: number;
  }) => Promise<NearbyPayeeEntity[]>;

  'api/rules-get': () => Promise<RuleEntity[]>;

  'api/payee-rules-get': (arg: {
    id: APIPayeeEntity['id'];
  }) => Promise<RuleEntity[]>;

  'api/rule-create': (arg: {
    rule: Omit<APIRuleEntity, 'id'>;
  }) => Promise<RuleEntity>;

  'api/rule-update': (arg: { rule: APIRuleEntity }) => Promise<RuleEntity>;

  'api/rule-delete': (id: RuleEntity['id']) => Promise<boolean>;

  'api/schedule-create': (
    schedule: Omit<APIScheduleEntity, 'id'>,
  ) => Promise<ScheduleEntity['id']>;

  'api/schedule-update': (arg: {
    id: ScheduleEntity['id'];
    fields: Partial<APIScheduleEntity>;
    resetNextDate?: boolean;
  }) => Promise<ScheduleEntity['id']>;

  'api/schedule-delete': (id: string) => Promise<void>;

  'api/schedules-get': () => Promise<APIScheduleEntity[]>;
  'api/get-id-by-name': (arg: {
    type: string;
    name: string;
  }) => Promise<string>;
  'api/get-server-version': () => Promise<
    { error: 'no-server' } | { error: 'network-failure' } | { version: string }
  >;
};
