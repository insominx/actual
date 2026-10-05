// Fixed workflow definitions over the CLI's typed operations. Each step
// calls the same public API read or guarded change a CLI command uses; no
// workflow contains its own finance logic or runs arbitrary commands. The
// executor persists the run after every step (see workflow-runs.ts).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as api from '@actual-app/api';

import { AgentError } from './agent-output';
import { createBudgetBackup } from './commands/backups';
import type { CliGlobalOpts } from './config';
import { withConnection } from './connection';
import {
  executeAccountCreation,
  executeBudgetCreation,
  executeCategoryCreation,
  executeCategoryGroupCreation,
  executeScopedChange,
} from './guarded-changes';
import { listStatements } from './statement-evidence';
import { isRecord } from './utils';
import type {
  UnresolvedItem,
  WorkflowName,
  WorkflowRun,
  WorkflowStep,
} from './workflow-runs';
import { writeRun } from './workflow-runs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function invalid(message: string, field?: string): never {
  throw new AgentError(
    'INVALID_INPUT',
    message,
    false,
    field ? { field } : undefined,
  );
}

function engine<T>(f: () => Promise<T>): Promise<T> {
  return f().catch((error: unknown) => {
    if (error instanceof AgentError) throw error;
    throw new AgentError(
      'INVALID_INPUT',
      error instanceof Error ? error.message : String(error),
    );
  });
}

function str(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(`${field} must be a non-empty string.`, field);
  }
  return value;
}

function int(value: unknown, field: string) {
  if (!Number.isSafeInteger(value)) {
    invalid(`${field} must be an integer amount in cents.`, field);
  }
  return value as number;
}

