import type { TransactionEntity } from './models';

export type TransactionUpdateRequest = {
  id: string;
  fields: Partial<
    Pick<TransactionEntity, 'notes' | 'amount' | 'date' | 'cleared'>
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
