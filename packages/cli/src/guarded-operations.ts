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
  'notes.set',
  'preferences.set',
  'account-groups.create',
  'account-groups.update',
  'account-groups.delete',
  'rules.create',
  'rules.update',
  'rules.delete',
  'schedules.create',
  'schedules.update',
  'schedules.delete',
  'transactions.delete',
  'transactions.categorize',
  'transactions.update-many',
  'transactions.clear',
  'transfers.match',
  'transfers.unmatch',
  'transfers.repair',
  'transfers.create',
  'imports.mapping-save',
  'imports.file',
  'rules.apply',
  'schedules.post',
  'schedules.skip',
  'budgets.move',
  'budgets.apply-templates',
  'reconcile.finish',
  'reconcile.adjust',
  'transactions.merge',
  'transactions.split',
  'transactions.add',
  'transactions.import',
  'accounts.create',
  'accounts.update',
  'accounts.reopen',
  'accounts.delete',
  'accounts.close',
  'budgets.set-amount',
  'budgets.set-carryover',
  'budgets.hold-next-month',
  'budgets.reset-hold',
  'budgets.set-type',
  'cash-planning.save',
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
  'account-groups.create',
  'rules.create',
  'schedules.create',
  'transactions.categorize',
  'transactions.update-many',
  'transactions.clear',
  'transfers.match',
  'transfers.unmatch',
  'transfers.repair',
  'transfers.create',
  'imports.mapping-save',
  'imports.file',
  'rules.apply',
  'schedules.post',
  'schedules.skip',
  'budgets.move',
  'budgets.apply-templates',
  'reconcile.finish',
  'reconcile.adjust',
  'cash-planning.save',
  'transactions.merge',
  'budgets.hold-next-month',
  'budgets.reset-hold',
  'budgets.set-type',
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
  'notes.set',
  'preferences.set',
  'preferences.reset',
  'account-groups.create',
  'account-groups.update',
  'account-groups.delete',
  'rules.create',
  'rules.update',
  'rules.delete',
  'schedules.create',
  'schedules.update',
  'schedules.delete',
  'transactions.delete',
  'transactions.categorize',
  'transactions.update-many',
  'transactions.clear',
  'transfers.match',
  'transfers.unmatch',
  'transfers.repair',
  'transfers.create',
  'imports.mappings.set',
  'imports.mappings.reset',
  'imports.apply',
  'rules.apply',
  'schedules.post',
  'schedules.skip',
  'budgets.move',
  'budgets.apply-templates',
  'reconcile.finish',
  'reconcile.adjust',
  'transactions.merge',
  'transactions.split',
  'transactions.add',
  'transactions.import',
  'budgets.clone',
  'budgets.publish',
  'backups.restore',
  'budgets.rename',
  'budgets.archive',
  'budgets.set-amount',
  'budgets.set-carryover',
  'budgets.hold-next-month',
  'budgets.reset-hold',
  'budgets.set-type',
  'cash-planning.save',
  'cash-planning.reset',
  'cash-planning.set-target',
  'cash-planning.reset-target',
  'cash-planning.set-goal',
];

// Direct commands whose guarded operation has a different name. `changes
// preview` takes the guarded name on the right.
const PREVIEW_ALIASES: Readonly<Record<string, string>> = {
  'preferences.reset': 'preferences.set',
  'imports.mappings.set': 'imports.mapping-save',
  'imports.mappings.reset': 'imports.mapping-save',
  'imports.apply': 'imports.file',
  'cash-planning.reset': 'cash-planning.save',
  'cash-planning.set-target': 'cash-planning.save',
  'cash-planning.reset-target': 'cash-planning.save',
  'cash-planning.set-goal': 'cash-planning.save',
};

// The operation name to give `changes preview` for a command, or undefined when
// the command has no guarded preview.
export function previewOperationFor(command: string): string | undefined {
  const alias = Object.prototype.hasOwnProperty.call(PREVIEW_ALIASES, command)
    ? PREVIEW_ALIASES[command]
    : command;
  return isGuardedOperation(alias) ? alias : undefined;
}

export function isGuardedOperation(operation: string) {
  return GUARDED_OPERATIONS.includes(operation);
}
