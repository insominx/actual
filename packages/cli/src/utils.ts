import { AgentError } from '#agent-output';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map(key => JSON.stringify(key) + ':' + stableJson(record[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

export function parseBoolFlag(value: string, flagName: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw new AgentError(
      'INVALID_INPUT',
      `Invalid ${flagName}: "${value}". Expected "true" or "false".`,
    );
  }
  return value === 'true';
}

// The budget engine's amount limit (loot-core shared/util MAX_SAFE_NUMBER).
// Amounts between 2**51 and 2**53 are valid JS safe integers but make every
// later spreadsheet sum throw, so request validation uses this bound.
export const MAX_ENGINE_AMOUNT = 2 ** 51 - 1;

export function isEngineAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_ENGINE_AMOUNT
  );
}

// Number() also accepts '', ' ', '0x10', '0b11', '1e3' and '1.0'. For a count or
// an amount in cents only plain decimal digits (with an optional sign) are an
// integer; anything else is NaN so callers refuse it.
export function plainInteger(value: string): number {
  const text = value.trim();
  return /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
}

export function parseIntFlag(value: string, flagName: string): number {
  const parsed = plainInteger(value);
  if (!isEngineAmount(parsed)) {
    throw new AgentError(
      'INVALID_INPUT',
      `Invalid ${flagName}: "${value}". Expected an integer.`,
    );
  }
  return parsed;
}

export function parseNonNegativeIntFlag(
  value: string,
  flagName: string,
): number {
  const parsed = parseIntFlag(value, flagName);
  if (parsed < 0) {
    throw new AgentError(
      'INVALID_INPUT',
      `Invalid ${flagName}: "${value}". Expected a non-negative integer.`,
    );
  }
  return parsed;
}

export function parseBoolEnv(
  raw: string | undefined,
  source: string,
): boolean | undefined {
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (raw === '1' || lower === 'true') return true;
  if (raw === '0' || lower === 'false') return false;
  throw new AgentError(
    'INVALID_INPUT',
    `Invalid ${source}: "${raw}". Expected "true", "false", "1", or "0".`,
  );
}

// Case-insensitive name filter for catalog inspection output.
export function filterByName<T extends { name: string | null }>(
  rows: T[],
  text: string | undefined,
) {
  if (text === undefined) return rows;
  const needle = text.trim().toLowerCase();
  return rows.filter(row => (row.name ?? '').toLowerCase().includes(needle));
}

/**
 * Message of a thrown value. The engine rejects with plain `{ type, message }`
 * objects (APIError) rather than Error instances, so `String(error)` would
 * print "[object Object]" and hide why a request was refused.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}
