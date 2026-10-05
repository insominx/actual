// Typed catalog of synced preferences for agent tools. It routes each key to
// its authority: allowlisted display and behavior preferences are settable
// with validated values, while domain-owned keys (budget type, cash planning,
// import mappings, bank sync options) point at their own tools and per-entity
// UI state stays read-only. Device-local preferences never sync and are not
// exposed here; metadata such as the budget name belongs to budget lifecycle.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import { currencies } from '#shared/currencies';
import { UPCOMING_LENGTH_PRESET_VALUES } from '#shared/schedules';
import { numberFormats } from '#shared/util';
import type {
  PreferenceSetProposal,
  PreferenceSetRequest,
} from '#types/change-proposals';
import type { FeatureFlag } from '#types/prefs';

import { saveSyncedPrefs } from './app';

export type PreferenceAuthority =
  | 'setting'
  | 'feature-flag'
  | 'budget-type'
  | 'cash-planning'
  | 'import-mapping'
  | 'bank-sync'
  | 'ui-state';

export type PreferenceDescription = {
  key: string;
  scope: 'synced';
  authority: PreferenceAuthority;
  settable: boolean;
  description: string;
  allowedValues?: string[];
  pattern?: string;
  appDefault?: string;
  owner?: string;
};

const BOOLEAN = ['true', 'false'];
// Keyed by FeatureFlag so adding a flag to the type fails here until listed.
const FEATURE_FLAG_KEYS: Record<FeatureFlag, true> = {
  newSidebarUI: true,
  goalTemplatesEnabled: true,
  goalTemplatesUIEnabled: true,
  actionTemplating: true,
  formulaMode: true,
  currency: true,
  balanceForecastReport: true,
  customThemes: true,
  budgetAnalysisReport: true,
  enableBanking: true,
  sankeyReport: true,
  akahuBankSync: true,
  mobileCalculator: true,
  monteCarloReport: true,
  budgetReservations: true,
};
const FEATURE_FLAGS = Object.keys(FEATURE_FLAG_KEYS) as FeatureFlag[];
const CUSTOM_UPCOMING = /^[1-9]\d{0,2}-(day|week|month|year)$/;

type Setting = Omit<PreferenceDescription, 'key' | 'scope' | 'settable'> & {
  validate?: (value: string) => boolean;
};

const SETTINGS: Record<string, Setting> = {
  dateFormat: {
    authority: 'setting',
    description: 'Date display format',
    allowedValues: [
      'MM/dd/yyyy',
      'dd/MM/yyyy',
      'yyyy-MM-dd',
      'MM.dd.yyyy',
      'dd.MM.yyyy',
      'dd-MM-yyyy',
    ],
    appDefault: 'MM/dd/yyyy',
  },
  numberFormat: {
    authority: 'setting',
    description: 'Number display format',
    allowedValues: numberFormats.map(format => format.value),
    appDefault: 'comma-dot',
  },
  hideFraction: {
    authority: 'setting',
    description: 'Hide decimal places in displayed amounts',
    allowedValues: BOOLEAN,
    appDefault: 'false',
  },
  isPrivacyEnabled: {
    authority: 'setting',
    description: 'Blur amounts in the app (privacy mode)',
    allowedValues: BOOLEAN,
    appDefault: 'false',
  },
  defaultCurrencyCode: {
    authority: 'setting',
    description:
      'Display currency code; stored amounts are not converted. Empty means none',
    allowedValues: currencies.map(currency => currency.code),
    appDefault: '',
  },
  currencySymbolPosition: {
    authority: 'setting',
    description: 'Currency symbol placement',
    allowedValues: ['before', 'after'],
  },
  currencySpaceBetweenAmountAndSymbol: {
    authority: 'setting',
    description: 'Space between the amount and the currency symbol',
    allowedValues: BOOLEAN,
  },
  firstDayOfWeekIdx: {
    authority: 'setting',
    description: 'First day of the week (0 = Sunday)',
    allowedValues: ['0', '1', '2', '3', '4', '5', '6'],
    appDefault: '0',
  },
  upcomingScheduledTransactionLength: {
    authority: 'setting',
    description:
      'How far ahead schedules count as upcoming: a preset or <n>-day|week|month|year',
    allowedValues: [...UPCOMING_LENGTH_PRESET_VALUES],
    pattern: CUSTOM_UPCOMING.source,
    appDefault: '7',
    validate: value =>
      (UPCOMING_LENGTH_PRESET_VALUES as readonly string[]).includes(value) ||
      CUSTOM_UPCOMING.test(value),
  },
  'show-hidden-tags': {
    authority: 'setting',
    description: 'Show hidden tags in tag lists',
    allowedValues: BOOLEAN,
    appDefault: 'false',
  },
  ...Object.fromEntries(
    FEATURE_FLAGS.map(flag => [
      `flags.${flag}`,
      {
        authority: 'feature-flag',
        description: `Experimental feature flag: ${flag}`,
        allowedValues: BOOLEAN,
        appDefault: 'false',
      } satisfies Setting,
    ]),
  ),
};

const DOMAIN_KEYS: Record<string, Omit<Setting, 'validate'>> = {
  budgetType: {
    authority: 'budget-type',
    description:
      'Envelope or tracking budgeting; switching changes budget tables and is not a plain preference',
    owner: '0025-cli-budgeting',
  },
  cashPlanning: {
    authority: 'cash-planning',
    description: 'Structured cash-planning targets; use the typed tool',
    owner: '0026-cli-cash-planning',
  },
};

