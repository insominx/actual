import type { NewRuleEntity, TransactionEntity } from './models';

export type TransactionUpdateRequest = {
  id: string;
  fields: Partial<
    Pick<
      TransactionEntity,
      'notes' | 'amount' | 'date' | 'cleared' | 'category' | 'payee'
    >
  >;
};

export type TransactionUpdateProposal = {
  schemaVersion: 1;
  operation: 'transactions.update';
  budget: { id: string; syncId: string | null; cloudFileId: string | null };
  request: TransactionUpdateRequest;
  before: TransactionEntity[];
  after: TransactionEntity[];
  references: unknown;
  sideEffects: string[];
};

export type TransactionUpdateOutcome =
  | {
      status: 'rejected';
      code: 'INVALID_INPUT' | 'STALE_PREVIEW' | 'MISSING_CONTEXT';
      message: string;
    }
  | {
      status: 'committed-local';
      changed: boolean;
      checkpoint: string;
      affectedIds: string[];
    };

export type PayeeCreationRequest = { name: string; transfer_acct?: string };
export type PayeeCreationProposal = {
  schemaVersion: 1;
  operation: 'payees.create';
  budget: TransactionUpdateProposal['budget'];
  request: PayeeCreationRequest;
  before: { sourceHash: string };
  after: { payee: Record<string, unknown>; mapping: { creates: true } };
  references: unknown;
  sideEffects: string[];
};
export type PayeeCreationOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      payeeCreation: { payeeId: string; mappingId: string };
    });

type CatalogProposal<Operation extends string, Request, Before, After> = {
  schemaVersion: 1;
  operation: Operation;
  budget: TransactionUpdateProposal['budget'];
  request: Request;
  before: { sourceHash: string } & Before;
  after: After;
  references: unknown;
  sideEffects: string[];
};
type CatalogCommit<Extra> =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & Extra);

export type PayeeUpdateRequest = { id: string; fields: { name: string } };
export type PayeeUpdateProposal = CatalogProposal<
  'payees.update',
  PayeeUpdateRequest,
  { payee: Record<string, unknown> },
  { payee: Record<string, unknown> }
>;

export type PayeeDeletionRequest = { id: string };
export type PayeeDeletionProposal = CatalogProposal<
  'payees.delete',
  PayeeDeletionRequest,
  { payee: Record<string, unknown> },
  { action: 'tombstone' | 'unchanged-transfer-payee' }
>;

export type PayeeMergeRequest = { targetId: string; mergeIds: string[] };
export type PayeeMergeProposal = CatalogProposal<
  'payees.merge',
  PayeeMergeRequest,
  {
    target: Record<string, unknown>;
    sources: Array<Record<string, unknown>>;
  },
  {
    action: 'merge' | 'unchanged-transfer-target';
    mergedIds: string[];
    skippedTransferIds: string[];
    mappings: Array<{ id: string; targetId: string }>;
  }
>;
export type PayeeMergeOutcome = CatalogCommit<{
  payeeMerge: { targetId: string; mergedIds: string[] };
}>;

export type TagCreationRequest = {
  tag: string;
  color?: string | null;
  description?: string | null;
};
export type TagCreationProposal = CatalogProposal<
  'tags.create',
  TagCreationRequest,
  { existing: Record<string, unknown> | null },
  {
    action: 'insert' | 'revive';
    tag: Record<string, unknown>;
  }
>;
export type TagCreationOutcome = CatalogCommit<{
  tagCreation: { tagId: string; action: 'insert' | 'revive' };
}>;

export type TagUpdateRequest = {
  id: string;
  fields: { tag?: string; color?: string | null; description?: string | null };
};
export type TagUpdateProposal = CatalogProposal<
  'tags.update',
  TagUpdateRequest,
  { tag: Record<string, unknown> },
  { tag: Record<string, unknown> }
>;

export type TagDeletionRequest = { id: string };
export type TagDeletionProposal = CatalogProposal<
  'tags.delete',
  TagDeletionRequest,
  { tag: Record<string, unknown> },
  { action: 'tombstone' }
>;

export type NoteTarget =
  | {
      kind: 'account' | 'category' | 'category-group';
      id: string;
      name: string;
    }
  | { kind: 'month'; month: string }
  | { kind: 'category-month'; id: string; name: string; month: string };
