// Saved automation jobs. A job binds a budget, the intake workflow, three
// declared directories (inbox, processed, error), filename routes to
// accounts and the mutations it may perform. A job run imports stable inbox
// files through a resumable workflow run, deduplicates by content hash,
// account and settings, and moves files only between its own directories.
// Results are local artifacts; nothing is delivered externally.
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import * as api from '@actual-app/api';

import { AgentError } from './agent-output';
import type { CliGlobalOpts } from './config';
import { withConnection } from './connection';
import { acquireExclusive } from './lock';
import { isRecord } from './utils';
import { newRunId, readRun, withRunLock, writeRun } from './workflow-runs';
import type { WorkflowRun } from './workflow-runs';
import { advanceRun, budgetOpts, cancelRun, createRun } from './workflows';

export const JOB_MUTATIONS = ['imports.file'] as const;
const TEMPORARY = /\.(part|partial|tmp|crdownload|download)$/i;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type JobRoute = {
  match: string;
  account: string;
  settings?: Record<string, unknown>;
};

export type Job = {
  schemaVersion: 1;
  name: string;
  workflow: 'intake';
  budget: WorkflowRun['budget'];
  directories: { inbox: string; processed: string; error: string };
  routes: JobRoute[];
  allowedMutations: Array<(typeof JOB_MUTATIONS)[number]>;
  allowCrossAccount: boolean;
  stableSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type LedgerEntry = {
  key: string;
  sha256: string;
  account: string;
  file: string;
  runId: string;
  at: string;
};

type ActiveRun = {
  runId: string;
  files: Array<{
    name: string;
    step: string;
    key: string;
    sha256: string;
    account: string;
  }>;
};

type JobState = {
  schemaVersion: 1;
  ledger: LedgerEntry[];
  active: ActiveRun | null;
  lastResult: string | null;
};

function invalid(message: string, field?: string): never {
  throw new AgentError(
    'INVALID_INPUT',
    message,
    false,
    field ? { field } : undefined,
  );
}

function jobDir(dataDir: string, name: string) {
  if (!NAME.test(name)) {
    invalid('Job names use 1-40 lowercase letters, digits or hyphens.', 'name');
  }
  return join(dataDir, 'jobs', name);
}

async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function inside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function validateJob(input: {
  name: string;
  budget: WorkflowRun['budget'];
  inbox: string;
  processed: string;
  error: string;
  routes: unknown;
  allow: string[];
  allowCrossAccount: boolean;
  stableSeconds: number;
}): Job {
  if (!NAME.test(input.name)) {
    invalid('Job names use 1-40 lowercase letters, digits or hyphens.', 'name');
  }
  if (!input.budget.syncId && !input.budget.budgetId) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'A job binds an explicit budget. Select one with --sync-id or --budget-id.',
    );
  }
  const directories = {
    inbox: resolve(input.inbox),
    processed: resolve(input.processed),
    error: resolve(input.error),
  };
  const all = Object.values(directories);
  for (const a of all) {
    for (const b of all) {
      if (a !== b && inside(a, b)) {
        invalid(
          'Inbox, processed and error directories must be separate, not nested.',
          'directories',
        );
      }
    }
  }
  if (new Set(all).size !== 3) {
    invalid(
      'Inbox, processed and error directories must differ.',
      'directories',
    );
  }
  if (!Array.isArray(input.routes) || input.routes.length === 0) {
    invalid('--routes must be a non-empty JSON array.', 'routes');
  }
  const routes = input.routes.map((r: unknown, i): JobRoute => {
    if (
      !isRecord(r) ||
      typeof r.match !== 'string' ||
      !r.match ||
      typeof r.account !== 'string' ||
      !r.account
    ) {
      invalid(`routes[${i}] needs match and account strings.`, 'routes');
    }
    try {
      new RegExp(r.match);
    } catch {
      invalid(
        `routes[${i}].match is not a valid regular expression.`,
        'routes',
      );
    }
    if (r.settings !== undefined && !isRecord(r.settings)) {
      invalid(`routes[${i}].settings must be an object.`, 'routes');
    }
    return {
      match: r.match,
      account: r.account,
      ...(r.settings
        ? { settings: r.settings as Record<string, unknown> }
        : {}),
    };
  });
  const allowed = input.allow.filter(m =>
    (JOB_MUTATIONS as readonly string[]).includes(m),
  ) as Job['allowedMutations'];
  if (
    allowed.length !== input.allow.length ||
    !allowed.includes('imports.file')
  ) {
    invalid(
      'An intake job must explicitly allow imports.file (--allow imports.file); no other mutation is supported.',
      'allow',
    );
  }
  if (
    !Number.isSafeInteger(input.stableSeconds) ||
    input.stableSeconds < 0 ||
    input.stableSeconds > 86400
  ) {
    invalid('--stable-seconds must be 0-86400.', 'stableSeconds');
  }
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    name: input.name,
    workflow: 'intake',
    budget: input.budget,
    directories,
    routes,
    allowedMutations: allowed,
    allowCrossAccount: input.allowCrossAccount,
    stableSeconds: input.stableSeconds,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveJob(dataDir: string, job: Job, create: boolean) {
  const dir = jobDir(dataDir, job.name);
  if (create) {
    try {
      await stat(join(dir, 'job.json'));
      invalid('A job with this name exists.', 'name');
    } catch (error) {
      if (error instanceof AgentError) throw error;
    }
  }
  await mkdir(join(dir, 'results'), { recursive: true });
  for (const d of Object.values(job.directories)) {
    await mkdir(d, { recursive: true });
  }
  job.updatedAt = new Date().toISOString();
  await writeJson(join(dir, 'job.json'), job);
}

