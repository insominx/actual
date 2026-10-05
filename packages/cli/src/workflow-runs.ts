// Device-local workflow run records. A run stores its budget context, the
// validated input, a fixed step plan and each step's outcome. Mutation
// steps record their operation ID and exact payload before they execute, so
// a resumed run replays the guarded change receipt instead of repeating the
// mutation. Records never contain credentials.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentError } from './agent-output';
import { acquireExclusive } from './lock';
import { isRecord } from './utils';

export const WORKFLOWS = [
  'setup',
  'intake',
  'weekly-checkup',
  'monthly-close',
  'goal-review',
] as const;
export type WorkflowName = (typeof WORKFLOWS)[number];

export type StepStatus =
  | 'pending'
  | 'committed'
  | 'completed'
  | 'unresolved'
  | 'failed'
  | 'not-run';

export type WorkflowStep = {
  id: string;
  kind: 'mutation' | 'read' | 'artifact';
  status: StepStatus;
  operation?: string;
  operationId?: string;
  payload?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string; message: string };
  finishedAt?: string;
};

export type UnresolvedItem = {
  step: string;
  code: string;
  message: string;
  accountId?: string | null;
  evidence?: unknown;
};

export type RunStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'needs-review'
  | 'cancelled'
  | 'failed';

export type WorkflowRun = {
  schemaVersion: 1;
  runId: string;
  workflow: WorkflowName;
  budget: { syncId: string | null; budgetId: string | null };
  input: Record<string, unknown>;
  status: RunStatus;
  steps: WorkflowStep[];
  unresolved: UnresolvedItem[];
  artifacts: Array<{ kind: string; path: string }>;
  createdAt: string;
  updatedAt: string;
};

const RUN_ID = /^wf-[a-z0-9]{1,40}$/;

function dir(dataDir: string) {
  return join(dataDir, 'workflow-runs');
}

export function newRunId() {
  return `wf-${randomBytes(8).toString('hex')}`;
}

export function validateRunId(runId: string) {
  if (!RUN_ID.test(runId)) {
    throw new AgentError(
      'INVALID_INPUT',
      'Workflow run IDs look like wf- followed by 1-40 lowercase letters or digits.',
      false,
      { field: 'runId' },
    );
  }
}

export async function writeRun(dataDir: string, run: WorkflowRun) {
  await mkdir(dir(dataDir), { recursive: true });
  run.updatedAt = new Date().toISOString();
  const path = join(dir(dataDir), `${run.runId}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(run, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}

function isRun(value: unknown): value is WorkflowRun {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.runId === 'string' &&
    typeof value.workflow === 'string' &&
    (WORKFLOWS as readonly string[]).includes(value.workflow) &&
    Array.isArray(value.steps) &&
    isRecord(value.budget)
  );
}

export async function readRun(dataDir: string, runId: string) {
  validateRunId(runId);
  let text;
  try {
    text = await readFile(join(dir(dataDir), `${runId}.json`), 'utf8');
  } catch {
    throw new AgentError('MISSING_CONTEXT', 'Workflow run was not found.');
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRun(parsed)) {
    throw new AgentError('INVALID_INPUT', 'Workflow run record is invalid.');
  }
  return parsed;
}

export async function runExists(dataDir: string, runId: string) {
  try {
    await readRun(dataDir, runId);
    return true;
  } catch {
    return false;
  }
}

export async function listRuns(dataDir: string, limit: number) {
  let names: string[] = [];
  try {
    names = await readdir(dir(dataDir));
  } catch {
    return { runs: [], truncated: false };
  }
  const runs: WorkflowRun[] = [];
  for (const name of names.filter(n => /^wf-[a-z0-9]+\.json$/.test(n))) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(dir(dataDir), name), 'utf8'),
      );
      if (isRun(parsed)) runs.push(parsed);
    } catch {
      /* Skip unreadable records; inspect reports them individually. */
    }
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    runs: runs.slice(0, limit).map(run => ({
      runId: run.runId,
      workflow: run.workflow,
      status: run.status,
      budget: run.budget,
      unresolved: run.unresolved.length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
    truncated: runs.length > limit,
  };
}

// One process at a time may advance a run. A second invocation fails within
// about a second instead of executing the same steps concurrently.
export async function withRunLock<T>(
  dataDir: string,
  runId: string,
  f: () => Promise<T>,
): Promise<T> {
  validateRunId(runId);
  const lockDir = join(dir(dataDir), 'locks', runId);
  await mkdir(lockDir, { recursive: true });
  let release;
  try {
    release = await acquireExclusive(lockDir, { timeoutMs: 1000 });
  } catch {
    throw new AgentError(
      'ENGINE_FAILURE',
      'Another process is advancing this workflow run. Retry after it finishes.',
      true,
      { runId, reason: 'run-active' },
    );
  }
  try {
    return await f();
  } finally {
    await release();
  }
}
