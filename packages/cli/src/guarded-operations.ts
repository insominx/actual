// Single source for guarded operation names shared by the journal decoder,
// executor, changes command and discovery. Keep this module dependency-free so
// the journal can import it without a cycle through the executor.

// Domain ledger and budget adapters that run through the shared executor.
export const DOMAIN_OPERATIONS = [
  'transactions.update',
  'category-groups.delete',
  'categories.delete',
  'category-groups.update',
  'categories.update',
  'category-groups.create',
  'categories.create',
  'payees.create',
  'payees.update',
  'payees.delete',
  'payees.merge',
  'tags.create',
  'tags.update',
  'tags.delete',
  'accounts.create',
  'accounts.update',
  'accounts.reopen',
  'accounts.delete',
  'accounts.close',
  'budgets.set-amount',
  'budgets.set-carryover',
  'budgets.hold-next-month',
  'budgets.reset-hold',
] as const;

// Budget lifecycle operations with dedicated connection and lock handling.
export const LIFECYCLE_OPERATIONS = [
  'budgets.rename',
  'budgets.archive',
  'budgets.create',
  'budgets.clone',
  'backups.restore',
  'budgets.publish',
] as const;

export const GUARDED_OPERATIONS: readonly string[] = [
  ...DOMAIN_OPERATIONS,
  ...LIFECYCLE_OPERATIONS,
];

// Operations whose scope comes from the payload. They take no target ID.
export const PAYLOAD_SCOPED_OPERATIONS: readonly string[] = [
  'accounts.create',
  'category-groups.create',
  'categories.create',
  'payees.create',
  'tags.create',
  'budgets.hold-next-month',
  'budgets.reset-hold',
];

// Operations that create a new budget destination. They take no target ID.
export const BUDGET_CREATING_OPERATIONS: readonly string[] = [
  'budgets.create',
  'backups.restore',
];

// Direct version 2 commands that must receive --operation-id before connecting.
export const DIRECT_GUARDED_COMMANDS: readonly string[] = [
  'budgets.create',
  'accounts.create',
  'accounts.update',
  'accounts.reopen',
  'accounts.delete',
  'accounts.close',
  'category-groups.delete',
  'categories.delete',
  'category-groups.update',
  'categories.update',
  'category-groups.create',
  'categories.create',
  'payees.create',
  'payees.update',
  'payees.delete',
  'payees.merge',
  'tags.create',
  'tags.update',
  'tags.delete',
  'budgets.clone',
  'budgets.publish',
  'backups.restore',
  'budgets.rename',
  'budgets.archive',
  'budgets.set-amount',
  'budgets.set-carryover',
  'budgets.hold-next-month',
  'budgets.reset-hold',
];

export function isGuardedOperation(operation: string) {
  return GUARDED_OPERATIONS.includes(operation);
}
