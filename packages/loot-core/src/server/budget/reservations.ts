// A reservation is the part of a category balance that is owed to a known
// future cost. We calculate it on read and never store it, from each claim's
// next due date, so a payment or a skip (which advance the stored next date)
// starts the claim collecting again from zero.
//
// The accrual and settlement math is adapted from
// https://github.com/hubermjonathan/actual/blob/5e939d427cb8ca347b3e526b4a230537e5e84668/packages/loot-core/src/server/budget/reservations.ts
// (`accruedToDate`, `settleReservations`, `getByReservationClaims`).

import { logger } from '#platform/server/log';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { getCurrency } from '#shared/currencies';
import * as monthUtils from '#shared/months';
import { q } from '#shared/query';
import { amountToInteger } from '#shared/util';
import type { CategoryEntity } from '#types/models';
import type {
  ReadyReservationRow,
  ReservationClaim,
  ReservationRow,
  ReservationsRequest,
  ReservationsResult,
  ReservationUnavailableReason,
} from '#types/models/reservations';
import type {
  ByTemplate,
  ScheduleTemplate,
  Template,
} from '#types/models/templates';

import { getSheetValue, isTrackingBudget } from './actions';
import { getScheduleClaims } from './schedule-template';
import { parseTemplateNote } from './template-parser';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const REASON_ORDER: ReservationUnavailableReason[] = [
  'invalid-template',
  'missing-schedule',
  'ambiguous-schedule',
  'inactive-schedule',
  'duplicate-schedule',
  'unsupported-template',
];

const KNOWN_TEMPLATE_TYPES = new Set<string>([
  'percentage',
  'periodic',
  'by',
  'spend',
  'simple',
  'schedule',
  'remainder',
  'average',
  'goal',
  'copy',
  'refill',
  'limit',
]);

export type ExactClaim = Omit<ReservationClaim, 'accrued'> & {
  monthlyRate: number;
  monthsRemaining: number;
};

export async function getReservations({
  month,
}: ReservationsRequest): Promise<ReservationsResult> {
  if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
    throw APIError(`Invalid month: ${String(month)}`);
  }
  if (month !== monthUtils.currentMonth()) {
    throw APIError('Reservations are only available for the current month');
  }
  if (isTrackingBudget()) {
    throw APIError('Reservations are only available for envelope budgets');
  }

  const { data: currencyPref }: { data: Array<{ value: string }> } =
    await aqlQuery(
      q('preferences').filter({ id: 'defaultCurrencyCode' }).select('*'),
    );
  const currency = getCurrency(currencyPref[0]?.value ?? '');

  const categories = await db.all<CategoryRecord>(
    `SELECT c.id, c.name, c.cat_group, c.goal_def, c.template_settings, n.note
     FROM categories c
     LEFT JOIN notes n ON n.id = c.id
     WHERE c.tombstone = 0 AND c.is_income = 0
     ORDER BY c.sort_order, c.id`,
  );

  const sheetName = monthUtils.sheetForMonth(month);
  const rows: ReservationRow[] = [];
  for (const category of categories) {
    try {
      rows.push(await getCategoryRow(category, month, sheetName, currency));
    } catch (e) {
      logger.error('Failed to calculate reservations for category', e);
      rows.push({
        categoryId: category.id,
        state: 'unavailable',
        reason: 'invalid-template',
      });
    }
  }

  return { month, categories: rows };
}

/**
 * The part of `target` that should already be held: everything except what
 * the remaining months still collect. Kept exact; totals round once.
 */
export function accruedToDate({
  target,
  monthlyRate,
  monthsRemaining,
}: Pick<ExactClaim, 'target' | 'monthlyRate' | 'monthsRemaining'>): number {
  return Math.min(target, Math.max(0, target - monthlyRate * monthsRemaining));
}

/**
 * Claims hold their full accrual whatever the balance; the allowance takes
 * what is left, and any deficit shows once, as negative spare.
 */
export function settleReservations(
  balance: number,
  claims: ExactClaim[],
  allowanceTotal: number,
): Omit<ReadyReservationRow, 'categoryId' | 'state'> {
  const ordered = [...claims].sort(
    (a, b) =>
      a.nextDate.localeCompare(b.nextDate) || a.label.localeCompare(b.label),
  );
  const exact = ordered.map(claim => ({
    claim,
    accrued: accruedToDate(claim),
  }));

  const reserved = Math.round(exact.reduce((sum, c) => sum + c.accrued, 0));
  const allowance = Math.min(
    Math.max(0, balance - reserved),
    Math.max(0, allowanceTotal),
  );
  const spare = balance - reserved - allowance;

  return {
    balance,
    reserved,
    allowance,
    allowanceTotal,
    spare,
    shortfall: Math.max(0, -spare),
    claims: exact.map(({ claim, accrued }) => ({
      key: claim.key,
      kind: claim.kind,
      label: claim.label,
      nextDate: claim.nextDate,
      target: claim.target,
      accrued: Math.round(accrued),
    })),
  };
}

/**
 * A repeating By template as a claim, or `null` when it has no cycle to
 * accrue against. The target month rolls forward like `runBy`'s.
 */
