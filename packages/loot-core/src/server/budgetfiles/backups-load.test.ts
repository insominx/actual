// @ts-strict-ignore
import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as fs from '#platform/server/fs';
import { logger } from '#platform/server/log';
import * as cloudStorage from '#server/cloud-storage';
import * as prefs from '#server/prefs';
import { safeZip } from '#server/util/zip';

import { loadBackup, startBackupService, stopBackupService } from './backups';

describe('startBackupService', () => {
  it('survives a failed periodic backup instead of rejecting', async () => {
    const docDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'backup-svc-'));
    fs._setDocumentDir(docDir);

    let tick: (() => Promise<void>) | undefined;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      fn: () => Promise<void>,
    ) => {
      tick = fn;
      return 0;
    }) as unknown as typeof setInterval);
    const errorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const logSpy = vi.spyOn(logger, 'log').mockImplementation(() => undefined);

    try {
      // The budget directory does not exist, so making the backup fails
      startBackupService('missing-budget');
      await expect(tick?.()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.restoreAllMocks();
      stopBackupService();
      nodeFs.rmSync(docDir, { recursive: true, force: true });
    }
  });
});

describe('loadBackup', () => {
  let docDir: string;
  beforeEach(() => {
    // The zip library rejects the faked 1970 clock
    global.restoreDateNow();
    docDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'load-backup-'));
    fs._setDocumentDir(docDir);
  });
  afterEach(() => {
    global.restoreFakeDateNow();
    stopBackupService();
    vi.restoreAllMocks();
    nodeFs.rmSync(docDir, { recursive: true, force: true });
  });

  it('re-uploads the restored database and metadata, not the ones it replaced', async () => {
    const id = 'my-budget';
    const budgetDir = path.join(docDir, id);
    nodeFs.mkdirSync(path.join(budgetDir, 'backups'), { recursive: true });

    const metadata = (marker: string) =>
      JSON.stringify({
        id,
        budgetName: marker,
        groupId: 'old-group',
        lastSyncedTimestamp: 'old-timestamp',
        lastUploaded: '2020-01-01',
      });

    nodeFs.writeFileSync(path.join(budgetDir, 'db.sqlite'), 'CURRENT-DB');
    nodeFs.writeFileSync(
      path.join(budgetDir, 'metadata.json'),
      metadata('current'),
    );
    nodeFs.writeFileSync(
      path.join(budgetDir, 'backups', 'old.zip'),
      safeZip({
        'db.sqlite': new TextEncoder().encode('BACKUP-DB'),
        'metadata.json': new TextEncoder().encode(metadata('backup')),
      }),
    );

    const seenAtUpload: Array<{
      db: string;
      budgetName: string;
      groupId: string | null;
      lastSyncedTimestamp: string | null;
    }> = [];
    vi.spyOn(cloudStorage, 'upload').mockImplementation(async () => {
      seenAtUpload.push({
        // upload() works from the prefs loaded in memory and the files on disk
        groupId: prefs.getPrefs().groupId,
        lastSyncedTimestamp: prefs.getPrefs().lastSyncedTimestamp,
        db: nodeFs.readFileSync(path.join(budgetDir, 'db.sqlite'), 'utf8'),
        budgetName: JSON.parse(
          nodeFs.readFileSync(path.join(budgetDir, 'metadata.json'), 'utf8'),
        ).budgetName,
      });
    });

    await loadBackup(id, 'old.zip');

    // The restored files are what ends up on disk...
    expect(nodeFs.readFileSync(path.join(budgetDir, 'db.sqlite'), 'utf8')).toBe(
      'BACKUP-DB',
    );
    // ...and what gets re-uploaded, with the old sync data forgotten
    expect(seenAtUpload).toEqual([
      {
        db: 'BACKUP-DB',
        budgetName: 'backup',
        groupId: null,
        lastSyncedTimestamp: null,
      },
    ]);
  });
});
