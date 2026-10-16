import { describe, expect, it } from 'vitest';

import { readJsonWithRetry } from './read-metadata';

describe('readJsonWithRetry', () => {
  it('recovers when the file is read while it is being rewritten', async () => {
    const reads = ['', '{"id":', '{"id":"a"}'];
    const result = await readJsonWithRetry<{ id: string }>(
      async () => reads.shift() ?? '',
      { delayMs: 1 },
    );
    expect(result).toEqual({ id: 'a' });
  });

  it('still fails for a file that stays corrupt', async () => {
    await expect(
      readJsonWithRetry(async () => '{"id":', { attempts: 3, delayMs: 1 }),
    ).rejects.toThrow();
  });

  it('does not retry a read that succeeds', async () => {
    let calls = 0;
    await readJsonWithRetry(async () => {
      calls++;
      return '{}';
    });
    expect(calls).toBe(1);
  });
});
