import { createHash, randomUUID } from 'node:crypto';
import {
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AgentError } from './agent-output';
import { isRecord } from './utils';

export type RuntimeConfig = {
  schemaVersion: 1;
  serverDir: string;
  entry: string;
  entryHash: string;
  port: number;
};
export type RuntimeState = {
  schemaVersion: 1;
  owner: string;
  token: string;
  controlPort: number;
  pid: number;
  entryHash: string;
  configHash: string;
};
export function runtimePaths(dir: string) {
  const root = join(resolve(dir), '.actual-runtime');
  return {
    root,
    config: join(root, 'config.json'),
    state: join(root, 'state.json'),
    events: join(root, 'events.jsonl'),
  };
}
export async function fileHash(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
export async function readRuntimeConfig(dir: string): Promise<RuntimeConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(runtimePaths(dir).config, 'utf8'));
  } catch {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Initialize this server directory with server init first.',
    );
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.serverDir !== resolve(dir) ||
    typeof value.entry !== 'string' ||
    typeof value.entryHash !== 'string' ||
    !Number.isInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65535
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'Invalid runtime configuration. Restore the original configuration.',
    );
  }
  return {
    schemaVersion: 1,
    serverDir: value.serverDir,
    entry: value.entry,
    entryHash: value.entryHash,
    port: Number(value.port),
  };
}
export async function verifyRuntimeEntry(config: RuntimeConfig) {
  try {
    if (
      (await realpath(config.entry)) === config.entry &&
      (await fileHash(config.entry)) === config.entryHash
    ) {
      return;
    }
  } catch {
    /* Report a stable error without arbitrary filesystem diagnostics. */
  }
  throw new AgentError(
    'ENGINE_FAILURE',
    'The server executable is missing or changed. Restore it before managing this process.',
    false,
    { issue: 'executable-changed' },
  );
}
export async function readRuntimeState(
  dir: string,
): Promise<RuntimeState | null> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(runtimePaths(dir).state, 'utf8'));
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw new AgentError(
      'ENGINE_FAILURE',
      'Cannot read runtime ownership metadata. Do not stop a process by its recorded PID.',
      false,
      { issue: 'invalid-ownership' },
    );
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.owner !== 'string' ||
    typeof value.token !== 'string' ||
    typeof value.entryHash !== 'string' ||
    typeof value.configHash !== 'string' ||
    !Number.isInteger(value.controlPort) ||
    Number(value.controlPort) < 1 ||
    Number(value.controlPort) > 65535 ||
    !Number.isInteger(value.pid)
  ) {
    throw new AgentError(
      'ENGINE_FAILURE',
      'Invalid runtime ownership metadata.',
      false,
      { issue: 'invalid-ownership' },
    );
  }
  return {
    schemaVersion: 1,
    owner: value.owner,
    token: value.token,
    controlPort: Number(value.controlPort),
    pid: Number(value.pid),
    entryHash: value.entryHash,
    configHash: value.configHash,
  };
}
export async function writePrivateJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function controlRequest(
  state: RuntimeState,
  action: 'status' | 'stop',
) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${state.controlPort}/${action}`,
      {
        method: action === 'stop' ? 'POST' : 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${state.token}` },
        signal: AbortSignal.timeout(4000),
      },
    );
    const value: unknown = await response.json();
    if (
      !response.ok ||
      !isRecord(value) ||
      value.owner !== state.owner ||
      value.pid !== state.pid ||
      value.entryHash !== state.entryHash ||
      value.configHash !== state.configHash
    ) {
      throw new Error('identity mismatch');
    }
    return value;
  } catch {
    throw new AgentError(
      action === 'stop' ? 'PARTIAL_COMPLETION' : 'ENGINE_FAILURE',
      action === 'stop'
        ? 'The stop outcome is unknown. Inspect server status before another lifecycle action.'
        : 'The managed supervisor is unreachable or its identity does not match. No process was stopped. Inspect the runtime directory.',
      false,
      { issue: 'ownership-unconfirmed' },
    );
  }
}
