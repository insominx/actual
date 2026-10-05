// Read-only cash plan inspection with transient scenarios, and the guarded
// writer for the synced cashPlanning preference. Calculations stay in the
// shared projection functions the report uses; scenarios are never stored.
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import { saveSyncedPrefs } from '#server/preferences/app';
import { storedPreference } from '#server/preferences/catalog';
import {
  cashPlanningChart,
  isPlanningDate,
  parseCashPlanningConfig,
  projectCashPlanning,
} from '#shared/cash-planning';
import * as months from '#shared/months';
import type {
  CashPlanSaveProposal,
  CashPlanSaveRequest,
} from '#types/change-proposals';
import type {
  CashPlanInspection,
  CashPlanInspectRequest,
  CashPlanningConfig,
} from '#types/models/cash-planning';

import { getCashPlanningSummary } from './app';

const KEY = 'cashPlanning';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTargets(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([id, amount]) =>
        id.length > 0 &&
        typeof amount === 'number' &&
        Number.isFinite(amount) &&
        amount >= 0,
    )
  );
}

function validGoal(value: unknown) {
  return (
    isRecord(value) &&
    Object.keys(value).every(key => ['balance', 'deadline'].includes(key)) &&
    Number.isSafeInteger(value.balance) &&
    (value.deadline === undefined ||
      (typeof value.deadline === 'string' && isPlanningDate(value.deadline)))
  );
}

// Normalizes a full config the same way the report reads it back, and rejects
// anything the report would silently drop or replace.
export function strictCashPlanningConfig(
  value: unknown,
  asOf: string,
): CashPlanningConfig {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      key =>
        ![
          'startDate',
          'endDate',
          'categoryTargets',
          'goal',
          'forecastEndDate',
        ].includes(key),
    ) ||
    typeof value.startDate !== 'string' ||
    typeof value.endDate !== 'string' ||
    !isPlanningDate(value.startDate) ||
    !isPlanningDate(value.endDate) ||
    value.startDate > value.endDate ||
    value.endDate > asOf ||
    !validTargets(value.categoryTargets ?? {}) ||
    (value.goal !== undefined && !validGoal(value.goal)) ||
    (value.forecastEndDate !== undefined &&
      (typeof value.forecastEndDate !== 'string' ||
        !isPlanningDate(value.forecastEndDate) ||
        value.forecastEndDate <= asOf))
  ) {
    throw APIError(
      `Invalid cash plan: history must end by ${asOf}, targets must be non-negative amounts, the goal an integer balance with an optional deadline, and the forecast end after ${asOf}`,
    );
  }
  const config: CashPlanningConfig = {
    startDate: value.startDate,
    endDate: value.endDate,
    categoryTargets: { ...(value.categoryTargets as Record<string, number>) },
    ...(value.goal ? { goal: value.goal as CashPlanningConfig['goal'] } : {}),
    ...(value.forecastEndDate
      ? { forecastEndDate: value.forecastEndDate as string }
      : {}),
  };
  return config;
}

export async function inspectCashPlan(
  request: CashPlanInspectRequest = {},
): Promise<CashPlanInspection> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(
      key => !['startDate', 'endDate', 'scenario'].includes(key),
    )
  ) {
    throw APIError(
      'Invalid cash plan inspection: provide optional startDate, endDate and scenario',
    );
  }
  const asOf = months.currentDay();
  const stored = await storedPreference(KEY);
  const saved = parseCashPlanningConfig(stored?.value ?? undefined, asOf);
  const scenario = request.scenario;
  if (
    scenario !== undefined &&
    (!isRecord(scenario) ||
      Object.keys(scenario).some(
        key => !['categoryTargets', 'goal', 'forecastEndDate'].includes(key),
      ))
  ) {
    throw APIError(
      'Invalid scenario: provide categoryTargets, goal (or null) and forecastEndDate (or null)',
    );
  }
  const merged: Record<string, unknown> = {
    ...saved,
    ...(request.startDate !== undefined
      ? { startDate: request.startDate }
      : {}),
    ...(request.endDate !== undefined ? { endDate: request.endDate } : {}),
  };
  if (scenario?.categoryTargets !== undefined) {
    if (!validTargets(scenario.categoryTargets)) {
      throw APIError('Invalid scenario targets: use non-negative amounts');
    }
    merged.categoryTargets = {
      ...saved.categoryTargets,
      ...scenario.categoryTargets,
    };
  }
  if (scenario?.goal !== undefined) merged.goal = scenario.goal ?? undefined;
  if (scenario?.forecastEndDate !== undefined) {
    merged.forecastEndDate = scenario.forecastEndDate ?? undefined;
  }
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  const config = strictCashPlanningConfig(merged, asOf);
  const summary = await getCashPlanningSummary({
    startDate: config.startDate,
    endDate: config.endDate,
  });
  const hasHistory = summary.transactionCount > 0;
  return {
    asOf,
    saved: { stored: (stored?.value ?? null) !== null, config: saved },
    config,
    scenarioApplied:
      scenario !== undefined ||
      request.startDate !== undefined ||
      request.endDate !== undefined,
    summary,
    projections: hasHistory
      ? {
          historical: projectCashPlanning(summary, config, false),
          targets: projectCashPlanning(summary, config, true),
        }
      : null,
    chart: hasHistory ? cashPlanningChart(summary, config) : [],
    warnings: hasHistory
      ? []
      : ['No history in the selected range; projections are unavailable'],
  };
}

export async function prepareCashPlanSave(
  request: CashPlanSaveRequest,
): Promise<CashPlanSaveProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => key !== 'config') ||
    !('config' in request)
  ) {
    throw APIError('Invalid cash plan save: provide config, or null to reset');
  }
  const asOf = months.currentDay();
  const value =
    request.config === null
      ? null
      : JSON.stringify(strictCashPlanningConfig(request.config, asOf));
  const stored = await storedPreference(KEY);
  return {
    schemaVersion: 1,
    operation: 'cash-planning.save',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      preference: stored ? { ...stored } : null,
    },
    after: { preference: { id: KEY, value } },
    references: {},
    sideEffects: [
      value === null
        ? 'clear the saved cash plan so the report falls back to the last three complete months with no targets or goal'
        : 'store the cash plan in the synced cashPlanning preference; transactions, allocations, templates and schedules are unchanged',
    ],
  };
}

export async function performCashPlanSave(current: CashPlanSaveProposal) {
  const value = current.after.preference.value;
  if ((current.before.preference?.value ?? null) === null && value === null) {
    // Resetting a plan that is not stored is a no-op.
    return { changed: false, affectedIds: [KEY] };
  }
  await saveSyncedPrefs({ id: KEY, value: value as string | undefined });
  const actual = await storedPreference(KEY);
  if (!rowMatches(actual, current.after.preference)) {
    throw new Error('Cash plan acknowledgement is incomplete');
  }
  return {
    changed: (current.before.preference?.value ?? null) !== value,
    affectedIds: [KEY],
  };
}
