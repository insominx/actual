import type { ChangeReceipt } from './change-journal';
import { diagnoseReceipt, planReversal, reversalConflicts } from './reversal';

function receipt(
  state: ChangeReceipt['state'],
  proposal: Record<string, unknown>,
): ChangeReceipt {
  return {
    schemaVersion: 1,
    operationId: 'op-1',
    token: 'a'.repeat(64),
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    state,
    proposal: proposal as unknown as ChangeReceipt['proposal'],
  };
}

const tx = (id: string, category: string | null) => ({
  id,
  account: 'acct',
  amount: -100,
  date: 20260801,
  category,
  parentId: null,
  transferId: null,
  reconciled: false,
});

const categorize = {
  operation: 'transactions.categorize',
  request: { ids: ['a', 'b'], category: 'dining' },
  before: { transactions: [tx('a', null), tx('b', null)] },
  after: { changedIds: ['a', 'b'] },
};

describe('reversal planning', () => {
  it('never reverses an uncertain change and guides recovery', () => {
    const r = receipt('uncertain', categorize);
    const plan = planReversal(r);
    expect(plan.supported).toBe(false);
    const diagnosis = diagnoseReceipt(r);
    expect(diagnosis.diagnosis).toMatch(/never replayed/);
    expect(diagnosis.nextSteps.join('\n')).toMatch(/backups restore/);
    expect(diagnosis.nextSteps.join('\n')).not.toMatch(/changes reverse/);
  });

  it('builds the inverse categorization from before-values', () => {
    const plan = planReversal(receipt('synced', categorize));
    expect(plan).toMatchObject({
      supported: true,
      operation: 'transactions.categorize',
      request: { ids: ['a', 'b'], category: null },
    });
  });

  it('refuses mixed prior categories', () => {
    const mixed = {
      ...categorize,
      before: { transactions: [tx('a', null), tx('b', 'food')] },
    };
    const plan = planReversal(receipt('committed-local', mixed));
    expect(plan.supported).toBe(false);
  });

  it('reports conflicts when records changed after the original', () => {
    const original = receipt('committed-local', categorize);
    const inverse = {
      operation: 'transactions.categorize',
      before: {
        transactions: [
          tx('a', 'dining'),
          { ...tx('b', 'other'), reconciled: true },
        ],
      },
    } as unknown as ChangeReceipt['proposal'];
    const conflicts = reversalConflicts(original, inverse);
    expect(conflicts).toEqual([
      'b: category changed after the original change',
      'b: reconciled',
    ]);
  });

  it('marks merges unsupported with backup guidance', () => {
    const plan = planReversal(
      receipt('synced', { operation: 'transactions.merge' }),
    );
    expect(plan.supported).toBe(false);
    if (!plan.supported) {
      expect(plan.reason).toMatch(/un-merge/);
      expect(plan.recovery.join('\n')).toMatch(/budgets compare/);
    }
  });
});
