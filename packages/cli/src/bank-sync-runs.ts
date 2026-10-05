// Device-local bank sync run records. A record is written after the engine
// import and before synchronization (commit: committed-local) and updated
// to synced once the push is acknowledged, so a failed push leaves the run
// visible as committed-local with its per-account outcomes.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentError } from './agent-output';
import { isRecord } from './utils';

export type BankSyncRun = {
  schemaVersion: 1;
  runId: string;
  budget: string;
  createdAt: string;
  updatedAt: string;
  commit: 'committed-local' | 'synced';
  result: unknown;
};

const RUN_ID = /^[a-f0-9-]{36}$/;

function dir(dataDir: string) {
  return join(dataDir, 'bank-sync-runs');
}

export function newRunId() {
  return randomUUID();
}

export async function writeRun(dataDir: string, run: BankSyncRun) {
  await mkdir(dir(dataDir), { recursive: true });
  const path = join(dir(dataDir), `${run.runId}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(run, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}

function isRun(value: unknown): value is BankSyncRun {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.runId === 'string' &&
    typeof value.budget === 'string' &&
    (value.commit === 'committed-local' || value.commit === 'synced')
  );
}

export async function readRun(dataDir: string, runId: string) {
  if (!RUN_ID.test(runId)) {
    throw new AgentError('INVALID_INPUT', 'Expected a bank sync run ID.');
  }
  let text;
  try {
    text = await readFile(join(dir(dataDir), `${runId}.json`), 'utf8');
  } catch {
    throw new AgentError('MISSING_CONTEXT', 'Bank sync run was not found.');
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRun(parsed)) {
    throw new AgentError('INVALID_INPUT', 'Bank sync run record is invalid.');
  }
  return parsed;
}

export async function listRuns(dataDir: string, budget: string, limit: number) {
  let names: string[] = [];
  try {
    names = await readdir(dir(dataDir));
  } catch {
    return { runs: [], truncated: false };
  }
  const runs: BankSyncRun[] = [];
  for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(dir(dataDir), name), 'utf8'),
      );
      if (isRun(parsed) && parsed.budget === budget) runs.push(parsed);
    } catch {
      // Skip unreadable records.
    }
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { runs: runs.slice(0, limit), truncated: runs.length > limit };
}