export function getByClaim(
  template: ByTemplate,
  month: string,
  decimalPlaces: number,
  key: string,
  fallbackLabel: string,
): ExactClaim | null {
  if (
    template.from != null ||
    typeof template.amount !== 'number' ||
    !Number.isFinite(template.amount) ||
    template.amount <= 0 ||
    !MONTH_PATTERN.test(String(template.month))
  ) {
    return null;
  }
  const period = template.annual
    ? (template.repeat || 1) * 12
    : template.repeat;
  if (
    typeof period !== 'number' ||
    !Number.isSafeInteger(period) ||
    period <= 0
  ) {
    return null;
  }

  let targetMonth = String(template.month);
  while (targetMonth < month) {
    if (
      period > monthUtils.differenceInCalendarMonths('9999-12', targetMonth)
    ) {
      return null;
    }
    const nextMonth = monthUtils.addMonths(targetMonth, period);
    if (!MONTH_PATTERN.test(nextMonth) || nextMonth <= targetMonth) {
      return null;
    }
    targetMonth = nextMonth;
  }
  const target = amountToInteger(template.amount, decimalPlaces);

  return {
    key,
    kind: 'by',
    label: template.description || fallbackLabel,
    nextDate: `${targetMonth}-01`,
    target,
    monthlyRate: target / period,
    monthsRemaining: monthUtils.differenceInCalendarMonths(targetMonth, month),
  };
}

/** The monthly amount of a supported simple template, or `null`. */
export function getAllowanceAmount(
  template: Extract<Template, { type: 'simple' }>,
  decimalPlaces: number,
): number | null {
  if (
    template.limit != null ||
    typeof template.monthly !== 'number' ||
    !Number.isFinite(template.monthly) ||
    template.monthly < 0
  ) {
    return null;
  }
  return amountToInteger(template.monthly, decimalPlaces);
}

type TemplatesRead = { ok: true; templates: Template[] } | { ok: false };

type CategoryRecord = Pick<db.DbCategory, 'id' | 'name' | 'cat_group'> & {
  goal_def: string | null;
  template_settings: string | null;
  note: string | null;
};

function readTemplates(category: CategoryRecord): TemplatesRead {
  if (getTemplateSource(category.template_settings) !== 'ui') {
    return { ok: true, templates: parseTemplateNote(category.note ?? '') };
  }
  if (category.goal_def == null) {
    return { ok: true, templates: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(category.goal_def);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(parsed) || !parsed.every(isValidStoredTemplate)) {
    return { ok: false };
  }
  return { ok: true, templates: parsed };
}

function getTemplateSource(settings: string | null): 'ui' | 'notes' {
  if (!settings) {
    return 'notes';
  }
  try {
    const parsed: unknown = JSON.parse(settings);
    return typeof parsed === 'object' &&
      parsed !== null &&
      'source' in parsed &&
      parsed.source === 'ui'
      ? 'ui'
      : 'notes';
  } catch {
    return 'notes';
  }
}

function isValidStoredTemplate(value: unknown): value is Template {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const template = value as Record<string, unknown>;
  if (
    typeof template.type !== 'string' ||
    !KNOWN_TEMPLATE_TYPES.has(template.type)
  ) {
    return false;
  }
  switch (template.type) {
    case 'simple':
      return (
        (template.monthly == null || typeof template.monthly === 'number') &&
        (template.limit == null || typeof template.limit === 'object')
      );
    case 'schedule':
      return (
        typeof template.scheduleId === 'string' ||
        typeof template.name === 'string'
      );
    case 'by':
      return (
        typeof template.amount === 'number' &&
        typeof template.month === 'string' &&
        MONTH_PATTERN.test(template.month) &&
        (template.annual == null || typeof template.annual === 'boolean') &&
        (template.repeat == null || typeof template.repeat === 'number')
      );
    default:
      return true;
  }
}

async function getCategoryRow(
  category: CategoryRecord,
  month: string,
  sheetName: string,
  currency: ReturnType<typeof getCurrency>,
): Promise<ReservationRow> {
  const unavailable = (
    reason: ReservationUnavailableReason,
  ): ReservationRow => ({
    categoryId: category.id,
    state: 'unavailable',
    reason,
  });

  const read = readTemplates(category);
  if (!read.ok || read.templates.some(t => t.type === 'error')) {
    return unavailable('invalid-template');
  }

  const reasons = new Set<ReservationUnavailableReason>();
  const claims: ExactClaim[] = [];
  const scheduleTemplates: ScheduleTemplate[] = [];
  let allowanceTotal = 0;

  read.templates.forEach((template, index) => {
    switch (template.type) {
      case 'simple': {
        const amount = getAllowanceAmount(template, currency.decimalPlaces);
        if (amount === null) {
          reasons.add('unsupported-template');
        } else {
          allowanceTotal += amount;
        }
        break;
      }
      case 'schedule':
        scheduleTemplates.push(template);
        break;
      case 'by': {
        const claim = getByClaim(
          template,
          month,
          currency.decimalPlaces,
          `${category.id}:${index}`,
          category.name,
        );
        if (claim === null) {
          reasons.add('unsupported-template');
        } else {
          claims.push(claim);
        }
        break;
      }
      default:
        reasons.add('unsupported-template');
    }
  });

  const scheduleResult = await getScheduleClaims(
    scheduleTemplates,
    month,
    {
      id: category.id,
      name: category.name,
      is_income: false,
      group: category.cat_group,
    } satisfies CategoryEntity,
    currency,
  );
  if (scheduleResult.ok === false) {
    reasons.add(scheduleResult.reason);
  } else {
    for (const claim of scheduleResult.claims) {
      claims.push({
        key: claim.scheduleId,
        kind: 'schedule',
        label:
          claim.template.description || claim.scheduleName || category.name,
        nextDate: claim.nextDate,
        target: claim.target,
        monthlyRate: claim.monthlyRate,
        monthsRemaining: claim.monthsRemaining,
      });
    }
  }

  const reason = REASON_ORDER.find(r => reasons.has(r));
  if (reason) {
    return unavailable(reason);
  }

  const balance = await getSheetValue(sheetName, `leftover-${category.id}`);
  return {
    categoryId: category.id,
    state: 'ready',
    ...settleReservations(balance, claims, allowanceTotal),
  };
}
