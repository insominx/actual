import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { resolveConfig } from '#config';
import type { CliGlobalOpts } from '#config';
import { printOutput } from '#output';
import {
  listRuns,
  newRunId,
  readRun,
  runExists,
  validateRunId,
  withRunLock,
  writeRun,
} from '#workflow-runs';
import type { WorkflowName, WorkflowRun } from '#workflow-runs';
import {
  advanceRun,
  cancelRun,
  planSteps,
  runSummary,
  validateClose,
  validateIntake,
  validateSetup,
} from '#workflows';

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AgentError('INVALID_INPUT', `--${field} must be JSON.`, false, {
      field,
    });
  }
}

function readJsonFile(path: string, field: string): unknown {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new AgentError('INVALID_INPUT', `${field} cannot be read.`, false, {
      field,
    });
  }
  return parseJson(text, field);
}

function output(run: WorkflowRun) {
  return { ...run, summary: runSummary(run) };
}

async function start(
  program: Command,
  workflow: WorkflowName,
  input: Record<string, unknown>,
  cmdOpts: { runId?: string; stopAfter?: string },
  { needsBudget = true } = {},
) {
  const opts: CliGlobalOpts = program.opts();
  const resolved = await resolveConfig(opts);
  const budget = {
    syncId: resolved.syncId ?? null,
    budgetId: resolved.syncId ? null : (resolved.budgetId ?? null),
  };
  if (needsBudget && !budget.syncId && !budget.budgetId) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Select a budget with --sync-id or --budget-id.',
    );
  }
  const runId = cmdOpts.runId ?? newRunId();
  validateRunId(runId);
  await withRunLock(resolved.dataDir, runId, async () => {
    if (await runExists(resolved.dataDir, runId)) {
      throw new AgentError(
        'INVALID_INPUT',
        'A workflow run with this ID exists. Use workflow run resume.',
        false,
        { field: 'runId' },
      );
    }
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
    await writeRun(resolved.dataDir, run);
    printOutput(
      output(await advanceRun(opts, resolved.dataDir, run, cmdOpts.stopAfter)),
      opts.format,
    );
  });
}

function runOptions(command: Command) {
  return command
    .option(
      '--run-id <id>',
      'Explicit run ID (wf- plus lowercase letters/digits); default generated',
    )
    .option(
      '--stop-after <step>',
      'Pause the run after this step; continue with workflow run resume',
    );
}

