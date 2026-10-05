// Read-only catalog inspection for agent tools. Reports stable IDs, hidden
// and deleted status, where a deleted row's references now resolve, how many
// live transactions resolve to each row through the canonical mapping tables,
// and which other rows share a name (case-insensitive), so duplicates are
// explicit instead of being guessed away.
import * as db from '#server/db';
import { APIError } from '#server/errors';

export type CatalogInspectKind = 'categories' | 'payees';

export type CatalogInspectRow = {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  mappedTo: string | null;
  transactionCount: number;
  sameNameIds: string[];
  group?: { id: string; name: string | null } | null;
  isIncome?: boolean;
  transferAccount?: string | null;
};

type RawCategory = {
  id: string;
  name: string;
  hidden: number;
  tombstone: number;
  is_income: number;
  cat_group: string | null;
  group_name: string | null;
  mapped: string | null;
};

type RawPayee = {
  id: string;
  name: string;
  tombstone: number;
  transfer_acct: string | null;
  mapped: string | null;
};

function sameNames<T extends { id: string; name: string }>(rows: T[]) {
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    const key = (row.name ?? '').trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), row.id]);
  }
  return (row: T) =>
    (byName.get((row.name ?? '').trim().toLowerCase()) ?? []).filter(
      id => id !== row.id,
    );
}

// The alive transaction view already resolves references through the
// canonical mapping tables, so merged rows count toward their target.
// Categories count leaf rows (a split parent has no category); payees count
// top-level transactions.
async function counts(column: 'category' | 'payee') {
  const rows = await db.all<{ target: string; count: number }>(
    column === 'category'
      ? `SELECT category AS target, COUNT(*) AS count
           FROM v_transactions_internal_alive
          WHERE category IS NOT NULL
          GROUP BY category`
      : `SELECT payee AS target, COUNT(*) AS count
           FROM v_transactions_internal_alive
          WHERE payee IS NOT NULL AND is_child = 0
          GROUP BY payee`,
  );
  return new Map(rows.map(row => [row.target, row.count]));
}

export async function inspectCatalog({
  kind,
  includeDeleted = false,
}: {
  kind: CatalogInspectKind;
  includeDeleted?: boolean;
}): Promise<CatalogInspectRow[]> {
  if (kind === 'categories') {
    const rows = await db.all<RawCategory>(
      `SELECT c.id, c.name, c.hidden, c.tombstone, c.is_income, c.cat_group,
              g.name AS group_name, m.transferId AS mapped
         FROM categories c
         LEFT JOIN category_groups g ON g.id = c.cat_group
         LEFT JOIN category_mapping m ON m.id = c.id
        ORDER BY c.sort_order, c.id`,
    );
    const transactionCounts = await counts('category');
    const others = sameNames(rows);
    return rows
      .filter(row => includeDeleted || !row.tombstone)
      .map(row => ({
        id: row.id,
        name: row.name,
        hidden: !!row.hidden,
        deleted: !!row.tombstone,
        mappedTo: row.mapped && row.mapped !== row.id ? row.mapped : null,
        transactionCount: row.tombstone
          ? 0
          : (transactionCounts.get(row.id) ?? 0),
        sameNameIds: others(row),
        group: row.cat_group
          ? { id: row.cat_group, name: row.group_name }
          : null,
        isIncome: !!row.is_income,
      }));
  }
  if (kind === 'payees') {
    const rows = await db.all<RawPayee>(
      `SELECT p.id, p.name, p.tombstone, p.transfer_acct, m.targetId AS mapped
         FROM payees p
         LEFT JOIN payee_mapping m ON m.id = p.id
        ORDER BY p.name, p.id`,
    );
    const transactionCounts = await counts('payee');
    const others = sameNames(rows);
    return rows
      .filter(row => includeDeleted || !row.tombstone)
      .map(row => ({
        id: row.id,
        name: row.name,
        hidden: false,
        deleted: !!row.tombstone,
        mappedTo: row.mapped && row.mapped !== row.id ? row.mapped : null,
        transactionCount: row.tombstone
          ? 0
          : (transactionCounts.get(row.id) ?? 0),
        sameNameIds: others(row),
        transferAccount: row.transfer_acct,
      }));
  }
  throw APIError('Catalog inspection supports categories and payees');
}
