// Pre-write validation shared by the guarded transaction addition and import
// planners. The canonical owners accept rows that later fail or are altered at
// write time (unknown category or payee ids, dates before the AQL minimum,
// dangling transfer links, categories on off-budget rows, split children that
// do not add up). Those rows used to pass preview and then commit a bad row or
// fail the acknowledgement after writing, so every such case is rejected here,
// before any plan or token exists.
import * as db from '#server/db';
import { assertEngineHeadroom } from '#server/engine-limits';
import { APIError } from '#server/errors';
import { isEngineAmount } from '#shared/util';

// aql/schema-helpers.ts rejects earlier dates when a row is inserted.
export const MINIMUM_TRANSACTION_DATE = '1995-01-01';

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDate(value: unknown) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value &&
    value >= MINIMUM_TRANSACTION_DATE
  );
}

export async function assertPlannableTransactionRows(
  accountId: string,
  rows: Row[],
  { allowTransferPayees }: { allowTransferPayees: boolean },
) {
  const account = await db.first<{ offbudget: number }>(
    'SELECT offbudget FROM accounts WHERE id = ? AND tombstone = 0',
    [accountId],
  );
  const categories = new Map<string, boolean>();
  const payees = new Map<string, { transfer: boolean } | null>();

  async function categoryExists(id: string) {
    if (!categories.has(id)) {
      categories.set(
        id,
        !!(await db.first(
          'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
          [id],
        )),
      );
    }
    return categories.get(id)!;
  }

  async function payeeRow(id: string) {
    if (!payees.has(id)) {
      const row = await db.first<{ transfer_acct: string | null }>(
        'SELECT transfer_acct FROM payees WHERE id = ? AND tombstone = 0',
        [id],
      );
      payees.set(id, row ? { transfer: row.transfer_acct != null } : null);
    }
    return payees.get(id)!;
  }

  async function check(row: Row, label: string) {
    if (row.category != null) {
      if (
        typeof row.category !== 'string' ||
        !(await categoryExists(row.category))
      ) {
        throw APIError(`${label}: category does not exist`);
      }
      if (account?.offbudget) {
        throw APIError(
          `${label}: off-budget transactions cannot carry a category`,
        );
      }
    }
    if (row.payee != null) {
      const payee =
        typeof row.payee === 'string' ? await payeeRow(row.payee) : null;
      if (!payee) throw APIError(`${label}: payee does not exist`);
      if (payee.transfer && !allowTransferPayees) {
        throw APIError(
          `${label}: a transfer payee needs a linked counterpart; use transactions import or the transfers operations`,
        );
      }
    }
  }

  const amounts: number[] = [];
  for (const [index, row] of rows.entries()) {
    const label = `Row ${index + 1}`;
    if (row.date !== undefined && !validDate(row.date)) {
      throw APIError(
        `${label}: date must be a real YYYY-MM-DD date on or after ${MINIMUM_TRANSACTION_DATE}`,
      );
    }
    if (row.amount !== undefined && !isEngineAmount(row.amount)) {
      throw APIError(
        `${label}: amount must be integer cents within the budget engine limit`,
      );
    }
    if (row.transfer_id != null) {
      throw APIError(
        `${label}: transfer_id cannot be set; transfers are linked by the transfers operations`,
      );
    }
    await check(row, label);
    if (typeof row.amount === 'number') amounts.push(row.amount);
    if (row.subtransactions !== undefined) {
      if (!Array.isArray(row.subtransactions)) {
        throw APIError(`${label}: subtransactions must be an array`);
      }
      if (row.subtransactions.length) {
        let sum = 0;
        for (const child of row.subtransactions) {
          if (!isRecord(child)) {
            throw APIError(`${label}: each subtransaction must be an object`);
          }
          if (!isEngineAmount(child.amount)) {
            throw APIError(
              `${label}: subtransaction amount must be integer cents within the budget engine limit`,
            );
          }
          await check(child, `${label} subtransaction`);
          sum += typeof child.amount === 'number' ? child.amount : NaN;
          amounts.push(child.amount);
        }
        if (sum !== row.amount) {
          throw APIError(
            `${label}: subtransaction amounts must add up to the row amount`,
          );
        }
      }
    }
  }
  await assertEngineHeadroom(amounts);
}

// Rules run while a plan is built and can set a category that no longer
// exists (the rule predates a category deletion). The row is then stored with
// a dangling category, the receipt read-back sees it as uncategorized, and the
// operation is left uncertain after committing. Refuse such plans.
export async function assertPlannedCategories(
  rows: Array<{ category?: unknown }>,
) {
  const checked = new Set<string>();
  for (const row of rows) {
    if (row.category == null || typeof row.category !== 'string') continue;
    if (checked.has(row.category)) continue;
    const live = await db.first(
      'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
      [row.category],
    );
    if (!live) {
      throw APIError(
        'A rule would set a category that does not exist; fix or delete that rule first',
      );
    }
    checked.add(row.category);
  }
}
