import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { executeCatalogChange } from '#guarded-changes';
import { printOutput } from '#output';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type TargetOptions = {
  account?: string;
  category?: string;
  group?: string;
  month?: string;
};

// Maps the convenience flags onto Actual's note ID conventions. Exactly one
// target is required: a raw note ID, --account, --group, --category (with an
// optional --month for the category's month note) or --month alone for the
// budget month note.
export function noteIdFromOptions(
  raw: string | undefined,
  options: TargetOptions,
): string {
  const { account, category, group, month } = options;
  if (month !== undefined && !MONTH.test(month)) {
    throw new AgentError('INVALID_INPUT', 'Month must be YYYY-MM.', false, {
      field: 'month',
    });
  }
  const targets = [
    raw !== undefined,
    account !== undefined,
    category !== undefined,
    group !== undefined,
    month !== undefined && category === undefined,
  ].filter(Boolean).length;
  if (targets !== 1) {
    throw new AgentError(
      'INVALID_INPUT',
      'Provide exactly one note target: <note-id>, --account, --group, --category [--month] or --month.',
      false,
      { field: 'target' },
    );
  }
  if (raw !== undefined) {
    if (!raw.trim()) {
      throw new AgentError('INVALID_INPUT', 'Note ID is empty.', false, {
        field: 'id',
      });
    }
    return raw;
  }
  if (account !== undefined) return `account-${account}`;
  if (group !== undefined) return group;
  if (category !== undefined) {
    return month === undefined ? category : `${category}-${month}`;
  }
  return `budget-${month}`;
}

function addTargetOptions(command: Command) {
  return command
    .option('--account <id>', 'Account note')
    .option('--category <id>', 'Category note (with --month: its month note)')
    .option('--group <id>', 'Category group note')
    .option('--month <month>', 'Budget month note (YYYY-MM)');
}

export function registerNotesCommand(program: Command) {
  const notes = program
    .command('notes')
    .description('Read and change account, category, group and month notes');

  addTargetOptions(
    notes
      .command('get [note-id]')
      .description(
        'Read a note and the live entity it belongs to; a missing note returns null and writes nothing',
      ),
  ).action(async (raw: string | undefined, cmdOpts: TargetOptions) => {
    const opts = program.opts();
    const id = noteIdFromOptions(raw, cmdOpts);
    await withConnection(
      opts,
      async () => {
        const result = await api.getNoteTarget(id);
        printOutput({ id, ...result }, opts.format);
      },
      { mutates: false },
    );
  });

  addTargetOptions(
    notes
      .command('set [note-id]')
      .description(
        'Replace a note through a guarded change with a durable receipt',
      )
      .option('--operation-id <id>', 'Required; durable retry ID')
      .option('--note <text>', 'New note text')
      .option('--clear', 'Replace the note with empty text'),
  ).action(
    async (
      raw: string | undefined,
      cmdOpts: TargetOptions & {
        operationId?: string;
        note?: string;
        clear?: boolean;
      },
    ) => {
      const opts = program.opts();
      if ((cmdOpts.note === undefined) === !cmdOpts.clear) {
        throw new AgentError(
          'INVALID_INPUT',
          'Provide exactly one of --note or --clear.',
          false,
          { field: 'note' },
        );
      }
      const id = noteIdFromOptions(raw, cmdOpts);
      printOutput(
        await executeCatalogChange(opts, cmdOpts.operationId, 'notes.set', id, {
          note: cmdOpts.clear ? '' : cmdOpts.note,
        }),
        opts.format,
      );
    },
  );
}
