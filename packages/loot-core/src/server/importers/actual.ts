// @ts-strict-ignore
import * as fs from '#platform/server/fs';
import * as sqlite from '#platform/server/sqlite';
import * as cloudStorage from '#server/cloud-storage';
import { withErrorCode } from '#server/errors';
import { handlers } from '#server/main';
import { waitOnSpreadsheet } from '#server/sheet';

export async function importActual(
  _filepath: string,
  buffer: Buffer,
  { newName }: { newName?: string } = {},
) {
  // Importing Actual files is a special case because we can directly
  // write down the files, but because it doesn't go through the API
  // layer we need to duplicate some of the workflow
  await handlers['close-budget']();

  let id;
  try {
    ({ id } = await cloudStorage.importBuffer(
      { cloudFileId: null, groupId: null },
      buffer,
      { newName },
    ));
  } catch (e) {
    if (e.type === 'FileDownloadError') {
      return { error: e.reason, meta: e.meta };
    }
    throw e;
  }

  try {
    // We never want to load cached data from imported files, so
    // delete the cache
    const sqliteDb = await sqlite.openDatabase(
      fs.join(fs.getBudgetDir(id), 'db.sqlite'),
    );
    try {
      sqlite.execQuery(
        sqliteDb,
        `
          DELETE FROM kvcache;
          DELETE FROM kvcache_key;
        `,
      );
    } finally {
      sqlite.closeDatabase(sqliteDb);
    }

    // Load the budget, force everything to be computed, and try
    // to upload it as a cloud file
    if (newName !== undefined) {
      await handlers['api/load-budget']({ id, offline: true });
    } else {
      const result = await handlers['load-budget']({ id });
      if (result.error) {
        throw new Error('Imported budget could not be loaded: ' + result.error);
      }
    }
    await handlers['get-budget-bounds']();
    await waitOnSpreadsheet();
    if (newName === undefined) {
      await cloudStorage.upload().catch(() => {
        // Ignore errors
      });
    }
    return { id };
  } catch (error) {
    if (newName !== undefined) {
      try {
        await handlers['close-budget']();
        // This directory was exclusively created by the restore path. Invalid
        // SQLite input must be removable without opening it again for deletion.
        await fs.removeDirRecursively(fs.getBudgetDir(id));
      } catch {
        throw withErrorCode(
          new Error('Restore failed and local cleanup was incomplete'),
          'creation-cleanup-failed',
        );
      }
    }
    throw error;
  }
}
