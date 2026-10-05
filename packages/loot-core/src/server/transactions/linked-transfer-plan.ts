import { updateTransaction } from '#shared/transactions';
import type { TransactionEntity } from '#types/models';

export type LinkedTransferContext = {
  account: string;
  payee: string;
  clearCategory: boolean;
};

// Both preview and the transfer writer use the same counterpart calculation.
// The shared split planner supplies inheritance and parent error recalculation.
export function planLinkedTransferUpdate(
  counterpartGroup: TransactionEntity[],
  source: TransactionEntity,
  context: LinkedTransferContext,
) {
  const counterpart = counterpartGroup.find(
    row => row.id === source.transfer_id,
  );
  if (!counterpart) throw new Error('Transfer counterpart not found');
  return updateTransaction(counterpartGroup, {
    ...counterpart,
    account: context.account,
    payee: context.payee,
    notes: source.notes,
    amount: -source.amount,
    schedule: source.schedule,
    ...(context.clearCategory ? { category: null } : {}),
    // Persisted categories can be null; the legacy entity type omits that case.
  } as TransactionEntity);
}