export async function readJob(dataDir: string, name: string) {
  const dir = jobDir(dataDir, name);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'));
  } catch {
    throw new AgentError('MISSING_CONTEXT', 'Job was not found.');
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    invalid('Job record is invalid.');
  }
  return parsed as unknown as Job;
}

async function readState(dataDir: string, name: string): Promise<JobState> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(jobDir(dataDir, name), 'state.json'), 'utf8'),
    );
    if (isRecord(parsed) && parsed.schemaVersion === 1) {
      return parsed as unknown as JobState;
    }
  } catch {
    /* No state yet. */
  }
  return { schemaVersion: 1, ledger: [], active: null, lastResult: null };
}

function writeState(dataDir: string, name: string, state: JobState) {
  return writeJson(join(jobDir(dataDir, name), 'state.json'), state);
}

export async function listJobs(dataDir: string) {
  let names: string[] = [];
  try {
    names = await readdir(join(dataDir, 'jobs'));
  } catch {
    return { jobs: [] };
  }
  const jobs = [];
  for (const name of names.filter(n => NAME.test(n)).sort()) {
    try {
      const job = await readJob(dataDir, name);
      jobs.push({
        name: job.name,
        workflow: job.workflow,
        enabled: job.enabled,
        budget: job.budget,
        inbox: job.directories.inbox,
      });
    } catch {
      /* Skip unreadable job records. */
    }
  }
  return { jobs };
}

type Candidate = {
  name: string;
  path: string;
  status:
    | 'ready'
    | 'pending-unstable'
    | 'no-route'
    | 'duplicate'
    | 'cross-account-review';
  account?: string;
  settings?: Record<string, unknown>;
  sha256?: string;
  key?: string;
  reason?: string;
};