export type NoteSetRequest = { id: string; note: string };
export type NoteSetProposal = CatalogProposal<
  'notes.set',
  NoteSetRequest,
  { note: { id: string; note: string | null } | null },
  { target: NoteTarget; note: { id: string; note: string } }
>;

export type AccountGroupCreationRequest = { name: string };
export type AccountGroupCreationProposal = CatalogProposal<
  'account-groups.create',
  AccountGroupCreationRequest,
  Record<never, never>,
  { group: Record<string, unknown> }
>;
export type AccountGroupCreationOutcome = CatalogCommit<{
  accountGroupCreation: { groupId: string };
}>;
export type AccountGroupUpdateRequest = {
  id: string;
  fields: { name: string };
};
export type AccountGroupUpdateProposal = CatalogProposal<
  'account-groups.update',
  AccountGroupUpdateRequest,
  { group: Record<string, unknown> },
  { group: Record<string, unknown> }
>;
export type AccountGroupDeletionRequest = { id: string };
export type AccountGroupDeletionProposal = CatalogProposal<
  'account-groups.delete',
  AccountGroupDeletionRequest,
  { group: Record<string, unknown> },
  { action: 'tombstone'; ungroupedAccountIds: string[] }
>;

export type PreferenceSetRequest = { id: string; value: string | null };
export type PreferenceSetProposal = CatalogProposal<
  'preferences.set',
  PreferenceSetRequest,
  { preference: { id: string; value: string | null } | null },
  {
    description: Record<string, unknown>;
    preference: { id: string; value: string | null };
  }
>;

export type RuleFieldsRequest = Omit<NewRuleEntity, 'stage' | 'tombstone'> & {
  stage: NewRuleEntity['stage'] | 'default';
};
export type RuleCreationRequest = RuleFieldsRequest;
export type RuleCreationProposal = CatalogProposal<
  'rules.create',
  RuleCreationRequest,
  object,
  { rule: Record<string, unknown> }
>;
export type RuleCreationOutcome = CatalogCommit<{
  ruleCreation: { ruleId: string };
}>;

export type RuleUpdateRequest = {
  id: string;
  fields: Partial<RuleFieldsRequest>;
};
export type RuleUpdateProposal = CatalogProposal<
  'rules.update',
  RuleUpdateRequest,
  { rule: Record<string, unknown> },
  { rule: Record<string, unknown> }
>;

export type RuleDeletionRequest = { id: string };
export type RuleDeletionProposal = CatalogProposal<
  'rules.delete',
  RuleDeletionRequest,
  { rule: Record<string, unknown> },
  { action: 'tombstone' }
>;

export type ScheduleCreationRequest = {
  name?: string | null;
  posts_transaction: boolean;
  payee: string;
  account: string;
  amount?: number | { num1: number; num2: number };
  amountOp: 'is' | 'isapprox' | 'isbetween';
  date: unknown;
};
export type ScheduleCreationProposal = CatalogProposal<
  'schedules.create',
  ScheduleCreationRequest,
  object,
  { schedule: Record<string, unknown>; rule: Record<string, unknown> }
>;
export type ScheduleCreationOutcome = CatalogCommit<{
  scheduleCreation: { scheduleId: string; ruleId: string };
}>;

export type ScheduleUpdateRequest = {
  id: string;
  fields: Record<string, unknown>;
  resetNextDate?: boolean;
};
export type ScheduleUpdateProposal = CatalogProposal<
  'schedules.update',
  ScheduleUpdateRequest,
  { schedule: Record<string, unknown>; rule: Record<string, unknown> },
  { schedule: Record<string, unknown>; rule: Record<string, unknown> }
>;

export type ScheduleDeletionRequest = { id: string };
export type ScheduleDeletionProposal = CatalogProposal<
  'schedules.delete',
  ScheduleDeletionRequest,
  { schedule: Record<string, unknown>; rule: Record<string, unknown> },
  { action: 'tombstone'; ruleId: string }
>;

export type TransactionDeletionRequest = { id: string };
export type TransactionDeletionProposal = CatalogProposal<
  'transactions.delete',
  TransactionDeletionRequest,
  { transaction: Record<string, unknown> },
  {
    deletedIds: string[];
    transferDeletedIds: string[];
    transferUnlinkedIds: string[];
  }
>;

