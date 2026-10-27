import type { ChangeReceipt } from '#change-journal';

import {
  checkFieldsLanded,
  checkImportLanded,
  resolutionScope,
  resolvable,
  resolvedOutcome,
} from './receipt-resolution';

function receipt(
  added: Array<Record<string, unknown>>,
  updated: Array<{ id: string }> = [],
  state: ChangeReceipt['state'] = 'uncertain',
): ChangeReceipt {
  return {
    schemaVersion: 1,
    operationId: 'op',
    token: 't',
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
    state,
    proposal: {
      schemaVersion: 1,
      operation: 'imports.file',
      before: { file: { sha256: 'abc' } },
      after: { added, updated },
    } as unknown as ChangeReceipt['proposal'],
  };
}

const row = (over: Record<string, unknown>) => ({
  id: 'x',
  account: 'acct',
  date: '2026-10-23',
  amount: 10000,
  imported_id: null,
  imported_payee: null,
  ...over,
});

describe('receipt resolution', () => {
  it('only resolves uncertain import receipts', () => {
    expect(resolvable(receipt([]))).toBe(true);
    expect(resolvable(receipt([], [], 'committed-local'))).toBe(false);
  });

  it('scopes the ledger read to the planned accounts and dates', () => {
    const r = receipt(
      [
        { account: 'acct', date: '2026-10-23', amount: 1 },
        { account: 'acct', date: '2026-10-20', amount: 2 },
      ],
      [{ id: 'u1' }],
    );
    expect(resolutionScope(r)).toEqual({
      accounts: ['acct'],
      from: '2026-10-20',
      to: '2026-10-23',
      updatedIds: ['u1'],
    });
  });

  it('verifies when every planned row is in the ledger', () => {
    const r = receipt(
      [
        {
          account: 'acct',
          date: '2026-10-23',
          amount: 10000,
          imported_id: 'bank-1',
        },
        {
          account: 'acct',
          date: '2026-10-23',
          amount: 10000,
          imported_payee: 'Deposit',
        },
      ],
      [{ id: 'u1' }],
    );
    const check = checkImportLanded(
      r,
      [
        row({ id: 'a1', imported_id: 'bank-1' }),
        row({ id: 'a2', imported_payee: 'Deposit' }),
      ],
      ['u1'],
    );
    expect(check).toEqual({
      verified: true,
      addedIds: ['a1', 'a2'],
      updatedIds: ['u1'],
      missing: [],
    });
    const outcome = resolvedOutcome(r, check, '2026-10-23T12:00:00Z');
    expect(outcome).toMatchObject({
      status: 'committed-local',
      changed: true,
      checkpoint: 'resolved:2026-10-23T12:00:00Z',
      fileImport: { sha256: 'abc', addedIds: ['a1', 'a2'], updatedIds: ['u1'] },
    });
  });

  it('does not let one ledger row satisfy two planned rows', () => {
    const r = receipt([
      {
        account: 'acct',
        date: '2026-10-23',
        amount: 10000,
        imported_payee: 'Deposit',
      },
      {
        account: 'acct',
        date: '2026-10-23',
        amount: 10000,
        imported_payee: 'Deposit',
      },
    ]);
    const check = checkImportLanded(
      r,
      [row({ id: 'a1', imported_payee: 'Deposit' })],
      [],
    );
    expect(check.verified).toBe(false);
    expect(check.missing).toHaveLength(1);
  });

  it('reports missing updated rows', () => {
    const check = checkImportLanded(receipt([], [{ id: 'gone' }]), [], []);
    expect(check).toMatchObject({
      verified: false,
      missing: [{ kind: 'updated', row: { id: 'gone' } }],
    });
  });

  function fieldReceipt(
    operation: string,
    request: unknown,
    before: unknown,
    after: unknown,
  ): ChangeReceipt {
    return {
      ...receipt([]),
      proposal: {
        schemaVersion: 1,
        operation,
        request,
        before,
        after,
      } as unknown as ChangeReceipt['proposal'],
    };
  }
  const tx = (over: Record<string, unknown>) => ({
    id: 't1',
    account: 'acct',
    category: null,
    notes: null,
    payee: null,
    cleared: true,
    transfer_id: null,
    ...over,
  });

  it('checks categorization by the planned category', () => {
    const r = fieldReceipt(
      'transactions.categorize',
      { ids: ['t1', 't2'], category: 'food' },
      {},
      { changedIds: ['t1', 't2'] },
    );
    expect(resolvable(r)).toBe(true);
    const half = checkFieldsLanded(r, [
      tx({ category: 'food' }),
      tx({ id: 't2', category: 'rent' }),
    ]);
    expect(half.verified).toBe(false);
    expect(half.missing[0].row).toMatchObject({
      id: 't2',
      found: { category: 'rent' },
    });
    expect(
      checkFieldsLanded(r, [
        tx({ category: 'food' }),
        tx({ id: 't2', category: 'food' }),
      ]).verified,
    ).toBe(true);
  });

  it('checks each field of a batch update and reports absent rows', () => {
    const r = fieldReceipt(
      'transactions.update-many',
      {},
      {},
      {
        changes: [
          { id: 't1', fields: { notes: 'n', cleared: false } },
          { id: 'gone', fields: { notes: null } },
        ],
      },
    );
    const check = checkFieldsLanded(r, [tx({ notes: 'n', cleared: false })]);
    expect(check.updatedIds).toEqual(['t1']);
    expect(check.missing).toEqual([
      { kind: 'field', row: { id: 'gone', absent: true } },
    ]);
  });

  it('checks a created transfer through its counterpart link', () => {
    const r = fieldReceipt(
      'transfers.create',
      { id: 't1', account: 'savings' },
      { transaction: { id: 't1' } },
      { payee: 'p-savings', counterpart: { account: 'savings' } },
    );
    const source = tx({ payee: 'p-savings', transfer_id: 'c1' });
    const good = checkFieldsLanded(
      r,
      [source],
      [tx({ id: 'c1', account: 'savings', transfer_id: 't1' })],
    );
    expect(good).toMatchObject({ verified: true, addedIds: ['c1'] });
    expect(resolvedOutcome(r, good, 'now')).toMatchObject({
      transferCreate: { counterpartId: 'c1' },
    });
    expect(
      checkFieldsLanded(
        r,
        [source],
        [tx({ id: 'c1', account: 'other', transfer_id: 't1' })],
      ).verified,
    ).toBe(false);
  });
});
