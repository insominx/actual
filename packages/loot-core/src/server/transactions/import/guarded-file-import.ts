// Guarded import of one statement file into one account. The file is parsed
// with the import dialog's mapping rules (inspect-file), then the normalized
// rows go through the canonical import owner (reconcileTransactions) exactly
// as transactions.import does. The proposal freezes the file hash, resolved
// settings and options, so a changed file, mapping or preference makes the
// prepared import stale instead of being replayed.
import { matchTransactions } from '#server/accounts/sync';
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
} from '#server/guarded-proposal';
import {
  performTransactionImport,
  planTransactionImport,
} from '#server/transactions/guarded-import';
import { parseCategoryFields } from '#shared/import-mapping';
import * as monthUtils from '#shared/months';
import type {
  ImportFileProposal,
  ImportFileRequest,
  ImportFileRowOutcome,
  TransactionImportProposal,
} from '#types/change-proposals';

import { inspectImportFile } from './inspect-file';

const KEYS = [
  'path',
  'accountId',
  'settings',
  'useSaved',
  'sha256',
  'invalidRows',
  'opts',
  'maxFuzzyDayGap',
  'updateMatched',
];
const OPT_KEYS = [
  'defaultCleared',
  'reimportDeleted',
  'payeeNameNormalization',
];
const ROW_LIMIT = 1000;

// The normalized transactions behind a prepared proposal. guardedApply hands
// the freshly prepared proposal to perform, so they are never re-derived.
const prepared = new WeakMap<
  ImportFileProposal,
  Array<Record<string, unknown>>
>();

function invalid(message: string): never {
  throw APIError(`Invalid file import request: ${message}`);
}

function validate(request: ImportFileRequest) {
  if (typeof request !== 'object' || request === null) {
    invalid('provide path and accountId');
  }
  for (const key of Object.keys(request)) {
    if (!KEYS.includes(key)) invalid(`unknown field ${key}`);
  }
  if (typeof request.path !== 'string' || !request.path) {
    invalid('path is required');
  }
  if (typeof request.accountId !== 'string' || !request.accountId) {
    invalid('accountId is required');
  }
  if (request.useSaved !== undefined && typeof request.useSaved !== 'boolean') {
    invalid('useSaved must be a boolean');
  }
  if (
    request.sha256 !== undefined &&
    (typeof request.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(request.sha256))
  ) {
    invalid('sha256 must be 64 lowercase hex characters');
  }
  if (
    request.invalidRows !== undefined &&
    request.invalidRows !== 'reject' &&
    request.invalidRows !== 'skip'
  ) {
    invalid('invalidRows must be reject or skip');
  }
  if (
    request.maxFuzzyDayGap !== undefined &&
    (!Number.isInteger(request.maxFuzzyDayGap) ||
      request.maxFuzzyDayGap < 0 ||
      request.maxFuzzyDayGap > 7)
  ) {
    invalid('maxFuzzyDayGap must be a whole number of days from 0 to 7');
  }
  if (
    request.updateMatched !== undefined &&
    typeof request.updateMatched !== 'boolean'
  ) {
    invalid('updateMatched must be a boolean');
  }
  const opts = request.opts;
  if (opts !== undefined) {
    if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
      invalid('opts must be an object');
    }
    for (const key of Object.keys(opts)) {
      if (!OPT_KEYS.includes(key)) invalid(`unknown option ${key}`);
    }
    for (const key of ['defaultCleared', 'reimportDeleted'] as const) {
      if (opts[key] !== undefined && typeof opts[key] !== 'boolean') {
        invalid(`${key} must be a boolean`);
      }
    }
    if (
      opts.payeeNameNormalization !== undefined &&
      opts.payeeNameNormalization !== 'original' &&
      opts.payeeNameNormalization !== 'title-case'
    ) {
      invalid('payeeNameNormalization must be original or title-case');
    }
  }
}

// Days between a row and its date/amount match, or null for an imported_id
// match or no match.
function fuzzyDayGap(
  matched: Awaited<ReturnType<typeof matchTransactions>>,
  position: number,
  date: unknown,
) {
  const match = matched.transactionsStep3[position]?.match as
    | { date?: number }
    | null
    | undefined;
  if (
    !match ||
    match.date == null ||
    matched.transactionsStep1[position]?.match
  ) {
    return null;
  }
  return Math.abs(
    monthUtils.differenceInCalendarDays(
      db.fromDateRepr(match.date),
      String(date),
    ),
  );
}

