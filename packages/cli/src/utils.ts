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
    throw new Error(
      `Invalid ${flagName}: "${value}". Expected "true" or "false".`,
    );
  }
  return value === 'true';
}

export function parseIntFlag(value: string, flagName: string): number {
  const parsed = value.trim() === '' ? NaN : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${flagName}: "${value}". Expected an integer.`);
  }
  return parsed;
}

export function parseNonNegativeIntFlag(
  value: string,
  flagName: string,
): number {
  const parsed = parseIntFlag(value, flagName);
  if (parsed < 0) {
    throw new Error(
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
  throw new Error(
    `Invalid ${source}: "${raw}". Expected "true", "false", "1", or "0".`,
  );
}
