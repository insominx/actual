import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { upgradeCheck } from './upgrade-check';

describe('upgrade check', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'actual-upgrade-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports absent stores as compatible', async () => {
    const report = await upgradeCheck(root, '26.9.0', join(root, 'p.json'));
    expect(report.compatible).toBe(true);
    expect(report.stores.every(s => s.status === 'absent')).toBe(true);
    expect(report.actions).toEqual([]);
  });

  it('flags newer, unreadable and pending records with actions', async () => {
    await mkdir(join(root, '.actual-cli', 'changes'), { recursive: true });
    await writeFile(
      join(root, '.actual-cli', 'changes', 'a.json'),
      JSON.stringify({
        schemaVersion: 1,
        operationId: 'a',
        state: 'uncertain',
      }),
    );
    await writeFile(
      join(root, '.actual-cli', 'changes', 'b.json'),
      JSON.stringify({ schemaVersion: 3, operationId: 'b' }),
    );
    await mkdir(join(root, 'workflow-runs'));
    await writeFile(join(root, 'workflow-runs', 'wf-x.json'), '{not json');
    await writeFile(
      join(root, 'workflow-runs', 'wf-y.json'),
      JSON.stringify({ schemaVersion: 1, runId: 'wf-y', status: 'paused' }),
    );
    const report = await upgradeCheck(root, '26.9.0', join(root, 'p.json'));
    expect(report.compatible).toBe(false);
    const receipts = report.stores.find(s => s.store === 'receipts');
    expect(receipts?.versions).toEqual({ 1: 1, 3: 1 });
    expect(report.pendingReceipts).toEqual([
      { operationId: 'a', state: 'uncertain' },
    ]);
    expect(report.unfinishedRuns).toEqual([
      { runId: 'wf-y', status: 'paused' },
    ]);
    expect(report.actions).toHaveLength(4);
  });
});
