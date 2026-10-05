import { EventEmitter } from 'node:events';
import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import { createBackupArtifact } from './backup-artifacts';
import { pruneBackupArtifacts } from './backup-retention';

const boundary = vi.hoisted(() => ({ spawn: vi.fn(), unlink: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: boundary.spawn }));
vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof FsPromises>()),
  unlink: boundary.unlink,
}));

it('reports a partially removed artifact and preserves the newest valid copy after a deletion failure', async () => {
  const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'actual-retention-test-'));
  // Only the subprocess and filesystem failure are mocked. Artifact writes,
  // root locking, preservation, and partial deletion use the real filesystem.
  boundary.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    child.stdin.once('finish', () =>
      setImmediate(() => {
        child.stdout.write(
          JSON.stringify({
            identity: { id: 'test-source' },
            snapshot: { schemaVersion: 1, tables: {}, accountBalances: [] },
          }),
        );
        child.emit('close', 0);
      }),
    );
    return child;
  });
  boundary.unlink.mockImplementation(async (path: string) => {
    if (basename(path) === 'manifest.json') {
      throw new Error('Injected manifest deletion failure');
    }
    await actualFs.unlink(path);
  });
  try {
    const metadata = {
      source: {
        id: 'test-source',
        name: 'Disposable',
        syncId: null,
        cloudFileId: null,
        currency: 'USD',
      },
      sourceEncrypted: false,
      remoteFreshness: 'unknown' as const,
      lastSyncedTimestamp: null,
      lastSyncedAt: null,
      pendingMessages: 0,
    };
    const older = await createBackupArtifact(
      root,
      new Uint8Array([1, 2, 3]),
      metadata,
    );
    const newer = await createBackupArtifact(
      root,
      new Uint8Array([4, 5, 6]),
      metadata,
    );
    expect(older.manifest.createdAt < newer.manifest.createdAt).toBe(true);
    await expect(
      pruneBackupArtifacts(
        root,
        1,
        100,
        60,
        true,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: 'PARTIAL_COMPLETION',
      details: { deleted: [], activeArtifact: older.path },
    });
    await expect(stat(join(older.path, 'budget.zip'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await stat(join(older.path, 'manifest.json'))).isFile()).toBe(true);
    expect(await readFile(join(newer.path, 'budget.zip'))).toEqual(
      Buffer.from([4, 5, 6]),
    );
  } finally {
    await removeFixture(root);
  }
});

async function removeFixture(root: string) {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('actual-retention-test-')
  ) {
    throw new Error('Unexpected fixture cleanup path.');
  }
  await rm(root, { recursive: true, force: true });
}
