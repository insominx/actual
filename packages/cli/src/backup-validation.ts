import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentError } from './agent-output';
import type { BudgetSnapshot } from './budget-snapshot';
import { isRecord } from './utils';

export async function withBackupCancellation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let inputLine = '';
  const onInput = (chunk: Buffer) => {
    inputLine = (inputLine + chunk.toString()).slice(-256);
    if (inputLine.split(/\r?\n/).some(line => line.trim() === 'cancel')) {
      cancel();
    }
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  process.stdin.on('data', onInput);
  process.stdin.resume();
  try {
    return await operation(controller.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    process.stdin.off('data', onInput);
    process.stdin.pause();
  }
}

async function removeValidationDirectory(root: string) {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('actual-backup-validation-')
  ) {
    throw new Error('Unexpected isolated validation path.');
  }
  await rm(root, { recursive: true, force: true });
}

export async function validateBackupArchive(
  archive: Uint8Array,
  timeout: number,
  signal?: AbortSignal,
) {
  const root = await mkdtemp(join(tmpdir(), 'actual-backup-validation-'));
  try {
    const dataDir = join(root, 'engine');
    const archivePath = join(root, 'archive.zip');
    await mkdir(dataDir);
    await writeFile(archivePath, archive, { flag: 'wx', mode: 0o600 });
    return await new Promise<{
      identity: Record<string, unknown>;
      snapshot: BudgetSnapshot;
    }>((resolveResult, reject) => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith('ACTUAL_'),
        ),
      );
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./backup-worker.js', import.meta.url))],
        { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let output = '';
      let timedOut = false;
      child.stdout.on('data', chunk => {
        output += chunk;
      });
      child.stderr.resume();
      child.stdin.on('error', () => {
        /* A terminated worker can close its pipe first. */
      });
      child.stdin.end(JSON.stringify({ dataDir, archivePath }));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout * 1000);
      const cancel = () => {
        child.kill();
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      };
      child.once('error', error => {
        cleanup();
        reject(error);
      });
      child.once('close', code => {
        cleanup();
        if (code !== 0 || timedOut || signal?.aborted) {
          reject(
            new AgentError(
              'INVALID_INPUT',
              signal?.aborted
                ? 'Backup validation was cancelled.'
                : timedOut
                  ? 'Backup validation exceeded its worker deadline.'
                  : 'Backup failed isolated engine import or domain queries.',
            ),
          );
          return;
        }
        try {
          const result: unknown = JSON.parse(output);
          if (
            !isRecord(result) ||
            !isRecord(result.identity) ||
            !isRecord(result.snapshot) ||
            result.snapshot.schemaVersion !== 1 ||
            !isRecord(result.snapshot.tables) ||
            !Array.isArray(result.snapshot.accountBalances)
          ) {
            throw new Error('Invalid worker result.');
          }
          resolveResult({
            identity: result.identity,
            snapshot: result.snapshot as BudgetSnapshot,
          });
        } catch {
          reject(
            new AgentError(
              'ENGINE_FAILURE',
              'The validation worker returned an invalid result.',
            ),
          );
        }
      });
    });
  } finally {
    await removeValidationDirectory(root);
  }
}
