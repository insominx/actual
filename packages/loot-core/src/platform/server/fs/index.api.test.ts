import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readFile, writeFileAtomic } from '#platform/server/fs';

describe('writeFileAtomic (node)', () => {
  let dir: string;
  beforeEach(() => {
    dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  });
  afterEach(() => {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the content and leaves no temporary file behind', async () => {
    const file = path.join(dir, 'metadata.json');
    await writeFileAtomic(file, '{"id":"a"}');
    await writeFileAtomic(file, '{"id":"b"}');
    expect(await readFile(file)).toBe('{"id":"b"}');
    expect(nodeFs.readdirSync(dir)).toEqual(['metadata.json']);
  });

  // Windows refuses to rename over a file a reader has open, so writeFileAtomic
  // falls back to an in-place write there and readers can see partial content.
  it('never exposes a truncated file to a concurrent reader', async ({
    skip,
  }) => {
    skip(process.platform === 'win32');
    const file = path.join(dir, 'metadata.json');
    const body = JSON.stringify({ id: 'x', pad: 'p'.repeat(4000) });
    await writeFileAtomic(file, body);
    let writing = true;
    const writer = (async () => {
      for (let i = 0; i < 300; i++) await writeFileAtomic(file, body);
      writing = false;
    })();
    let torn = 0;
    let reads = 0;
    while (writing) {
      reads++;
      try {
        JSON.parse(nodeFs.readFileSync(file, 'utf8'));
      } catch {
        torn++;
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    await writer;
    expect(reads).toBeGreaterThan(0);
    expect(torn).toBe(0);
  });
});
