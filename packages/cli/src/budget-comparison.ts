import * as api from '@actual-app/api';

import { AgentError } from './agent-output';
import { validateBackupArchive } from './backup-validation';
import type { BudgetSnapshot } from './budget-snapshot';
import type { CliGlobalOpts } from './config';
import { resolveConfig } from './config';
import { withConnection } from './connection';

export async function compareBudgets(
  opts: CliGlobalOpts,
  leftId: string,
  rightId: string,
  limit: number,
  timeout: number,
  signal: AbortSignal,
) {
  for (const id of [leftId, rightId]) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new AgentError(
        'INVALID_INPUT',
        'Provide two explicit local budget IDs.',
      );
    }
  }
  const config = await resolveConfig(opts);
  if (!config.offline) {
    throw new AgentError(
      'INVALID_INPUT',
      'Budget comparison requires --offline and two local IDs.',
    );
  }
  const observe = async (id: string) => {
    const exported = await withConnection(
      {
        ...opts,
        dataDir: config.dataDir,
        budgetId: id,
        syncId: undefined,
        offline: true,
      },
      async () => ({
        identity: await api.inspectBudget(),
        archive: await api.exportBudget(),
        observedAt: new Date().toISOString(),
      }),
      { mutates: false },
    );
    const imported = await validateBackupArchive(
      exported.archive,
      timeout,
      signal,
    );
    if (imported.identity.id !== id) {
      throw new AgentError(
        'ENGINE_FAILURE',
        'The isolated snapshot has an unexpected budget identity.',
      );
    }
    return {
      identity: exported.identity,
      observedAt: exported.observedAt,
      snapshot: imported.snapshot,
    };
  };
  const left = await observe(leftId);
  const right = await observe(rightId);
  const comparableCurrency =
    left.identity.currency !== null &&
    left.identity.currency === right.identity.currency;
  const differences: Array<
    | {
        kind: 'table';
        table: string;
        left: BudgetSnapshot['tables'][string] | null;
        right: BudgetSnapshot['tables'][string] | null;
      }
    | {
        kind: 'account-balance';
        id: string;
        left: number | null;
        right: number | null;
        delta: number | null;
      }
  > = [];
  for (const table of [
    ...new Set([
      ...Object.keys(left.snapshot.tables),
      ...Object.keys(right.snapshot.tables),
    ]),
  ].sort()) {
    const a = left.snapshot.tables[table] ?? null;
    const b = right.snapshot.tables[table] ?? null;
    if (a?.rows !== b?.rows || a?.sha256 !== b?.sha256) {
      differences.push({ kind: 'table', table, left: a, right: b });
    }
  }
  const leftBalances = new Map(
    left.snapshot.accountBalances.map(row => [row.id, row.balance]),
  );
  const rightBalances = new Map(
    right.snapshot.accountBalances.map(row => [row.id, row.balance]),
  );
  for (const id of [
    ...new Set([...leftBalances.keys(), ...rightBalances.keys()]),
  ].sort()) {
    const a = leftBalances.get(id) ?? null;
    const b = rightBalances.get(id) ?? null;
    if (a !== b) {
      differences.push({
        kind: 'account-balance',
        id,
        left: a,
        right: b,
        delta: comparableCurrency && a !== null && b !== null ? b - a : null,
      });
    }
  }
  return {
    left: { ...left.identity, observedAt: left.observedAt },
    right: { ...right.identity, observedAt: right.observedAt },
    isolated: true,
    remoteFreshness: 'unknown',
    jointSnapshot: false,
    comparableCurrency,
    sameDomainState: differences.length === 0,
    differences: differences.slice(0, limit),
    total: differences.length,
    limit,
    truncated: differences.length > limit,
  };
}
