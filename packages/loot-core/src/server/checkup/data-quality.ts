// Read-only data-quality checkup for agents. Findings carry a stable code,
// severity, the record IDs involved, the evidence that produced them, how
// certain they are, and the supported operations that could address them.
// Nothing here writes: remediation is always a separate, previewed domain
// operation. Coverage separates months with observed rows, months backed by
// user-declared statement evidence, and months with neither (unknown); a
// month with no rows is never called complete without statement evidence.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import { auditTransfers } from '#server/transfers/inspect';
import * as monthUtils from '#shared/months';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 60;
const ID_LIMIT = 100;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export type StatementEvidence = {
  accountId: string;
  month: string;
  endingBalance?: number | null;
  noActivity?: boolean;
  source?: string | null;
};

export type DataQualityRequest = {
  start: string;
  end: string;
  accountIds?: string[];
  statements?: StatementEvidence[];
  duplicateWindowDays?: number;
  limit?: number;
};

export type FindingSeverity = 'error' | 'warning' | 'info';

export type FindingCode =
  | 'uncategorized'
  | 'deleted-category'
  | 'duplicate-candidate'
  | 'transfer-issue'
  | 'statement-discrepancy'
  | 'coverage-unknown';

export type SuggestedOperation = {
  operation: string;
  command: string;
};

export type DataQualityFinding = {
  code: FindingCode;
  severity: FindingSeverity;
  accountId: string | null;
  ids: string[];
  idsTruncated: boolean;
  count: number;
  evidence: Record<string, unknown>;
  uncertainty: string;
  suggested: SuggestedOperation[];
};

export type CoverageStatus =
  | 'observed'
  | 'statement-verified'
  | 'discrepancy'
  | 'unknown';

export type CoverageMonth = {
  month: string;
  status: CoverageStatus;
  rows: number;
  statement: {
    endingBalance: number | null;
    noActivity: boolean;
    source: string | null;
    ledgerBalance: number;
    matches: boolean;
  } | null;
};

type LeafRow = {
  id: string;
  account: string;
  date: number;
  amount: number;
  category: string | null;
  category_name: string | null;
  category_tombstone: number | null;
  payee: string | null;
  payee_name: string | null;
  transfer_acct: string | null;
  transfer_offbudget: number | null;
  imported_id: string | null;
  is_child: number;
  parent_id: string | null;
  starting_balance_flag: number;
};

type AccountRow = {
  id: string;
  name: string;
  offbudget: number;
  closed: number;
};

function invalid(message: string): never {
  throw APIError(`Invalid checkup request: ${message}`);
}

function validate(request: DataQualityRequest) {
  const allowed = [
    'start',
    'end',
    'accountIds',
    'statements',
    'duplicateWindowDays',
    'limit',
  ];
  if (
    typeof request !== 'object' ||
    request === null ||
    Object.keys(request).some(key => !allowed.includes(key))
  ) {
    invalid(`provide only ${allowed.join(', ')}`);
  }
  if (
    typeof request.start !== 'string' ||
    typeof request.end !== 'string' ||
    !MONTH.test(request.start) ||
    !MONTH.test(request.end) ||
    request.end < request.start
  ) {
    invalid('start and end must be YYYY-MM with end on or after start');
  }
  const months = monthUtils.rangeInclusive(request.start, request.end);
  if (months.length > MAX_MONTHS) invalid(`at most ${MAX_MONTHS} months`);
  if (
    request.accountIds !== undefined &&
    (!Array.isArray(request.accountIds) ||
      !request.accountIds.every(id => typeof id === 'string' && id))
  ) {
    invalid('accountIds must be a list of IDs');
  }
  const window = request.duplicateWindowDays ?? 3;
  if (!Number.isSafeInteger(window) || window < 0 || window > 14) {
    invalid('duplicateWindowDays must be an integer from 0 to 14');
  }
  const limit = request.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    invalid(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  const statements = request.statements ?? [];
  if (!Array.isArray(statements)) invalid('statements must be a list');
  const seen = new Set<string>();
  for (const s of statements) {
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof s.accountId !== 'string' ||
      !s.accountId ||
      typeof s.month !== 'string' ||
      !MONTH.test(s.month) ||
      (s.endingBalance !== undefined &&
        s.endingBalance !== null &&
        !Number.isSafeInteger(s.endingBalance)) ||
      (s.noActivity !== undefined && typeof s.noActivity !== 'boolean') ||
      (s.source !== undefined &&
        s.source !== null &&
        typeof s.source !== 'string')
    ) {
      invalid(
        'each statement needs accountId, month YYYY-MM, and an integer endingBalance or noActivity',
      );
    }
    if (
      (s.endingBalance === undefined || s.endingBalance === null) &&
      !s.noActivity
    ) {
      invalid('each statement needs an endingBalance or noActivity: true');
    }
    const key = `${s.accountId}:${s.month}`;
    if (seen.has(key)) invalid(`duplicate statement for ${key}`);
    seen.add(key);
  }
  return { months, window, limit, statements };
}

