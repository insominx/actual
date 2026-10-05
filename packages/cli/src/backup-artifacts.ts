import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { AgentError } from './agent-output';
import { acquireExclusive } from './lock';
import { isRecord } from './utils';

export type BackupManifest = {
  schemaVersion: 1;
  createdAt: string;
  archiveFile: 'budget.zip';
  sha256: string;
  bytes: number;
  encrypted: false;
  sourceEncrypted: boolean;
  remoteFreshness: 'unknown' | 'observed';
  lastSyncedTimestamp: string | null;
  lastSyncedAt: number | null;
  pendingMessages: number;
  validation: 'not-imported';
  source: {
    id: string;
    name: string;
    syncId: string | null;
    cloudFileId: string | null;
    currency: string | null;
  };
};

function isNullableString(value: unknown) {
  return value === null || typeof value === 'string';
}

function isManifest(value: unknown): value is BackupManifest {
  if (!isRecord(value) || !isRecord(value.source)) return false;
  return (
    value.schemaVersion === 1 &&
    value.archiveFile === 'budget.zip' &&
    value.encrypted === false &&
    typeof value.sourceEncrypted === 'boolean' &&
    value.validation === 'not-imported' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.bytes === 'number' &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    (value.remoteFreshness === 'unknown' ||
      value.remoteFreshness === 'observed') &&
    isNullableString(value.lastSyncedTimestamp) &&
    (value.lastSyncedAt === null ||
      (typeof value.lastSyncedAt === 'number' &&
        Number.isFinite(value.lastSyncedAt) &&
        value.lastSyncedAt >= 0)) &&
    typeof value.pendingMessages === 'number' &&
    Number.isSafeInteger(value.pendingMessages) &&
    value.pendingMessages >= 0 &&
    typeof value.source.id === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(value.source.id) &&
    typeof value.source.name === 'string' &&
    isNullableString(value.source.syncId) &&
    isNullableString(value.source.cloudFileId) &&
    isNullableString(value.source.currency)
  );
}

export async function readBackupManifest(path: string) {
  try {
    const absolute = resolve(path);
    const directory = await lstat(absolute);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      !basename(absolute).endsWith('.actualbackup')
    ) {
      throw new Error('Invalid artifact path.');
    }
    const root = await realpath(absolute);
    const manifestPath = join(root, 'manifest.json');
    const file = await lstat(manifestPath);
    if (!file.isFile() || file.isSymbolicLink() || file.size > 65536) {
      throw new Error('Invalid manifest file.');
    }
    const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!isManifest(value)) throw new Error('Unsupported backup manifest.');
    return { path: root, manifest: value };
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      'The backup path or version 1 manifest is invalid. Symbolic links are not supported.',
    );
  }
}

export async function readBackupArtifact(path: string) {
  const artifact = await readBackupManifest(path);
  try {
    const archivePath = join(artifact.path, 'budget.zip');
    const file = await lstat(archivePath);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.size !== artifact.manifest.bytes ||
      file.size > 500 * 1024 * 1024
    ) {
      throw new Error('Invalid archive file.');
    }
    const archive = await readFile(archivePath);
    if (
      archive.length !== artifact.manifest.bytes ||
      createHash('sha256').update(archive).digest('hex') !==
        artifact.manifest.sha256
    ) {
      throw new Error('Archive hash mismatch.');
    }
    return { ...artifact, archive };
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      'The backup archive size, hash, or file boundary is invalid.',
    );
  }
}

export async function listBackupArtifacts(directory: string, limit: number) {
  if (!directory.trim() || directory.includes('\0')) {
    throw new AgentError(
      'INVALID_INPUT',
      'Provide an explicit backup directory.',
    );
  }
  let root: string;
  let names: string[];
  try {
    root = await realpath(resolve(directory));
    names = (await readdir(root))
      .filter(name => name.endsWith('.actualbackup'))
      .sort()
      .reverse();
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      'Cannot read the explicit backup directory.',
    );
  }
  const items: Array<{
    path: string;
    manifest?: BackupManifest;
    status: 'not-validated' | 'invalid';
  }> = [];
  for (const name of names.slice(0, limit)) {
    const path = join(root, name);
    try {
      const artifact = await readBackupManifest(path);
      items.push({ ...artifact, status: 'not-validated' });
    } catch {
      items.push({ path, status: 'invalid' });
    }
  }
  return { items, total: names.length, limit, truncated: names.length > limit };
}

async function writeCompletedFile(path: string, contents: string | Uint8Array) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createBackupArtifact(
  directory: string,
  archive: Uint8Array,
  metadata: Omit<
    BackupManifest,
    | 'schemaVersion'
    | 'createdAt'
    | 'archiveFile'
    | 'sha256'
    | 'bytes'
    | 'encrypted'
    | 'validation'
  >,
  lockTimeoutMs = 10000,
) {
  if (!directory.trim() || directory.includes('\0')) {
    throw new AgentError(
      'INVALID_INPUT',
      'Provide an explicit backup directory.',
    );
  }
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const root = await realpath(resolve(directory));
  const release = await acquireExclusive(root, { timeoutMs: lockTimeoutMs });
  try {
    const staging = await mkdtemp(join(root, '.pending-'));
    try {
      const createdAt = new Date().toISOString();
      const manifest: BackupManifest = {
        ...metadata,
        schemaVersion: 1,
        createdAt,
        archiveFile: 'budget.zip',
        sha256: createHash('sha256').update(archive).digest('hex'),
        bytes: archive.byteLength,
        encrypted: false,
        validation: 'not-imported',
      };
      await writeCompletedFile(join(staging, 'budget.zip'), archive);
      await writeCompletedFile(
        join(staging, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      );
      const completed = await readFile(join(staging, 'budget.zip'));
      if (
        completed.length !== manifest.bytes ||
        createHash('sha256').update(completed).digest('hex') !== manifest.sha256
      ) {
        throw new Error('Incomplete backup archive.');
      }
      if (
        (await readFile(join(staging, 'manifest.json'), 'utf8')) !==
        JSON.stringify(manifest, null, 2) + '\n'
      ) {
        throw new Error('Incomplete backup manifest.');
      }
      const path = join(
        root,
        `${createdAt.replaceAll(':', '-')}-${randomUUID()}.actualbackup`,
      );
      await rename(staging, path);
      return { path, manifest };
    } catch (error) {
      // This deletion targets only the exact staging directory created above.
      if (
        dirname(resolve(staging)) !== root ||
        !basename(staging).startsWith('.pending-')
      ) {
        throw new Error('Unexpected backup staging path.');
      }
      try {
        await rm(staging, { recursive: true, force: true });
      } catch {
        throw new AgentError(
          'PARTIAL_COMPLETION',
          'Backup failed and staging cleanup was incomplete. Inspect the staging directory before retrying.',
          false,
          { staging },
        );
      }
      throw error;
    }
  } finally {
    await release();
  }
}
