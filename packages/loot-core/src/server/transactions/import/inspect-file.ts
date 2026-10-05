// Read-only import file inspection for agent tools. It runs the same parser
// as the import dialog (`parseFile`) and the same shared mapping, date and
// amount rules (`#shared/import-mapping`), reporting normalized candidates
// with row-level errors instead of importing anything. Saved per-account
// mappings are the synced preferences the dialog reads and writes.
import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { storedPreference } from '#server/preferences/catalog';
import {
  applyFieldMappings,
  dateFormats,
  getFileType,
  getInitialDateFormat,
  getInitialMappings,
  isDateFormat,
  parseAmountFields,
  parseDate,
} from '#shared/import-mapping';
import type {
  DateFormat,
  FieldMapping,
  ImportTransaction,
} from '#shared/import-mapping';
import { amountToInteger } from '#shared/util';

import { parseFile } from './parse-file';
import type { ParseFileOptions } from './parse-file';

export const IMPORT_FILE_LIMIT = 10 * 1024 * 1024;
const ROW_LIMIT = 1000;
const FORMATS = ['csv', 'qif', 'ofx', 'qfx', 'xml'] as const;
const ENCODINGS = [
  'auto',
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
  'iso-8859-1',
  'iso-8859-15',
  'shift_jis',
  'gb18030',
  'big5',
  'euc-kr',
];

export type ImportMappingSettings = {
  fields: Partial<FieldMapping> | null;
  dateFormat: DateFormat | null;
  delimiter: string | null;
  encoding: string | null;
  hasHeaderRow: boolean | null;
  skipStartLines: number | null;
  skipEndLines: number | null;
  inOutMode: boolean | null;
  outValue: string | null;
  flipAmount: boolean | null;
  swapPayeeAndMemo: boolean | null;
  fallbackMissingPayeeToMemo: boolean | null;
};

export type ImportFileInspectRequest = {
  path: string;
  account?: string;
  useSaved?: boolean;
  settings?: Partial<ImportMappingSettings> & { multiplier?: string };
  limit?: number;
};

export type ImportCandidate = {
  date: string;
  amount: number;
  payee_name: string | null;
  imported_payee: string | null;
  notes: string | null;
  category: string | null;
  imported_id: string | null;
};

export type ImportFileInspection = {
  file: { name: string; format: string; size: number; sha256: string };
  account: string | null;
  settings: ImportMappingSettings & { multiplier: string | null };
  sources: Record<string, 'request' | 'saved' | 'detected' | 'default'>;
  columns: string[];
  rowCount: number;
  validCount: number;
  errorCount: number;
  dateRange: { start: string; end: string } | null;
  dateFormatCandidates: DateFormat[];
  rows: Array<{
    index: number;
    transaction: ImportCandidate | null;
    errors: string[];
  }>;
  truncated: boolean;
  parseErrors: string[];
  warnings: string[];
};

const PREF_KEYS = {
  fields: (a: string) => `csv-mappings-${a}`,
  delimiter: (a: string) => `csv-delimiter-${a}`,
  encoding: (a: string) => `csv-encoding-${a}`,
  hasHeaderRow: (a: string) => `csv-has-header-${a}`,
  skipStartLines: (a: string) => `csv-skip-start-lines-${a}`,
  skipEndLines: (a: string) => `csv-skip-end-lines-${a}`,
  inOutMode: (a: string) => `csv-in-out-mode-${a}`,
  outValue: (a: string) => `csv-out-value-${a}`,
} as const;

// The synced preference keys the import dialog uses for one account and
// file type, in the order the dialog reads them.
export function importPreferenceKeys(account: string, format: string) {
  const filetype = format === 'qfx' ? 'ofx' : format;
  return {
    ...Object.fromEntries(
      Object.entries(PREF_KEYS).map(([name, key]) => [name, key(account)]),
    ),
    dateFormat: `parse-date-${account}-${filetype}`,
    flipAmount: `flip-amount-${account}-${filetype}`,
    swapPayeeAndMemo: `${filetype === 'xml' ? 'camt' : filetype}-swap-payee-memo-${account}`,
    fallbackMissingPayeeToMemo: `ofx-fallback-missing-payee-${account}`,
  } as Record<keyof ImportMappingSettings, string>;
}

