// Agent-facing bank sync status and refresh. Status reports which accounts
// are linked to a provider, their last sync and persisted sync status, and
// whether each provider is configured on the server, without secrets.
// Refresh runs the engine's existing bank sync for already-linked accounts
// only and returns one outcome per account; authentication, rate limits,
// provider errors and an empty feed stay distinct. It never creates a
// provider connection: linking needs provider consent in the app.
import * as db from '#server/db';
import { APIError } from '#server/errors';

export type BankSyncProviderState = {
  configured: boolean | null;
  error: string | null;
};

export type BankSyncAccountStatus = {
  id: string;
  name: string;
  offBudget: boolean;
  closed: boolean;
  linked: boolean;
  provider: string | null;
  institution: string | null;
  lastSync: string | null;
  bankSyncStatus: string | null;
};

export type BankSyncOutcomeStatus =
  | 'imported'
  | 'no-new-transactions'
  | 'not-linked'
  | 'auth-required'
  | 'rate-limited'
  | 'attention-required'
  | 'account-missing'
  | 'provider-error';

export type BankSyncAccountOutcome = {
  accountId: string;
  name: string;
  provider: string | null;
  status: BankSyncOutcomeStatus;
  addedIds: string[];
  matchedIds: string[];
  retryable: boolean;
  prerequisite: string | null;
  error: {
    category: string | null;
    code: string | null;
    message: string;
  } | null;
};

type SyncError = {
  accountId: string;
  message: string;
  category?: string;
  code?: string;
};

type SyncResult = {
  errors: SyncError[];
  newTransactions: string[];
  matchedTransactions: string[];
  updatedAccounts: string[];
};

export type BankSyncRunners = {
  single: (ids: string[]) => Promise<SyncResult>;
  simpleFin: (
    ids: string[],
  ) => Promise<Array<{ accountId: string; res: SyncResult }>>;
  status: Record<string, () => Promise<unknown>>;
};

type AccountRow = {
  id: string;
  name: string;
  offbudget: number;
  closed: number;
  account_id: string | null;
  bank: string | null;
  account_sync_source: string | null;
  last_sync: string | null;
  bank_sync_status: string | null;
  institution: string | null;
};

const CONSENT =
  'Link the account to a bank sync provider in the Actual app; provider consent happens in the browser. File imports (actual imports) remain available.';
const REAUTH =
  'Reauthenticate the provider connection in the Actual app; the CLI does not handle provider consent.';
export const EMPTY_FEED_NOTE =
  'An empty provider feed is not verified history coverage; record statement evidence with actual checkup statement add.';

async function accountRows() {
  return db.all<AccountRow>(
    `SELECT a.id, a.name, a.offbudget, a.closed, a.account_id, a.bank,
            a.account_sync_source, a.last_sync, a.bank_sync_status,
            b.name AS institution
     FROM accounts a LEFT JOIN banks b ON b.id = a.bank AND b.tombstone = 0
     WHERE a.tombstone = 0 ORDER BY a.sort_order, a.id`,
  );
}

function isLinked(row: AccountRow) {
  return Boolean(row.account_id && row.bank);
}

function provider(row: AccountRow) {
  if (!isLinked(row)) return null;
  return row.account_sync_source ?? 'goCardless';
}