export type TransactionCategorizationRequest = {
  ids: string[];
  category: string | null;
  allowReconciled?: boolean;
};
export type TransactionCategorizationProposal = CatalogProposal<
  'transactions.categorize',
  TransactionCategorizationRequest,
  {
    transactions: Array<{
      id: string;
      account: string;
      amount: number;
      date: number;
      category: string | null;
      parentId: string | null;
      transferId: string | null;
      reconciled: boolean;
    }>;
  },
  {
    category: { id: string; name: string } | null;
    changedIds: string[];
    unchangedIds: string[];
    reconciledIds: string[];
  }
>;

export type TransactionMergeRequest = {
  ids: [string, string];
  allowReconciled?: boolean;
};
export type TransactionMergeProposal = CatalogProposal<
  'transactions.merge',
  TransactionMergeRequest,
  { transactions: Array<Record<string, unknown>> },
  {
    keepId: string;
    dropId: string;
    movedChildIds: string[];
    deletedChildIds: string[];
    transfer: { keepId: string; dropId: string } | null;
  }
>;
export type TransactionMergeOutcome = CatalogCommit<{
  transactionMerge: { keptId: string };
}>;

export type TransactionSplitRequest = {
  id: string;
  subtransactions: Array<{
    amount: number;
    category?: string | null;
    notes?: string | null;
    payee?: string | null;
  }>;
  allowReconciled?: boolean;
};
export type TransactionSplitProposal = CatalogProposal<
  'transactions.split',
  TransactionSplitRequest,
  {
    transaction: Record<string, unknown>;
    children: Array<{ id: string; amount: number; category: string | null }>;
  },
  {
    amount: number;
    children: Array<{
      amount: number;
      category: string | null;
      notes: string | null;
      payee: string | null;
    }>;
    removedChildIds: string[];
  }
>;
export type TransactionSplitOutcome = CatalogCommit<{
  transactionSplit: { childIds: string[] };
}>;

export type TransactionAdditionRequest = {
  accountId: string;
  transactions: Array<Record<string, unknown>>;
};
export type TransactionAdditionProposal = CatalogProposal<
  'transactions.add',
  TransactionAdditionRequest,
  object,
  { rows: Array<Record<string, unknown>> }
>;
export type TransactionAdditionOutcome = CatalogCommit<{
  transactionAddition: { transactionIds: string[] };
}>;

export type TransactionImportRequest = {
  accountId: string;
  transactions: Array<Record<string, unknown>>;
  opts?: {
    defaultCleared?: boolean;
    reimportDeleted?: boolean;
    payeeNameNormalization?: 'original' | 'title-case';
  };
};
export type TransactionImportProposal = CatalogProposal<
  'transactions.import',
  TransactionImportRequest,
  object,
  {
    added: Array<Record<string, unknown>>;
    updated: Array<Record<string, unknown>>;
  }
>;
export type TransactionImportOutcome = CatalogCommit<{
  transactionImport: { addedIds: string[]; updatedIds: string[] };
}>;

export type CategoryGroupUpdateRequest = {
  id: string;
  fields: {
    id?: string;
    name?: string;
    is_income?: boolean;
    hidden?: boolean;
    categories?: CategoryGroupCreationRequest['categories'];
  };
};
export type CategoryGroupUpdateProposal = {
  schemaVersion: 1;
  operation: 'category-groups.update';
  budget: TransactionUpdateProposal['budget'];
  request: CategoryGroupUpdateRequest;
  before: { sourceHash: string; group: Record<string, unknown> };
  after: Record<string, unknown>;
  references: unknown;
  sideEffects: string[];
};

export type CategoryGroupCreationRequest = {
  name: string;
  is_income?: boolean;
  hidden?: boolean;
  categories?: Array<{
    id: string;
    name: string;
    group_id: string;
    is_income?: boolean;
    hidden?: boolean;
  }>;
};
export type CategoryGroupCreationProposal = {
  schemaVersion: 1;
  operation: 'category-groups.create';
  budget: TransactionUpdateProposal['budget'];
  request: CategoryGroupCreationRequest;
  before: { sourceHash: string };
  after: { group: Record<string, unknown> };
  references: unknown;
  sideEffects: string[];
};
export type CategoryGroupCreationOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      groupCreation: { groupId: string };
    });

