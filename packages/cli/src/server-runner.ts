import { spawn } from 'node:child_process';
import { appendFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import {
  fileHash,
  readRuntimeConfig,
  readRuntimeState,
  runtimePaths,
  verifyRuntimeEntry,
  writePrivateJson,
} from './runtime-state';

const dir = process.argv[2];
const token = process.env.ACTUAL_CLI_RUNTIME_TOKEN;
const owner = process.env.ACTUAL_CLI_RUNTIME_OWNER;
if (!dir || !token || !owner) {
  throw new Error('Run this supervisor through actual server start.');
}
const config = await readRuntimeConfig(dir);
await verifyRuntimeEntry(config);
const paths = runtimePaths(dir);
const configHash = await fileHash(paths.config);
const identity = {
  owner,
  entryHash: config.entryHash,
  configHash,
  pid: process.pid,
};
const serverConfig = join(paths.root, 'actual-server.json');
await writePrivateJson(serverConfig, {
  dataDir: config.serverDir,
  port: config.port,
  hostname: '127.0.0.1',
});
async function event(code: string) {
  await appendFile(
    paths.events,
    JSON.stringify({ at: new Date().toISOString(), event: code }) + '\n',
    { mode: 0o600 },
  );
}
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('ACTUAL_')),
);
const child = spawn(
  process.execPath,
  [config.entry, '--config', serverConfig],
  {
    cwd: config.serverDir,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...env,
      NODE_ENV: 'production',
      ACTUAL_DATA_DIR: config.serverDir,
      ACTUAL_PORT: String(config.port),
      ACTUAL_HOSTNAME: '127.0.0.1',
      ACTUAL_CLI_RUNTIME_OWNER: owner,
    },
  },
);
let healthy = false;
let stopping = false;
let exited = false;
let stopPromise: Promise<void> | undefined;
const childClosed = new Promise<void>(resolveClosed => {
  child.once('close', () => {
    exited = true;
    resolveClosed();
  });
  child.once('error', () => {
    exited = true;
    resolveClosed();
  });
});
function stopChild(): Promise<void> {
  stopPromise ??= (async () => {
    stopping = true;
    if (!exited) {
      child.kill();
      const timer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 1500);
      await childClosed;
      clearTimeout(timer);
    }
    const state = await readRuntimeState(dir);
    if (state?.owner === owner) await unlink(paths.state);
    await event('stopped');
  })();
  return stopPromise;
}
async function probeHealth() {
  if (exited || stopping) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
      signal: AbortSignal.timeout(500),
      redirect: 'error',
    });
    const value: unknown = await response.json();
    return (
      response.ok &&
      Boolean(
        value &&
        typeof value === 'object' &&
        'status' in value &&
        value.status === 'UP' &&
        'instanceId' in value &&
        value.instanceId === owner,
      )
    );
  } catch {
    return false;
  }
}
const control = createServer((request, response) => {
  void (async () => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    if (request.url === '/status' && request.method === 'GET') {
      healthy = await probeHealth();
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ ...identity, running: !exited && !stopping, healthy }),
      );
    } else if (request.url === '/stop' && request.method === 'POST') {
      await stopChild();
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ...identity, stopped: true }));
      control.close(() => process.exit(0));
    } else {
      response.writeHead(404).end();
    }
  })().catch(() => {
    response.writeHead(500).end();
  });
});
try {
  await new Promise<void>(resolveReady =>
    control.listen(0, '127.0.0.1', resolveReady),
  );
  const address = control.address();
  if (!address || typeof address === 'string') {
    throw new Error('Control listener unavailable.');
  }
  await writePrivateJson(paths.state, {
    schemaVersion: 1,
    ...identity,
    token,
    controlPort: address.port,
  });
  await event('starting');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stopChild().finally(() => process.exit(0));
    });
  }
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !exited && !stopping) {
    if (await probeHealth()) {
      healthy = true;
      break;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  if (!healthy) {
    await event('startup-failed');
    await stopChild();
    control.close();
    process.exit(1);
  }
  await event('healthy');
  void childClosed
    .then(async () => {
      if (!stopping) {
        await event('server-exited');
        await stopChild();
        control.close();
      }
    })
    .catch(() => {
      control.close();
      process.exitCode = 1;
    });
} catch {
  await event('supervisor-failed').catch(() => undefined);
  await stopChild().catch(() => undefined);
  control.close();
  process.exitCode = 1;
}
