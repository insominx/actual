import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { isPlanningDate } from '#shared/cash-planning';
import * as months from '#shared/months';
import { q } from '#shared/query';
import type {
  CashPlanningRequest,
  CashPlanningSummary,
} from '#types/models/cash-planning';

import { summarizeCashPlanning } from './summary';
import type { PlanningTransaction } from './summary';

export async function getCashPlanningSummary(
  request: CashPlanningRequest,
): Promise<CashPlanningSummary> {
  const asOf = months.currentDay();
  if (
    !isPlanningDate(request.startDate) ||
    !isPlanningDate(request.endDate) ||
    request.startDate > request.endDate ||
    request.endDate > asOf
  ) {
    throw new Error('Invalid cash planning history range');
  }
  const [accounts, transactions, categories, payees, references] =
    await Promise.all([
      aqlQuery(
        q('accounts').select([
          'id',
          'name',
          'offbudget',
          'closed',
          'tombstone',
        ]),
      ),
      aqlQuery(
        q('transactions')
          .options({ splits: 'all' })
          .filter({ date: { $lte: asOf } })
          .select([
            'id',
            'account',
            'date',
            'amount',
            'category',
            'payee',
            'transfer_id',
            'is_parent',
            'parent_id',
            'starting_balance_flag',
            'tombstone',
          ]),
      ),
      aqlQuery(
        q('categories')
          .withDead()
          .select(['id', 'name', 'is_income', 'hidden', 'tombstone']),
      ),
      aqlQuery(q('payees').withDead().select(['id', 'transfer_acct'])),
      // AQL's normal reference validation removes deleted categories. Preserve
      // the original reference when no replacement exists, while honoring merges.
      db.all<{ id: string; category: string | null; payee: string | null }>(
        `
      SELECT t.id, COALESCE(cm.transferId, t.category) AS category,
        COALESCE(pm.targetId, t.description) AS payee
      FROM transactions t
      LEFT JOIN category_mapping cm ON cm.id = t.category
      LEFT JOIN payee_mapping pm ON pm.id = t.description
      WHERE t.date <= ? AND t.tombstone = 0`,
        [Number(asOf.replaceAll('-', ''))],
      ),
    ]);
  const referencesById = new Map(references.map(row => [row.id, row]));
  return summarizeCashPlanning(
    request,
    asOf,
    accounts.data,
    transactions.data.map((row: PlanningTransaction) => ({
      ...row,
      ...referencesById.get(row.id),
    })),
    categories.data,
    payees.data,
  );
}

export type CashPlanningHandlers = {
  'cash-planning/get-summary': (
    request: CashPlanningRequest,
  ) => Promise<CashPlanningSummary>;
};
export const app = createApp<CashPlanningHandlers>();
app.method('cash-planning/get-summary', getCashPlanningSummary);