export type CategoryCreationRequest = {
  name: string;
  group_id: string;
  is_income?: boolean;
  hidden?: boolean;
};
export type CategoryCreationProposal = {
  schemaVersion: 1;
  operation: 'categories.create';
  budget: TransactionUpdateProposal['budget'];
  request: CategoryCreationRequest;
  before: { sourceHash: string };
  after: {
    category: Record<string, unknown>;
    updatedCategories: Array<{ id: string; sort_order: number }>;
    mapping: { creates: true };
  };
  references: unknown;
  sideEffects: string[];
};
export type CategoryCreationOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      categoryCreation: {
        categoryId: string;
        mappingId: string;
        updatedCategoryIds: string[];
      };
    });

export type CategoryGroupDeletionRequest = {
  id: string;
  transferCategoryId?: string;
};
export type CategoryGroupDeletionProposal = {
  schemaVersion: 1;
  operation: 'category-groups.delete';
  budget: TransactionUpdateProposal['budget'];
  request: CategoryGroupDeletionRequest;
  before: { sourceHash: string; group: Record<string, unknown> };
  after: {
    group: Record<string, unknown>;
    categories: Array<Record<string, unknown> & { id: string }>;
    mappings: CategoryDeletionProposal['after']['mappings'];
    budgetTransfers: CategoryDeletionProposal['after']['budgetTransfers'];
  };
  references: unknown;
  sideEffects: string[];
};

export type CategoryDeletionRequest = {
  id: string;
  transferCategoryId?: string;
};
export type CategoryDeletionProposal = {
  schemaVersion: 1;
  operation: 'categories.delete';
  budget: TransactionUpdateProposal['budget'];
  request: CategoryDeletionRequest;
  before: { sourceHash: string; category: Record<string, unknown> };
  after: {
    category: Record<string, unknown>;
    mappings: Array<{ id: string; transferId: string }>;
    budgetTransfers: Array<{
      month: string;
      category: string;
      amount: number;
      table: 'zero_budgets' | 'reflect_budgets';
      before: Record<string, unknown> | null;
    }>;
  };
  references: unknown;
  sideEffects: string[];
};

export type CategoryUpdateRequest = {
  id: string;
  fields: {
    id?: string;
    name?: string;
    group_id?: string;
    is_income?: boolean;
    hidden?: boolean;
  };
};
export type CategoryUpdateProposal = {
  schemaVersion: 1;
  operation: 'categories.update';
  budget: TransactionUpdateProposal['budget'];
  request: CategoryUpdateRequest;
  before: { sourceHash: string; category: Record<string, unknown> };
  after: Record<string, unknown>;
  references: unknown;
  sideEffects: string[];
};

export type AccountUpdateFields = {
  name?: string;
  offbudget?: boolean;
  closed?: boolean;
  balance_current?: number | null;
  account_group_id?: string | null;
};
export type AccountUpdateRequest = { id: string; fields: AccountUpdateFields };
export type AccountUpdateState = {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  balance_current: number | null;
  account_group_id: string | null;
};
export type AccountUpdateProposal = {
  schemaVersion: 1;
  operation: 'accounts.update';
  budget: TransactionUpdateProposal['budget'];
  request: AccountUpdateRequest;
  before: {
    sourceHash: string;
    account: AccountUpdateState;
    transferPayees: { id: string; name: string }[];
  };
  after: {
    account: AccountUpdateState;
    transferPayees: { id: string; name: string }[];
  };
  references: unknown;
  sideEffects: string[];
};

export type AccountUnlinkOutcome = {
  localChanged: boolean;
  remoteStatus:
    | 'not-required'
    | 'skipped-no-token'
    | 'skipped-other-accounts'
    | 'acknowledged'
    | 'uncertain';
};

export type AccountClosureOutcome = {
  action: 'unchanged' | 'closed' | 'deleted';
  accountId: string;
  unlink: AccountUnlinkOutcome;
  addedTransactionIds: string[];
  deletedTransactionIds: string[];
  updatedTransactionIds: string[];
  deletedPayeeIds: string[];
};

export type AccountCloseRequest = {
  id: string;
  transferAccountId?: string;
  categoryId?: string;
};
export type AccountCloseSeed = { id: string; date: string; sortOrder: number };
export type AccountCloseProposal = {
  schemaVersion: 1;
  operation: 'accounts.close';
  budget: TransactionUpdateProposal['budget'];
  request: AccountCloseRequest;
  seed: AccountCloseSeed;
  before: { sourceHash: string };
  after: {
    action: AccountClosureOutcome['action'];
    source:
      | (Omit<TransactionEntity, 'category'> & { category: string | null })
      | null;
    counterpart:
      | (Partial<Omit<TransactionEntity, 'category' | 'schedule'>> & {
          category?: string | null;
          schedule?: string | null;
        })
      | null;
    unlink: AccountDeletionProposal['after']['unlink'];
  };
  references: unknown;
  sideEffects: string[];
};
export type AccountCloseOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      accountClosure: AccountClosureOutcome;
    });

