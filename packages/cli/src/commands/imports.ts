import { resolve } from 'node:path';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { withConnection } from '#connection';
import { executeScopedChange } from '#guarded-changes';
import { printOutput } from '#output';

function parseSettings(value: string | undefined) {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      '--settings must be a JSON object.',
      false,
      { field: 'settings' },
    );
  }
}

function parseLimit(value: string) {
  const limit = Number(value);
  if (!Number.isInteger(limit)) {
    throw new AgentError('INVALID_INPUT', 'limit must be an integer.', false, {
      field: 'limit',
    });
  }
  return limit;
}

export function registerImportsCommand(program: Command) {
  const imports = program
    .command('imports')
    .description(
      'Inspect import files with the import dialog parser and manage saved per-account import mappings',
    );

  for (const [verb, description, defaultLimit] of [
    [
      'inspect',
      'Report format, hash, columns, date range and row-level errors for an import file without importing (shows the first rows)',
      '20',
    ],
    [
      'parse',
      'Return the normalized transaction candidates of an import file without importing',
      '1000',
    ],
  ] as const) {
    imports
      .command(`${verb} <file>`)
      .description(description)
      .option(
        '--account <id>',
        "Apply this account's saved import settings (and validate it exists)",
      )
      .option('--no-saved', 'Ignore saved settings for the account')
      .option(
        '--settings <json>',
        'Override settings: fields, dateFormat, delimiter, encoding, hasHeaderRow, skipStartLines, skipEndLines, inOutMode, outValue, flipAmount, swapPayeeAndMemo, fallbackMissingPayeeToMemo, multiplier',
      )
      .option('--limit <n>', 'Rows to return (0-1000)', defaultLimit)
      .action(
        async (
          file: string,
          cmdOpts: {
            account?: string;
            saved: boolean;
            settings?: string;
            limit: string;
          },
        ) => {
          const opts = program.opts();
          const settings = parseSettings(cmdOpts.settings);
          const limit = parseLimit(cmdOpts.limit);
          await withConnection(
            opts,
            async () => {
              printOutput(
                await api.inspectImportFile({
                  path: resolve(file),
                  ...(cmdOpts.account ? { account: cmdOpts.account } : {}),
                  useSaved: cmdOpts.saved,
                  ...(settings ? { settings } : {}),
                  limit,
                }),
                opts.format,
              );
            },
            { mutates: false },
          );
        },
      );
  }

  const mappings = imports
    .command('mappings')
    .description(
      'Saved per-account import settings (the import dialog synced preferences)',
    );

  mappings
    .command('get')
    .description("Show an account's saved import settings for a file format")
    .requiredOption('--account <id>', 'Account ID')
    .option('--format <format>', 'csv, qif, ofx, qfx or xml', 'csv')
    .action(async (cmdOpts: { account: string; format: string }) => {
      const opts = program.opts();
      await withConnection(
        opts,
        async () => {
          printOutput(
            await api.getImportMapping(cmdOpts.account, cmdOpts.format),
            opts.format,
          );
        },
        { mutates: false },
      );
    });

  mappings
    .command('set')
    .description(
      "Save import settings for an account and format (guarded; becomes the import dialog's default)",
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--account <id>', 'Account ID')
    .option('--format <format>', 'csv, qif, ofx, qfx or xml', 'csv')
    .requiredOption(
      '--settings <json>',
      'Settings to store; a null value clears that setting',
    )
    .action(
      async (cmdOpts: {
        operationId?: string;
        account: string;
        format: string;
        settings: string;
      }) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'imports.mapping-save',
            {
              account: cmdOpts.account,
              format: cmdOpts.format,
              settings: parseSettings(cmdOpts.settings),
            },
          ),
          opts.format,
        );
      },
    );

  mappings
    .command('reset')
    .description(
      'Clear every saved import setting for an account and format (guarded)',
    )
    .option('--operation-id <id>', 'Required; durable retry ID')
    .requiredOption('--account <id>', 'Account ID')
    .option('--format <format>', 'csv, qif, ofx, qfx or xml', 'csv')
    .action(
      async (cmdOpts: {
        operationId?: string;
        account: string;
        format: string;
      }) => {
        const opts = program.opts();
        printOutput(
          await executeScopedChange(
            opts,
            cmdOpts.operationId,
            'imports.mapping-save',
            { account: cmdOpts.account, format: cmdOpts.format, reset: true },
          ),
          opts.format,
        );
      },
    );
}
