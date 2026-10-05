import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';

import { AgentError } from '#agent-output';
import { listRuns } from '#bank-sync-runs';
import { resolveConfig } from '#config';

import { registerBankSyncCommand } from './bank-sync';

vi.mock('@actual-app/api', () => ({
  refreshBankSync: vi.fn().mockResolvedValue({
    prerequisite: null,
    attempted: 1,
    outcomes: [{ accountId: 'a', status: 'imported', addedIds: ['t'] }],
    coverage: 'not verified',
  }),
  getBankSyncStatus: vi.fn(),
}));

// The engine import commits locally, then the push fails.
vi.mock('#connection', () => ({
  withConnection: vi.fn(
    async (_opts: unknown, fn: (config: unknown) => Promise<void>) => {
      await fn({});
      throw new AgentError(
        'PARTIAL_COMPLETION',
        'Local changes committed, but synchronization failed.',
        true,
      );
    },
  ),
}));

vi.mock('#config', () => ({ resolveConfig: vi.fn() }));

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'bank-sync-test-'));
  vi.mocked(resolveConfig).mockResolvedValue({
    serverUrl: 'http://test',
    dataDir,
    syncId: 'sync-1',
    cacheTtl: 60,
    lockTimeout: 10,
    refresh: false,
    noLock: false,
  });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('bank-sync refresh', () => {
  it('keeps a failed push committed-local with a readable run record', async () => {
    const program = new Command();
    program.exitOverride();
    registerBankSyncCommand(program);
    let caught: unknown;
    try {
      await program.parseAsync(['node', 'actual', 'bank-sync', 'refresh']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentError);
    const error = caught as AgentError;
    expect(error.code).toBe('PARTIAL_COMPLETION');
    const details = error.details as { runId: string; commit: string };
    expect(details.commit).toBe('committed-local');
    const { runs } = await listRuns(dataDir, 'sync-1', 10);
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe(details.runId);
    expect(runs[0].commit).toBe('committed-local');
    expect(runs[0].result).toMatchObject({ attempted: 1 });
  });
});
