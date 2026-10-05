import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export function isolatedEnv(extra = {}) {
  // Never inherit a personal Actual selector, password, cache, or provider setting.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ACTUAL_')),
  );
  return { ...env, ...extra };
}

export async function runNode(
  args,
  { cwd = repoRoot, env = {}, input, timeout = 30000 } = {},
) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: isolatedEnv(env),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => {
    stdout += data;
  });
  child.stderr.on('data', data => {
    stderr += data;
  });
  child.stdin.end(input);
  return await new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Disposable child process timed out.'));
    }, timeout);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

export async function unusedPort() {
  const listener = createServer();
  await new Promise(resolveReady =>
    listener.listen(0, '127.0.0.1', resolveReady),
  );
  const port = listener.address().port;
  await new Promise(resolveClosed => listener.close(resolveClosed));
  return port;
}

export async function createFixture({
  encrypted = false,
  fresh = false,
  browser = false,
  richBackup = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'actual-agent-cli-'));
  const port = await unusedPort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const password = 'disposable-cli-test-password';
  let server;
  let logs = '';
  const serverEnv = {
    ACTUAL_DATA_DIR: join(root, 'server'),
    ACTUAL_PORT: String(port),
    ACTUAL_HOSTNAME: '127.0.0.1',
    NODE_ENV: browser ? 'production' : 'development',
    ...(browser
      ? { ACTUAL_WEB_ROOT: join(repoRoot, 'packages/desktop-client/build') }
      : {}),
  };
  async function start() {
    server = spawn(
      process.execPath,
      [join(repoRoot, 'packages/sync-server/build/app.js')],
      {
        cwd: root,
        env: isolatedEnv(serverEnv),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    server.stdout.on('data', data => {
      logs += data;
    });
    server.stderr.on('data', data => {
      logs += data;
    });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) {
        throw new Error(`Disposable server exited: ${logs}`);
      }
      try {
        if (
          (
            await fetch(`${serverUrl}/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          return;
        }
      } catch {
        /* Wait for the disposable server. */
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    throw new Error(`Disposable server health timeout: ${logs}`);
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const current = server;
    const closed = new Promise(resolveClosed =>
      current.once('close', resolveClosed),
    );
    current.kill();
    await closed;
    server = undefined;
  }
  async function dispose() {
    await stop();
    // The resolved deletion target is the exact mkdtemp root we created.
    if (
      !resolve(root).startsWith(resolve(tmpdir())) ||
      !root.includes('actual-agent-cli-')
    ) {
      throw new Error('Unexpected fixture cleanup path.');
    }
    await rm(root, { recursive: true, force: true });
  }
  try {
    await mkdir(serverEnv.ACTUAL_DATA_DIR, { recursive: true });
    await start();
    if (!fresh) {
      const response = await fetch(`${serverUrl}/account/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        throw new Error('Disposable password bootstrap failed.');
      }
      const seeded = await runNode(
        [join(repoRoot, 'packages/cli/integration/seed.mjs')],
        {
          cwd: root,
          env: {
            ACTUAL_SERVER_URL: serverUrl,
            ACTUAL_PASSWORD: password,
            ACTUAL_DATA_DIR: join(root, 'seed'),
            ACTUAL_TEST_ENCRYPTED: encrypted ? '1' : '0',
            ACTUAL_TEST_RICH_BACKUP: richBackup ? '1' : '0',
          },
        },
      );
      if (seeded.code !== 0) {
        throw new Error(
          `Disposable seed failed: ${seeded.stderr}\n${seeded.stdout}`,
        );
      }
    }
    const fixture = fresh
      ? {}
      : JSON.parse(await readFile(join(root, 'seed/fixture.json'), 'utf8'));
    async function cli(
      args,
      { client = 'a', input, version = '2', env = {}, timeout = 30000 } = {},
    ) {
      return runNode(
        [
          join(repoRoot, 'packages/cli/dist/cli.js'),
          '--output-version',
          version,
          ...args,
        ],
        {
          cwd: root,
          input,
          timeout,
          env: {
            ACTUAL_SERVER_URL: serverUrl,
            ACTUAL_PASSWORD: password,
            ...(fixture.syncId ? { ACTUAL_SYNC_ID: fixture.syncId } : {}),
            ACTUAL_DATA_DIR: join(root, client),
            ACTUAL_PROFILES_FILE: join(root, 'profiles.json'),
            ...env,
            ...(encrypted && env.ACTUAL_ENCRYPTION_PASSWORD === undefined
              ? { ACTUAL_ENCRYPTION_PASSWORD: 'disposable-encryption-password' }
              : {}),
          },
        },
      );
    }
    return {
      root,
      serverUrl,
      fixture,
      cli,
      start,
      stop,
      dispose,
      holdReadLock: async () => {
        const child = spawn(
          process.execPath,
          [join(repoRoot, 'packages/cli/integration/hold-lock.mjs')],
          {
            cwd: root,
            env: isolatedEnv({
              ACTUAL_TEST_LOCK_PATH: join(
                root,
                'a/.actual-cli',
                fixture.syncId,
              ),
            }),
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        await new Promise((resolveReady, reject) => {
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Lock fixture timed out.'));
          }, 5000);
          child.stdout.once('data', () => {
            clearTimeout(timer);
            resolveReady();
          });
          child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`Lock holder exited: ${code}`));
          });
        });
        return child;
      },
      writeInput: async (name, value) => {
        const path = join(root, name);
        await writeFile(path, JSON.stringify(value));
        return path;
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
