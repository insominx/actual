import { lstat, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { AgentError } from './agent-output';
import { listBackupArtifacts, readBackupArtifact } from './backup-artifacts';
import type { BackupManifest } from './backup-artifacts';
import { validateBackupArchive } from './backup-validation';
import { acquireExclusive } from './lock';
import { stableJson } from './utils';

export async function pruneBackupArtifacts(
  directory: string,
  keep: number,
  limit: number,
  timeout: number,
  apply: boolean,
  signal: AbortSignal,
) {
  const inventory = await listBackupArtifacts(directory, limit);
  if (inventory.truncated) {
    throw new AgentError(
      'INVALID_INPUT',
      'The artifact inventory exceeds limit. Increase limit before applying retention.',
    );
  }
  const root = await realpath(resolve(directory));
  const deadline = Date.now() + timeout * 1000;
  const release = await acquireExclusive(root, { timeoutMs: timeout * 1000 });
  const deleted: string[] = [];
  let activeArtifact: string | null = null;
  let mutationStarted = false;
  const checkDeadline = () => {
    if (signal.aborted) {
      throw new AgentError('INVALID_INPUT', 'Backup retention was cancelled.');
    }
    if (Date.now() >= deadline) {
      throw new AgentError(
        'INVALID_INPUT',
        'Backup retention exceeded its total deadline.',
      );
    }
  };
  const managed = async (path: string) => {
    const entry = await lstat(path);
    if (
      dirname(resolve(path)) !== root ||
      (await realpath(root)) !== root ||
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      (await realpath(path)) !== path
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'The artifact is outside the resolved backup directory or uses a symbolic link.',
      );
    }
    const entries = (await readdir(path)).sort();
    if (
      entries.length !== 2 ||
      entries[0] !== 'budget.zip' ||
      entries[1] !== 'manifest.json'
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Retention only manages directories containing budget.zip and manifest.json.',
      );
    }
  };
  try {
    checkDeadline();
    // Re-enumerate while holding the same root lock used by backup creation.
    const current = await listBackupArtifacts(root, limit);
    if (current.truncated) {
      throw new AgentError(
        'INVALID_INPUT',
        'The artifact inventory exceeds limit. Increase limit before applying retention.',
      );
    }
    const valid: Array<{ path: string; manifest: BackupManifest }> = [];
    const invalid: Array<{ path: string; reason: string }> = [];
    for (const item of current.items) {
      checkDeadline();
      try {
        await managed(item.path);
        const artifact = await readBackupArtifact(item.path);
        const checked = await validateBackupArchive(
          artifact.archive,
          (deadline - Date.now()) / 1000,
          signal,
        );
        if (checked.identity.id !== artifact.manifest.source.id) {
          throw new AgentError(
            'INVALID_INPUT',
            'Archive source identity mismatch.',
          );
        }
        valid.push({ path: artifact.path, manifest: artifact.manifest });
      } catch (error) {
        checkDeadline();
        if (!(error instanceof AgentError) || error.code !== 'INVALID_INPUT') {
          throw error;
        }
        invalid.push({ path: item.path, reason: error.message });
      }
    }
    valid.sort(
      (a, b) =>
        Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt) ||
        a.path.localeCompare(b.path),
    );
    const counts = new Map<string, number>();
    const kept: string[] = [];
    const candidates: typeof valid = [];
    for (const artifact of valid) {
      const id = artifact.manifest.source.id;
      const count = counts.get(id) ?? 0;
      counts.set(id, count + 1);
      if (count < keep) kept.push(artifact.path);
      else candidates.push(artifact);
    }
    if (apply) {
      // No deletion starts until every valid keeper and candidate still matches.
      for (const artifact of valid) {
        checkDeadline();
        await managed(artifact.path);
        const now = await readBackupArtifact(artifact.path);
        if (stableJson(now.manifest) !== stableJson(artifact.manifest)) {
          throw new AgentError(
            'STALE_PREVIEW',
            'A backup changed during retention. No deletion was started.',
          );
        }
      }
      for (const artifact of candidates) {
        checkDeadline();
        activeArtifact = artifact.path;
        await managed(artifact.path);
        const now = await readBackupArtifact(artifact.path);
        if (stableJson(now.manifest) !== stableJson(artifact.manifest)) {
          throw new AgentError(
            'STALE_PREVIEW',
            'A backup changed during retention.',
          );
        }
        mutationStarted = true;
        await unlink(join(artifact.path, 'budget.zip'));
        await unlink(join(artifact.path, 'manifest.json'));
        await rmdir(artifact.path);
        deleted.push(artifact.path);
        activeArtifact = null;
      }
    }
    return {
      directory: root,
      keep,
      limit,
      applied: apply,
      kept,
      candidates: candidates.map(item => item.path),
      invalid,
      deleted,
      validated: valid.length,
    };
  } catch (error) {
    if (mutationStarted) {
      throw new AgentError(
        'PARTIAL_COMPLETION',
        'Retention stopped after deletion started. Inspect the completed and active paths before retrying.',
        false,
        { deleted, activeArtifact },
      );
    }
    throw error;
  } finally {
    await release();
  }
}
