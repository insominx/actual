import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import { canonicalJson } from '#shared/canonical-json';

import { newBudgetMetadata } from './new-budget-metadata';

// A clone recomputes its cache and receives an independent clock node.
export const copySourceIgnoredTables = [
  'kvcache',
  'kvcache_key',
  'messages_clock',
] as const;

/** Caller holds the engine mutator while inspecting the loaded source. */
export async function inspectCopySource(name: string): Promise<string> {
  const schema = await db.all<{
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }>(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_autoindex_%'
     ORDER BY type, name`,
  );
  const tables: Array<{ name: string; rows: string[] }> = [];
  for (const entry of schema) {
    if (
      entry.type !== 'table' ||
      copySourceIgnoredTables.some(name => name === entry.name)
    ) {
      continue;
    }
    const quotedName = '"' + entry.name.replaceAll('"', '""') + '"';
    const rows = await db.all<Record<string, unknown>>(
      'SELECT * FROM ' + quotedName,
    );
    tables.push({ name: entry.name, rows: rows.map(canonicalJson).sort() });
  }
  const source = prefs.getPrefs();
  const metadata = JSON.parse(
    await fs.readFile(fs.join(fs.getBudgetDir(source.id), 'metadata.json')),
  );
  const copiedMetadata = newBudgetMetadata(metadata, 'uncreated', name);
  const bytes = new TextEncoder().encode(
    canonicalJson({ schema, tables, metadata: copiedMetadata }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