function monthEnd(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

function addMonths(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Input validation (before any side effect) ----

export type SetupInput = {
  budgetName?: string;
  accounts: Array<{ name: string; offbudget: boolean; initialBalance: number }>;
  categoryGroups: Array<{
    name: string;
    isIncome: boolean;
    categories: string[];
  }>;
};

export type IntakeInput = {
  files: Array<{
    path: string;
    account: string;
    sha256: string;
    settings?: Record<string, unknown>;
    useSaved?: boolean;
    skipInvalid?: boolean;
  }>;
  fromMonth?: string;
  toMonth?: string;
};

export type WeeklyInput = { asOf: string; accounts?: string[] };

export type CloseInput = {
  month: string;
  statements: Array<{ accountId: string; endingBalance: number; date: string }>;
  finish: boolean;
  backupDirectory?: string;
};

export type GoalInput = {
  scenario?: Record<string, unknown>;
  start?: string;
  end?: string;
};

export function validateSetup(raw: unknown): SetupInput {
  if (!isRecord(raw)) invalid('Setup spec must be a JSON object.', 'spec');
  const accounts = raw.accounts ?? [];
  const groups = raw.categoryGroups ?? [];
  if (!Array.isArray(accounts) || !Array.isArray(groups)) {
    invalid('accounts and categoryGroups must be arrays.', 'spec');
  }
  if (accounts.length + groups.length === 0 && raw.budgetName === undefined) {
    invalid('Setup spec has nothing to create.', 'spec');
  }
  if (accounts.length > 50 || groups.length > 50) {
    invalid('Setup creates at most 50 accounts and 50 groups.', 'spec');
  }
  return {
    ...(raw.budgetName === undefined
      ? {}
      : { budgetName: str(raw.budgetName, 'budgetName') }),
    accounts: accounts.map((a: unknown, i) => {
      if (!isRecord(a)) invalid(`accounts[${i}] must be an object.`, 'spec');
      return {
        name: str(a.name, `accounts[${i}].name`),
        offbudget: a.offbudget === true,
        initialBalance:
          a.initialBalance === undefined
            ? 0
            : int(a.initialBalance, `accounts[${i}].initialBalance`),
      };
    }),
    categoryGroups: groups.map((g: unknown, i) => {
      if (!isRecord(g)) {
        invalid(`categoryGroups[${i}] must be an object.`, 'spec');
      }
      const categories = g.categories ?? [];
      if (!Array.isArray(categories) || categories.length > 50) {
        invalid(`categoryGroups[${i}].categories must be an array.`, 'spec');
      }
      return {
        name: str(g.name, `categoryGroups[${i}].name`),
        isIncome: g.isIncome === true,
        categories: categories.map((c: unknown, j) =>
          str(c, `categoryGroups[${i}].categories[${j}]`),
        ),
      };
    }),
  };
}

export function validateIntake(
  raw: unknown,
  baseDir: string,
  range: { fromMonth?: string; toMonth?: string },
): IntakeInput {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    invalid('The intake manifest must be an array of 1-50 files.', 'manifest');
  }
  for (const value of [range.fromMonth, range.toMonth]) {
    if (value !== undefined && !MONTH.test(value)) {
      invalid('Months must be YYYY-MM.', 'month');
    }
  }
  const files = raw.map((entry: unknown, i) => {
    if (!isRecord(entry)) invalid(`manifest[${i}] must be an object.`);
    const path = resolve(baseDir, str(entry.file, `manifest[${i}].file`));
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch {
      invalid(`manifest[${i}].file cannot be read.`, 'manifest');
    }
    if (entry.settings !== undefined && !isRecord(entry.settings)) {
      invalid(`manifest[${i}].settings must be an object.`, 'manifest');
    }
    return {
      path,
      account: str(entry.account, `manifest[${i}].account`),
      // The hash binds every later import (and any resume) to the bytes
      // observed when the run started.
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...(entry.settings === undefined
        ? {}
        : { settings: entry.settings as Record<string, unknown> }),
      ...(entry.useSaved === false ? { useSaved: false } : {}),
      ...(entry.skipInvalid === true ? { skipInvalid: true } : {}),
    };
  });
  return {
    files,
    ...(range.fromMonth ? { fromMonth: range.fromMonth } : {}),
    ...(range.toMonth ? { toMonth: range.toMonth } : {}),
  };
}

export function validateClose(raw: {
  month: string;
  statements: unknown;
  finish: boolean;
  backupDirectory?: string;
}): CloseInput {
  if (!MONTH.test(raw.month)) invalid('--month must be YYYY-MM.', 'month');
  if (!Array.isArray(raw.statements) || raw.statements.length > 50) {
    invalid('--statements must be a JSON array of at most 50.', 'statements');
  }
  const seen = new Set<string>();
  const statements = raw.statements.map((s: unknown, i) => {
    if (!isRecord(s)) invalid(`statements[${i}] must be an object.`);
    const accountId = str(s.accountId, `statements[${i}].accountId`);
    if (seen.has(accountId)) {
      invalid('Each account may have one statement.', 'statements');
    }
    seen.add(accountId);
    const date = s.date === undefined ? monthEnd(raw.month) : s.date;
    if (typeof date !== 'string' || !DATE.test(date)) {
      invalid(`statements[${i}].date must be YYYY-MM-DD.`, 'statements');
    }
    return {
      accountId,
      endingBalance: int(s.endingBalance, `statements[${i}].endingBalance`),
      date,
    };
  });
  if (raw.backupDirectory !== undefined) {
    if (!raw.backupDirectory.trim() || raw.backupDirectory.includes('\0')) {
      invalid('Provide an explicit backup directory.', 'backupDirectory');
    }
  }
  return {
    month: raw.month,
    statements,
    finish: raw.finish,
    ...(raw.backupDirectory
      ? { backupDirectory: resolve(raw.backupDirectory) }
      : {}),
  };
}

// ---- Step plans ----

export function planSteps(
  workflow: WorkflowName,
  input: Record<string, unknown>,
): WorkflowStep[] {
  const step = (
    id: string,
    kind: WorkflowStep['kind'],
    operation?: string,
  ): WorkflowStep => ({
    id,
    kind,
    status: 'pending',
    ...(operation ? { operation } : {}),
  });
  switch (workflow) {
    case 'setup': {
      const spec = input as unknown as SetupInput;
      return [
        ...(spec.budgetName
          ? [step('budget', 'mutation', 'budgets.create')]
          : []),
        ...spec.accounts.map((_, i) =>
          step(`account-${i}`, 'mutation', 'accounts.create'),
        ),
        ...spec.categoryGroups.flatMap((g, i) => [
          step(`group-${i}`, 'mutation', 'category-groups.create'),
          ...g.categories.map((_, j) =>
            step(`category-${i}-${j}`, 'mutation', 'categories.create'),
          ),
        ]),
      ];
    }
    case 'intake': {
      const intake = input as unknown as IntakeInput;
      return [
        ...intake.files.map((_, i) =>
          step(`import-${i}`, 'mutation', 'imports.file'),
        ),
        step('transfers', 'read'),
        step('review', 'read'),
      ];
    }
    case 'weekly-checkup':
      return [
        step('data-quality', 'read'),
        step('schedules', 'read'),
        step('bank-sync', 'read'),
      ];
    case 'monthly-close': {
      const close = input as unknown as CloseInput;
      return [
        ...(close.backupDirectory ? [step('backup', 'artifact')] : []),
        ...close.statements.map((_, i) =>
          step(`reconcile-${i}`, 'mutation', 'reconcile.finish'),
        ),
        step('review', 'read'),
      ];
    }
    case 'goal-review':
      return [step('cash-plan', 'read')];
    default:
      throw new AgentError('INVALID_INPUT', 'Unknown workflow.');
  }
}

// ---- Execution ----

type StepContext = {
  opts: CliGlobalOpts;
  dataDir: string;
  run: WorkflowRun;
  unresolved: (item: Omit<UnresolvedItem, 'step'>) => void;
};

export function budgetOpts(
  opts: CliGlobalOpts,
  run: WorkflowRun,
): CliGlobalOpts {
  return {
    ...opts,
    syncId: run.budget.syncId ?? undefined,
    budgetId: run.budget.budgetId ?? undefined,
    // A local budget ID is only selectable offline (see resolveConfig).
    ...(run.budget.budgetId ? { offline: true } : {}),
  };
}

function receiptSummary(receipt: {
  operationId: string;
  state: string;
  outcome?: unknown;
}) {
  return { operationId: receipt.operationId, state: receipt.state };
}

// Mutation steps fix their payload before executing. A resumed step reuses
// it, so the change journal returns the original receipt.
async function mutate<T>(
  step: WorkflowStep,
  ctx: StepContext,
  build: () => Promise<Record<string, unknown>> | Record<string, unknown>,
  run: (operationId: string, payload: Record<string, unknown>) => Promise<T>,
) {
  if (!step.operationId) step.operationId = `${ctx.run.runId}-${step.id}`;
  if (!step.payload) {
    step.payload = await build();
    await writeRun(ctx.dataDir, ctx.run);
  }
  return run(step.operationId, step.payload);
}

function stepResult(run: WorkflowRun, id: string) {
  return run.steps.find(s => s.id === id)?.result as
    | Record<string, unknown>
    | undefined;
}

async function readStatements(ctx: StepContext) {
  const key = ctx.run.budget.syncId ?? ctx.run.budget.budgetId;
  if (!key) return [];
  return (await listStatements(ctx.dataDir, key)).map(s => ({
    accountId: s.accountId,
    month: s.month,
    endingBalance: s.endingBalance,
    noActivity: s.noActivity,
    source: s.source,
  }));
}

function recordFindings(
  ctx: StepContext,
  result: Awaited<ReturnType<typeof api.getDataQualityCheckup>>,
) {
  for (const finding of result.findings) {
    if (finding.severity === 'info') continue;
    ctx.unresolved({
      code: finding.code,
      message: `${finding.count} item(s): ${finding.uncertainty}`,
      accountId: finding.accountId,
      evidence: { ids: finding.ids, suggested: finding.suggested },
    });
  }
  for (const account of result.coverage) {
    if (account.summary.unknown > 0 || account.summary.discrepancy > 0) {
      ctx.unresolved({
        code:
          account.summary.discrepancy > 0
            ? 'statement-discrepancy'
            : 'coverage-unknown',
        message: `${account.name}: ${account.summary.unknown} month(s) without statement evidence, ${account.summary.discrepancy} with a discrepancy.`,
        accountId: account.accountId,
      });
    }
  }
  return {
    findings: result.findings.length,
    truncated: result.truncated,
    coverage: result.coverage.map(a => ({
      accountId: a.accountId,
      name: a.name,
      summary: a.summary,
    })),
  };
}

async function dataQuality(
  ctx: StepContext,
  start: string,
  end: string,
  accountIds?: string[],
  extraStatements: Array<{
    accountId: string;
    month: string;
    endingBalance: number;
  }> = [],
) {
  const saved = await readStatements(ctx);
  const statements = [
    ...saved.filter(
      s =>
        !extraStatements.some(
          e => e.accountId === s.accountId && e.month === s.month,
        ),
    ),
    ...extraStatements.map(s => ({
      ...s,
      noActivity: false,
      source: `workflow ${ctx.run.runId}`,
    })),
  ];
  let result!: Awaited<ReturnType<typeof api.getDataQualityCheckup>>;
  await withConnection(
    budgetOpts(ctx.opts, ctx.run),
    async () => {
      result = await engine(() =>
        api.getDataQualityCheckup({
          start,
          end,
          ...(accountIds?.length ? { accountIds } : {}),
          statements,
        }),
      );
    },
    { mutates: false },
  );
  return recordFindings(ctx, result);
}

async function runSetupStep(step: WorkflowStep, ctx: StepContext) {
  const spec = ctx.run.input as unknown as SetupInput;
  const opts = () => budgetOpts(ctx.opts, ctx.run);
  if (step.id === 'budget') {
    const created = await mutate(
      step,
      ctx,
      () => ({ name: spec.budgetName }),
      (id, payload) =>
        executeBudgetCreation(
          { ...ctx.opts, syncId: undefined, budgetId: undefined },
          id,
          payload as unknown as api.BudgetCreationRequest,
        ),
    );
    ctx.run.budget = { syncId: null, budgetId: created.id };
    return {
      status: 'committed' as const,
      result: {
        budgetId: created.id,
        receipt: receiptSummary(created.receipt),
      },
    };
  }
  const account = /^account-(\d+)$/.exec(step.id);
  if (account) {
    const created = await mutate(
      step,
      ctx,
      () => spec.accounts[Number(account[1])],
      (id, payload) =>
        executeAccountCreation(
          opts(),
          id,
          payload as unknown as api.AccountCreationRequest,
        ),
    );
    return {
      status: 'committed' as const,
      result: { id: created.id, receipt: receiptSummary(created.receipt) },
    };
  }
  const group = /^group-(\d+)$/.exec(step.id);
  if (group) {
    const g = spec.categoryGroups[Number(group[1])];
    const created = await mutate(
      step,
      ctx,
      () => ({ name: g.name, ...(g.isIncome ? { is_income: true } : {}) }),
      (id, payload) =>
        executeCategoryGroupCreation(
          opts(),
          id,
          payload as unknown as api.CategoryGroupCreationRequest,
        ),
    );
    return {
      status: 'committed' as const,
      result: { id: created.id, receipt: receiptSummary(created.receipt) },
    };
  }
  const category = /^category-(\d+)-(\d+)$/.exec(step.id);
  if (category) {
    const g = spec.categoryGroups[Number(category[1])];
    const created = await mutate(
      step,
      ctx,
      () => {
        const groupId = stepResult(ctx.run, `group-${category[1]}`)?.id;
        if (typeof groupId !== 'string') {
          throw new AgentError(
            'PARTIAL_COMPLETION',
            'The category group step has no acknowledged ID.',
          );
        }
        return {
          name: g.categories[Number(category[2])],
          group_id: groupId,
          ...(g.isIncome ? { is_income: true } : {}),
        };
      },
      (id, payload) =>
        executeCategoryCreation(
          opts(),
          id,
          payload as unknown as api.CategoryCreationRequest,
        ),
    );
    return {
      status: 'committed' as const,
      result: { id: created.id, receipt: receiptSummary(created.receipt) },
    };
  }
  throw new AgentError('ENGINE_FAILURE', `Unknown setup step ${step.id}.`);
}

type ImportedRange = Map<string, { start: string; end: string }>;

function importedRanges(run: WorkflowRun): ImportedRange {
  const ranges: ImportedRange = new Map();
  for (const step of run.steps) {
    const result = step.result as
      | { accountId?: string; dates?: { start: string; end: string } | null }
      | undefined;
    if (!step.id.startsWith('import-') || !result?.dates || !result.accountId) {
      continue;
    }
    const range = ranges.get(result.accountId);
    if (!range) {
      ranges.set(result.accountId, { ...result.dates });
    } else {
      if (result.dates.start < range.start) range.start = result.dates.start;
      if (result.dates.end > range.end) range.end = result.dates.end;
    }
  }
  return ranges;
}

async function runIntakeStep(step: WorkflowStep, ctx: StepContext) {
  const intake = ctx.run.input as unknown as IntakeInput;
  const opts = budgetOpts(ctx.opts, ctx.run);
  const imported = /^import-(\d+)$/.exec(step.id);
  if (imported) {
    const file = intake.files[Number(imported[1])];
    const { receipt } = await mutate(
      step,
      ctx,
      () => ({
        path: file.path,
        accountId: file.account,
        sha256: file.sha256,
        ...(file.settings ? { settings: file.settings } : {}),
        ...(file.useSaved === false ? { useSaved: false } : {}),
        ...(file.skipInvalid ? { invalidRows: 'skip' } : {}),
      }),
      (id, payload) => executeScopedChange(opts, id, 'imports.file', payload),
    );
    const proposal = receipt.proposal as unknown as api.ImportFileProposal;
    const dates = proposal.after.added
      .map(row => String(row.date))
      .filter(d => DATE.test(d))
      .sort();
    for (const row of proposal.after.rows) {
      if (row.outcome === 'invalid') {
        ctx.unresolved({
          code: 'import-invalid-row',
          message: `Row ${row.index} of ${file.path} was not imported: ${(row.errors ?? []).join('; ')}`,
          accountId: file.account,
        });
      } else if (row.match?.kind === 'date_amount') {
        ctx.unresolved({
          code: 'import-ambiguous-match',
          message: `Row ${row.index} of ${file.path} matched an existing transaction by date and amount only.`,
          accountId: file.account,
          evidence: { transactionId: row.match.transactionId },
        });
      }
    }
    for (const category of proposal.after.summary.unresolvedCategories) {
      ctx.unresolved({
        code: 'import-unresolved-category',
        message: `Category "${category}" in ${file.path} did not match an existing category.`,
        accountId: file.account,
      });
    }
    return {
      status: 'committed' as const,
      result: {
        accountId: file.account,
        file: file.path,
        receipt: receiptSummary(receipt),
        summary: proposal.after.summary,
        dates: dates.length
          ? { start: dates[0], end: dates[dates.length - 1] }
          : null,
      },
    };
  }
  if (step.id === 'transfers') {
    const pairs = new Map<string, unknown>();
    let truncated = false;
    await withConnection(
      opts,
      async () => {
        for (const [account, range] of importedRanges(ctx.run)) {
          const found = await engine(() =>
            api.findTransferCandidates({ account, ...range }),
          );
          truncated ||= found.truncated;
          for (const candidate of found.candidates) {
            pairs.set(`${candidate.from.id}|${candidate.to.id}`, candidate);
          }
        }
      },
      { mutates: false },
    );
    for (const candidate of pairs.values()) {
      ctx.unresolved({
        code: 'transfer-candidate',
        message:
          'Possible transfer between imported rows; review with transfers match.',
        evidence: candidate,
      });
    }
    return {
      status: 'completed' as const,
      result: { candidates: pairs.size, truncated },
    };
  }
  if (step.id === 'review') {
    const ranges = [...importedRanges(ctx.run).values()];
    const start =
      intake.fromMonth ??
      (ranges.length
        ? ranges
            .map(r => r.start)
            .sort()[0]
            .slice(0, 7)
        : today().slice(0, 7));
    const end =
      intake.toMonth ??
      (ranges.length
        ? ranges
            .map(r => r.end)
            .sort()
            .reverse()[0]
            .slice(0, 7)
        : start);
    const accounts = [...new Set(intake.files.map(f => f.account))];
    return {
      status: 'completed' as const,
      result: {
        range: { fromMonth: start, toMonth: end },
        ...(await dataQuality(ctx, start, end, accounts)),
      },
    };
  }
  throw new AgentError('ENGINE_FAILURE', `Unknown intake step ${step.id}.`);
}

async function runWeeklyStep(step: WorkflowStep, ctx: StepContext) {
  const input = ctx.run.input as unknown as WeeklyInput;
  const opts = budgetOpts(ctx.opts, ctx.run);
  const month = input.asOf.slice(0, 7);
  if (step.id === 'data-quality') {
    return {
      status: 'completed' as const,
      result: {
        range: { fromMonth: addMonths(month, -1), toMonth: month },
        ...(await dataQuality(
          ctx,
          addMonths(month, -1),
          month,
          input.accounts,
        )),
      },
    };
  }
  if (step.id === 'schedules') {
    const end = new Date(`${input.asOf}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    let result!: Awaited<ReturnType<typeof api.inspectSchedules>>;
    await withConnection(
      opts,
      async () => {
        result = await engine(() =>
          api.inspectSchedules({
            start: input.asOf,
            end: end.toISOString().slice(0, 10),
          }),
        );
      },
      { mutates: false },
    );
    const due = result.schedules.filter(
      s => s.nextDate !== null && s.nextDate <= result.window.end,
    );
    for (const s of due.filter(s => s.status === 'missed')) {
      ctx.unresolved({
        code: 'schedule-missed',
        message: `Schedule ${s.name ?? s.id} is missed.`,
        accountId: s.account?.id ?? null,
      });
    }
    return {
      status: 'completed' as const,
      result: {
        window: result.window,
        due: due.map(s => ({
          id: s.id,
          name: s.name,
          nextDate: s.nextDate,
          status: s.status,
          amount: s.amount,
          accountId: s.account?.id ?? null,
        })),
      },
    };
  }
  if (step.id === 'bank-sync') {
    let status!: Awaited<ReturnType<typeof api.getBankSyncStatus>>;
    await withConnection(
      opts,
      async () => {
        status = await engine(() => api.getBankSyncStatus());
      },
      { mutates: false },
    );
    return { status: 'completed' as const, result: status };
  }
  throw new AgentError('ENGINE_FAILURE', `Unknown checkup step ${step.id}.`);
}

async function runCloseStep(step: WorkflowStep, ctx: StepContext) {
  const close = ctx.run.input as unknown as CloseInput;
  const opts = budgetOpts(ctx.opts, ctx.run);
  if (step.id === 'backup' && close.backupDirectory) {
    const created = await createBudgetBackup(opts, close.backupDirectory);
    ctx.run.artifacts.push({ kind: 'backup', path: created.path });
    return {
      status: 'completed' as const,
      result: { path: created.path, source: created.manifest.source },
    };
  }
  const reconcile = /^reconcile-(\d+)$/.exec(step.id);
  if (reconcile) {
    const statement = close.statements[Number(reconcile[1])];
    if (!step.payload) {
      let status!: Awaited<ReturnType<typeof api.getReconciliationStatus>>;
      await withConnection(
        opts,
        async () => {
          status = await engine(() =>
            api.getReconciliationStatus({
              accountId: statement.accountId,
              statementBalance: statement.endingBalance,
              statementDate: statement.date,
            }),
          );
        },
        { mutates: false },
      );
      const summary = {
        accountId: statement.accountId,
        statementBalance: statement.endingBalance,
        statementDate: statement.date,
        clearedBalance: status.clearedBalance,
        difference: status.difference,
        candidates: status.candidateIds.length,
        unclearedCount: status.unclearedCount,
      };
      if (!status.canFinish || status.difference !== 0) {
        ctx.unresolved({
          code: 'statement-unmatched',
          message: `Cleared balance differs from the statement by ${status.difference ?? 'an unknown amount'} cents; the account was not reconciled.`,
          accountId: statement.accountId,
          evidence: summary,
        });
        return { status: 'unresolved' as const, result: summary };
      }
      if (!close.finish) {
        ctx.unresolved({
          code: 'reconcile-not-authorized',
          message:
            'The statement matches, but this run was not authorized to finish reconciliation (--finish).',
          accountId: statement.accountId,
          evidence: summary,
        });
        return { status: 'unresolved' as const, result: summary };
      }
      // Freeze the candidate set the status read observed; a resume replays
      // this exact payload and receipt.
      step.operationId = `${ctx.run.runId}-${step.id}`;
      step.payload = {
        accountId: statement.accountId,
        statementBalance: statement.endingBalance,
        statementDate: statement.date,
        ids: status.candidateIds,
      };
      step.result = summary;
      await writeRun(ctx.dataDir, ctx.run);
    }
    const { receipt } = await mutate(
      step,
      ctx,
      () => step.payload ?? {},
      (id, payload) =>
        executeScopedChange(opts, id, 'reconcile.finish', payload),
    );
    return {
      status: 'committed' as const,
      result: {
        ...(step.result as Record<string, unknown>),
        receipt: receiptSummary(receipt),
      },
    };
  }
  if (step.id === 'review') {
    const extra = close.statements.map(s => ({
      accountId: s.accountId,
      month: close.month,
      endingBalance: s.endingBalance,
    }));
    return {
      status: 'completed' as const,
      result: await dataQuality(
        ctx,
        close.month,
        close.month,
        close.statements.length
          ? close.statements.map(s => s.accountId)
          : undefined,
        extra,
      ),
    };
  }
  throw new AgentError('ENGINE_FAILURE', `Unknown close step ${step.id}.`);
}

async function runGoalStep(step: WorkflowStep, ctx: StepContext) {
  const input = ctx.run.input as unknown as GoalInput;
  let saved!: Awaited<ReturnType<typeof api.inspectCashPlan>>;
  let scenario: Awaited<ReturnType<typeof api.inspectCashPlan>> | null = null;
  await withConnection(
    budgetOpts(ctx.opts, ctx.run),
    async () => {
      const range = {
        ...(input.start ? { startDate: input.start } : {}),
        ...(input.end ? { endDate: input.end } : {}),
      };
      saved = await engine(() => api.inspectCashPlan(range));
      if (input.scenario) {
        scenario = await engine(() =>
          api.inspectCashPlan({
            ...range,
            scenario: input.scenario as NonNullable<
              Parameters<typeof api.inspectCashPlan>[0]
            >['scenario'],
          }),
        );
      }
    },
    { mutates: false },
  );
  return {
    status: 'completed' as const,
    result: {
      saved,
      scenario,
      saveCommand:
        'Nothing was saved. Save a reviewed plan with cash-planning save or set-target/set-goal.',
    },
  };
}

function runStep(step: WorkflowStep, ctx: StepContext) {
  switch (ctx.run.workflow) {
    case 'setup':
      return runSetupStep(step, ctx);
    case 'intake':
      return runIntakeStep(step, ctx);
    case 'weekly-checkup':
      return runWeeklyStep(step, ctx);
    case 'monthly-close':
      return runCloseStep(step, ctx);
    case 'goal-review':
      return runGoalStep(step, ctx);
    default:
      throw new AgentError('INVALID_INPUT', 'Unknown workflow.');
  }
}

function errorOf(error: unknown) {
  return error instanceof AgentError
    ? { code: error.code, message: error.message }
    : {
        code: 'ENGINE_FAILURE',
        message: error instanceof Error ? error.message : String(error),
      };
}

// Advances a run through its pending (or previously failed) steps. Completed,
// committed and unresolved steps are never executed again. stopAfter pauses
// the run after the named step so it can be resumed later.
export async function advanceRun(
  opts: CliGlobalOpts,
  dataDir: string,
  run: WorkflowRun,
  stopAfter?: string,
) {
  if (stopAfter !== undefined && !run.steps.some(s => s.id === stopAfter)) {
    invalid(
      `--stop-after must name a step: ${run.steps.map(s => s.id).join(', ')}.`,
      'stopAfter',
    );
  }
  run.status = 'running';
  await writeRun(dataDir, run);
  for (const step of run.steps) {
    if (step.status !== 'pending' && step.status !== 'failed') continue;
    const ctx: StepContext = {
      opts,
      dataDir,
      run,
      unresolved: item => {
        run.unresolved = run.unresolved.filter(
          u =>
            !(
              u.step === step.id &&
              u.code === item.code &&
              u.message === item.message &&
              u.accountId === item.accountId &&
              JSON.stringify(u.evidence) === JSON.stringify(item.evidence)
            ),
        );
        run.unresolved.push({ step: step.id, ...item });
      },
    };
    // A retried step replaces its own earlier findings.
    run.unresolved = run.unresolved.filter(u => u.step !== step.id);
    try {
      const outcome = await runStep(step, ctx);
      step.status = outcome.status;
      step.result = outcome.result;
      delete step.error;
    } catch (error) {
      step.status = 'failed';
      step.error = errorOf(error);
      step.finishedAt = new Date().toISOString();
      run.status = 'failed';
      await writeRun(dataDir, run);
      throw new AgentError(
        'PARTIAL_COMPLETION',
        `Workflow step ${step.id} failed: ${step.error.message} Inspect the run, fix the cause and resume it.`,
        false,
        { runId: run.runId, step: step.id, cause: step.error },
      );
    }
    step.finishedAt = new Date().toISOString();
    await writeRun(dataDir, run);
    if (step.id === stopAfter) {
      run.status = 'paused';
      await writeRun(dataDir, run);
      return run;
    }
  }
  run.status = run.unresolved.length ? 'needs-review' : 'completed';
  await writeRun(dataDir, run);
  return run;
}

export function cancelRun(run: WorkflowRun) {
  if (!['running', 'paused', 'failed'].includes(run.status)) {
    invalid(`A ${run.status} run cannot be cancelled.`, 'runId');
  }
  for (const step of run.steps) {
    // A pending mutation with a fixed payload may have committed before a
    // crash; keep it visible so its receipt can be inspected.
    if (step.status === 'pending' && !step.payload) step.status = 'not-run';
  }
  run.status = 'cancelled';
  return run;
}

// Workflow-specific completion facts derived from the run record.
export function runSummary(run: WorkflowRun) {
  const operations = run.steps
    .filter(s => s.operationId && s.status === 'committed')
    .map(s => ({ step: s.id, operationId: s.operationId }));
  const summary: Record<string, unknown> = {
    complete: run.status === 'completed',
    operations,
    receiptsCommand: operations.length
      ? 'changes inspect <operation-id>'
      : null,
  };
  if (run.workflow === 'monthly-close') {
    const reconcile = run.steps.filter(s => s.id.startsWith('reconcile-'));
    // A close is complete only when every statement reconciled; review
    // findings alone keep the run in needs-review but do not undo that.
    summary.closeComplete =
      (run.status === 'completed' || run.status === 'needs-review') &&
      reconcile.length > 0 &&
      reconcile.every(s => s.status === 'committed');
  }
  return summary;
}

// Builds and persists a new run record (callers hold the run lock).
export async function createRun(
  dataDir: string,
  runId: string,
  workflow: WorkflowName,
  input: Record<string, unknown>,
  budget: WorkflowRun['budget'],
) {
  const now = new Date().toISOString();
  const run: WorkflowRun = {
    schemaVersion: 1,
    runId,
    workflow,
    budget,
    input,
    status: 'running',
    steps: planSteps(workflow, input),
    unresolved: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeRun(dataDir, run);
  return run;
}