function bounded(ids: string[]) {
  return {
    ids: ids.slice(0, ID_LIMIT),
    idsTruncated: ids.length > ID_LIMIT,
    count: ids.length,
  };
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export async function dataQualityCheckup(request: DataQualityRequest) {
  const { months, window, limit, statements } = validate(request);
  const allAccounts = await db.all<AccountRow>(
    'SELECT id, name, offbudget, closed FROM accounts WHERE tombstone = 0 ORDER BY sort_order, id',
  );
  const known = new Set(allAccounts.map(a => a.id));
  for (const id of [
    ...(request.accountIds ?? []),
    ...statements.map(s => s.accountId),
  ]) {
    if (!known.has(id)) throw APIError(`Account does not exist: ${id}`);
  }
  // Closed accounts are checked only when named explicitly.
  const accounts = request.accountIds
    ? allAccounts.filter(a => request.accountIds?.includes(a.id))
    : allAccounts.filter(a => !a.closed);
  const scoped = new Set(accounts.map(a => a.id));
  const startDay = monthUtils.firstDayOfMonth(request.start);
  const endDay = monthUtils.lastDayOfMonth(request.end);
  const rows = (
    await db.all<LeafRow>(
      `SELECT t.id, t.account, t.date, t.amount, t.category,
              c.name AS category_name, c.tombstone AS category_tombstone,
              t.payee, p.name AS payee_name, p.transfer_acct,
              ta.offbudget AS transfer_offbudget, t.imported_id, t.is_child,
              t.parent_id, t.starting_balance_flag
       FROM v_transactions_internal_alive t
       LEFT JOIN payees p ON p.id = t.payee
       LEFT JOIN accounts ta ON ta.id = p.transfer_acct
       LEFT JOIN categories c ON c.id = t.category
       WHERE t.is_parent = 0 AND t.date >= ? AND t.date <= ?
       ORDER BY t.date, t.id`,
      [db.toDateRepr(startDay), db.toDateRepr(endDay)],
    )
  ).filter(row => scoped.has(row.account));
  const offBudget = new Map(allAccounts.map(a => [a.id, Boolean(a.offbudget)]));
  const findings: DataQualityFinding[] = [];

  // Uncategorized: on-budget leaf rows that need a category. Transfers
  // between two on-budget accounts never take one, so they are excluded.
  const needsCategory = (row: LeafRow) =>
    !offBudget.get(row.account) &&
    !(row.transfer_acct && !row.transfer_offbudget);
  const uncategorized = rows.filter(
    row => needsCategory(row) && !row.category && !row.starting_balance_flag,
  );
  if (uncategorized.length) {
    findings.push({
      code: 'uncategorized',
      severity: 'warning',
      accountId: null,
      ...bounded(uncategorized.map(r => r.id)),
      evidence: {
        total: uncategorized.reduce((sum, r) => sum + r.amount, 0),
        firstDate: db.fromDateRepr(uncategorized[0].date),
        lastDate: db.fromDateRepr(uncategorized[uncategorized.length - 1].date),
      },
      uncertainty: 'exact: these on-budget rows have no category',
      suggested: [
        {
          operation: 'transactions.categorize',
          command:
            'actual transactions categorize --ids <id,id> --category <id> --operation-id <unique-id>',
        },
      ],
    });
  }

  // Rows still pointing at a deleted category.
  const byDeleted = new Map<string, LeafRow[]>();
  for (const row of rows) {
    if (row.category && row.category_tombstone) {
      byDeleted.set(row.category, [
        ...(byDeleted.get(row.category) ?? []),
        row,
      ]);
    }
  }
  for (const [category, list] of byDeleted) {
    findings.push({
      code: 'deleted-category',
      severity: 'warning',
      accountId: null,
      ...bounded(list.map(r => r.id)),
      evidence: {
        categoryId: category,
        categoryName: list[0].category_name,
        total: list.reduce((sum, r) => sum + r.amount, 0),
      },
      uncertainty:
        'exact: the category is deleted; history keeps it until recategorized',
      suggested: [
        {
          operation: 'transactions.categorize',
          command:
            'actual transactions categorize --ids <id,id> --category <id> --operation-id <unique-id>',
        },
      ],
    });
  }

  // Duplicate candidates: top-level rows in one account with the same
  // amount within the window. Split children and transfers are left out.
  const topLevel = rows.filter(
    row => !row.is_child && !row.transfer_acct && !row.starting_balance_flag,
  );
  const groups = new Map<string, LeafRow[]>();
  for (const row of topLevel) {
    const key = `${row.account}:${row.amount}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const gap = monthUtils.differenceInCalendarDays(
          db.fromDateRepr(b.date),
          db.fromDateRepr(a.date),
        );
        if (gap > window) break;
        if (a.imported_id && b.imported_id && a.imported_id !== b.imported_id) {
          // Two distinct bank IDs are separate bank records.
          continue;
        }
        const samePayee = a.payee === b.payee;
        findings.push({
          code: 'duplicate-candidate',
          severity: 'info',
          accountId: a.account,
          ...bounded([a.id, b.id]),
          evidence: {
            amount: a.amount,
            dates: [db.fromDateRepr(a.date), db.fromDateRepr(b.date)],
            dateGapDays: gap,
            payees: [a.payee_name, b.payee_name],
            importedIds: [a.imported_id, b.imported_id],
            samePayee,
          },
          uncertainty: `heuristic: same account and amount within ${window} days${
            samePayee ? ' and the same payee' : ''
          }; repeat purchases look the same`,
          suggested: [
            {
              operation: 'transactions.merge',
              command:
                'actual transactions merge --ids <id>,<id> --operation-id <unique-id>',
            },
            {
              operation: 'transactions.delete',
              command:
                'actual transactions delete <id> --operation-id <unique-id>',
            },
          ],
        });
      }
    }
  }

  // Transfer link problems from the transfer audit (0019).
  const audit = await auditTransfers();
  for (const inspection of audit.findings) {
    const t = inspection.transaction;
    if (!t.account || !scoped.has(t.account.id)) continue;
    if (t.date < startDay || t.date > endDay) continue;
    findings.push({
      code: 'transfer-issue',
      severity: 'error',
      accountId: t.account.id,
      ...bounded(
        [t.id, inspection.counterpart?.id].filter(
          (id): id is string => typeof id === 'string',
        ),
      ),
      evidence: {
        issues: inspection.issues,
        repair: inspection.repair,
        amount: t.amount,
        date: t.date,
      },
      uncertainty: 'exact: the link fails the engine transfer invariants',
      suggested:
        inspection.repair === 'none'
          ? [
              {
                operation: 'transfers.inspect',
                command: `actual transfers inspect ${t.id}`,
              },
            ]
          : [
              {
                operation: 'transfers.repair',
                command: `actual transfers repair ${t.id} --operation-id <unique-id>`,
              },
            ],
    });
  }

  // Statement evidence and coverage.
  const statementByKey = new Map(
    statements.map(s => [`${s.accountId}:${s.month}`, s]),
  );
  const countRows = await db.all<{ account: string; month: string; n: number }>(
    `SELECT account, substr(CAST(date AS TEXT), 1, 6) AS month, COUNT(*) AS n
     FROM v_transactions_internal_alive
     WHERE is_child = 0 AND date >= ? AND date <= ?
     GROUP BY account, month`,
    [db.toDateRepr(startDay), db.toDateRepr(endDay)],
  );
  const counts = new Map(
    countRows.map(r => [
      `${r.account}:${r.month.slice(0, 4)}-${r.month.slice(4, 6)}`,
      r.n,
    ]),
  );
  async function balanceAt(account: string, day: string) {
    const row = await db.first<{ balance: number | null }>(
      `SELECT SUM(amount) AS balance FROM v_transactions_internal_alive
       WHERE is_child = 0 AND account = ? AND date <= ?`,
      [account, db.toDateRepr(day)],
    );
    return row?.balance ?? 0;
  }
  const coverage = [];
  const coverageAccounts = [
    ...accounts,
    ...allAccounts.filter(
      a => !scoped.has(a.id) && statements.some(s => s.accountId === a.id),
    ),
  ];
  for (const account of coverageAccounts) {
    const accountMonths = [
      ...new Set([
        ...months,
        ...statements.filter(s => s.accountId === account.id).map(s => s.month),
      ]),
    ].sort();
    const out: CoverageMonth[] = [];
    for (const month of accountMonths) {
      const key = `${account.id}:${month}`;
      const n = months.includes(month)
        ? (counts.get(key) ?? 0)
        : ((
            await db.first<{ n: number }>(
              `SELECT COUNT(*) AS n FROM v_transactions_internal_alive
               WHERE is_child = 0 AND account = ? AND date >= ? AND date <= ?`,
              [
                account.id,
                db.toDateRepr(monthUtils.firstDayOfMonth(month)),
                db.toDateRepr(monthUtils.lastDayOfMonth(month)),
              ],
            )
          )?.n ?? 0);
      const evidence = statementByKey.get(key);
      let statement: CoverageMonth['statement'] = null;
      let status: CoverageStatus = n > 0 ? 'observed' : 'unknown';
      if (evidence) {
        const ledgerBalance = await balanceAt(
          account.id,
          monthUtils.lastDayOfMonth(month),
        );
        const monthRows = n;
        const endingBalance = evidence.endingBalance ?? null;
        const balanceMatches =
          endingBalance === null || endingBalance === ledgerBalance;
        const activityMatches = !evidence.noActivity || monthRows === 0;
        const matches = balanceMatches && activityMatches;
        statement = {
          endingBalance,
          noActivity: Boolean(evidence.noActivity),
          source: evidence.source ?? null,
          ledgerBalance,
          matches,
        };
        status = matches ? 'statement-verified' : 'discrepancy';
        if (!matches) {
          findings.push({
            code: 'statement-discrepancy',
            severity: 'error',
            accountId: account.id,
            ...bounded([]),
            evidence: {
              month,
              statementBalance: endingBalance,
              ledgerBalance,
              difference:
                endingBalance === null ? null : endingBalance - ledgerBalance,
              noActivity: Boolean(evidence.noActivity),
              rows: monthRows,
              source: evidence.source ?? null,
            },
            uncertainty:
              'exact against user-declared statement evidence; the statement itself is not bank-verified',
            suggested: [
              {
                operation: 'reconcile.status',
                command: `actual reconcile status ${account.id} --date ${monthUtils.lastDayOfMonth(month)}${
                  endingBalance === null ? '' : ` --balance ${endingBalance}`
                }`,
              },
              {
                operation: 'imports.preview',
                command:
                  'actual imports preview <file> --account ' + account.id,
              },
            ],
          });
        }
      }
      out.push({ month, status, rows: n, statement });
    }
    const unknown = out.filter(m => m.status === 'unknown').map(m => m.month);
    if (unknown.length) {
      findings.push({
        code: 'coverage-unknown',
        severity: 'info',
        accountId: account.id,
        ...bounded([]),
        evidence: { months: unknown },
        uncertainty:
          'unknown: no rows and no statement evidence; the months may have no activity or missing imports',
        suggested: [
          {
            operation: 'checkup.statements',
            command: `actual checkup statement add --account ${account.id} --month <YYYY-MM> --no-activity --source <text>`,
          },
          {
            operation: 'imports.preview',
            command: 'actual imports preview <file> --account ' + account.id,
          },
        ],
      });
    }
    coverage.push({
      accountId: account.id,
      name: account.name,
      offBudget: Boolean(account.offbudget),
      closed: Boolean(account.closed),
      months: out,
      summary: {
        observed: out.filter(m => m.status === 'observed').length,
        statementVerified: out.filter(m => m.status === 'statement-verified')
          .length,
        discrepancy: out.filter(m => m.status === 'discrepancy').length,
        unknown: unknown.length,
      },
    });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code) ||
      (a.ids[0] ?? '').localeCompare(b.ids[0] ?? ''),
  );
  const summary = {
    error: findings.filter(f => f.severity === 'error').length,
    warning: findings.filter(f => f.severity === 'warning').length,
    info: findings.filter(f => f.severity === 'info').length,
  };
  return {
    scope: {
      start: request.start,
      end: request.end,
      accountIds: accounts.map(a => a.id),
      closedAccounts: request.accountIds ? 'as named' : 'excluded',
      duplicateWindowDays: window,
      statements: statements.length,
      statementEvidence: 'user-declared, not bank-verified',
    },
    readOnly: true as const,
    summary,
    totalFindings: findings.length,
    truncated: findings.length > limit,
    findings: findings.slice(0, limit),
    coverage,
    transferAudit: { checked: audit.checked, linked: audit.linked },
  };
}
