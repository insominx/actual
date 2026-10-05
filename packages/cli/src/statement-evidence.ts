// Device-local statement evidence for data-quality coverage. Entries are
// user-declared facts about a statement (ending balance or no activity for a
// month); they are never treated as bank verification. The file lives in the
// CLI data directory, keyed by budget, and is replaced atomically.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentError } from './agent-output';
import { isRecord } from './utils';

export type StoredStatement = {
  accountId: string;
  month: string;
  endingBalance: number | null;
  noActivity: boolean;
  source: string | null;
  importOperationId: string | null;
  recordedAt: string;
};

type EvidenceFile = {
  schemaVersion: 1;
  budgets: Record<string, StoredStatement[]>;
};

const FILE = 'statement-evidence.json';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function evidencePath(dataDir: string) {
  return join(dataDir, FILE);
}

function isStatement(value: unknown): value is StoredStatement {
  return (
    isRecord(value) &&
    typeof value.accountId === 'string' &&
    typeof value.month === 'string' &&
    MONTH.test(value.month) &&
    (value.endingBalance === null ||
      Number.isSafeInteger(value.endingBalance)) &&
    typeof value.noActivity === 'boolean' &&
    (value.source === null || typeof value.source === 'string') &&
    (value.importOperationId === null ||
      typeof value.importOperationId === 'string') &&
    typeof value.recordedAt === 'string'
  );
}

async function load(dataDir: string): Promise<EvidenceFile> {
  let text;
  try {
    text = await readFile(evidencePath(dataDir), 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { schemaVersion: 1, budgets: {} };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    !isRecord(parsed.budgets) ||
    !Object.values(parsed.budgets).every(
      list => Array.isArray(list) && list.every(isStatement),
    )
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      `Statement evidence file is not valid: ${evidencePath(dataDir)}`,
    );
  }
  return parsed as EvidenceFile;
}

async function save(dataDir: string, file: EvidenceFile) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${evidencePath(dataDir)}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(file, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, evidencePath(dataDir));
}

export async function listStatements(dataDir: string, budget: string) {
  return (await load(dataDir)).budgets[budget] ?? [];
}

export async function addStatement(
  dataDir: string,
  budget: string,
  entry: Omit<StoredStatement, 'recordedAt'>,
  replace: boolean,
) {
  if (!entry.accountId) {
    throw new AgentError('INVALID_INPUT', '--account is required.');
  }
  if (!MONTH.test(entry.month)) {
    throw new AgentError('INVALID_INPUT', 'Expected a valid YYYY-MM month.');
  }
  if (entry.endingBalance === null && !entry.noActivity) {
    throw new AgentError(
      'INVALID_INPUT',
      'Provide --ending-balance <cents> or --no-activity.',
    );
  }
  const file = await load(dataDir);
  const list = file.budgets[budget] ?? [];
  const existing = list.findIndex(
    s => s.accountId === entry.accountId && s.month === entry.month,
  );
  if (existing >= 0 && !replace) {
    throw new AgentError(
      'INVALID_INPUT',
      'Statement evidence for this account and month already exists. Pass --replace to overwrite it.',
    );
  }
  const stored: StoredStatement = {
    ...entry,
    recordedAt: new Date().toISOString(),
  };
  const next = list.filter((_, i) => i !== existing);
  next.push(stored);
  next.sort(
    (a, b) =>
      a.accountId.localeCompare(b.accountId) || a.month.localeCompare(b.month),
  );
  file.budgets[budget] = next;
  await save(dataDir, file);
  return { statement: stored, replaced: existing >= 0 };
}

export async function removeStatement(
  dataDir: string,
  budget: string,
  accountId: string,
  month: string,
) {
  const file = await load(dataDir);
  const list = file.budgets[budget] ?? [];
  const next = list.filter(
    s => !(s.accountId === accountId && s.month === month),
  );
  if (next.length === list.length) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'No statement evidence for this account and month.',
    );
  }
  file.budgets[budget] = next;
  await save(dataDir, file);
  return { removed: { accountId, month } };
}
