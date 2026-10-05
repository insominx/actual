// Shared envelope for guarded preview/apply adapters. Domain owners supply a
// read-only prepare function and a writer that consumes the recomputed
// proposal; this module owns the budget identity, source hash, stale preview
// comparison and committed-local receipt shape so each adapter cannot drift.
import { getClock } from '@actual-app/crdt';

import { canonicalJson } from '#shared/canonical-json';
import type { TransactionUpdateOutcome } from '#types/change-proposals';

import { inspectCopySource } from './budgetfiles/copy-source';
import { APIError } from './errors';
import * as prefs from './prefs';

export type GuardedBudgetIdentity = {
  id: string;
  syncId: string | null;
  cloudFileId: string | null;
};

export type GuardedRejection = Extract<
  TransactionUpdateOutcome,
  { status: 'rejected' }
>;

export type GuardedCommit<Extra extends object = object> = Extract<
  TransactionUpdateOutcome,
  { status: 'committed-local' }
> &
  Extra;

function openMetadata() {
  const metadata = prefs.getPrefs();
  if (!metadata?.id || metadata.budgetName === undefined) {
    throw APIError('No budget file is open');
  }
  return { ...metadata, id: metadata.id, budgetName: metadata.budgetName };
}

export function guardedBudgetIdentity(): GuardedBudgetIdentity {
  const metadata = openMetadata();
  return {
    id: metadata.id,
    syncId: metadata.groupId ?? null,
    cloudFileId: metadata.cloudFileId ?? null,
  };
}

export async function guardedSourceHash() {
  return inspectCopySource(openMetadata().budgetName);
}

type GuardedProposalEnvelope = {
  schemaVersion: 1;
  operation: string;
  budget: GuardedBudgetIdentity;
  request: unknown;
};

export function guardedApply<
  Proposal extends GuardedProposalEnvelope,
  Extra extends object,
>(spec: {
  operation: Proposal['operation'];
  noun: string;
  prepare: (request: Proposal['request']) => Promise<Proposal>;
  perform: (
    current: Proposal,
  ) => Promise<{ changed: boolean; affectedIds: string[] } & Extra>;
}) {
  return async (
    proposal: Proposal,
  ): Promise<GuardedRejection | GuardedCommit<Extra>> => {
    if (
      !proposal ||
      proposal.schemaVersion !== 1 ||
      proposal.operation !== spec.operation
    ) {
      return {
        status: 'rejected',
        code: 'INVALID_INPUT',
        message: `Unsupported ${spec.noun} proposal`,
      };
    }
    if (
      canonicalJson(proposal.budget) !== canonicalJson(guardedBudgetIdentity())
    ) {
      return {
        status: 'rejected',
        code: 'MISSING_CONTEXT',
        message: 'The proposal belongs to another budget identity',
      };
    }
    let current: Proposal;
    try {
      current = await spec.prepare(proposal.request);
    } catch {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: `${spec.noun} scope is no longer available`,
      };
    }
    if (canonicalJson(current) !== canonicalJson(proposal)) {
      return {
        status: 'rejected',
        code: 'STALE_PREVIEW',
        message: `${spec.noun} or source references changed after preview`,
      };
    }
    const result = await spec.perform(current);
    return {
      status: 'committed-local',
      checkpoint: getClock().timestamp.toString(),
      ...result,
    };
  };
}

// Verifies that the raw row now carries every expected column value.
export function rowMatches(
  actual: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
) {
  return (
    !!actual &&
    Object.entries(expected).every(
      ([key, value]) => canonicalJson(actual[key]) === canonicalJson(value),
    )
  );
}
