import * as db from '#server/db';
// Guarded save of one account's import settings. The values are stored in
// the same synced preferences, with the same serialization, that the import
// dialog reads and writes, so a mapping saved here is the dialog's next
// default and the reverse.
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import { saveSyncedPrefs } from '#server/preferences/app';
import { storedPreference } from '#server/preferences/catalog';
import type {
  ImportMappingSaveProposal,
  ImportMappingSaveRequest,
} from '#types/change-proposals';

import { importPreferenceKeys, validateImportSettings } from './inspect-file';
import type { ImportMappingSettings } from './inspect-file';

const APPLIES: Record<string, Array<keyof ImportMappingSettings>> = {
  csv: [
    'fields',
    'dateFormat',
    'delimiter',
    'encoding',
    'hasHeaderRow',
    'skipStartLines',
    'skipEndLines',
    'inOutMode',
    'outValue',
    'flipAmount',
  ],
  qif: ['dateFormat', 'flipAmount', 'swapPayeeAndMemo'],
  ofx: ['swapPayeeAndMemo', 'fallbackMissingPayeeToMemo'],
  xml: ['swapPayeeAndMemo'],
};

const FIELD_KEYS = [
  'date',
  'amount',
  'payee',
  'notes',
  'inOut',
  'category',
  'outflow',
  'inflow',
] as const;

function serialize(name: keyof ImportMappingSettings, value: unknown) {
  if (value === null) return null;
  if (name === 'fields') {
    const fields = value as Record<string, string | null>;
    // The dialog stores every mapping slot, unmapped ones as null.
    return JSON.stringify(
      Object.fromEntries(FIELD_KEYS.map(key => [key, fields[key] ?? null])),
    );
  }
  return String(value);
}

export async function prepareImportMappingSave(
  request: ImportMappingSaveRequest,
): Promise<ImportMappingSaveProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(
      key => !['account', 'format', 'settings', 'reset'].includes(key),
    )
  ) {
    throw APIError(
      'Invalid import mapping request: provide account, format, and settings or reset',
    );
  }
  const { account, format, settings, reset = false } = request;
  const found =
    typeof account === 'string'
      ? await db.first<{ tombstone: number }>(
          'SELECT tombstone FROM accounts WHERE id = ?',
          [account],
        )
      : null;
  if (!found || found.tombstone) {
    throw APIError(`Account does not exist: ${String(account)}`);
  }
  const normalizedFormat = format === 'qfx' ? 'ofx' : format;
  if (typeof normalizedFormat !== 'string' || !APPLIES[normalizedFormat]) {
    throw APIError('format must be csv, qif, ofx, qfx or xml');
  }
  if (typeof reset !== 'boolean') throw APIError('reset must be a boolean');
  if (reset === (settings !== undefined)) {
    throw APIError('Provide either settings or reset, not both');
  }
  const validated = validateImportSettings(settings);
  if ('multiplier' in validated) {
    throw APIError('multiplier is not saved; the dialog never stores it');
  }
  const allowed = APPLIES[normalizedFormat];
  for (const key of Object.keys(validated)) {
    if (!allowed.includes(key as keyof ImportMappingSettings)) {
      throw APIError(
        `${key} does not apply to ${normalizedFormat} imports; allowed: ${allowed.join(', ')}`,
      );
    }
  }
  if (!reset && !Object.keys(validated).length) {
    throw APIError('settings must name at least one setting');
  }
  const keys = importPreferenceKeys(account, normalizedFormat);
  const names = reset
    ? allowed
    : (Object.keys(validated) as Array<keyof ImportMappingSettings>);
  const before: Array<{ id: string; value: string | null }> = [];
  const after: Array<{ id: string; value: string | null }> = [];
  for (const name of names) {
    const id = keys[name];
    const current = (await storedPreference(id))?.value ?? null;
    const next = reset
      ? null
      : serialize(name, (validated as Record<string, unknown>)[name]);
    before.push({ id, value: current });
    if (current !== next) after.push({ id, value: next });
  }
  return {
    schemaVersion: 1,
    operation: 'imports.mapping-save',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), preferences: before },
    after: { preferences: after },
    references: {},
    sideEffects: [
      after.length
        ? `${reset ? 'clear' : 'store'} ${after.length} synced import preference(s) for this account; they sync to every device and become the import dialog's defaults`
        : 'no preference changes; the stored settings already match',
    ],
  };
}

export async function performImportMappingSave(
  current: ImportMappingSaveProposal,
) {
  for (const preference of current.after.preferences) {
    await saveSyncedPrefs({
      id: preference.id as Parameters<typeof saveSyncedPrefs>[0]['id'],
      value: preference.value as string | undefined,
    });
  }
  for (const preference of current.after.preferences) {
    const stored = (await storedPreference(preference.id))?.value ?? null;
    if (stored !== preference.value) {
      throw new Error('Import mapping acknowledgement is incomplete');
    }
  }
  return {
    changed: current.after.preferences.length > 0,
    affectedIds: current.after.preferences.map(p => p.id),
  };
}
