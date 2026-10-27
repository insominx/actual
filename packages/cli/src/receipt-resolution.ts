// Resolution of uncertain receipts. A receipt is uncertain when the engine
// call failed or its acknowledgement was lost after the receipt was marked,
// so the change may or may not have landed. Replaying is never safe, but some
// postconditions are checkable against the ledger:
// - imports: every planned row is in the account;
// - field changes (categorize, batch update, transfer link or creation): every
//   affected transaction now carries the planned values.
// When the check holds, the receipt can be closed as committed; otherwise it
// stays uncertain and what is missing is reported.
import type { ChangeReceipt } from '#change-journal';
import { isRecord } from '#utils';

export const IMPORT_OPERATIONS = ['imports.file', 'transactions.import'];
export const FIELD_OPERATIONS = [
  'transactions.categorize',
  'transactions.update-many',
  'transfers.match',
  'transfers.create',
];
export const RESOLVABLE_OPERATIONS = [
  ...IMPORT_OPERATIONS,
  ...FIELD_OPERATIONS,
];

export type LedgerRow = {
  id: string;
  account: string;
  date: string;
  amount: number;
  imported_id: string | null;
  imported_payee: string | null;
};

// Current values of the fields a field operation sets.
export type FieldRow = {
  id: string;
  account: string;
  category: string | null;
  notes: string | null;
  payee: string | null;
  cleared: boolean;
  transfer_id: string | null;
};

type PlannedAdd = {
  account: string;
  date: string;
  amount: number;
  imported_id?: string | null;
  imported_payee?: string | null;
};

export type ResolutionCheck = {
  verified: boolean;
  addedIds: string[];
  updatedIds: string[];
  missing: Array<{
    kind: 'added' | 'updated' | 'field';
    row: Record<string, unknown>;
  }>;
};

type FieldExpectation = {
  id: string;
  fields: Partial<Omit<FieldRow, 'id' | 'account'>>;
  // transfers.create: the transfer must exist; its counterpart is checked by
  // account and the reverse link.
  linkedInto?: string;
};

export function resolvable(receipt: ChangeReceipt) {
  return (
    receipt.state === 'uncertain' &&
    RESOLVABLE_OPERATIONS.includes(receipt.proposal.operation)
  );
}

export function isImportReceipt(receipt: ChangeReceipt) {
  return IMPORT_OPERATIONS.includes(receipt.proposal.operation);
}

function plannedRows(receipt: ChangeReceipt) {
  const after = (receipt.proposal as { after?: unknown }).after;
  if (
    !isRecord(after) ||
    !Array.isArray(after.added) ||
    !Array.isArray(after.updated)
  ) {
    throw new Error('The receipt has no planned import rows');
  }
  return {
    added: after.added as PlannedAdd[],
    updated: after.updated as Array<{ id: string }>,
  };
}

// The date window and account the ledger must be read over.
export function resolutionScope(receipt: ChangeReceipt) {
  const { added, updated } = plannedRows(receipt);
  const dates = added.map(row => row.date).sort();
  return {
    accounts: [...new Set(added.map(row => row.account))],
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    updatedIds: updated.map(row => row.id),
  };
}

// Each planned addition must match a distinct live row: by imported_id when it
// has one, else by account, date, amount and imported payee.
export function checkImportLanded(
  receipt: ChangeReceipt,
  ledger: LedgerRow[],
  liveUpdatedIds: string[],
): ResolutionCheck {
  const { added, updated } = plannedRows(receipt);
  const claimed = new Set<string>();
  const addedIds: string[] = [];
  const missing: ResolutionCheck['missing'] = [];
  for (const row of added) {
    const hit = ledger.find(
      candidate =>
        !claimed.has(candidate.id) &&
        candidate.account === row.account &&
        candidate.amount === row.amount &&
        (row.imported_id
          ? candidate.imported_id === row.imported_id
          : candidate.date === row.date &&
            (candidate.imported_payee ?? null) ===
              (row.imported_payee ?? null)),
    );
    if (hit) {
      claimed.add(hit.id);
      addedIds.push(hit.id);
    } else {
      missing.push({ kind: 'added', row: { ...row } });
    }
  }
  const live = new Set(liveUpdatedIds);
  const updatedIds: string[] = [];
  for (const row of updated) {
    if (live.has(row.id)) updatedIds.push(row.id);
    else missing.push({ kind: 'updated', row: { id: row.id } });
  }
  return { verified: missing.length === 0, addedIds, updatedIds, missing };
}

