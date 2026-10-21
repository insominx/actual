import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addStatement,
  listStatements,
  removeStatement,
} from './statement-evidence';

function entry(accountId: string, month: string, endingBalance: number) {
  return {
    accountId,
    month,
    endingBalance,
    noActivity: false,
    source: null,
    importOperationId: null,
  };
}

describe('statement evidence aliases', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'actual-cli-statements-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reads evidence stored under an older key for the same budget', async () => {
    // Recorded offline by local ID before keys were unified.
    await addStatement(dataDir, 'local-id', entry('a', '2026-01', 100), false);
    await addStatement(dataDir, 'sync-1', entry('a', '2026-02', 200), false);
    const list = await listStatements(dataDir, 'sync-1', ['local-id']);
    expect(list.map(s => s.month)).toEqual(['2026-01', '2026-02']);
    expect(await listStatements(dataDir, 'sync-1')).toHaveLength(1);
  });

  it('prefers the canonical entry and migrates aliases on write', async () => {
    await addStatement(dataDir, 'local-id', entry('a', '2026-01', 100), false);
    await addStatement(dataDir, 'local-id', entry('b', '2026-01', 5), false);
    await addStatement(dataDir, 'sync-1', entry('a', '2026-01', 150), false);
    expect(
      (await listStatements(dataDir, 'sync-1', ['local-id'])).map(
        s => s.endingBalance,
      ),
    ).toEqual([150, 5]);
    // An alias entry counts as existing evidence.
    await expect(
      addStatement(dataDir, 'sync-1', entry('b', '2026-01', 6), false, [
        'local-id',
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await removeStatement(dataDir, 'sync-1', 'b', '2026-01', ['local-id']);
    expect(await listStatements(dataDir, 'local-id')).toEqual([]);
    expect(
      (await listStatements(dataDir, 'sync-1')).map(s => s.endingBalance),
    ).toEqual([150]);
  });
});
