import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

type BatchEntry = {
  file: string;
  account: string;
  settings?: Record<string, unknown>;
  useSaved?: boolean;
  skipInvalid?: boolean;
};

function readManifest(path: string): Array<BatchEntry & { path: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      'The batch manifest must be a readable JSON file.',
      false,
      { field: 'manifest' },
    );
  }
  const entries = Array.isArray(parsed) ? parsed : null;
  if (
    !entries ||
    entries.length < 1 ||
    entries.length > 20 ||
    entries.some(
      entry =>
        typeof entry !== 'object' ||
        entry === null ||
        Object.keys(entry).some(
          key =>
            ![
              'file',
              'account',
              'settings',
              'useSaved',
              'skipInvalid',
            ].includes(key),
        ) ||
        typeof entry.file !== 'string' ||
        typeof entry.account !== 'string' ||
        !(
          entry.settings === undefined ||
          (typeof entry.settings === 'object' &&
            entry.settings !== null &&
            !Array.isArray(entry.settings))
        ) ||
        !(
          entry.useSaved === undefined || typeof entry.useSaved === 'boolean'
        ) ||
        !(
          entry.skipInvalid === undefined ||
          typeof entry.skipInvalid === 'boolean'
        ),
    )
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'The batch manifest is an array of 1-20 entries with file, account and optional settings, useSaved and skipInvalid.',
      false,
      { field: 'manifest' },
    );
  }
  const base = dirname(resolve(path));
  return (entries as BatchEntry[]).map(entry => ({
    ...entry,
    path: resolve(base, entry.file),
  }));
}

function batchRequest(
  entry: BatchEntry & { path: string },
  cmdOpts: FileImportOptions,
): api.ImportFileRequest {
  const shared = fileImportRequest(entry.path, {
    ...cmdOpts,
    account: entry.account,
    saved: entry.useSaved ?? true,
    settings: undefined,
    skipInvalid: entry.skipInvalid,
  });
  return entry.settings ? { ...shared, settings: entry.settings } : shared;
}

// Rows of a later file that an earlier file in the same batch also carries
// for the same account. After the earlier file commits they are matched as
// duplicates; a dry run cannot show that because each preview reads the
// current ledger only.
function batchOverlaps(proposals: Array<api.ImportFileProposal | null>) {
  const seen = new Map<string, { file: number; index: number }>();
  const overlaps: Array<{
    file: number;
    index: number;
    earlierFile: number;
    earlierIndex: number;
    key: 'imported_id' | 'date_amount_payee';
  }> = [];
  proposals.forEach((proposal, file) => {
    if (!proposal) return;
    const account = proposal.request.accountId;
    proposal.after.rows.forEach(row => {
      if (row.outcome !== 'add') return;
      const added = proposal.after.added.filter(r => !r.is_child);
      const position = proposal.after.rows
        .filter(r => r.outcome === 'add')
        .indexOf(row);
      const tx = added[position];
      if (!tx) return;
      const keys: Array<[string, 'imported_id' | 'date_amount_payee']> = [];
      if (tx.imported_id) {
        keys.push([`${account}|id|${String(tx.imported_id)}`, 'imported_id']);
      }
      keys.push([
        `${account}|${String(tx.date)}|${String(tx.amount)}|${String(tx.imported_payee ?? '')}`,
        'date_amount_payee',
      ]);
      for (const [key, kind] of keys) {
        const earlier = seen.get(key);
        if (earlier && earlier.file !== file) {
          overlaps.push({
            file,
            index: row.index,
            earlierFile: earlier.file,
            earlierIndex: earlier.index,
            key: kind,
          });
          return;
        }
      }
      for (const [key] of keys) {
        if (!seen.has(key)) seen.set(key, { file, index: row.index });
      }
    });
  });
  return overlaps;
}