const PATTERN_KEYS: Array<{
  pattern: RegExp;
  authority: PreferenceAuthority;
  description: string;
  owner?: string;
}> = [
  {
    pattern:
      /^(csv-|parse-date-|flip-amount-|import-reimport-deleted-|ofx-|qif-|camt-)/,
    authority: 'import-mapping',
    description: 'Per-account import mapping',
    owner: '0020-cli-file-parsing',
  },
  {
    pattern: /^(sync-|custom-sync-mappings-)/,
    authority: 'bank-sync',
    description: 'Bank sync option',
    owner: '0030-cli-bank-sync',
  },
  {
    pattern: /^(show-|hide-|side-nav\.|transaction-table-columns|show-group-)/,
    authority: 'ui-state',
    description: 'App display state',
  },
];

export function describePreference(key: unknown): PreferenceDescription {
  if (typeof key !== 'string' || !key) {
    throw APIError('Invalid preference key');
  }
  const setting = SETTINGS[key];
  if (setting) {
    const { validate: _validate, ...rest } = setting;
    return { key, scope: 'synced', settable: true, ...rest };
  }
  const domain = DOMAIN_KEYS[key];
  if (domain) {
    return { key, scope: 'synced', settable: false, ...domain };
  }
  const match = PATTERN_KEYS.find(entry => entry.pattern.test(key));
  if (match) {
    return {
      key,
      scope: 'synced',
      settable: false,
      authority: match.authority,
      description: match.description,
      ...(match.owner ? { owner: match.owner } : {}),
    };
  }
  throw APIError(`Unknown synced preference: ${key}`);
}

async function storedPreference(id: string) {
  const row = await db.first<{ id: string; value: string | null }>(
    'SELECT id, value FROM preferences WHERE id = ?',
    [id],
  );
  return row ?? null;
}

// Read-only inspection. Unset settings report value null with the app default
// alongside; nothing is written. Stored keys outside the catalog are listed
// with authority 'unknown' so nothing is hidden.
export async function inspectPreferences(key?: string) {
  if (key !== undefined) {
    const description = describePreference(key);
    const row = await storedPreference(key);
    return [{ ...description, value: row?.value ?? null }];
  }
  const rows = await db.all<{ id: string; value: string | null }>(
    'SELECT id, value FROM preferences ORDER BY id',
  );
  const stored = new Map(rows.map(row => [row.id, row.value]));
  const result: Array<
    | (PreferenceDescription & { value: string | null })
    | {
        key: string;
        scope: 'synced';
        authority: 'unknown';
        settable: false;
        value: string | null;
      }
  > = Object.keys(SETTINGS).map(name => ({
    ...describePreference(name),
    value: stored.get(name) ?? null,
  }));
  for (const name of Object.keys(DOMAIN_KEYS)) {
    result.push({
      ...describePreference(name),
      value: stored.get(name) ?? null,
    });
  }
  for (const [name, value] of stored) {
    if (SETTINGS[name] || DOMAIN_KEYS[name]) continue;
    try {
      result.push({ ...describePreference(name), value });
    } catch {
      result.push({
        key: name,
        scope: 'synced',
        authority: 'unknown',
        settable: false,
        value,
      });
    }
  }
  return result;
}

export async function preparePreferenceSet(
  request: PreferenceSetRequest,
): Promise<PreferenceSetProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Array.isArray(request) ||
    Object.keys(request).some(name => !['id', 'value'].includes(name)) ||
    !(typeof request.value === 'string' || request.value === null)
  ) {
    throw APIError(
      'Invalid preference request: provide id and a string value, or null to reset',
    );
  }
  const description = describePreference(request.id);
  if (!description.settable) {
    throw APIError(
      `Preference ${request.id} is owned by ${description.owner ?? description.authority} and cannot be set here`,
    );
  }
  const setting = SETTINGS[request.id];
  if (
    request.value !== null &&
    !(setting.validate
      ? setting.validate(request.value)
      : (setting.allowedValues ?? []).includes(request.value))
  ) {
    throw APIError(
      `Invalid value for ${request.id}; allowed: ${(setting.allowedValues ?? []).join(', ')}${setting.pattern ? ` or ${setting.pattern}` : ''}`,
    );
  }
  const existing = await storedPreference(request.id);
  const sideEffects = [
    request.value === null
      ? 'clear the synced preference so the app falls back to its default'
      : 'store the synced preference through the canonical preferences owner; it syncs to every device',
  ];
  if (description.authority === 'feature-flag') {
    sideEffects.push('toggles an experimental feature for every device');
  }
  if (request.id === 'defaultCurrencyCode') {
    sideEffects.push('changes display only; stored amounts are not converted');
  }
  return {
    schemaVersion: 1,
    operation: 'preferences.set',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      preference: existing ? { ...existing } : null,
    },
    after: {
      description,
      preference: { id: request.id, value: request.value },
    },
    references: {},
    sideEffects,
  };
}

export async function performPreferenceSet(current: PreferenceSetProposal) {
  if (current.before.preference === null && current.request.value === null) {
    // Resetting a preference that was never stored is a no-op; writing would
    // create an empty row.
    return { changed: false, affectedIds: [current.request.id] };
  }
  await saveSyncedPrefs({
    id: current.request.id as Parameters<typeof saveSyncedPrefs>[0]['id'],
    value: current.request.value as string | undefined,
  });
  const actual = await storedPreference(current.request.id);
  if (!rowMatches(actual, current.after.preference)) {
    throw new Error('Preference acknowledgement is incomplete');
  }
  return {
    changed:
      (current.before.preference?.value ?? null) !== current.request.value,
    affectedIds: [current.request.id],
  };
}
