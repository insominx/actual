// Guarded allocation moves and template application, plus read-only
// template and reservation inspection for agents. Every amount comes from
// the budget engine (sheet cells, the template engine and the reservation
// calculator); nothing here computes budget math of its own beyond adding
// the requested amount to the cells it moves.
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import * as sheet from '#server/sheet';
import { canonicalJson } from '#shared/canonical-json';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import type {
  BudgetMoveCell,
  BudgetMoveProposal,
  BudgetMoveRequest,
  BudgetTemplateRow,
  BudgetTemplatesProposal,
  BudgetTemplatesRequest,
} from '#types/change-proposals';
import type { CategoryEntity } from '#types/models';
import type { ReservationsResult } from '#types/models/reservations';
import type { Template } from '#types/models/templates';

import {
  getSheetValue,
  isTrackingBudget,
  transferAvailable,
  transferCategory,
} from './actions';
import {
  applyMultipleCategoryTemplates,
  applyTemplate,
  computeTemplates,
  overwriteTemplate,
} from './goal-template';
import { getReservations } from './reservations';
import { getCategoriesWithTemplateNotes } from './statements';
import {
  checkTemplateNotes,
  getCategoriesWithTemplates,
} from './template-notes';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function invalid(noun: string, message: string): never {
  throw APIError(`Invalid ${noun} request: ${message}`);
}

async function currencyCode() {
  const row = await db.first<{ value: string }>(
    "SELECT value FROM preferences WHERE id = 'defaultCurrencyCode'",
  );
  return row?.value ?? '';
}

async function budgetCategory(id: string) {
  const category = await db.first<{
    id: string;
    name: string;
    is_income: number;
  }>(
    'SELECT id, name, is_income FROM categories WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!category) throw APIError(`Category does not exist: ${id}`);
  if (category.is_income && !isTrackingBudget()) {
    throw APIError(
      `Income category ${category.name} cannot hold allocations in an envelope budget`,
    );
  }
  return category;
}

async function cell(
  sheetName: string,
  id: string,
  toBudget: number | null,
): Promise<BudgetMoveCell> {
  if (id === 'to-budget') {
    return { id, name: null, budgeted: null, balance: toBudget ?? 0 };
  }
  const category = await budgetCategory(id);
  return {
    id,
    name: category.name,
    budgeted: await getSheetValue(sheetName, `budget-${id}`),
    balance: await getSheetValue(sheetName, `leftover-${id}`),
  };
}

function shift(source: BudgetMoveCell, delta: number): BudgetMoveCell {
  return {
    ...source,
    budgeted: source.budgeted === null ? null : source.budgeted + delta,
    balance: source.balance + delta,
  };
}

export async function prepareBudgetMove(
  request: BudgetMoveRequest,
): Promise<BudgetMoveProposal> {
  const noun = 'allocation move';
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['month', 'from', 'to', 'amount', 'allowOverspend'].includes(key),
    )
  ) {
    invalid(
      noun,
      'provide month, from, to, amount and optional allowOverspend',
    );
  }
  if (typeof request.month !== 'string' || !MONTH.test(request.month)) {
    invalid(noun, 'month must be YYYY-MM');
  }
  if (typeof request.from !== 'string' || typeof request.to !== 'string') {
    invalid(noun, 'from and to must be category IDs or to-budget');
  }
  if (request.from === request.to) invalid(noun, 'from and to must differ');
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
    invalid(noun, 'amount must be a positive integer in cents');
  }
  if (
    request.allowOverspend !== undefined &&
    typeof request.allowOverspend !== 'boolean'
  ) {
    invalid(noun, 'allowOverspend must be a boolean');
  }
  const tracking = isTrackingBudget();
  if (
    tracking &&
    (request.from === 'to-budget' || request.to === 'to-budget')
  ) {
    throw APIError('Tracking budgets have no To Budget amount to move');
  }
  const sheetName = monthUtils.sheetForMonth(request.month);
  const toBudget = tracking
    ? null
    : await getSheetValue(sheetName, 'to-budget');
  const from = await cell(sheetName, request.from, toBudget);
  const to = await cell(sheetName, request.to, toBudget);
  if (request.from === 'to-budget' && request.amount > (toBudget ?? 0)) {
    throw APIError(
      `Insufficient funds: To Budget is ${toBudget} and the move is ${request.amount}`,
    );
  }
  if (
    request.from !== 'to-budget' &&
    from.balance - request.amount < 0 &&
    !request.allowOverspend
  ) {
    throw APIError(
      `Insufficient funds: ${from.name} has a balance of ${from.balance}; moving ${request.amount} would overspend it (pass allowOverspend to allow)`,
    );
  }
  const totalBudgetedChange =
    request.from === 'to-budget'
      ? request.amount
      : request.to === 'to-budget'
        ? -request.amount
        : 0;
  const after = {
    from:
      request.from === 'to-budget'
        ? { ...from, balance: from.balance - request.amount }
        : shift(from, -request.amount),
    to:
      request.to === 'to-budget'
        ? { ...to, balance: to.balance + request.amount }
        : shift(to, request.amount),
    toBudget: toBudget === null ? null : toBudget - totalBudgetedChange,
    totalBudgetedChange,
  };
  return JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      operation: 'budgets.move',
      budget: guardedBudgetIdentity(),
      request,
      before: { sourceHash: await guardedSourceHash(), from, to, toBudget },
      after,
      references: {},
      sideEffects: [
        request.from === 'to-budget'
          ? "allocate from To Budget as the app's budget menu does"
          : "move the allocation as the app's Transfer to category does, including its movement line in the month's budget notes",
        'engine budget recalculation; transactions and cash-planning targets are unchanged',
      ],
    }),
  );
}