async function transferReview(proposals: Array<api.ImportFileProposal | null>) {
  const accounts = new Map<string, { start: string; end: string }>();
  for (const proposal of proposals) {
    if (!proposal) continue;
    for (const row of proposal.after.added) {
      const date = String(row.date);
      const range = accounts.get(proposal.request.accountId);
      if (!range) {
        accounts.set(proposal.request.accountId, { start: date, end: date });
      } else {
        if (date < range.start) range.start = date;
        if (date > range.end) range.end = date;
      }
    }
  }
  const pairs = new Map<string, unknown>();
  let truncated = false;
  for (const [account, range] of accounts) {
    const found = await api.findTransferCandidates({
      account,
      start: range.start,
      end: range.end,
    });
    truncated ||= found.truncated;
    for (const candidate of found.candidates) {
      pairs.set(`${candidate.from.id}|${candidate.to.id}`, candidate);
    }
  }
  return { candidates: [...pairs.values()], truncated };
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
        let proposal;
        try {
          proposal = await api.previewFileImport(request);
        } catch (error) {
          // The engine rejects unreadable files, invalid rows and stale
          // hashes with an explanatory message; surface it as input error.
          throw new AgentError(
            'INVALID_INPUT',
            error instanceof Error ? error.message : String(error),
          );
        }
        printOutput(proposal, opts.format);
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
    .command('batch <manifest>')
    .description(
      'Import several files (a JSON manifest of file, account, settings) one guarded change per file, stopping at the first failure; then list transfer candidates among the imported rows',
    )
    .option(
      '--operation-id <id>',
      'Required unless --dry-run; file N uses <id>-N so a retry returns stored receipts',
    )
    .option('--dry-run', 'Preview every file without writing')
    .option('--reimport-deleted', 'Reimport rows whose match was deleted')
    .option(
      '--no-reimport-deleted',
      'Skip rows whose imported ID matches a deleted transaction',
    )
    .option('--uncleared', 'Import new rows as uncleared (default: cleared)')
    .option(
      '--payee-names <mode>',
      'Payee name normalization: title-case (default) or original',
    )
    .action(
      async (
        manifest: string,
        cmdOpts: Omit<FileImportOptions, 'account' | 'saved'> & {
          operationId?: string;
          dryRun?: boolean;
        },
      ) => {
        const opts = program.opts();
        const entries = readManifest(manifest);
        const shared = { ...cmdOpts, account: '', saved: true };
        const requests = entries.map(entry => batchRequest(entry, shared));
        if (cmdOpts.dryRun) {
          await withConnection(
            opts,
            async () => {
              const files = [];
              const proposals: Array<api.ImportFileProposal | null> = [];
              for (const [index, request] of requests.entries()) {
                try {
                  const proposal = await api.previewFileImport(request);
                  proposals.push(proposal);
                  files.push({
                    index,
                    path: request.path,
                    accountId: request.accountId,
                    status: 'previewed',
                    sha256: proposal.before.file.sha256,
                    summary: proposal.after.summary,
                  });
                } catch (error) {
                  proposals.push(null);
                  files.push({
                    index,
                    path: request.path,
                    accountId: request.accountId,
                    status: 'rejected',
                    message:
                      error instanceof Error ? error.message : String(error),
                  });
                }
              }
              printOutput(
                {
                  mode: 'dry-run',
                  files,
                  overlaps: batchOverlaps(proposals),
                  transferReview: null,
                  notes: [
                    'Each preview reads the current ledger; rows listed in overlaps are expected to match as duplicates once the earlier file is imported.',
                    'Transfer candidates are listed after a real import, when the new rows exist.',
                  ],
                },
                opts.format,
              );
            },
            { mutates: false },
          );
          return;
        }
        if (!cmdOpts.operationId) {
          throw new AgentError(
            'INVALID_INPUT',
            'imports batch requires --operation-id unless --dry-run is given.',
            false,
            { field: 'operationId' },
          );
        }
        if (cmdOpts.operationId.length > 76) {
          throw new AgentError(
            'INVALID_INPUT',
            'The batch operation ID must be at most 76 characters.',
            false,
            { field: 'operationId' },
          );
        }
        validateOperationId(cmdOpts.operationId);
        const files: Array<Record<string, unknown>> = [];
        const proposals: Array<api.ImportFileProposal | null> = [];
        let failed: AgentError | null = null;
        for (const [index, request] of requests.entries()) {
          const operationId = `${cmdOpts.operationId}-${index + 1}`;
          if (failed) {
            files.push({
              index,
              path: request.path,
              accountId: request.accountId,
              operationId,
              status: 'not-attempted',
            });
            continue;
          }
          try {
            const { receipt } = await executeScopedChange(
              opts,
              operationId,
              'imports.file',
              request,
            );
            const proposal = receipt.proposal as api.ImportFileProposal;
            const outcome = receipt.outcome as api.ImportFileOutcome;
            proposals.push(proposal);
            files.push({
              index,
              path: request.path,
              accountId: request.accountId,
              operationId,
              status: 'committed',
              state: receipt.state,
              sha256: proposal.before.file.sha256,
              summary: proposal.after.summary,
              ...(outcome.status === 'committed-local'
                ? {
                    addedIds: outcome.fileImport.addedIds,
                    updatedIds: outcome.fileImport.updatedIds,
                  }
                : {}),
            });
          } catch (error) {
            failed =
              error instanceof AgentError
                ? error
                : new AgentError(
                    'ENGINE_FAILURE',
                    error instanceof Error ? error.message : String(error),
                  );
            files.push({
              index,
              path: request.path,
              accountId: request.accountId,
              operationId,
              status: 'failed',
              code: failed.code,
              message: failed.message,
            });
          }
        }
        let review: Awaited<ReturnType<typeof transferReview>> | null = null;
        if (proposals.length) {
          await withConnection(
            opts,
            async () => {
              review = await transferReview(proposals);
            },
            { mutates: false },
          );
        }
        const result = {
          mode: 'apply',
          files,
          transferReview: review,
        };
        if (failed) {
          throw new AgentError(
            'PARTIAL_COMPLETION',
            `File ${files.findIndex(f => f.status === 'failed') + 1} of ${files.length} failed (${failed.code}); earlier files are committed and later files were not attempted. Inspect the failed file with imports preview, then rerun with the same --operation-id.`,
            false,
            result,
          );
        }
        printOutput(result, opts.format);
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