// The file import dialog's per-account choice, not the bank sync one
async function accountReimportsDeleted(accountId: string) {
  const row = await db.first<{ value: string }>(
    'SELECT value FROM preferences WHERE id = ?',
    [`import-reimport-deleted-${accountId}`],
  );
  return String(row?.value ?? 'true') === 'true';
}

export async function prepareFileImport(
  request: ImportFileRequest,
): Promise<ImportFileProposal> {
  validate(request);
  const account = await db.first<{ closed: number }>(
    'SELECT closed FROM accounts WHERE id = ? AND tombstone = 0',
    [request.accountId],
  );
  if (!account || account.closed) {
    throw APIError('Files can only be imported into a live open account');
  }
  const inspection = await inspectImportFile({
    path: request.path,
    account: request.accountId,
    ...(request.useSaved === undefined ? {} : { useSaved: request.useSaved }),
    ...(request.settings === undefined ? {} : { settings: request.settings }),
    limit: ROW_LIMIT,
  });
  if (request.sha256 && inspection.file.sha256 !== request.sha256) {
    throw APIError(
      `Import file changed: expected sha256 ${request.sha256}, found ${inspection.file.sha256}`,
    );
  }
  if (inspection.truncated) {
    throw APIError(
      `Import file has ${inspection.rowCount} rows; one import takes at most ${ROW_LIMIT}`,
    );
  }
  if (inspection.parseErrors.length) {
    throw APIError(
      `Import file could not be parsed: ${inspection.parseErrors.join('; ')}`,
    );
  }
  if (!inspection.rowCount) throw APIError('Import file has no rows');
  const invalidRows = request.invalidRows ?? 'reject';
  const bad = inspection.rows.filter(row => !row.transaction);
  if (bad.length && invalidRows === 'reject') {
    throw APIError(
      `${bad.length} of ${inspection.rowCount} rows are invalid (${bad
        .slice(0, 5)
        .map(row => `row ${row.index}: ${row.errors.join(', ')}`)
        .join('; ')}); fix the mapping or pass invalidRows skip`,
    );
  }

  const categories = await db.all<{ id: string; name: string }>(
    'SELECT id, name FROM categories WHERE tombstone = 0',
  );
  const unresolved = new Set<string>();
  const valid = inspection.rows.filter(row => row.transaction);
  if (!valid.length) throw APIError('Import file has no valid rows');
  const transactions = valid.map(({ transaction }) => {
    const candidate = transaction!;
    const row: Record<string, unknown> = {
      date: candidate.date,
      amount: candidate.amount,
    };
    for (const key of [
      'payee_name',
      'imported_payee',
      'notes',
      'imported_id',
    ] as const) {
      if (candidate[key] != null) row[key] = candidate[key];
    }
    if (candidate.category != null) {
      const id = parseCategoryFields(
        { category: candidate.category },
        categories,
      );
      if (id) row.category = id;
      else unresolved.add(candidate.category);
    }
    return row;
  });

  const options = {
    defaultCleared: request.opts?.defaultCleared ?? true,
    reimportDeleted:
      request.opts?.reimportDeleted ??
      (await accountReimportsDeleted(request.accountId)),
    payeeNameNormalization:
      request.opts?.payeeNameNormalization ?? 'title-case',
    invalidRows,
    ...(request.maxFuzzyDayGap === undefined
      ? {}
      : { maxFuzzyDayGap: request.maxFuzzyDayGap }),
    ...(request.updateMatched === false
      ? { updateMatched: false as const }
      : {}),
  } as const;
  const importRequest = {
    accountId: request.accountId,
    transactions,
    opts: {
      defaultCleared: options.defaultCleared,
      reimportDeleted: options.reimportDeleted,
      payeeNameNormalization: options.payeeNameNormalization,
    },
  };
  let planned;
  let matched: Awaited<ReturnType<typeof matchTransactions>>;
  const forced = new Set<number>();
  try {
    matched = await matchTransactions(
      request.accountId,
      structuredClone(transactions),
      {
        reimportDeleted: options.reimportDeleted,
        payeeNameNormalization: options.payeeNameNormalization,
      },
    );
    // A fuzzy match farther than the limit is a different transaction (a
    // weekly transfer of the same amount, for example): add the row instead.
    // The flag travels with the rows, so apply re-plans the same way.
    if (request.maxFuzzyDayGap !== undefined) {
      valid.forEach((row, position) => {
        const gap = fuzzyDayGap(matched, position, row.transaction!.date);
        if (gap !== null && gap > request.maxFuzzyDayGap!) {
          forced.add(position);
          transactions[position].forceAddTransaction = true;
        }
      });
    }
    // Leave matched transactions as they are: a skipped row still takes part
    // in matching, so the other rows match exactly as previewed.
    if (request.updateMatched === false) {
      valid.forEach((_, position) => {
        if (
          matched.transactionsStep3[position]?.match &&
          !forced.has(position)
        ) {
          transactions[position].skipTransaction = true;
        }
      });
    }
    planned = await planTransactionImport(importRequest);
  } catch (error) {
    if (error instanceof Error) throw APIError(error.message);
    throw error;
  }
  const updatedIds = new Set(planned.updated.map(row => String(row.id)));
  const rows: ImportFileRowOutcome[] = inspection.rows.map(row => ({
    index: row.index,
    outcome: 'invalid',
    match: null,
    errors: row.errors,
  }));
  valid.forEach((row, position) => {
    const step3 = matched.transactionsStep3[position];
    const match = step3?.match as
      | { id: string; date?: number; reconciled?: number; tombstone?: number }
      | null
      | undefined;
    const target = rows.find(r => r.index === row.index)!;
    delete target.errors;
    if (!match) {
      target.outcome = 'add';
      return;
    }
    const kind = matched.transactionsStep1[position]?.match
      ? 'imported_id'
      : matched.transactionsStep2[position]?.match
        ? 'payee_date_amount'
        : 'date_amount';
    target.match = { kind, transactionId: match.id };
    // Fuzzy matches reach 7 days either way, so a recurring same-amount
    // transaction (a weekly transfer) can claim a different row. Report the
    // distance so a reviewer can tell those from true duplicates.
    const dayGap = fuzzyDayGap(matched, position, row.transaction!.date);
    if (dayGap) target.match.dayGap = dayGap;
    if (forced.has(position)) {
      target.match.forcedAdd = true;
      target.outcome = 'add';
      return;
    }
    target.outcome = match.reconciled
      ? 'reconciled'
      : match.tombstone
        ? 'deleted'
        : updatedIds.has(match.id)
          ? 'update'
          : 'duplicate';
  });
  const newPayees = new Set<string>();
  for (const row of [...planned.added, ...planned.updated]) {
    const payee = row.payee as { newPayee?: string } | null;
    if (payee && typeof payee === 'object' && payee.newPayee) {
      newPayees.add(payee.newPayee);
    }
  }
  const count = (outcome: ImportFileRowOutcome['outcome']) =>
    rows.filter(row => row.outcome === outcome).length;
  const proposal: ImportFileProposal = {
    schemaVersion: 1,
    operation: 'imports.file',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      file: inspection.file,
      settings: inspection.settings,
      sources: inspection.sources,
    },
    after: {
      added: planned.added,
      updated: planned.updated,
      rows,
      summary: {
        rowCount: inspection.rowCount,
        add: count('add'),
        update: count('update'),
        duplicate: count('duplicate'),
        reconciled: count('reconciled'),
        deleted: count('deleted'),
        invalid: count('invalid'),
        newPayees: [...newPayees].sort(),
        unresolvedCategories: [...unresolved].sort(),
      },
      options,
    },
    references: {},
    sideEffects: [
      'import the valid rows through the canonical import owner: matched rows are updated, unmatched rows are inserted after running rules, and payees that do not exist are created',
      'duplicate matching is heuristic except for imported_id matches; date/amount matches are listed per row',
    ],
  };
  prepared.set(proposal, transactions);
  return proposal;
}

export async function performFileImport(current: ImportFileProposal) {
  const transactions = prepared.get(current);
  if (!transactions) {
    throw new Error('File import was not prepared in this session');
  }
  const synthesized: TransactionImportProposal = {
    schemaVersion: 1,
    operation: 'transactions.import',
    budget: current.budget,
    request: {
      accountId: current.request.accountId,
      transactions,
      opts: {
        defaultCleared: current.after.options.defaultCleared,
        reimportDeleted: current.after.options.reimportDeleted,
        payeeNameNormalization: current.after.options.payeeNameNormalization,
      },
    },
    before: { sourceHash: current.before.sourceHash },
    after: { added: current.after.added, updated: current.after.updated },
    references: {},
    sideEffects: [],
  };
  const result = await performTransactionImport(synthesized);
  return {
    changed: result.changed,
    affectedIds: result.affectedIds,
    fileImport: {
      sha256: current.before.file.sha256,
      addedIds: result.transactionImport.addedIds,
      updatedIds: result.transactionImport.updatedIds,
    },
  };
}
