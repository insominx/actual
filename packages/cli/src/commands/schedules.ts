import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import {
  executeCatalogChange,
  executeScheduleCreation,
  executeScopedChange,
} from '#guarded-changes';
import { readJsonInput } from '#input';
import { printOutput } from '#output';

export function registerSchedulesCommand(program: Command) {
  const schedules = program
    .command('schedules')
    .description('Manage scheduled transactions');

  schedules
    .command('list')
    .description('List all schedules')
    .action(async () => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          const result = await api.getSchedules();
          printOutput(result, opts.format);
        },
        { mutates: false },
      );
    });

  schedules
    .command('create')
    .description('Create a new schedule')
    .option('--data <json>', 'Schedule definition as JSON')
    .option('--file <path>', 'Read schedule from JSON file (use - for stdin)')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async cmdOpts => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        if (!cmdOpts.operationId) {
          throw new AgentError(
            'INVALID_INPUT',
            'Version 2 schedule creation requires --operation-id for durable retry.',
            false,
            { field: 'operationId' },
          );
        }
        printOutput(
          await executeScheduleCreation(
            opts,
            cmdOpts.operationId,
            readJsonInput(cmdOpts) as api.ScheduleCreationRequest,
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          const schedule = readJsonInput(cmdOpts) as Parameters<
            typeof api.createSchedule
          >[0];
          const id = await api.createSchedule(schedule);
          printOutput({ id }, opts.format);
        },
        { mutates: true },
      );
    });

  schedules
    .command('update <id>')
    .description('Update a schedule')
    .option('--data <json>', 'Fields to update as JSON')
    .option('--file <path>', 'Read fields from JSON file (use - for stdin)')
    .option('--reset-next-date', 'Reset next occurrence date', false)
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (id: string, cmdOpts) => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        if (!cmdOpts.operationId) {
          throw new AgentError(
            'INVALID_INPUT',
            'Version 2 schedule update requires --operation-id for durable retry.',
            false,
            { field: 'operationId' },
          );
        }
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'schedules.update',
            id,
            {
              fields: readJsonInput(cmdOpts),
              ...(cmdOpts.resetNextDate ? { resetNextDate: true } : {}),
            },
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          const fields = readJsonInput(cmdOpts) as Parameters<
            typeof api.updateSchedule
          >[1];
          await api.updateSchedule(id, fields, cmdOpts.resetNextDate);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });

  schedules
    .command('delete <id>')
    .description('Delete a schedule')
    .option('--operation-id <id>', 'Required for version 2; durable retry ID')
    .action(async (id: string, cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      if (opts.outputVersion === '2') {
        printOutput(
          await executeCatalogChange(
            opts,
            cmdOpts.operationId,
            'schedules.delete',
            id,
            {},
          ),
          opts.format,
        );
        return;
      }
      await withConnection(
        opts,
        async () => {
          await api.deleteSchedule(id);
          printOutput({ success: true, id }, opts.format);
        },
        { mutates: true },
      );
    });
  const inspect = async (request: api.ScheduleInspectionRequest) => {
    const opts = program.opts();
    await withConnection(
      opts,
      async () => {
        let result;
        try {
          result = await api.inspectSchedules(request);
        } catch (error) {
          throw new AgentError(
            'INVALID_INPUT',
            error instanceof Error ? error.message : String(error),
          );
        }
        printOutput(result, opts.format);
      },
      { mutates: false },
    );
  };

  schedules
    .command('inspect <id>')
    .description(
      'Show one schedule: status, next date, amount rule, transfer, and its occurrences and posted transactions in a window (default today through 30 days)',
    )
    .option('--start <date>', 'Window start YYYY-MM-DD')
    .option(
      '--end <date>',
      'Window end YYYY-MM-DD (at most 3 years after start)',
    )
    .action(async (id: string, cmdOpts: { start?: string; end?: string }) => {
      await inspect({
        id,
        includeCompleted: true,
        ...(cmdOpts.start ? { start: cmdOpts.start } : {}),
        ...(cmdOpts.end ? { end: cmdOpts.end } : {}),
      });
    });

  schedules
    .command('upcoming')
    .description(
      'List schedule occurrences in a window (default today through 30 days) with missed, due, upcoming and paid status',
    )
    .option('--start <date>', 'Window start YYYY-MM-DD')
    .option(
      '--end <date>',
      'Window end YYYY-MM-DD (at most 3 years after start)',
    )
    .option('--account <id>', 'Only schedules for this account')
    .option('--include-completed', 'Include completed schedules', false)
    .action(
      async (cmdOpts: {
        start?: string;
        end?: string;
        account?: string;
        includeCompleted?: boolean;
      }) => {
        await inspect({
          ...(cmdOpts.start ? { start: cmdOpts.start } : {}),
          ...(cmdOpts.end ? { end: cmdOpts.end } : {}),
          ...(cmdOpts.account ? { account: cmdOpts.account } : {}),
          ...(cmdOpts.includeCompleted ? { includeCompleted: true } : {}),
        });
      },
    );

  schedules
    .command('post <id>')
    .description(
      "Post the schedule's next occurrence as a transaction through a guarded change, as the app's Post transaction does (rules run; transfer schedules add the counterpart)",
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--date <date>', 'The next occurrence date being posted')
    .option(
      '--today',
      'Date the transaction today instead of the occurrence date',
    )
    .action(
      async (
        id: string,
        cmdOpts: { operationId?: string; date: string; today?: boolean },
      ) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'schedules.post',
            {
              id,
              date: cmdOpts.date,
              ...(cmdOpts.today ? { today: true } : {}),
            },
          ),
          opts.format,
        );
      },
    );

  schedules
    .command('skip <id>')
    .description(
      "Skip the schedule's next occurrence through a guarded change (advances the next date; no transaction is added)",
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--date <date>', 'The next occurrence date being skipped')
    .action(
      async (id: string, cmdOpts: { operationId?: string; date: string }) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'schedules.skip',
            {
              id,
              date: cmdOpts.date,
            },
          ),
          opts.format,
        );
      },
    );
}
