import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { resolveConfig } from '#config';
import {
  disableJob,
  enableJob,
  jobStatus,
  listJobs,
  readJob,
  runJob,
  saveJob,
  schedulerRecipes,
  validateJob,
} from '#jobs';
import { printOutput } from '#output';
import { parseIntFlag } from '#utils';

export function registerJobsCommand(program: Command) {
  const jobs = program
    .command('jobs')
    .description(
      'Saved intake automation: stable inbox files imported through resumable workflow runs, with local result artifacts and scheduler recipes',
    );

  jobs
    .command('create <name>')
    .description(
      'Save a job bound to the selected budget, the intake workflow, declared inbox/processed/error directories, filename routes and explicitly allowed mutations',
    )
    .requiredOption('--inbox <dir>', 'Directory the job reads files from')
    .requiredOption('--processed <dir>', 'Directory for imported files')
    .requiredOption('--error <dir>', 'Directory for files that failed')
    .requiredOption(
      '--routes <json>',
      '[{"match":"^checking-.*\\\\.csv$","account":"<id>","settings":{...}}] (first match wins)',
    )
    .requiredOption(
      '--allow <mutations>',
      'Comma-separated mutations the job may perform (imports.file)',
    )
    .option(
      '--allow-cross-account',
      'Allow importing a file whose identical content was imported into another account',
    )
    .option(
      '--stable-seconds <seconds>',
      'Only import files unmodified for this long (0-86400)',
      '30',
    )
    .action(
      async (
        name: string,
        cmdOpts: {
          inbox: string;
          processed: string;
          error: string;
          routes: string;
          allow: string;
          allowCrossAccount?: boolean;
          stableSeconds: string;
        },
      ) => {
        const opts = program.opts();
        const resolved = await resolveConfig(opts);
        let routes: unknown;
        try {
          routes = JSON.parse(cmdOpts.routes);
        } catch {
          throw new AgentError(
            'INVALID_INPUT',
            '--routes must be JSON.',
            false,
            {
              field: 'routes',
            },
          );
        }
        const job = validateJob({
          name,
          budget: {
            syncId: resolved.syncId ?? null,
            budgetId: resolved.syncId ? null : (resolved.budgetId ?? null),
          },
          inbox: cmdOpts.inbox,
          processed: cmdOpts.processed,
          error: cmdOpts.error,
          routes,
          allow: cmdOpts.allow
            .split(',')
            .map(m => m.trim())
            .filter(Boolean),
          allowCrossAccount: cmdOpts.allowCrossAccount === true,
          stableSeconds: parseIntFlag(
            cmdOpts.stableSeconds,
            '--stable-seconds',
          ),
        });
        await saveJob(resolved.dataDir, job, true);
        printOutput(job, opts.format);
      },
    );

  jobs
    .command('list')
    .description('Saved jobs on this device')
    .action(async () => {
      const opts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      printOutput(await listJobs(dataDir), opts.format);
    });

  jobs
    .command('status <name>')
    .description(
      'Job definition, inbox file states (ready, pending, no route, duplicate, cross-account review), active run and last result; read-only',
    )
    .action(async (name: string) => {
      const opts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      printOutput(await jobStatus(dataDir, name), opts.format);
    });

  jobs
    .command('run <name>')
    .description(
      'Run once: resume an interrupted run, or import stable routed inbox files through a workflow run and move them to processed/error; --dry-run previews only',
    )
    .option('--dry-run', 'Preview imports and moves without changing anything')
    .option(
      '--stop-after <step>',
      'Pause the workflow run after this step (resumed by the next jobs run)',
    )
    .action(
      async (
        name: string,
        cmdOpts: { dryRun?: boolean; stopAfter?: string },
      ) => {
        const opts = program.opts();
        const { dataDir } = await resolveConfig(opts);
        printOutput(
          await runJob(opts, dataDir, name, {
            dryRun: cmdOpts.dryRun === true,
            stopAfter: cmdOpts.stopAfter,
          }),
          opts.format,
        );
      },
    );

  jobs
    .command('disable <name>')
    .description(
      'Stop future runs; cancel a paused or failed active run, keeping its committed imports',
    )
    .action(async (name: string) => {
      const opts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      printOutput(await disableJob(dataDir, name), opts.format);
    });

  jobs
    .command('enable <name>')
    .description('Allow a disabled job to run again')
    .action(async (name: string) => {
      const opts = program.opts();
      const { dataDir } = await resolveConfig(opts);
      printOutput(await enableJob(dataDir, name), opts.format);
    });

  jobs
    .command('schedule <name>')
    .description(
      'Print cron, systemd timer and Windows Task Scheduler recipes for jobs run; installs nothing',
    )
    .option('--every <minutes>', 'Interval in minutes (1-59)', '15')
    .option('--executable <path>', 'CLI executable', 'actual')
    .action(
      async (name: string, cmdOpts: { every: string; executable: string }) => {
        const opts = program.opts();
        const { dataDir } = await resolveConfig(opts);
        const minutes = parseIntFlag(cmdOpts.every, '--every');
        if (minutes < 1 || minutes > 59) {
          throw new AgentError('INVALID_INPUT', '--every must be 1-59.');
        }
        printOutput(
          schedulerRecipes(await readJob(dataDir, name), {
            executable: cmdOpts.executable,
            minutes,
            dataDir,
          }),
          opts.format,
        );
      },
    );
}