export type AccountDeletionRequest = { id: string };
export type AccountDeletionProposal = {
  schemaVersion: 1;
  operation: 'accounts.delete';
  budget: TransactionUpdateProposal['budget'];
  request: AccountDeletionRequest;
  before: {
    sourceHash: string;
    account: unknown;
    transactions: TransactionEntity[];
    counterparts: (TransactionEntity | null)[];
  };
  after: {
    action: AccountClosureOutcome['action'];
    deletedTransactionIds: string[];
    updatedTransactionIds: string[];
    deletedPayeeIds: string[];
    unlink: {
      clearFields: string[];
      remoteRemoval: { url: string; requisitionId: string } | null;
      hasToken: boolean;
    };
  };
  references: unknown;
  sideEffects: string[];
};
export type AccountDeletionOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      accountClosure: AccountClosureOutcome;
    });

export type AccountReopenRequest = { id: string };
export type AccountReopenProposal = Omit<
  AccountUpdateProposal,
  'operation' | 'request'
> & {
  operation: 'accounts.reopen';
  request: AccountReopenRequest;
};

export type AccountCreationRequest = {
  name: string;
  offbudget: boolean;
  initialBalance: number;
  closed?: boolean;
};
export type AccountCreationProposal = {
  schemaVersion: 1;
  operation: 'accounts.create';
  budget: TransactionUpdateProposal['budget'];
  request: AccountCreationRequest;
  before: { sourceHash: string };
  after: {
    account: { name: string; offbudget: boolean; closed: boolean };
    transferPayee: { creates: true };
    openingTransaction: {
      amount: number;
      date: string;
      cleared: true;
      categoryId: string | null;
      payeeId: string | null;
      createsPayee: boolean;
    } | null;
  };
  references: unknown;
  sideEffects: string[];
};
export type AccountCreationOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      accountCreation: {
        accountId: string;
        transferPayeeId: string;
        openingTransactionId: string | null;
        startingBalancePayeeId: string | null;
      };
    });

export type BudgetAmountRequest = {
  month: string;
  categoryId: string;
  amount: number;
};
export type BudgetCarryoverRequest = {
  month: string;
  categoryId: string;
  flag: boolean;
};
export type BudgetHoldRequest =
  | { operation: 'budgets.hold-next-month'; month: string; amount: number }
  | { operation: 'budgets.reset-hold'; month: string };
export type BudgetHoldProposal = {
  schemaVersion: 1;
  budget: TransactionUpdateProposal['budget'];
  before: { buffered: number; row: unknown };
  after: { buffered: number; willWrite: boolean };
  references: { toBudget: number; tracking: boolean; sourceHash: string };
  sideEffects: string[];
} & (
  | {
      operation: 'budgets.hold-next-month';
      request: Extract<
        BudgetHoldRequest,
        { operation: 'budgets.hold-next-month' }
      >;
    }
  | {
      operation: 'budgets.reset-hold';
      request: Extract<BudgetHoldRequest, { operation: 'budgets.reset-hold' }>;
    }
);
export type BudgetCarryoverProposal = {
  schemaVersion: 1;
  operation: 'budgets.set-carryover';
  budget: TransactionUpdateProposal['budget'];
  request: BudgetCarryoverRequest;
  before: { months: { month: string; row: unknown; carryover: boolean }[] };
  after: { months: { month: string; carryover: boolean }[] };
  references: unknown;
  sideEffects: string[];
};
export type BudgetAmountProposal = {
  schemaVersion: 1;
  operation: 'budgets.set-amount';
  budget: TransactionUpdateProposal['budget'];
  request: BudgetAmountRequest;
  before: { amount: number; row: unknown };
  after: { amount: number };
  references: unknown;
  sideEffects: string[];
};
export type BudgetMetadataRequest =
  | { operation: 'budgets.rename'; id: string; name: string }
  | { operation: 'budgets.archive'; id: string; archived: boolean };

