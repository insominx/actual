// Read-only plan and canonical writer for guarded note changes. Note IDs
// follow the UI conventions: `account-<accountId>`, a category or category
// group ID, `budget-<YYYY-MM>` for a budget month, and
// `<categoryId>-<YYYY-MM>` for a category's month note.
import * as db from '#server/db';
import { APIError } from '#server/errors';
import {
  guardedBudgetIdentity,
  guardedSourceHash,
  rowMatches,
} from '#server/guarded-proposal';
import type {
  NoteSetProposal,
  NoteSetRequest,
  NoteTarget,
} from '#types/change-proposals';

import { updateNotes } from './app';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// A note larger than this is almost certainly a mistaken file payload.
const MAX_NOTE_LENGTH = 100_000;

type LiveRow = { id: string; name: string; tombstone: number };

async function liveRow(
  table: 'accounts' | 'categories' | 'category_groups',
  id: string,
) {
  const row = await db.first<LiveRow>(
    `SELECT id, name, tombstone FROM ${table} WHERE id = ?`,
    [id],
  );
  return row && !row.tombstone ? row : null;
}

// Resolves a raw note ID to the entity it annotates. Unknown, deleted or
// malformed targets are rejected so a typo cannot create an orphan note.
export async function resolveNoteTarget(id: unknown): Promise<NoteTarget> {
  if (typeof id !== 'string' || !id.trim()) {
    throw APIError('Invalid note request: provide a note id');
  }
  if (id.startsWith('budget-')) {
    const month = id.slice('budget-'.length);
    if (!MONTH.test(month)) {
      throw APIError(`Invalid budget month note id: ${id}`);
    }
    return { kind: 'month', month };
  }
  if (id.startsWith('account-')) {
    const accountId = id.slice('account-'.length);
    const account = await liveRow('accounts', accountId);
    if (!account) {
      throw APIError(`Account does not exist: ${accountId}`);
    }
    return { kind: 'account', id: accountId, name: account.name };
  }
  const category = await liveRow('categories', id);
  if (category) {
    return { kind: 'category', id, name: category.name };
  }
  const group = await liveRow('category_groups', id);
  if (group) {
    return { kind: 'category-group', id, name: group.name };
  }
  const categoryMonth = /^(.+)-(\d{4}-\d{2})$/.exec(id);
  if (categoryMonth && MONTH.test(categoryMonth[2])) {
    const owner = await liveRow('categories', categoryMonth[1]);
    if (owner) {
      return {
        kind: 'category-month',
        id: categoryMonth[1],
        name: owner.name,
        month: categoryMonth[2],
      };
    }
  }
  throw APIError(`Note target does not exist: ${id}`);
}

export async function readNote(id: string) {
  const row = await db.first<{ id: string; note: string | null }>(
    'SELECT id, note FROM notes WHERE id = ?',
    [id],
  );
  return row ?? null;
}

export async function prepareNoteSet(
  request: NoteSetRequest,
): Promise<NoteSetProposal> {
  if (
    typeof request !== 'object' ||
    request === null ||
    Array.isArray(request) ||
    Object.keys(request).some(key => !['id', 'note'].includes(key)) ||
    typeof request.note !== 'string' ||
    request.note.length > MAX_NOTE_LENGTH
  ) {
    throw APIError(
      `Invalid note request: provide id and note text (at most ${MAX_NOTE_LENGTH} characters)`,
    );
  }
  const target = await resolveNoteTarget(request.id);
  const existing = await readNote(request.id);
  const sideEffects = [
    existing
      ? 'replace the note text through the canonical notes owner'
      : 'create the note through the canonical notes owner',
  ];
  if (target.kind === 'category' || target.kind === 'category-month') {
    sideEffects.push(
      'category notes can carry #template and #goal lines; budget templates that read notes will use the new text',
    );
  }
  return {
    schemaVersion: 1,
    operation: 'notes.set',
    budget: guardedBudgetIdentity(),
    request,
    before: {
      sourceHash: await guardedSourceHash(),
      note: existing ? { ...existing } : null,
    },
    after: { target, note: { id: request.id, note: request.note } },
    references: {},
    sideEffects,
  };
}

export async function performNoteSet(current: NoteSetProposal) {
  await updateNotes({ id: current.request.id, note: current.request.note });
  const actual = await readNote(current.request.id);
  if (!rowMatches(actual, current.after.note)) {
    throw new Error('Note acknowledgement is incomplete');
  }
  return {
    changed: (current.before.note?.note ?? null) !== current.request.note,
    affectedIds: [current.request.id],
  };
}
