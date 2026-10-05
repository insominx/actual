import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import {
  executeCatalogChange,
  executeScheduleCreation,
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
}