async function scanInbox(job: Job, state: JobState, now: number) {
  const names = (await readdir(job.directories.inbox, { withFileTypes: true }))
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort();
  const candidates: Candidate[] = [];
  const seenThisScan = new Set<string>();
  const scanAccounts = new Map<string, string>();
  for (const name of names) {
    const path = join(job.directories.inbox, name);
    if (TEMPORARY.test(name)) {
      candidates.push({
        name,
        path,
        status: 'pending-unstable',
        reason: 'temporary download name',
      });
      continue;
    }
    const info = await stat(path);
    if (now - info.mtimeMs < job.stableSeconds * 1000) {
      candidates.push({
        name,
        path,
        status: 'pending-unstable',
        reason: `modified less than ${job.stableSeconds}s ago`,
      });
      continue;
    }
    const route = job.routes.find(r => new RegExp(r.match).test(name));
    if (!route) {
      candidates.push({
        name,
        path,
        status: 'no-route',
        reason: 'no route matches this file name; add a route to import it',
      });
      continue;
    }
    const sha256 = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    const key = createHash('sha256')
      .update(
        stableJson({
          sha256,
          account: route.account,
          settings: route.settings ?? null,
        }),
      )
      .digest('hex');
    const base = {
      name,
      path,
      account: route.account,
      sha256,
      key,
      ...(route.settings ? { settings: route.settings } : {}),
    };
    if (state.ledger.some(e => e.key === key) || seenThisScan.has(key)) {
      candidates.push({
        ...base,
        status: 'duplicate',
        reason: 'already imported with the same account and settings',
      });
      continue;
    }
    const other =
      state.ledger.some(
        e => e.sha256 === sha256 && e.account !== route.account,
      ) ||
      (scanAccounts.has(sha256) && scanAccounts.get(sha256) !== route.account);
    if (other && !job.allowCrossAccount) {
      candidates.push({
        ...base,
        status: 'cross-account-review',
        reason:
          'the same file was imported into another account; allow it explicitly with a cross-account job policy',
      });
      continue;
    }
    seenThisScan.add(key);
    scanAccounts.set(sha256, route.account);
    candidates.push({ ...base, status: 'ready' });
  }
  return candidates;
}

async function moveWithin(from: string, toDir: string, suffix: string) {
  let target = join(toDir, basename(from));
  try {
    await stat(target);
    target = join(toDir, `${suffix}-${basename(from)}`);
  } catch {
    /* Target name is free. */
  }
  await rename(from, target);
  return target;
}

// Moves files of a finished (or cancelled) run: committed imports go to
// processed and enter the ledger; failed ones go to error; files whose
// import never ran stay in the inbox.
async function finalize(
  dataDir: string,
  job: Job,
  state: JobState,
  run: WorkflowRun,
) {
  const active = state.active;
  if (!active) return [];
  const moves = [];
  for (const file of active.files) {
    const step = run.steps.find(s => s.id === file.step);
    const from = join(job.directories.inbox, file.name);
    try {
      await stat(from);
    } catch {
      continue;
    }
    if (step?.status === 'committed') {
      state.ledger.push({
        key: file.key,
        sha256: file.sha256,
        account: file.account,
        file: file.name,
        runId: run.runId,
        at: new Date().toISOString(),
      });
      moves.push({
        file: file.name,
        to: await moveWithin(from, job.directories.processed, run.runId),
        outcome: 'imported',
      });
    } else if (step?.status === 'failed' && run.status !== 'cancelled') {
      moves.push({
        file: file.name,
        to: await moveWithin(from, job.directories.error, run.runId),
        outcome: 'failed',
      });
    }
  }
  state.active = null;
  await writeState(dataDir, job.name, state);
  return moves;
}

async function writeResult(dataDir: string, job: Job, result: unknown) {
  const at = new Date().toISOString();
  const path = join(
    jobDir(dataDir, job.name),
    'results',
    `${at.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`,
  );
  await writeJson(path, result);
  return path;
}

function jobOpts(opts: CliGlobalOpts, job: Job): CliGlobalOpts {
  return {
    ...opts,
    syncId: job.budget.syncId ?? undefined,
    budgetId: job.budget.budgetId ?? undefined,
    ...(job.budget.budgetId ? { offline: true } : {}),
  };
}

async function withJobLock<T>(
  dataDir: string,
  name: string,
  f: () => Promise<T>,
) {
  const lockDir = join(jobDir(dataDir, name), 'lock');
  await mkdir(lockDir, { recursive: true });
  let release;
  try {
    release = await acquireExclusive(lockDir, { timeoutMs: 1000 });
  } catch {
    throw new AgentError(
      'ENGINE_FAILURE',
      'Another invocation of this job is running; only one run is active at a time. Retry later.',
      true,
      { job: name, reason: 'job-active' },
    );
  }
  try {
    return await f();
  } finally {
    await release();
  }
}