function lastSync(value: string | null) {
  if (!value) return null;
  const ms = Number(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

export async function bankSyncStatus(runners: BankSyncRunners) {
  const rows = await accountRows();
  const providers: Record<string, BankSyncProviderState> = {};
  for (const [name, check] of Object.entries(runners.status)) {
    try {
      const result = (await check()) as {
        configured?: boolean;
        error?: string;
      } | null;
      providers[name] =
        result && typeof result.configured === 'boolean'
          ? { configured: result.configured, error: null }
          : { configured: null, error: result?.error ?? 'unknown' };
    } catch (error) {
      providers[name] = {
        configured: null,
        error: error instanceof Error ? error.message : 'unavailable',
      };
    }
  }
  const accounts: BankSyncAccountStatus[] = rows.map(row => ({
    id: row.id,
    name: row.name,
    offBudget: Boolean(row.offbudget),
    closed: Boolean(row.closed),
    linked: isLinked(row),
    provider: provider(row),
    institution: row.institution,
    lastSync: lastSync(row.last_sync),
    bankSyncStatus: row.bank_sync_status,
  }));
  const linked = accounts.filter(a => a.linked && !a.closed);
  return {
    providers,
    accounts,
    linkedCount: linked.length,
    prerequisite: linked.length ? null : CONSENT,
  };
}

function classify(error: SyncError): {
  status: BankSyncOutcomeStatus;
  retryable: boolean;
  prerequisite: string | null;
} {
  const category = error.category ?? null;
  const code = error.code ?? null;
  if (
    code === 'ITEM_LOGIN_REQUIRED' ||
    code === 'INVALID_ACCESS_TOKEN' ||
    category === 'INVALID_ACCESS_TOKEN'
  ) {
    return { status: 'auth-required', retryable: false, prerequisite: REAUTH };
  }
  if (category === 'RATE_LIMIT_EXCEEDED') {
    return { status: 'rate-limited', retryable: true, prerequisite: null };
  }
  if (category === 'ACCOUNT_NEEDS_ATTENTION') {
    return {
      status: 'attention-required',
      retryable: false,
      prerequisite: REAUTH,
    };
  }
  if (category === 'ACCOUNT_MISSING') {
    return {
      status: 'account-missing',
      retryable: false,
      prerequisite: 'Relink the account in the Actual app.',
    };
  }
  return { status: 'provider-error', retryable: true, prerequisite: null };
}

function outcome(
  row: AccountRow,
  result: SyncResult | null,
  addedPool: Set<string>,
): BankSyncAccountOutcome {
  const base = {
    accountId: row.id,
    name: row.name,
    provider: provider(row),
  };
  const error = result?.errors.find(e => e.accountId === row.id);
  if (!result || error) {
    const kind = error
      ? classify(error)
      : {
          status: 'provider-error' as const,
          retryable: true,
          prerequisite: null,
        };
    return {
      ...base,
      ...kind,
      addedIds: [],
      matchedIds: [],
      error: {
        category: error?.category ?? null,
        code: error?.code ?? null,
        message: error?.message ?? 'No result for this account.',
      },
    };
  }
  const addedIds = result.newTransactions.filter(id => addedPool.has(id));
  const matchedIds = result.matchedTransactions.filter(id => addedPool.has(id));
  return {
    ...base,
    status:
      addedIds.length || matchedIds.length ? 'imported' : 'no-new-transactions',
    addedIds,
    matchedIds,
    retryable: false,
    prerequisite: null,
    error: null,
  };
}

export async function bankSyncRefresh(
  request: { accountIds?: string[] } | undefined,
  runners: BankSyncRunners,
) {
  if (
    request !== undefined &&
    (typeof request !== 'object' ||
      request === null ||
      Object.keys(request).some(key => key !== 'accountIds') ||
      (request.accountIds !== undefined &&
        (!Array.isArray(request.accountIds) ||
          !request.accountIds.every(id => typeof id === 'string' && id))))
  ) {
    throw APIError('Invalid bank sync request: provide optional accountIds');
  }
  const rows = await accountRows();
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const id of request?.accountIds ?? []) {
    if (!byId.has(id)) throw APIError(`Account does not exist: ${id}`);
  }
  const targets = request?.accountIds
    ? request.accountIds.map(id => byId.get(id) as AccountRow)
    : rows.filter(r => !r.closed && isLinked(r));
  const outcomes: BankSyncAccountOutcome[] = [];
  const linked = targets.filter(r => isLinked(r) && !r.closed);
  for (const row of targets) {
    if (!isLinked(row) || row.closed) {
      outcomes.push({
        accountId: row.id,
        name: row.name,
        provider: provider(row),
        status: 'not-linked',
        addedIds: [],
        matchedIds: [],
        retryable: false,
        prerequisite: row.closed ? 'The account is closed.' : CONSENT,
        error: null,
      });
    }
  }
  if (!linked.length) {
    return {
      prerequisite: CONSENT,
      attempted: 0,
      outcomes,
      coverage: EMPTY_FEED_NOTE,
    };
  }
  const idsOf = async (account: string) =>
    new Set(
      (
        await db.all<{ id: string }>(
          'SELECT id FROM transactions WHERE acct = ? AND tombstone = 0',
          [account],
        )
      ).map(r => r.id),
    );
  const simpleFin = linked.filter(r => r.account_sync_source === 'simpleFin');
  if (simpleFin.length) {
    let results: Array<{ accountId: string; res: SyncResult }> = [];
    try {
      results = await runners.simpleFin(simpleFin.map(r => r.id));
    } catch (error) {
      results = simpleFin.map(r => ({
        accountId: r.id,
        res: {
          errors: [
            {
              accountId: r.id,
              message: error instanceof Error ? error.message : String(error),
            },
          ],
          newTransactions: [],
          matchedTransactions: [],
          updatedAccounts: [],
        },
      }));
    }
    for (const row of simpleFin) {
      const result = results.find(r => r.accountId === row.id)?.res ?? null;
      outcomes.push(outcome(row, result, await idsOf(row.id)));
    }
  }
  for (const row of linked.filter(r => r.account_sync_source !== 'simpleFin')) {
    let result: SyncResult | null;
    try {
      result = await runners.single([row.id]);
    } catch (error) {
      result = {
        errors: [
          {
            accountId: row.id,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        newTransactions: [],
        matchedTransactions: [],
        updatedAccounts: [],
      };
    }
    outcomes.push(outcome(row, result, await idsOf(row.id)));
  }
  const order = new Map(targets.map((r, i) => [r.id, i]));
  outcomes.sort(
    (a, b) => (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0),
  );
  return {
    prerequisite: null,
    attempted: linked.length,
    outcomes,
    coverage: EMPTY_FEED_NOTE,
  };
}
