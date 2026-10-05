// Read-only plans and canonical writers for guarded tag creation, updates and
// deletions. Tag names follow the UI rule: any characters except whitespace
// and '#'.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  TagCreationProposal,
  TagCreationRequest,
  TagDeletionProposal,
  TagDeletionRequest,
  TagUpdateProposal,
  TagUpdateRequest,
} from '#types/change-proposals';

import { createTag, deleteTag, updateTag } from './app';

type RawTag = db.DbTag & { tombstone: number };

const TAG_NAME = /^[^#\s]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalText(value: unknown) {
  return value === undefined || value === null || typeof value === 'string';
}

function tagRows() {
  return db.all<RawTag>('SELECT * FROM tags ORDER BY id');
}

async function liveTag(id: unknown) {
  if (typeof id !== 'string' || !id.trim()) {
    throw APIError('Invalid tag request: provide an id');
  }
  const row = await db.first<RawTag>('SELECT * FROM tags WHERE id = ?', [id]);
  if (!row || row.tombstone) {
    throw APIError(`Tag does not exist: ${id}`);
  }
  return row;
}

export async function prepareTagCreation(
  request: TagCreationRequest,
): Promise<TagCreationProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(
      key => !['tag', 'color', 'description'].includes(key),
    ) ||
    typeof request.tag !== 'string' ||
    !TAG_NAME.test(request.tag) ||
    !isOptionalText(request.color) ||
    !isOptionalText(request.description)
  ) {
    throw APIError(
      'Invalid tag creation request: tag must be non-empty without whitespace or #',
    );
  }
  const rows = await tagRows();
  const matches = rows.filter(row => row.tag === request.tag);
  const live = matches.find(row => !row.tombstone);
  if (live) {
    throw APIError(`A tag with that name already exists: ${live.id}`);
  }
  // The owner revives the first same-name row it reads without an order, so
  // more than one deleted candidate would make the revived identity ambiguous.
  if (matches.length > 1) {
    throw APIError('More than one deleted tag uses that name');
  }
  const existing = matches[0] ?? null;
  const color = request.color ?? null;
  const description = request.description ?? null;
  return {
    schemaVersion: 1,
    operation: 'tags.create',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      existing: existing ? { ...existing } : null,
    },
    after: existing
      ? {
          action: 'revive',
          tag: { ...existing, color, description, tombstone: 0 },
        }
      : {
          action: 'insert',
          tag: {
            tag: request.tag,
            // Match createTag insert: falsy/empty color becomes null.
            color: color ? color.trim() : null,
            description,
            tombstone: 0,
          },
        },
    references: {},
    sideEffects: [
      existing
        ? 'revive the deleted tag with the same name through the canonical owner and replace its color and description'
        : 'create one tag through the canonical owner; transaction notes are not changed',
    ],
  };
}

export async function performTagCreation(current: TagCreationProposal) {
  const { id } = await createTag({
    tag: current.request.tag,
    color: current.request.color ?? null,
    description: current.request.description ?? null,
  });
  const actual = await db.first<RawTag>('SELECT * FROM tags WHERE id = ?', [
    id,
  ]);
  if (
    !rowMatches(actual, current.after.tag) ||
    (current.before.existing && current.before.existing.id !== id)
  ) {
    throw new Error('Tag creation acknowledgement is incomplete');
  }
  return {
    changed: true,
    affectedIds: [id],
    tagCreation: { tagId: id, action: current.after.action },
  };
}

export async function prepareTagUpdate(
  request: TagUpdateRequest,
): Promise<TagUpdateProposal> {
  if (
    !isRecord(request) ||
    Object.keys(request).some(key => !['id', 'fields'].includes(key)) ||
    !isRecord(request.fields) ||
    !Object.keys(request.fields).length ||
    Object.keys(request.fields).some(
      key => !['tag', 'color', 'description'].includes(key),
    ) ||
    (request.fields.tag !== undefined &&
      (typeof request.fields.tag !== 'string' ||
        !TAG_NAME.test(request.fields.tag))) ||
    !isOptionalText(request.fields.color) ||
    !isOptionalText(request.fields.description)
  ) {
    throw APIError(
      'Invalid tag update request: provide tag, color or description; tag must be non-empty without whitespace or #',
    );
  }
  const tag = await liveTag(request.id);
  if (request.fields.tag !== undefined && request.fields.tag !== tag.tag) {
    const rows = await tagRows();
    const clash = rows.find(
      row => row.id !== tag.id && row.tag === request.fields.tag,
    );
    if (clash) {
      throw APIError(`A tag with that name already exists: ${clash.id}`);
    }
  }
  return {
    schemaVersion: 1,
    operation: 'tags.update',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), tag: { ...tag } },
    after: { tag: { ...tag, ...request.fields } },
    references: {},
    sideEffects: [
      'update one tag row through the canonical owner; existing transaction notes are not rewritten',
    ],
  };
}

export async function performTagUpdate(current: TagUpdateProposal) {
  await updateTag({ id: current.request.id, ...current.request.fields });
  const actual = await db.first<RawTag>('SELECT * FROM tags WHERE id = ?', [
    current.request.id,
  ]);
  if (!rowMatches(actual, current.after.tag)) {
    throw new Error('Tag update acknowledgement is incomplete');
  }
  return {
    changed: Object.entries(current.request.fields).some(
      ([key, value]) => current.before.tag[key] !== value,
    ),
    affectedIds: [current.request.id],
  };
}

export async function prepareTagDeletion(
  request: TagDeletionRequest,
): Promise<TagDeletionProposal> {
  if (!isRecord(request) || Object.keys(request).some(key => key !== 'id')) {
    throw APIError('Invalid tag deletion request: provide an id');
  }
  const tag = await liveTag(request.id);
  return {
    schemaVersion: 1,
    operation: 'tags.delete',
    budget: guardedBudgetIdentity(),
    request,
    before: { sourceHash: await guardedSourceHash(), tag: { ...tag } },
    after: { action: 'tombstone' },
    references: {},
    sideEffects: [
      'tombstone one tag through the canonical owner; transaction notes that mention it are not changed',
    ],
  };
}

export async function performTagDeletion(current: TagDeletionProposal) {
  await deleteTag({ id: current.request.id });
  const actual = await db.first<RawTag>('SELECT * FROM tags WHERE id = ?', [
    current.request.id,
  ]);
  if (!actual || actual.tombstone !== 1) {
    throw new Error('Tag deletion acknowledgement is incomplete');
  }
  return { changed: true, affectedIds: [current.request.id] };
}