export async function performBudgetMove(current: BudgetMoveProposal) {
  const { month, from, to, amount } = current.request;
  if (from === 'to-budget') {
    await transferAvailable({ month, amount, category: to });
  } else {
    await transferCategory({
      month,
      amount,
      from,
      to,
      currencyCode: await currencyCode(),
    });
  }
  await sheet.waitOnSpreadsheet();
  const sheetName = monthUtils.sheetForMonth(month);
  for (const side of [current.after.from, current.after.to]) {
    if (side.id === 'to-budget') continue;
    const budgeted = await getSheetValue(sheetName, `budget-${side.id}`);
    if (budgeted !== side.budgeted) {
      throw new Error('Allocation move acknowledgement does not match');
    }
  }
  return {
    changed: true,
    affectedIds: [from, to].filter(id => id !== 'to-budget'),
    budgetMove: { month, amount },
  };
}

type TemplateSettings = { source?: string } | null;

// The templates the app would use after its own `storeNoteTemplates`
// refresh, computed without writing: UI-managed categories keep their stored
// definition, note-managed categories use their parsed notes, and
// note-managed categories with no template lines lose theirs.
export async function effectiveTemplates(): Promise<
  Record<string, { name: string; source: string; templates: Template[] }>
> {
  const stored = await db.all<{
    id: string;
    name: string;
    goal_def: string | null;
    template_settings: string | null;
  }>(
    'SELECT id, name, goal_def, template_settings FROM categories WHERE tombstone = 0',
  );
  const fromNotes = new Map(
    (await getCategoriesWithTemplates()).map(row => [row.id, row.templates]),
  );
  const noted = new Set(
    (await getCategoriesWithTemplateNotes()).map(row => row.id),
  );
  const result: Record<
    string,
    { name: string; source: string; templates: Template[] }
  > = {};
  for (const row of stored) {
    let settings: TemplateSettings = null;
    try {
      settings = row.template_settings
        ? (JSON.parse(row.template_settings) as TemplateSettings)
        : null;
    } catch {
      settings = null;
    }
    const source = settings?.source ?? 'notes';
    let templates: Template[] | null = null;
    if (source === 'ui') {
      templates = row.goal_def
        ? (JSON.parse(row.goal_def) as Template[])
        : null;
    } else if (fromNotes.has(row.id)) {
      templates = JSON.parse(JSON.stringify(fromNotes.get(row.id)));
    } else if (noted.has(row.id) && row.goal_def) {
      templates = JSON.parse(row.goal_def) as Template[];
    }
    if (templates && templates.length > 0) {
      result[row.id] = { name: row.name, source, templates };
    }
  }
  return result;
}

export type TemplateInspection = {
  valid: boolean;
  errors: string[];
  categories: Array<{
    id: string;
    name: string;
    source: string;
    templates: Template[];
  }>;
};

export async function inspectTemplates(): Promise<TemplateInspection> {
  const templates = await effectiveTemplates();
  const check = await checkTemplateNotes();
  return {
    valid: check.message !== 'template-errors',
    errors:
      check.message === 'template-errors' && check.pre
        ? check.pre.split('\n\n')
        : [],
    categories: Object.entries(templates).map(([id, value]) => ({
      id,
      name: value.name,
      source: value.source,
      templates: value.templates,
    })),
  };
}

