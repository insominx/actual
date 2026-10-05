import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as api from '@actual-app/api';

import { writeAgentError } from './agent-output';
import { createProgram } from './program';

// Simulate the native-module loading boundary; HTTP and command execution are real.
vi.mock('@actual-app/api', () => ({ init: vi.fn() }));

describe('public diagnostic failures', () => {
  it('identifies native bindings and incompatible server metadata without exposing details', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'actual-cli-doctor-'));
    if (!dir.startsWith(join(tmpdir(), 'actual-cli-doctor-'))) {
      throw new Error('Unexpected cleanup path');
    }
    let info: unknown = {
      build: { name: '@actual-app/sync-server', version: '26.9.0' },
    };
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(info));
    });
    await new Promise<void>(resolveReady =>
      server.listen(0, '127.0.0.1', resolveReady),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Fixture address unavailable');
    }
    const output = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      vi.stubEnv('ACTUAL_PROFILES_FILE', join(dir, 'profiles.json'));
      vi.stubEnv('ACTUAL_PROFILE', '');
      vi.stubEnv('ACTUAL_SYNC_ID', '');
      vi.stubEnv('ACTUAL_BUDGET_ID', '');
      vi.stubEnv('ACTUAL_OFFLINE', 'false');
      vi.stubEnv('ACTUAL_SESSION_TOKEN_FILE', undefined);
      vi.stubEnv('ACTUAL_ENCRYPTION_PASSWORD_FILE', undefined);
      const run = async () => {
        const program = createProgram('test');
        try {
          await program.parseAsync(
            [
              '--server-url',
              `http://127.0.0.1:${address.port}`,
              '--password',
              'disposable-secret',
              '--data-dir',
              dir,
              'doctor',
            ],
            { from: 'user' },
          );
        } catch (error) {
          writeAgentError(error);
        }
        return JSON.parse(String(output.mock.calls.at(-1)?.[0]));
      };
      vi.mocked(api.init).mockRejectedValueOnce(
        new Error('Could not locate the bindings file at secret/private/path'),
      );
      let result = await run();
      expect(result.error.details.issue).toBe('native-module-unavailable');
      expect(JSON.stringify(result)).not.toContain('secret/private/path');
      info = { server: 'unrelated' };
      result = await run();
      expect(result.error.details.issue).toBe('server-incompatible');
      expect(api.init).toHaveBeenCalledTimes(1);
    } finally {
      output.mockRestore();
      vi.unstubAllEnvs();
      process.exitCode = 0;
      await new Promise<void>(resolveClosed =>
        server.close(() => resolveClosed()),
      );
      await rm(dir, { recursive: true, force: true });
    }
  });
});
