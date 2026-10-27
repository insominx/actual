// @ts-strict-ignore
import { stringify as csvStringify } from 'csv-stringify/sync';

import { aqlQuery } from '#server/aql';
import { integerToAmount } from '#shared/util';

const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

type SplitRow = {
  Id: string;
  ParentId: string | null;
  IsChild: boolean;
  SortOrder: number | null;
};

// Query order is not split order. A date sort can return the later half
// first, and the CSV would label that half "SPLIT 1".
export function childSplitPositions(transactions: readonly SplitRow[]): {
  childSplitOrder: Map<string, number>;
  parentsChildCount: Map<string, number>;
} {
  const childrenByParent = new Map<string, SplitRow[]>();
  for (const trans of transactions) {
    if (!trans.IsChild || trans.ParentId == null) {
      continue;
    }
    const list = childrenByParent.get(trans.ParentId) ?? [];
    list.push(trans);
    childrenByParent.set(trans.ParentId, list);
  }

  const childSplitOrder = new Map<string, number>();
  const parentsChildCount = new Map<string, number>();
  for (const [parentId, children] of childrenByParent) {
    // Children are created with decreasing sort_order (-1, -2, ...), so
    // the first split has the highest value.
    const ordered = [...children].sort(
      (a, b) => (b.SortOrder ?? 0) - (a.SortOrder ?? 0),
    );
    parentsChildCount.set(parentId, ordered.length);
    ordered.forEach((child, index) => {
      childSplitOrder.set(child.Id, index + 1);
    });
  }
  return { childSplitOrder, parentsChildCount };
}

export function splitExportNotes(
  trans: {
    Id: string;
    ParentId: string | null;
    IsParent: boolean;
    IsChild: boolean;
    Notes: string | null;
  },
  childSplitOrder: ReadonlyMap<string, number>,
  parentsChildCount: ReadonlyMap<string, number>,
): string | null {
  const body = trans.Notes || '';
  if (trans.IsParent) {
    const count = parentsChildCount.get(trans.Id);
    const label = count == null ? '(SPLIT) ' : `(SPLIT INTO ${count}) `;
    return label + body;
  }
  if (trans.IsChild) {
    const index = childSplitOrder.get(trans.Id);
    const count =
      trans.ParentId == null
        ? undefined
        : parentsChildCount.get(trans.ParentId);
    if (index == null || count == null) {
      return trans.Notes;
    }
    return `(SPLIT ${index} OF ${count}) ` + body;
  }
  return trans.Notes;
}

const csvStringifyOptions = {
  header: true,
  cast: {
    string: (value: string) =>
      FORMULA_TRIGGERS.test(value) ? "'" + value : value,
  },
};

export async function exportToCSV(
  transactions,
  accounts,
  categoryGroups,
  payees,
) {
  const accountNamesById = accounts.reduce((reduced, { id, name }) => {
    reduced[id] = name;
    return reduced;
  }, {});

  const categoryNamesById = categoryGroups.reduce(
    (reduced, { name, categories: subCategories }) => {
      subCategories.forEach(
        subCategory =>
          (reduced[subCategory.id] = `${name}: ${subCategory.name}`),
      );
      return reduced;
    },
    {},
  );

  const payeeNamesById = payees.reduce((reduced, { id, name }) => {
    reduced[id] = name;
    return reduced;
  }, {});

  const transactionsForExport = transactions.map(
    ({
      account,
      date,
      payee,
      notes,
      category,
      amount,
      cleared,
      reconciled,
    }) => ({
      Account: accountNamesById[account],
      Date: date,
      Payee: payeeNamesById[payee],
      Notes: notes,
      Category: categoryNamesById[category],
      Amount: amount == null ? 0 : integerToAmount(amount),
      Cleared: cleared,
      Reconciled: reconciled,
    }),
  );

  return csvStringify(transactionsForExport, csvStringifyOptions);
}

export async function exportQueryToCSV(query) {
  const { data: transactions } = await aqlQuery(
    query
      .select([
        { Id: 'id' },
        { Account: 'account.name' },
        { Date: 'date' },
        { Payee: 'payee.name' },
        { ParentId: 'parent_id' },
        { IsParent: 'is_parent' },
        { IsChild: 'is_child' },
        { SortOrder: 'sort_order' },
        { Notes: 'notes' },
        { CategoryGroup: 'category.group.name' },
        { Category: 'category.name' },
        { Amount: 'amount' },
        { Cleared: 'cleared' },
        { Reconciled: 'reconciled' },
      ])
      .options({ splits: 'all' }),
  );

  const { childSplitOrder, parentsChildCount } =
    childSplitPositions(transactions);

  // map final properties for export and grab the child count for splits from their parent transaction
  const transactionsForExport = transactions.map(trans => {
    return {
      Account: trans.Account,
      Date: trans.Date,
      Payee: trans.Payee,
      Notes: splitExportNotes(trans, childSplitOrder, parentsChildCount),
      Category_Group: trans.CategoryGroup,
      Category: trans.Category,
      Amount: trans.IsParent
        ? 0
        : trans.Amount == null
          ? 0
          : integerToAmount(trans.Amount),
      Split_Amount: trans.IsParent
        ? integerToAmount(trans.Amount)
        : 0,
      Cleared:
        trans.Reconciled === true
          ? 'Reconciled'
          : trans.Cleared === true
            ? 'Cleared'
            : 'Not cleared',
    };
  });

  return csvStringify(transactionsForExport, csvStringifyOptions);
}