export async function runJob(
  opts: CliGlobalOpts,
  dataDir: string,
  name: string,
  { dryRun = false, stopAfter }: { dryRun?: boolean; stopAfter?: string } = {},
) {
  return withJobLock(dataDir, name, async () => {
    const job = await readJob(dataDir, name);
    if (!job.enabled) {
      invalid('This job is disabled; enable it to run.', 'name');
    }
    const state = await readState(dataDir, name);
    // An interrupted run resumes before any new scan: committed steps are
    // not replayed and interrupted imports replay their receipts.
    if (state.active && !dryRun) {
      const active = state.active;
      const run = await withRunLock(dataDir, active.runId, async () => {
        const record = await readRun(dataDir, active.runId);
        if (['running', 'paused', 'failed'].includes(record.status)) {
          return advanceRun(
            budgetOpts(opts, record),
            dataDir,
            record,
            stopAfter,
          );
        }
        return record;
      });
      if (run.status === 'paused') {
        return { job: name, resumed: run.runId, run: run.status, moves: [] };
      }
      const moves = await finalize(dataDir, job, state, run);
      const result = {
        job: name,
        resumed: run.runId,
        runStatus: run.status,
        unresolved: run.unresolved,
        moves,
        pending: [],
      };
      state.lastResult = await writeResult(dataDir, job, result);
      await writeState(dataDir, name, state);
      return { ...result, resultPath: state.lastResult };
    }
    const candidates = await scanInbox(job, state, Date.now());
    const ready = candidates.filter(c => c.status === 'ready');
    const pending = candidates
      .filter(c => c.status !== 'ready')
      .map(c => ({ file: c.name, status: c.status, reason: c.reason }));
    if (dryRun) {
      const previews: Array<Record<string, unknown>> = [];
      if (ready.length) {
        await withConnection(
          jobOpts(opts, job),
          async () => {
            for (const c of ready) {
              try {
                const proposal = await api.previewFileImport({
                  path: c.path,
                  accountId: c.account ?? '',
                  sha256: c.sha256,
                  ...(c.settings ? { settings: c.settings } : {}),
                });
                previews.push({
                  file: c.name,
                  account: c.account,
                  summary: proposal.after.summary,
                  moveTo: job.directories.processed,
                });
              } catch (error) {
                previews.push({
                  file: c.name,
                  account: c.account,
                  error: error instanceof Error ? error.message : String(error),
                  moveTo: job.directories.error,
                });
              }
            }
          },
          { mutates: false },
        );
      }
      return { job: name, dryRun: true, wouldImport: previews, pending };
    }
    // Duplicates already imported with the same account and settings move to
    // processed without another import.
    const moves = [];
    for (const c of candidates.filter(c => c.status === 'duplicate')) {
      moves.push({
        file: c.name,
        to: await moveWithin(c.path, job.directories.processed, 'duplicate'),
        outcome: 'duplicate',
      });
    }
    if (!ready.length) {
      const result = { job: name, runId: null, moves, pending };
      state.lastResult = await writeResult(dataDir, job, result);
      await writeState(dataDir, name, state);
      return { ...result, resultPath: state.lastResult };
    }
    const runId = newRunId();
    const input = {
      files: ready.map(c => ({
        path: c.path,
        account: c.account,
        sha256: c.sha256,
        ...(c.settings ? { settings: c.settings } : {}),
      })),
    };
    state.active = {
      runId,
      files: ready.map((c, i) => ({
        name: c.name,
        step: `import-${i}`,
        key: c.key ?? '',
        sha256: c.sha256 ?? '',
        account: c.account ?? '',
      })),
    };
    // Record the active run before it starts so a crash resumes it.
    await writeState(dataDir, name, state);
    const run = await withRunLock(dataDir, runId, async () => {
      const record = await createRun(
        dataDir,
        runId,
        'intake',
        input,
        job.budget,
      );
      try {
        return await advanceRun(jobOpts(opts, job), dataDir, record, stopAfter);
      } catch (error) {
        if (
          error instanceof AgentError &&
          error.code === 'PARTIAL_COMPLETION'
        ) {
          return readRun(dataDir, runId);
        }
        throw error;
      }
    });
    if (run.status === 'paused') {
      return { job: name, runId, runStatus: run.status, moves, pending };
    }
    moves.push(...(await finalize(dataDir, job, state, run)));
    const result = {
      job: name,
      runId,
      runStatus: run.status,
      unresolved: run.unresolved,
      moves,
      pending,
    };
    state.lastResult = await writeResult(dataDir, job, result);
    await writeState(dataDir, name, state);
    return { ...result, resultPath: state.lastResult };
  });
}

