import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import * as sheet from '#server/sheet';
// Guarded switch between envelope and tracking budgeting. The settings page
// flips the synced budgetType preference and resets the budget cache; this
// adapter does the same through preview/apply so the switch is reviewable and
// leaves a receipt. Each type keeps its own budgeted amounts (zero_budgets for
// envelope, reflect_budgets for tracking), so switching shows the other set.
import type {
  BudgetTypeName,
  BudgetTypeProposal,
  BudgetTypeRequest,
} from '#types/change-proposals';

import { getBudgetType, setType } from './base';

const BUDGET_TYPES: readonly BudgetTypeName[] = ['envelope', 'tracking'];

async function storedBudgetType(): Promise<BudgetTypeName> {
  const row = await db.first<Pick<db.DbPreference, 'value'>>(
    'SELECT value FROM preferences WHERE id = ?',
    ['budgetType'],
  );
  return row?.value === 'tracking' ? 'tracking' : 'envelope';
}

async function budgetedMonths(table: 'zero_budgets' | 'reflect_budgets') {
  const row = await db.first<{ months: number }>(
    `SELECT COUNT(DISTINCT month) AS months FROM ${table} WHERE amount != 0`,
  );
  return row?.months ?? 0;
}

export async function prepareBudgetType(
  request: BudgetTypeRequest,
): Promise<BudgetTypeProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Array.isArray(request) ||
    Object.keys(request).some(key => key !== 'type') ||
    !BUDGET_TYPES.includes(request.type)
  ) {
    throw APIError(
      'Invalid budget type request: provide type envelope or tracking',
    );
  }
  const current = await storedBudgetType();
  const willWrite = current !== request.type;
  return {
    schemaVersion: 1,
    operation: 'budgets.set-type',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), type: current },
    after: { type: request.type, willWrite },
    references: {
      table: request.type === 'tracking' ? 'reflect_budgets' : 'zero_budgets',
      budgetedMonths: {
        envelope: await budgetedMonths('zero_budgets'),
        tracking: await budgetedMonths('reflect_budgets'),
      },
    },
    sideEffects: willWrite
      ? [
          'store the synced budgetType preference; it syncs to every device',
          'rebuild every budget month for the new type',
          request.type === 'tracking'
            ? 'show tracking budget amounts (reflect_budgets); envelope amounts stay stored for switching back'
            : 'show envelope budget amounts (zero_budgets); tracking amounts stay stored for switching back',
        ]
      : [],
  };
}

export async function performBudgetType(current: BudgetTypeProposal) {
  if (!current.after.willWrite) {
    return { changed: false, affectedIds: ['budgetType'] };
  }
  const meta = sheet.get().meta();
  const previous = getBudgetType();
  // Store the preference first: the rebuild reads it to pick the budget table.
  // Marking the in-memory type beforehand makes the sync layer's own switch,
  // which the preference write triggers without waiting, a no-op, so the one
  // rebuild below runs here and is awaited.
  meta.budgetType = current.request.type;
  try {
    // The same synced write the preferences owner makes (a CRDT message).
    await db.update('preferences', {
      id: 'budgetType',
      value: current.request.type,
    });
  } catch (error) {
    meta.budgetType = previous;
    throw error;
  }
  await setType(current.request.type, { force: true });
  if (
    (await storedBudgetType()) !== current.request.type ||
    getBudgetType() !== current.request.type
  ) {
    throw new Error('Budget type acknowledgement is incomplete');
  }
  return { changed: true, affectedIds: ['budgetType'] };
}
