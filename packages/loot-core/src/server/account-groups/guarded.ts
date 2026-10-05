// Read-only plans and canonical writers for guarded account group creation,
// renames and deletions. Names follow the owner: non-empty and unique among
// live groups, compared case-insensitively. Deleting a group ungroups its
// live member accounts; it never touches the accounts themselves otherwise.
import * as db from '#server/db';
import { SORT_INCREMENT } from '#server/db/sort';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  AccountGroupCreationProposal,
  AccountGroupCreationRequest,
  AccountGroupDeletionProposal,
  AccountGroupDeletionRequest,
  AccountGroupUpdateProposal,
  AccountGroupUpdateRequest,
} from '#types/change-proposals';

type RawGroup = {
  id: string;
  name: string;
  sort_order: number | null;
  tombstone: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function clash(name: string, exceptId?: string) {
  return db.first<RawGroup>(
    'SELECT * FROM account_groups WHERE UPPER(name) = ? AND tombstone = 0 AND id != ? LIMIT 1',
    [name.toUpperCase(), exceptId ?? ''],
  );
}

async function liveGroup(id: unknown) {
  if (typeof id !== 'string' || !id.trim()) {
    throw APIError('Invalid account group request: provide an id');
  }
  const row = await db.first<RawGroup>(
    'SELECT * FROM account_groups WHERE id = ?',
    [id],
  );
  if (!row || row.tombstone) {
    throw APIError(`Account group does not exist: ${id}`);
  }
  return row;
}

export async function prepareAccountGroupCreation(
  request: AccountGroupCreationRequest,
): Promise<AccountGroupCreationProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => key !== 'name') ||
    !validName(request.name)
  ) {
    throw APIError('Invalid account group creation request: provide a name');
  }
  const existing = await clash(request.name);
  if (existing) {
    throw APIError(`An account group with that name exists: ${existing.id}`);
  }
  const last = await db.first<{ sort_order: number }>(
    'SELECT sort_order FROM account_groups WHERE tombstone = 0 ORDER BY sort_order DESC, id DESC LIMIT 1',
  );
  return {
    schemaVersion: 1,
    operation: 'account-groups.create',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash() },
    after: {
      group: {
        name: request.name,
        sort_order: (last ? last.sort_order : 0) + SORT_INCREMENT,
        tombstone: 0,
      },
    },
    references: {},
    sideEffects: [
      'create one empty account group after the last group through the canonical owner',
    ],
  };
}

export async function performAccountGroupCreation(
  current: AccountGroupCreationProposal,
) {
  const id = await db.insertAccountGroup({ name: current.request.name });
  const actual = await db.first<RawGroup>(
    'SELECT * FROM account_groups WHERE id = ?',
    [id],
  );
  if (!rowMatches(actual, current.after.group)) {
    throw new Error('Account group creation acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [id],
    accountGroupCreation: { groupId: id },
  };
}

export async function prepareAccountGroupUpdate(
  request: AccountGroupUpdateRequest,
): Promise<AccountGroupUpdateProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !isRecord(request.fields) ||
    Object.keys(request.fields).some(key => key !== 'name') ||
    !validName(request.fields.name)
  ) {
    throw APIError('Invalid account group update request: provide a name');
  }
  const group = await liveGroup(request.id);
  const existing = await clash(request.fields.name, group.id);
  if (existing) {
    throw APIError(`An account group with that name exists: ${existing.id}`);
  }
  return {
    schemaVersion: 1,
    operation: 'account-groups.update',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), group: { ...group } },
    after: { group: { ...group, name: request.fields.name } },
    references: {},
    sideEffects: ['rename one account group through the canonical owner'],
  };
}

export async function performAccountGroupUpdate(
  current: AccountGroupUpdateProposal,
) {
  await db.updateAccountGroup({
    id: current.request.id,
    name: current.request.fields.name,
  });
  const actual = await db.first<RawGroup>(
    'SELECT * FROM account_groups WHERE id = ?',
    [current.request.id],
  );
  if (!rowMatches(actual, current.after.group)) {
    throw new Error('Account group update acknowledgement is incomplete');
  }
  return {
    changed: current.before.group.name !== current.request.fields.name,
    affectedIds: [current.request.id],
  };
}

export async function prepareAccountGroupDeletion(
  request: AccountGroupDeletionRequest,
): Promise<AccountGroupDeletionProposal> {
  if (!isRecord(request) || Object.keys(request).some(key => key !== 'id')) {
    throw APIError('Invalid account group deletion request: provide an id');
  }
  const group = await liveGroup(request.id);
  const members = await db.all<{ id: string }>(
    'SELECT id FROM accounts WHERE account_group_id = ? AND tombstone = 0 ORDER BY id',
    [group.id],
  );
  return {
    schemaVersion: 1,
    operation: 'account-groups.delete',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), group: { ...group } },
    after: {
      action: 'tombstone',
      ungroupedAccountIds: members.map(member => member.id),
    },
    references: {},
    sideEffects: [
      members.length
        ? `tombstone the group and move ${members.length} member account(s) to ungrouped; accounts and transactions are not changed otherwise`
        : 'tombstone the empty group through the canonical owner',
    ],
  };
}

export async function performAccountGroupDeletion(
  current: AccountGroupDeletionProposal,
) {
  await db.deleteAccountGroup({ id: current.request.id });
  const actual = await db.first<RawGroup>(
    'SELECT * FROM account_groups WHERE id = ?',
    [current.request.id],
  );
  const stillGrouped = await db.all<{ id: string }>(
    'SELECT id FROM accounts WHERE account_group_id = ? AND tombstone = 0',
    [current.request.id],
  );
  if (!actual || actual.tombstone !== 1 || stillGrouped.length) {
    throw new Error('Account group deletion acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [current.request.id, ...current.after.ungroupedAccountIds],
  };
}
