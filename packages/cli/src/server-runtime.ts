import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentError } from './agent-output';
import { acquireExclusive } from './lock';
import {
  controlRequest,
  fileHash,
  readRuntimeConfig,
  readRuntimeState,
  runtimePaths,
  verifyRuntimeEntry,
  writePrivateJson,
} from './runtime-state';
import { isRecord } from './utils';

export async function initRuntime(dir: string, port: number, entry?: string) {
  if (!dir.trim()) {
    throw new AgentError(
      'INVALID_INPUT',
      'Provide a nonempty server data directory.',
    );
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new AgentError(
      'INVALID_INPUT',
      'The server port must be an integer from 1 to 65535.',
    );
  }
  let executable: string;
  try {
    executable = await realpath(
      entry ??
        join(
          dirname(
            createRequire(import.meta.url).resolve(
              '@actual-app/sync-server/package.json',
            ),
          ),
          'build/bin/actual-server.js',
        ),
    );
  } catch {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Install or build @actual-app/sync-server, or provide --server-entry.',
      false,
      { issue: 'server-package-unavailable' },
    );
  }
  const paths = runtimePaths(dir);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const release = await acquireExclusive(paths.root, { timeoutMs: 1000 });
  try {
    try {
      await readFile(paths.config);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        await writePrivateJson(paths.config, {
          schemaVersion: 1,
          serverDir: resolve(dir),
          entry: executable,
          entryHash: await fileHash(executable),
          port,
        });
        return {
          initialized: true,
          serverDir: resolve(dir),
          serverUrl: `http://127.0.0.1:${port}`,
        };
      }
      throw error;
    }
    throw new AgentError(
      'INVALID_INPUT',
      'This directory already has runtime configuration. Existing configuration was preserved.',
    );
  } finally {
    await release();
  }
}

async function assertFreePort(port: number) {
  const listener = createServer();
  try {
    await new Promise<void>((resolveReady, reject) => {
      listener.once('error', reject);
      listener.listen(port, '127.0.0.1', resolveReady);
    });
  } catch {
    throw new AgentError(
      'ENGINE_FAILURE',
      'The configured server port is occupied or unavailable. Stop its owner or choose another directory and port.',
      false,
      { issue: 'port-unavailable' },
    );
  } finally {
    if (listener.listening) {
      await new Promise<void>((resolveClosed, reject) =>
        listener.close(error => (error ? reject(error) : resolveClosed())),
      );
    }
  }
}

export async function runtimeStatus(dir: string) {
  const config = await readRuntimeConfig(dir);
  await verifyRuntimeEntry(config);
  const state = await readRuntimeState(dir);
  if (!state) {
    return {
      running: false,
      serverDir: config.serverDir,
      serverUrl: `http://127.0.0.1:${config.port}`,
    };
  }
  if (
    state.configHash !== (await fileHash(runtimePaths(dir).config)) ||
    state.entryHash !== config.entryHash
  ) {
    throw new AgentError(
      'ENGINE_FAILURE',
      'Runtime configuration changed while the process was running.',
      false,
      { issue: 'configuration-changed' },
    );
  }
  const status = await controlRequest(state, 'status');
  return {
    running: status.running === true,
    healthy: status.healthy === true,
    serverDir: config.serverDir,
    serverUrl: `http://127.0.0.1:${config.port}`,
    pid: state.pid,
  };
}

export async function startRuntime(dir: string) {
  const paths = runtimePaths(dir);
  const config = await readRuntimeConfig(dir);
  await verifyRuntimeEntry(config);
  const release = await acquireExclusive(paths.root, { timeoutMs: 1000 });
  try {
    if (await readRuntimeState(dir)) {
      const existing = await runtimeStatus(dir);
      if (existing.running) return existing;
      throw new AgentError(
        'ENGINE_FAILURE',
        'The previous runtime needs cleanup. Inspect server status before starting another process.',
      );
    }
    await assertFreePort(config.port);
    const token = randomBytes(32).toString('hex');
    const owner = randomUUID();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('ACTUAL_') &&
          !['DEBUG', 'NODE_OPTIONS', 'NODE_ENV'].includes(key),
      ),
    );
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./server-runner.js', import.meta.url)),
        resolve(dir),
      ],
      {
        cwd: resolve(dir),
        env: {
          ...env,
          ACTUAL_CLI_RUNTIME_TOKEN: token,
          ACTUAL_CLI_RUNTIME_OWNER: owner,
        },
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    let launchError = false;
    child.once('error', () => {
      launchError = true;
    });
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (launchError || child.exitCode !== null) break;
      const state = await readRuntimeState(dir);
      if (state?.owner === owner && state.token === token) {
        const status = await runtimeStatus(dir);
        if (status.running && status.healthy) return status;
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    const failedState = await readRuntimeState(dir);
    if (failedState?.owner === owner && failedState.token === token) {
      await controlRequest(failedState, 'stop');
    }
    // Without control ownership, do not kill the supervisor and orphan its child.
    throw new AgentError(
      'ENGINE_FAILURE',
      'The managed server failed to become healthy within 15 seconds. Inspect server logs.',
      true,
      { issue: 'startup-failed' },
    );
  } finally {
    await release();
  }
}

export async function stopRuntime(dir: string) {
  const paths = runtimePaths(dir);
  const config = await readRuntimeConfig(dir);
  await verifyRuntimeEntry(config);
  const release = await acquireExclusive(paths.root, { timeoutMs: 1000 });
  try {
    const state = await readRuntimeState(dir);
    if (!state) {
      return { stopped: true, alreadyStopped: true };
    }
    await runtimeStatus(dir);
    await controlRequest(state, 'stop');
    // The supervisor acknowledges only after its original child exits.
    const current = await readRuntimeState(dir);
    if (current?.owner === state.owner) await unlink(paths.state);
    return { stopped: true, serverDir: config.serverDir };
  } finally {
    await release();
  }
}

export async function runtimeLogs(dir: string) {
  await readRuntimeConfig(dir);
  let content = '';
  try {
    const file = await open(runtimePaths(dir).events, 'r');
    try {
      const { size } = await file.stat();
      const length = Math.min(size, 65536);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, size - length);
      content = buffer.subarray(0, bytesRead).toString('utf8');
      if (size > length) content = content.slice(content.indexOf('\n') + 1);
      if (!content.endsWith('\n')) {
        content = content.slice(0, content.lastIndexOf('\n') + 1);
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') {
      throw new AgentError(
        'ENGINE_FAILURE',
        'Cannot read supervisor lifecycle logs. Check directory permissions.',
      );
    }
  }
  return {
    events: content
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-100)
      .map(line => {
        const value: unknown = JSON.parse(line);
        if (
          !isRecord(value) ||
          typeof value.at !== 'string' ||
          ![
            'starting',
            'healthy',
            'stopped',
            'startup-failed',
            'supervisor-failed',
            'server-exited',
          ].includes(String(value.event))
        ) {
          throw new AgentError(
            'ENGINE_FAILURE',
            'Invalid supervisor event log.',
          );
        }
        return { at: value.at, event: value.event };
      }),
    limit: 100,
    scope: 'supervisor-lifecycle',
  };
}