function parseStored(
  name: keyof ImportMappingSettings,
  value: string,
): unknown {
  switch (name) {
    case 'fields':
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    case 'hasHeaderRow':
    case 'inOutMode':
    case 'flipAmount':
    case 'swapPayeeAndMemo':
    case 'fallbackMissingPayeeToMemo':
      return value === 'true' ? true : value === 'false' ? false : null;
    case 'skipStartLines':
    case 'skipEndLines': {
      const parsed = parseInt(value, 10);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    }
    case 'dateFormat':
      return isDateFormat(value) ? value : null;
    default:
      return value;
  }
}

export async function savedImportSettings(account: string, format: string) {
  const keys = importPreferenceKeys(account, format);
  const saved: Partial<ImportMappingSettings> = {};
  for (const [name, key] of Object.entries(keys) as Array<
    [keyof ImportMappingSettings, string]
  >) {
    const row = await storedPreference(key);
    if (row?.value != null) {
      const parsed = parseStored(name, row.value);
      if (parsed != null) (saved as Record<string, unknown>)[name] = parsed;
    }
  }
  return saved;
}

function invalid(message: string): never {
  throw APIError(`Invalid import inspection request: ${message}`);
}

export function validateImportSettings(
  settings: unknown,
): Partial<ImportMappingSettings> & { multiplier?: string } {
  if (settings === undefined) return {};
  if (typeof settings !== 'object' || settings === null) {
    invalid('settings must be an object');
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    switch (key) {
      case 'fields': {
        if (value === null) {
          out.fields = null;
          break;
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
          invalid(
            'fields must map date, amount, payee, notes, inOut, category, outflow and inflow to column names',
          );
        }
        const allowed = [
          'date',
          'amount',
          'payee',
          'notes',
          'inOut',
          'category',
          'outflow',
          'inflow',
        ];
        for (const [field, column] of Object.entries(value)) {
          if (!allowed.includes(field)) {
            invalid(`unknown mapping field ${field}`);
          }
          if (column !== null && typeof column !== 'string') {
            invalid(`mapping for ${field} must be a column name or null`);
          }
        }
        out.fields = value;
        break;
      }
      case 'dateFormat':
        if (
          value !== null &&
          !(typeof value === 'string' && isDateFormat(value))
        ) {
          invalid(
            `dateFormat must be one of ${dateFormats.map(f => f.format).join(', ')}`,
          );
        }
        out.dateFormat = value;
        break;
      case 'delimiter':
        if (
          value !== null &&
          (typeof value !== 'string' || value.length !== 1)
        ) {
          invalid('delimiter must be one character');
        }
        out.delimiter = value;
        break;
      case 'encoding':
        if (
          value !== null &&
          !(typeof value === 'string' && ENCODINGS.includes(value))
        ) {
          invalid(`encoding must be one of ${ENCODINGS.join(', ')}`);
        }
        out.encoding = value;
        break;
      case 'skipStartLines':
      case 'skipEndLines':
        if (
          value !== null &&
          !(
            Number.isInteger(value) &&
            (value as number) >= 0 &&
            (value as number) <= 1000
          )
        ) {
          invalid(`${key} must be an integer from 0 to 1000`);
        }
        out[key] = value;
        break;
      case 'hasHeaderRow':
      case 'inOutMode':
      case 'flipAmount':
      case 'swapPayeeAndMemo':
      case 'fallbackMissingPayeeToMemo':
        if (value !== null && typeof value !== 'boolean') {
          invalid(`${key} must be a boolean`);
        }
        out[key] = value;
        break;
      case 'outValue':
        if (value !== null && typeof value !== 'string') {
          invalid('outValue must be a string');
        }
        out.outValue = value;
        break;
      case 'multiplier':
        if (typeof value !== 'string' || !/^\d{1,}(\.\d{0,4})?$/.test(value)) {
          invalid('multiplier must be a positive decimal string');
        }
        out.multiplier = value;
        break;
      default:
        invalid(`unknown setting ${key}`);
    }
  }
  return out;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function readImportFile(path: unknown) {
  if (typeof path !== 'string' || !path) invalid('path is required');
  const format = getFileType(path);
  if (!(FORMATS as readonly string[]).includes(format)) {
    throw APIError(
      `Unsupported import file type .${format}; supported: csv, tsv, qif, ofx, qfx, xml (CAMT.053)`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(path, 'binary');
  } catch {
    throw APIError(`Import file cannot be read: ${path}`);
  }
  if (bytes.length > IMPORT_FILE_LIMIT) {
    throw APIError(
      `Import file is ${bytes.length} bytes; the limit is ${IMPORT_FILE_LIMIT}`,
    );
  }
  return {
    format,
    size: bytes.length,
    sha256: await sha256(bytes),
    name: path.split(/[\\/]/).pop() ?? path,
  };
}

function text(value: unknown) {
  return value == null || value === '' ? null : String(value);
}

export async function inspectImportFile(
  request: ImportFileInspectRequest,
): Promise<ImportFileInspection> {
  if (typeof request !== 'object' || request === null) {
    invalid('provide path and optional account, useSaved, settings, limit');
  }
  for (const key of Object.keys(request)) {
    if (!['path', 'account', 'useSaved', 'settings', 'limit'].includes(key)) {
      invalid(`unknown field ${key}`);
    }
  }
  const limit = request.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 0 || limit > ROW_LIMIT) {
    invalid(`limit must be an integer from 0 to ${ROW_LIMIT}`);
  }
  const requested = validateImportSettings(request.settings);
  const file = await readImportFile(request.path);
  let account: string | null = null;
  if (request.account !== undefined) {
    const found = await db.first<{ id: string; tombstone: number }>(
      'SELECT id, tombstone FROM accounts WHERE id = ?',
      [request.account],
    );
    if (!found || found.tombstone) {
      throw APIError(`Account does not exist: ${request.account}`);
    }
    account = found.id;
  }
  const saved =
    account && request.useSaved !== false
      ? await savedImportSettings(account, file.format)
      : {};
  const sources: ImportFileInspection['sources'] = {};
  function pick<K extends keyof ImportMappingSettings>(
    name: K,
    fallback: ImportMappingSettings[K],
  ): ImportMappingSettings[K] {
    if (requested[name] !== undefined) {
      sources[name] = 'request';
      return requested[name] as ImportMappingSettings[K];
    }
    if (saved[name] !== undefined) {
      sources[name] = 'saved';
      return saved[name] as ImportMappingSettings[K];
    }
    sources[name] = 'default';
    return fallback;
  }
  const isCsv = file.format === 'csv';
  const isOfx = file.format === 'ofx' || file.format === 'qfx';
  const delimiter = pick(
    'delimiter',
    file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',',
  );
  const encoding = pick('encoding', 'auto');
  const hasHeaderRow = pick('hasHeaderRow', true);
  const skipStartLines = pick('skipStartLines', 0);
  const skipEndLines = pick('skipEndLines', 0);
  const swapPayeeAndMemo = pick('swapPayeeAndMemo', false);
  const fallbackMissingPayeeToMemo = pick('fallbackMissingPayeeToMemo', true);
  const options: ParseFileOptions = isCsv
    ? {
        delimiter: delimiter ?? ',',
        encoding: encoding ?? 'auto',
        hasHeaderRow: hasHeaderRow ?? true,
        skipStartLines: skipStartLines ?? 0,
        skipEndLines: skipEndLines ?? 0,
        importNotes: true,
      }
    : {
        fallbackMissingPayeeToMemo: fallbackMissingPayeeToMemo ?? true,
        swapPayeeAndMemo: swapPayeeAndMemo ?? false,
        importNotes: true,
      };
  const parsed = await parseFile(request.path, options);
  const parseErrors = parsed.errors.map(error => error.message);
  const raw = (parsed.transactions ?? []) as Array<Record<string, unknown>>;

  let fields: Partial<FieldMapping> | null = null;
  if (isCsv) {
    fields = pick('fields', null);
    if (!fields) {
      fields = getInitialMappings(raw);
      sources.fields = 'detected';
    }
  }
  const needsDateFormat = isCsv || file.format === 'qif';
  const dateColumn = isCsv ? (fields?.date ?? null) : 'date';
  const candidatesFor = (format: DateFormat) =>
    raw.every(row => {
      const value = dateColumn ? row[dateColumn] : null;
      return (
        value == null ||
        value === '' ||
        parseDate(value as string, format) != null
      );
    });
  const dateFormatCandidates =
    needsDateFormat && raw.length
      ? dateFormats.map(f => f.format).filter(candidatesFor)
      : [];
  let dateFormat: DateFormat | null = null;
  const warnings: string[] = [];
  if (needsDateFormat) {
    dateFormat = pick('dateFormat', null);
    if (!dateFormat) {
      if (dateFormatCandidates.length > 1) {
        warnings.push(
          `Ambiguous date format: ${dateFormatCandidates.join(', ')} all parse every row; pass settings.dateFormat. Rows are not normalized until it is chosen.`,
        );
      } else {
        dateFormat =
          dateFormatCandidates[0] ??
          getInitialDateFormat(raw, { date: dateColumn });
        sources.dateFormat = 'detected';
      }
    }
  }
  const inOutMode = isOfx ? false : pick('inOutMode', false);
  const outValue = pick('outValue', '');
  const flipAmount =
    isCsv || file.format === 'qif' ? pick('flipAmount', false) : false;
  const multiplier = requested.multiplier ?? null;
  const splitMode = !!(fields?.outflow || fields?.inflow);

  const rows: ImportFileInspection['rows'] = [];
  let validCount = 0;
  let start: string | null = null;
  let end: string | null = null;
  raw.forEach((source, index) => {
    const errors: string[] = [];
    const mapped = (
      fields
        ? applyFieldMappings(
            source as ImportTransaction,
            fields as FieldMapping,
          )
        : source
    ) as Partial<ImportTransaction> & Record<string, unknown>;
    if (isCsv) {
      for (const [field, column] of Object.entries(fields ?? {})) {
        if (column && !(column in source)) {
          errors.push(`column ${column} for ${field} is missing`);
        }
      }
      if (!fields?.date) errors.push('no column is mapped to date');
      if (!splitMode && !fields?.amount) {
        errors.push('no column is mapped to amount (or outflow/inflow)');
      }
    }
    let date: string | null = null;
    if (needsDateFormat) {
      date = dateFormat ? parseDate(mapped.date ?? null, dateFormat) : null;
      if (dateFormat && date == null) {
        errors.push(
          `date ${String(mapped.date ?? '(empty)')} does not parse as ${dateFormat}`,
        );
      }
      if (!dateFormat) errors.push('date format is ambiguous');
    } else {
      date = typeof mapped.date === 'string' ? mapped.date : null;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(
          `date ${String(mapped.date ?? '(empty)')} is not a calendar date`,
        );
      }
    }
    const amountSource: unknown[] = splitMode
      ? [mapped.outflow, mapped.inflow]
      : [mapped.amount];
    const malformed = amountSource.some(
      value =>
        typeof value === 'string' && value.trim() !== '' && !/\d/.test(value),
    );
    const { amount } = parseAmountFields(
      mapped,
      splitMode,
      !!inOutMode,
      outValue ?? '',
      !!flipAmount,
      multiplier ?? '',
    );
    if (
      malformed ||
      amountSource.every(value => value == null || value === '') ||
      amount == null ||
      !Number.isFinite(amount)
    ) {
      errors.push(
        `amount ${amountSource.map(v => String(v ?? '(empty)')).join('/')} is not a number`,
      );
    }
    const payee = mapped.payee_name;
    const transaction: ImportCandidate | null = errors.length
      ? null
      : {
          date: date as string,
          amount: amountToInteger(amount as number),
          payee_name: text(payee),
          imported_payee: text(mapped.imported_payee ?? payee),
          notes: text(mapped.notes),
          category: text(mapped.category),
          imported_id: text(source.imported_id),
        };
    if (transaction) {
      validCount++;
      if (!start || transaction.date < start) start = transaction.date;
      if (!end || transaction.date > end) end = transaction.date;
    }
    if (rows.length < limit) rows.push({ index, transaction, errors });
  });
  const columns =
    isCsv && raw.length && !Array.isArray(raw[0]) ? Object.keys(raw[0]) : [];
  return {
    file,
    account,
    settings: {
      fields,
      dateFormat,
      delimiter: isCsv ? delimiter : null,
      encoding: isCsv ? encoding : null,
      hasHeaderRow: isCsv ? hasHeaderRow : null,
      skipStartLines: isCsv ? skipStartLines : null,
      skipEndLines: isCsv ? skipEndLines : null,
      inOutMode: isCsv ? inOutMode : null,
      outValue: isCsv ? outValue : null,
      flipAmount: isCsv || file.format === 'qif' ? flipAmount : null,
      swapPayeeAndMemo: isCsv ? null : swapPayeeAndMemo,
      fallbackMissingPayeeToMemo: isOfx ? fallbackMissingPayeeToMemo : null,
      multiplier,
    },
    sources,
    columns,
    rowCount: raw.length,
    validCount,
    errorCount: raw.length - validCount,
    dateRange: start && end ? { start, end } : null,
    dateFormatCandidates,
    rows,
    truncated: raw.length > rows.length,
    parseErrors,
    warnings,
  };
}