export type BudgetMetadataProposal = {
  schemaVersion: 1;
  delivery: 'local-only' | 'sync';
  operation: BudgetMetadataRequest['operation'];
  budget: TransactionUpdateProposal['budget'];
  request: BudgetMetadataRequest;
  before: { name: string; archived: boolean };
  after: { name: string; archived: boolean };
  references: { nameAvailable: boolean };
  sideEffects: string[];
};
export type ChangeProposal =
  | CategoryGroupUpdateProposal
  | PayeeCreationProposal
  | PayeeUpdateProposal
  | PayeeDeletionProposal
  | PayeeMergeProposal
  | TagCreationProposal
  | TagUpdateProposal
  | TagDeletionProposal
  | NoteSetProposal
  | PreferenceSetProposal
  | AccountGroupCreationProposal
  | AccountGroupUpdateProposal
  | AccountGroupDeletionProposal
  | RuleCreationProposal
  | RuleUpdateProposal
  | RuleDeletionProposal
  | ScheduleCreationProposal
  | ScheduleUpdateProposal
  | ScheduleDeletionProposal
  | TransactionDeletionProposal
  | TransactionCategorizationProposal
  | TransactionMergeProposal
  | TransactionSplitProposal
  | TransactionAdditionProposal
  | TransactionImportProposal
  | CategoryGroupCreationProposal
  | CategoryCreationProposal
  | CategoryGroupDeletionProposal
  | CategoryDeletionProposal
  | CategoryUpdateProposal
  | AccountCreationProposal
  | AccountUpdateProposal
  | AccountReopenProposal
  | AccountDeletionProposal
  | AccountCloseProposal
  | TransactionUpdateProposal
  | BudgetAmountProposal
  | BudgetCarryoverProposal
  | BudgetHoldProposal
  | BudgetMetadataProposal
  | BudgetCreationProposal
  | BudgetCloneProposal
  | BudgetRestoreProposal
  | BudgetPublicationProposal;

export type BudgetCreationRequest = { name: string; currency?: string };
export type BudgetCreationProposal = {
  schemaVersion: 1;
  operation: 'budgets.create';
  delivery: 'local-only';
  budget: null;
  request: BudgetCreationRequest;
  before: { exists: false };
  after: { name: string; currency: string | null; published: false };
  references: { nameAvailable: true };
  sideEffects: string[];
};

export type BudgetCloneRequest = { id: string; name: string };
export type BudgetCloneProposal = {
  schemaVersion: 1;
  operation: 'budgets.clone';
  delivery: 'local-only';
  budget: TransactionUpdateProposal['budget'];
  request: BudgetCloneRequest;
  before: {
    sourceHash: string;
    name: string;
    currency: string | null;
    archived: boolean;
  };
  after: { name: string; published: false };
  references: { nameAvailable: true; ignoredTables: string[] };
  sideEffects: string[];
};

export type BudgetRestoreRequest = { name: string };
export type BudgetRestoreProposal = {
  schemaVersion: 1;
  operation: 'backups.restore';
  delivery: 'local-only';
  budget: null;
  request: BudgetRestoreRequest;
  before: {
    sha256: string;
    bytes: number;
    sourceId: string;
  };
  after: { name: string; published: false };
  references: { nameAvailable: true };
  sideEffects: string[];
};

export type BudgetPublicationRequest = { id: string; encrypted: boolean };
export type BudgetPublicationProposal = {
  schemaVersion: 1;
  operation: 'budgets.publish';
  delivery: 'publication';
  budget: TransactionUpdateProposal['budget'];
  request: BudgetPublicationRequest;
  before: {
    sourceHash: string;
    name: string;
    currency: string | null;
    publication: {
      serverUrl: string;
      cloudFileId: string;
      encrypted: boolean;
      status: 'prepared' | 'published';
      guardHash: string | null;
    } | null;
  };
  after: { published: true; encrypted: boolean };
  references: { serverUrl: string; encryptedInitialSupported: boolean };
  sideEffects: string[];
};
export type BudgetPublicationOutcome =
  | Extract<TransactionUpdateOutcome, { status: 'rejected' }>
  | (Extract<TransactionUpdateOutcome, { status: 'committed-local' }> & {
      publication: {
        serverUrl: string;
        syncId: string;
        cloudFileId: string;
        encrypted: boolean;
      };
    });