export async function prepareTemplateApplication(
  request: BudgetTemplatesRequest,
): Promise<BudgetTemplatesProposal> {
  const noun = 'template application';
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['month', 'categoryIds', 'force'].includes(key),
    )
  ) {
    invalid(noun, 'provide month and optional categoryIds or force');
  }
  if (typeof request.month !== 'string' || !MONTH.test(request.month)) {
    invalid(noun, 'month must be YYYY-MM');
  }
  if (
    request.categoryIds !== undefined &&
    (!Array.isArray(request.categoryIds) ||
      request.categoryIds.length === 0 ||
      !request.categoryIds.every(id => typeof id === 'string') ||
      new Set(request.categoryIds).size !== request.categoryIds.length)
  ) {
    invalid(noun, 'categoryIds must be a non-empty list of unique IDs');
  }
  if (request.force !== undefined && typeof request.force !== 'boolean') {
    invalid(noun, 'force must be a boolean');
  }
  if (request.categoryIds && request.force !== undefined) {
    invalid(
      noun,
      'categoryIds always overwrites the listed categories; omit force',
    );
  }
  const all = await effectiveTemplates();
  let categories: CategoryEntity[] = [];
  let scoped: Record<string, Template[]> = Object.fromEntries(
    Object.entries(all).map(([id, value]) => [id, value.templates]),
  );
  if (request.categoryIds) {
    for (const id of request.categoryIds) {
      await budgetCategory(id);
      if (!all[id]) throw APIError(`Category ${id} has no templates`);
    }
    scoped = Object.fromEntries(
      request.categoryIds.map(id => [id, all[id].templates]),
    );
    const { data } = await aqlQuery(
      q('categories')
        .filter({ id: { $oneof: request.categoryIds } })
        .select('*'),
    );
    categories = data as CategoryEntity[];
  }
  const force = request.categoryIds ? true : Boolean(request.force);
  const { contexts, errors, orphanGoals } = await computeTemplates(
    request.month,
    force,
    scoped,
    categories,
  );
  if (errors.length > 0) {
    throw APIError(`Template errors: ${errors.join('; ')}`);
  }
  const sheetName = monthUtils.sheetForMonth(request.month);
  const rows: BudgetTemplateRow[] = [];
  for (const context of contexts) {
    const values = context.getValues();
    const goal = sheet.getCell(sheetName, `goal-${context.category.id}`).value;
    rows.push({
      categoryId: context.category.id,
      name: context.category.name,
      before: {
        budgeted: await getSheetValue(
          sheetName,
          `budget-${context.category.id}`,
        ),
        goal: typeof goal === 'number' ? goal : null,
      },
      after: {
        budgeted: values.budgeted,
        goal: values.goal ?? null,
        longGoal: Boolean(values.longGoal),
      },
    });
  }
  const tracking = isTrackingBudget();
  const toBudget = tracking
    ? null
    : (await getSheetValue(sheetName, 'to-budget')) -
      rows.reduce(
        (sum, row) => sum + row.after.budgeted - row.before.budgeted,
        0,
      );
  return JSON.parse(
    canonicalJson({
      schemaVersion: 1,
      operation: 'budgets.apply-templates',
      budget: guardedBudgetIdentity(),
      request,
      before: { sourceHash: await guardedSourceHash() },
      after: {
        rows,
        clearedGoals: orphanGoals.map(goal => goal.category),
        toBudget,
      },
      references: {},
      sideEffects: [
        "run the app's template refresh first: note-managed categories store their parsed notes as template definitions",
        request.categoryIds
          ? "apply the listed categories' templates, overwriting their allocations, as the category menu's apply does"
          : force
            ? 'overwrite every templated allocation in the month, as the month menu does'
            : 'fill allocations of templated categories that are still zero, as the month menu does',
        'set the template goal indicators; transactions and cash-planning targets are unchanged',
      ],
    }),
  );
}

export async function performTemplateApplication(
  current: BudgetTemplatesProposal,
) {
  const { month, categoryIds, force } = current.request;
  if (categoryIds) {
    await applyMultipleCategoryTemplates({ month, categoryIds });
  } else if (force) {
    await overwriteTemplate({ month });
  } else {
    await applyTemplate({ month });
  }
  await sheet.waitOnSpreadsheet();
  const sheetName = monthUtils.sheetForMonth(month);
  for (const row of current.after.rows) {
    const budgeted = await getSheetValue(sheetName, `budget-${row.categoryId}`);
    if (budgeted !== row.after.budgeted) {
      throw new Error('Template application acknowledgement does not match');
    }
  }
  const ids = current.after.rows.map(row => row.categoryId);
  return {
    changed: ids.length > 0 || current.after.clearedGoals.length > 0,
    affectedIds: ids,
    templateApplication: { categoryIds: ids },
  };
}

export async function budgetReservations({
  month,
}: { month?: string } = {}): Promise<ReservationsResult> {
  const flag = await db.first<{ value: string }>(
    "SELECT value FROM preferences WHERE id = 'flags.budgetReservations'",
  );
  if (flag?.value !== 'true') {
    throw APIError(
      'Reservations are an experimental feature; enable flags.budgetReservations first',
    );
  }
  return getReservations({ month: month ?? monthUtils.currentMonth() });
}
