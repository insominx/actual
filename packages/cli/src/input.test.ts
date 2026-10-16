import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readJsonInput } from './input';

const dir = mkdtempSync(join(tmpdir(), 'actual-input-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fromFile(bytes: Buffer) {
  const file = join(dir, `f${Math.random()}.json`);
  writeFileSync(file, bytes);
  return readJsonInput({ file });
}

describe('readJsonInput', () => {
  it('reads UTF-8 data and files, dropping a byte order mark', () => {
    expect(readJsonInput({ data: '{"a":"é😀"}' })).toEqual({ a: 'é😀' });
    expect(
      fromFile(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('{"a":1}'),
        ]),
      ),
    ).toEqual({ a: 1 });
  });

  it('refuses bytes that are not valid UTF-8 instead of storing U+FFFD', () => {
    expect(() =>
      fromFile(
        Buffer.concat([
          Buffer.from('{"n":"caf'),
          Buffer.from([0xe9]),
          Buffer.from('"}'),
        ]),
      ),
    ).toThrow(/not valid UTF-8/);
  });

  it('refuses lone surrogates in values and keys but keeps real pairs', () => {
    expect(() => readJsonInput({ data: '{"n":"\\ud800"}' })).toThrow(
      /lone surrogate/,
    );
    expect(() => readJsonInput({ data: '[{"\\udc00":1}]' })).toThrow(
      /lone surrogate/,
    );
    expect(readJsonInput({ data: '["\\ud83d\\ude00"]' })).toEqual(['😀']);
  });
});
