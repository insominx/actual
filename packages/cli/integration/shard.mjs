import nodeTest from 'node:test';

// Optional round-robin sharding for very long test files. A shard file sets
// TEST_SHARD="<index>/<count>" (1-based) before importing the real test file;
// only every count-th test is registered. Without the variable every test runs,
// so the real file still works on its own.
const spec = /^(\d+)\/(\d+)$/.exec(process.env.TEST_SHARD ?? '');
const shard = spec ? Number(spec[1]) : 0;
const count = spec ? Number(spec[2]) : 0;
if (spec && (shard < 1 || shard > count)) {
  throw new Error(`Invalid TEST_SHARD "${process.env.TEST_SHARD}"`);
}
let registered = 0;

export function test(...args) {
  if (!spec) return nodeTest(...args);
  const mine = registered++ % count === shard - 1;
  return mine ? nodeTest(...args) : undefined;
}
