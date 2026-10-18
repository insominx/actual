import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('orders keys by code unit regardless of locale', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3 })).toBe('{"B":2,"a":3,"b":1}');
  });

  it('is independent of key insertion order and drops undefined values', () => {
    expect(canonicalJson({ x: 1, y: [2, { q: 1, p: undefined }] })).toBe(
      canonicalJson({ y: [2, { p: undefined, q: 1 }], x: 1 }),
    );
  });
});
