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
  if (supervisorIsGone(state.pid)) {
    return {
      running: false,
      serverDir: config.serverDir,
      serverUrl: `http://127.0.0.1:${config.port}`,
      staleState: true,
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
    const previous = await readRuntimeState(dir);
    // Metadata left by a supervisor that no longer exists (crash, reboot,
    // forced kill) is cleared; the port check below still refuses to start
    // while an orphaned server child holds the port. Nothing is killed.
    if (previous && supervisorIsGone(previous.pid)) {
      await removeStaleState(dir, previous);
    } else if (previous) {
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
        // A supervisor that is exiting can drop its control server between
        // the state read and this request; the exit check above handles it.
        const status = await runtimeStatus(dir).catch(() => undefined);
        if (status?.running && status.healthy) return status;
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    const failedState = await readRuntimeState(dir);
    // The supervisor may already be exiting, which makes the stop request
    // fail. That must not replace the startup failure with a vaguer error.
    let stopConfirmed = child.exitCode !== null;
    if (failedState?.owner === owner && failedState.token === token) {
      stopConfirmed = await controlRequest(failedState, 'stop').then(
        () => true,
        () => child.exitCode !== null,
      );
    }
    // Without control ownership, do not kill the supervisor and orphan its child.
    throw new AgentError(
      'ENGINE_FAILURE',
      'The managed server failed to become healthy within 15 seconds. Inspect server logs.',
      true,
      { issue: 'startup-failed', stopConfirmed },
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
    if (supervisorIsGone(state.pid)) {
      await removeStaleState(dir, state);
      // An orphaned server child may outlive its supervisor. It has no
      // control channel, so report it instead of killing anything.
      await assertFreePort(config.port).catch(() => {
        throw new AgentError(
          'ENGINE_FAILURE',
          'The recorded supervisor is gone, but the server port is still in use. No process was stopped. Stop the port owner manually.',
          false,
          { issue: 'port-unavailable', staleStateRemoved: true },
        );
      });
      return {
        stopped: true,
        alreadyStopped: true,
        staleStateRemoved: true,
        serverDir: config.serverDir,
      };
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

// Signal 0 only checks existence. Only ESRCH proves the recorded supervisor
// is gone; EPERM or success may be a reused PID, so the state is kept.
function supervisorIsGone(pid: number) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return isRecord(error) && error.code === 'ESRCH';
  }
}

async function removeStaleState(dir: string, stale: { owner: string }) {
  const current = await readRuntimeState(dir);
  if (current?.owner !== stale.owner) return;
  await unlink(runtimePaths(dir).state).catch(error => {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  });
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
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          // A partially written line should read as an invalid log
          throw new AgentError(
            'ENGINE_FAILURE',
            'Invalid supervisor event log.',
          );
        }
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