// What a field operation's apply leaves on each affected transaction.
export function fieldExpectations(receipt: ChangeReceipt): FieldExpectation[] {
  const proposal = receipt.proposal as {
    operation: string;
    request?: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  const after = proposal.after ?? {};
  switch (proposal.operation) {
    case 'transactions.categorize':
      return ((after.changedIds as string[]) ?? []).map(id => ({
        id,
        fields: { category: (proposal.request?.category as string) ?? null },
      }));
    case 'transactions.update-many':
      return (
        (after.changes as Array<{
          id: string;
          fields: Record<string, unknown>;
        }>) ?? []
      ).map(change => ({
        id: change.id,
        fields: change.fields as FieldExpectation['fields'],
      }));
    case 'transfers.match':
      return (
        (after.transactions as Array<{
          id: string;
          payee: string | null;
          transferId: string | null;
          category: string | null;
        }>) ?? []
      ).map(leg => ({
        id: leg.id,
        fields: {
          payee: leg.payee,
          transfer_id: leg.transferId,
          category: leg.category,
        },
      }));
    case 'transfers.create': {
      const transaction = proposal.before?.transaction as { id: string };
      const counterpart = after.counterpart as { account: string };
      return [
        {
          id: transaction.id,
          fields: { payee: after.payee as string },
          linkedInto: counterpart.account,
        },
      ];
    }
    default:
      throw new Error(`No field check for ${proposal.operation}`);
  }
}

// The transactions a field check reads: the affected ones and, for a created
// transfer, its counterpart (found through the link).
export function fieldScope(receipt: ChangeReceipt) {
  return fieldExpectations(receipt).map(expectation => expectation.id);
}

export function checkFieldsLanded(
  receipt: ChangeReceipt,
  rows: FieldRow[],
  counterparts: FieldRow[] = [],
): ResolutionCheck {
  const byId = new Map(
    [...rows, ...counterparts].map(row => [row.id, row] as const),
  );
  const missing: ResolutionCheck['missing'] = [];
  const updatedIds: string[] = [];
  const addedIds: string[] = [];
  for (const expectation of fieldExpectations(receipt)) {
    const row = byId.get(expectation.id);
    if (!row) {
      missing.push({
        kind: 'field',
        row: { id: expectation.id, absent: true },
      });
      continue;
    }
    const wrong = Object.entries(expectation.fields).filter(
      ([field, value]) =>
        (row[field as keyof FieldRow] ?? null) !== (value ?? null),
    );
    if (expectation.linkedInto) {
      const other = row.transfer_id ? byId.get(row.transfer_id) : undefined;
      if (
        !other ||
        other.account !== expectation.linkedInto ||
        other.transfer_id !== row.id
      ) {
        wrong.push(['transfer_id', row.transfer_id]);
      } else {
        addedIds.push(other.id);
      }
    }
    if (wrong.length) {
      missing.push({
        kind: 'field',
        row: {
          id: expectation.id,
          expected: expectation.fields,
          found: Object.fromEntries(
            wrong.map(([field]) => [field, row[field as keyof FieldRow]]),
          ),
        },
      });
    } else {
      updatedIds.push(expectation.id);
    }
  }
  return { verified: missing.length === 0, addedIds, updatedIds, missing };
}

// The committed outcome a resolved receipt records, in the shape a normal
// apply of the same operation would have written.
export function resolvedOutcome(
  receipt: ChangeReceipt,
  check: ResolutionCheck,
  at: string,
) {
  const base = {
    status: 'committed-local' as const,
    changed: check.addedIds.length + check.updatedIds.length > 0,
    checkpoint: `resolved:${at}`,
    affectedIds: [...check.addedIds, ...check.updatedIds],
    resolution: {
      method: 'postcondition',
      verifiedAt: at,
      note: 'Closed by changes resolve after the ledger showed the planned result',
    },
  };
  const operation = receipt.proposal.operation;
  if (operation === 'imports.file') {
    const before = (
      receipt.proposal as { before?: { file?: { sha256?: string } } }
    ).before;
    return {
      ...base,
      fileImport: {
        sha256: before?.file?.sha256 ?? '',
        addedIds: check.addedIds,
        updatedIds: check.updatedIds,
      },
    };
  }
  if (operation === 'transactions.import') {
    return {
      ...base,
      transactionImport: {
        addedIds: check.addedIds,
        updatedIds: check.updatedIds,
      },
    };
  }
  if (operation === 'transfers.create') {
    return { ...base, transferCreate: { counterpartId: check.addedIds[0] } };
  }
  return base;
}