export function registerWorkflowCommand(program: Command) {
  const workflow = program
    .command('workflow')
    .description(
      'Fixed multi-step workflows over the same typed operations as the CLI commands, with device-local resumable run records',
    );

  runOptions(
    workflow
      .command('setup')
      .description(
        'Create a new local budget (optional), accounts and category groups/categories, one guarded change per item',
      )
      .requiredOption(
        '--spec <json>',
        '{"budgetName":"Household","accounts":[{"name":"Checking","offbudget":false,"initialBalance":0}],"categoryGroups":[{"name":"Bills","categories":["Rent"]}]}',
      ),
  ).action(
    async (cmdOpts: { spec: string; runId?: string; stopAfter?: string }) => {
      const spec = validateSetup(parseJson(cmdOpts.spec, 'spec'));
      const resolved = await resolveConfig(program.opts());
      if (spec.budgetName && (resolved.syncId || resolved.budgetId)) {
        throw new AgentError(
          'INVALID_INPUT',
          'budgetName creates a new budget; do not also select one with --sync-id or --budget-id.',
          false,
          { field: 'budgetName' },
        );
      }
      await start(
        program,
        'setup',
        spec as unknown as Record<string, unknown>,
        cmdOpts,
        { needsBudget: !spec.budgetName },
      );
    },
  );

  runOptions(
    workflow
      .command('intake <manifest>')
      .description(
        'Import several files (manifest of file, account, settings) as guarded changes bound to their hashes, then review transfer candidates and data quality',
      )
      .option('--from-month <month>', 'Review range start YYYY-MM')
      .option('--to-month <month>', 'Review range end YYYY-MM'),
  ).action(
    async (
      manifest: string,
      cmdOpts: {
        fromMonth?: string;
        toMonth?: string;
        runId?: string;
        stopAfter?: string;
      },
    ) => {
      const path = resolve(manifest);
      const input = validateIntake(
        readJsonFile(path, 'manifest'),
        dirname(path),
        cmdOpts,
      );
      await start(
        program,
        'intake',
        input as unknown as Record<string, unknown>,
        cmdOpts,
      );
    },
  );

  runOptions(
    workflow
      .command('weekly-checkup')
      .description(
        'Read-only: data quality for the last two months, schedules due in the next 7 days and bank sync status',
      )
      .option('--as-of <date>', 'Reference date YYYY-MM-DD (default today)')
      .option('--accounts <ids>', 'Comma-separated account IDs'),
  ).action(
    async (cmdOpts: {
      asOf?: string;
      accounts?: string;
      runId?: string;
      stopAfter?: string;
    }) => {
      const d = new Date();
      const asOf =
        cmdOpts.asOf ??
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
        throw new AgentError('INVALID_INPUT', '--as-of must be YYYY-MM-DD.');
      }
      const accounts = cmdOpts.accounts
        ?.split(',')
        .map(id => id.trim())
        .filter(Boolean);
      await start(
        program,
        'weekly-checkup',
        { asOf, ...(accounts?.length ? { accounts } : {}) },
        cmdOpts,
      );
    },
  );

  runOptions(
    workflow
      .command('monthly-close')
      .description(
        'Optional backup, reconcile each account against its statement (finish only with --finish and a zero difference), then a data-quality review; incomplete reconciliation leaves the close incomplete',
      )
      .requiredOption('--month <month>', 'Month to close YYYY-MM')
      .requiredOption(
        '--statements <json>',
        '[{"accountId":"...","endingBalance":123456,"date":"2026-09-30"}] (date defaults to month end)',
      )
      .option(
        '--finish',
        'Authorize reconcile finish for accounts whose difference is zero',
      )
      .option('--backup-directory <path>', 'Create a backup artifact first'),
  ).action(
    async (cmdOpts: {
      month: string;
      statements: string;
      finish?: boolean;
      backupDirectory?: string;
      runId?: string;
      stopAfter?: string;
    }) => {
      const input = validateClose({
        month: cmdOpts.month,
        statements: parseJson(cmdOpts.statements, 'statements'),
        finish: cmdOpts.finish === true,
        backupDirectory: cmdOpts.backupDirectory,
      });
      await start(
        program,
        'monthly-close',
        input as unknown as Record<string, unknown>,
        cmdOpts,
      );
    },
  );

  runOptions(
    workflow
      .command('goal-review')
      .description(
        'Read-only: the saved cash plan and an optional transient scenario side by side; saves nothing',
      )
      .option(
        '--scenario <json>',
        'Transient overrides (as cash-planning inspect)',
      )
      .option('--start <date>', 'History start YYYY-MM-DD')
      .option('--end <date>', 'History end YYYY-MM-DD'),
  ).action(
    async (cmdOpts: {
      scenario?: string;
      start?: string;
      end?: string;
      runId?: string;
      stopAfter?: string;
    }) => {
      const scenario =
        cmdOpts.scenario === undefined
          ? undefined
          : parseJson(cmdOpts.scenario, 'scenario');
      if (
        scenario !== undefined &&
        (typeof scenario !== 'object' ||
          scenario === null ||
          Array.isArray(scenario))
      ) {
        throw new AgentError('INVALID_INPUT', '--scenario must be an object.');
      }
      await start(
        program,
        'goal-review',
        {
          ...(scenario ? { scenario } : {}),
          ...(cmdOpts.start ? { start: cmdOpts.start } : {}),
          ...(cmdOpts.end ? { end: cmdOpts.end } : {}),
        },
        cmdOpts,
      );
    },
  );

  const run = workflow
    .command('run')
    .description('Inspect, list, resume or cancel device-local workflow runs');

  run
    .command('list')
    .description('Workflow runs on this device, latest first')
    .option('--limit <count>', 'Maximum runs (1-100)', '20')
    .action(async (cmdOpts: { limit: string }) => {
      const opts = program.opts();
      const limit = Number(cmdOpts.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new AgentError(
          'INVALID_INPUT',
          'limit must be an integer from 1 to 100.',
        );
      }
      const { dataDir } = await resolveConfig(opts);
      printOutput(await listRuns(dataDir, limit), opts.format);
    });

  run
    .command('inspect <runId>')
    .description('A run record: steps, operation IDs, unresolved items')
    .action(async (runId: string) => {
      const opts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      printOutput(output(await readRun(dataDir, runId)), opts.format);
    });

  run
    .command('resume <runId>')
    .description(
      'Continue a paused or failed run; committed steps are not repeated and interrupted mutations replay their receipts',
    )
    .option('--stop-after <step>', 'Pause again after this step')
    .action(async (runId: string, cmdOpts: { stopAfter?: string }) => {
      const opts: CliGlobalOpts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      await withRunLock(dataDir, runId, async () => {
        const record = await readRun(dataDir, runId);
        if (!['running', 'paused', 'failed'].includes(record.status)) {
          throw new AgentError(
            'INVALID_INPUT',
            `A ${record.status} run cannot be resumed.`,
            false,
            { field: 'runId' },
          );
        }
        printOutput(
          output(await advanceRun(opts, dataDir, record, cmdOpts.stopAfter)),
          opts.format,
        );
      });
    });

  run
    .command('cancel <runId>')
    .description(
      'Stop a paused or failed run; committed steps and their receipts stay as they are',
    )
    .action(async (runId: string) => {
      const opts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      await withRunLock(dataDir, runId, async () => {
        const record = cancelRun(await readRun(dataDir, runId));
        await writeRun(dataDir, record);
        printOutput(output(record), opts.format);
      });
    });
}
