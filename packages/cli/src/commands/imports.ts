import { resolve } from 'node:path';

import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { AgentError } from '#agent-output';
import { validateOperationId, withChangeJournal } from '#change-journal';
import { withConnection } from '#connection';
import { executeScopedChange, resolveGuardConfig } from '#guarded-changes';
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

type FileImportOptions = {
  account: string;
  saved: boolean;
  settings?: string;
  skipInvalid?: boolean;
  reimportDeleted?: boolean;
  uncleared?: boolean;
  payeeNames?: string;
  expectSha256?: string;
};

function fileImportRequest(
  file: string,
  cmdOpts: FileImportOptions,
): api.ImportFileRequest {
  const settings = parseSettings(cmdOpts.settings);
  if (
    cmdOpts.payeeNames !== undefined &&
    cmdOpts.payeeNames !== 'original' &&
    cmdOpts.payeeNames !== 'title-case'
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      '--payee-names must be original or title-case.',
      false,
      { field: 'payeeNames' },
    );
  }
  const opts: NonNullable<api.ImportFileRequest['opts']> = {};
  if (cmdOpts.uncleared) opts.defaultCleared = false;
  if (cmdOpts.reimportDeleted !== undefined) {
    opts.reimportDeleted = cmdOpts.reimportDeleted;
  }
  if (cmdOpts.payeeNames) {
    opts.payeeNameNormalization = cmdOpts.payeeNames;
  }
  return {
    path: resolve(file),
    accountId: cmdOpts.account,
    ...(cmdOpts.saved === false ? { useSaved: false } : {}),
    ...(settings ? { settings } : {}),
    ...(cmdOpts.expectSha256 ? { sha256: cmdOpts.expectSha256 } : {}),
    ...(cmdOpts.skipInvalid ? { invalidRows: 'skip' as const } : {}),
    ...(Object.keys(opts).length ? { opts } : {}),
  };
}

function fileImportOptions(command: Command) {
  return command
    .requiredOption('--account <id>', 'Account ID to import into')
    .option('--no-saved', 'Ignore saved import settings for the account')
    .option(
      '--settings <json>',
      'Override import settings (same keys as imports inspect)',
    )
    .option(
      '--skip-invalid',
      'Import the valid rows and list invalid ones (default: reject the file)',
    )
    .option('--reimport-deleted', 'Reimport rows whose match was deleted')
    .option(
      '--no-reimport-deleted',
      'Skip rows whose imported ID matches a deleted transaction',
    )
    .option('--uncleared', 'Import new rows as uncleared (default: cleared)')
    .option(
      '--payee-names <mode>',
      'Payee name normalization: title-case (default) or original',
    );
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

  fileImportOptions(
    imports
      .command('preview <file>')
      .description(
        'Plan importing a file into an account: per-row add, update, duplicate, reconciled, deleted or invalid outcome, match evidence, rule results and new payees. Writes nothing',
      ),
  ).action(async (file: string, cmdOpts: FileImportOptions) => {
    const opts = program.opts();
    const request = fileImportRequest(file, cmdOpts);
    await withConnection(
      opts,
      async () => {
        printOutput(await api.previewFileImport(request), opts.format);
      },
      { mutates: false },
    );
  });

  fileImportOptions(
    imports
      .command('apply <file>')
      .description(
        'Import a file into an account through a guarded change bound to the file hash, settings and options',
      )
      .option('--operation-id <id>', 'Required; durable retry ID')
      .option(
        '--expect-sha256 <hash>',
        'Reject the import unless the file still has this SHA-256 (from imports preview)',
      ),
  ).action(
    async (
      file: string,
      cmdOpts: FileImportOptions & { operationId?: string },
    ) => {
      const opts = program.opts();
      printOutput(
        await executeScopedChange(
          opts,
          cmdOpts.operationId,
          'imports.file',
          fileImportRequest(file, cmdOpts),
        ),
        opts.format,
      );
    },
  );

  imports
    .command('history')
    .description(
      'List file imports recorded in this device-local change journal (hash, settings, options, outcome)',
    )
    .option('--operation-id <id>', 'Show one import')
    .action(async (cmdOpts: { operationId?: string }) => {
      const opts = program.opts();
      if (cmdOpts.operationId) validateOperationId(cmdOpts.operationId);
      const resolved = await resolveGuardConfig(opts);
      await withChangeJournal(
        resolved.dataDir,
        resolved.lockTimeout,
        async journal => {
          const listed = await journal.list(500);
          const items = listed.items
            .filter(
              receipt =>
                receipt.proposal.operation === 'imports.file' &&
                (!cmdOpts.operationId ||
                  receipt.operationId === cmdOpts.operationId),
            )
            .map(receipt => {
              const proposal = receipt.proposal as api.ImportFileProposal;
              const outcome = receipt.outcome as
                | api.ImportFileOutcome
                | undefined;
              return {
                operationId: receipt.operationId,
                state: receipt.state,
                createdAt: receipt.createdAt,
                updatedAt: receipt.updatedAt,
                accountId: proposal.request.accountId,
                path: proposal.request.path,
                file: proposal.before.file,
                settings: proposal.before.settings,
                options: proposal.after.options,
                planned: proposal.after.summary,
                result:
                  outcome && outcome.status === 'committed-local'
                    ? {
                        added: outcome.fileImport.addedIds.length,
                        updated: outcome.fileImport.updatedIds.length,
                      }
                    : outcome && outcome.status === 'rejected'
                      ? { rejected: outcome.code, message: outcome.message }
                      : null,
              };
            });
          if (cmdOpts.operationId && !items.length) {
            throw new AgentError(
              'MISSING_CONTEXT',
              'No file import with this operation ID is in the local journal.',
            );
          }
          printOutput(
            { items, total: items.length, journalTruncated: listed.truncated },
            opts.format,
          );
        },
      );
    });

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
