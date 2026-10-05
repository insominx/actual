import type { MetadataPrefs } from '#types/prefs';

/** New local identities never retain publication or synchronization lineage. */
export function newBudgetMetadata(
  metadata: MetadataPrefs,
  id: string,
  name: string,
): MetadataPrefs {
  const copy = { ...metadata, id, budgetName: name, resetClock: true };
  delete copy.cloudFileId;
  delete copy.groupId;
  delete copy.lastUploaded;
  delete copy.encryptKeyId;
  delete copy.lastSyncedTimestamp;
  delete copy.publication;
  delete copy.archived;
  return copy;
}