export async function jobStatus(dataDir: string, name: string) {
  const job = await readJob(dataDir, name);
  const state = await readState(dataDir, name);
  const candidates = await scanInbox(job, state, Date.now());
  let lastResult: unknown = null;
  if (state.lastResult) {
    try {
      lastResult = JSON.parse(await readFile(state.lastResult, 'utf8'));
    } catch {
      lastResult = null;
    }
  }
  return {
    job,
    active: state.active,
    imported: state.ledger.length,
    inbox: candidates.map(c => ({
      file: c.name,
      status: c.status,
      ...(c.reason ? { reason: c.reason } : {}),
    })),
    lastResult,
    lastResultPath: state.lastResult,
  };
}

// Disabling stops future runs. A paused or failed active run is cancelled;
// its committed imports move to processed and the rest stay in the inbox.
export async function disableJob(dataDir: string, name: string) {
  return withJobLock(dataDir, name, async () => {
    const job = await readJob(dataDir, name);
    job.enabled = false;
    await saveJob(dataDir, job, false);
    const state = await readState(dataDir, name);
    let cancelled: string | null = null;
    let moves: unknown[] = [];
    if (state.active) {
      const runId = state.active.runId;
      const run = await withRunLock(dataDir, runId, async () => {
        const record = await readRun(dataDir, runId);
        if (['running', 'paused', 'failed'].includes(record.status)) {
          cancelRun(record);
          await writeRun(dataDir, record);
          cancelled = runId;
        }
        return record;
      });
      moves = await finalize(dataDir, job, state, run);
    }
    return { job: name, enabled: false, cancelledRun: cancelled, moves };
  });
}

export async function enableJob(dataDir: string, name: string) {
  return withJobLock(dataDir, name, async () => {
    const job = await readJob(dataDir, name);
    job.enabled = true;
    await saveJob(dataDir, job, false);
    return { job: name, enabled: true };
  });
}

function quoteSh(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Scheduler recipes only print text; nothing is installed.
export function schedulerRecipes(
  job: Job,
  {
    executable = 'actual',
    minutes = 15,
    dataDir,
  }: {
    executable?: string;
    minutes?: number;
    dataDir: string;
  },
) {
  const selector = job.budget.syncId
    ? ['--sync-id', job.budget.syncId]
    : ['--offline', '--budget-id', job.budget.budgetId ?? ''];
  const args = ['--data-dir', dataDir, ...selector, 'jobs', 'run', job.name];
  const sh = [executable, ...args].map(quoteSh).join(' ');
  const win = [executable, ...args]
    .map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(' ');
  return {
    command: { executable, args },
    cron: `*/${minutes} * * * * ${sh} >> ${quoteSh(join(dataDir, 'jobs', job.name, 'cron.log'))} 2>&1`,
    systemdTimer: { OnCalendar: `*:0/${minutes}`, ExecStart: sh },
    windowsTaskScheduler: `schtasks /Create /SC MINUTE /MO ${minutes} /TN "Actual ${job.name}" /TR "${win.replace(/"/g, '\\"')}"`,
    notes: [
      'Credentials come from the environment or a profile, never from the recipe.',
      'Overlapping invocations are safe: only one job run is active at a time.',
      'Results are local JSON files under the job results directory; configure any external alert delivery yourself.',
    ],
  };
}
