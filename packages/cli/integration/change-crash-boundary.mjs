import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join, resolve } from 'node:path';

// Test-only loader: pause actual receipt publication, leaving engine writes real.
const phase = process.env.ACTUAL_TEST_CHANGE_PHASE;
const id = process.env.ACTUAL_TEST_CHANGE_ID;
const root = resolve(process.env.ACTUAL_DATA_DIR ?? '');
if (
  !root.includes('actual-agent-cli-') ||
  !/^[A-Za-z0-9_-]+$/.test(id ?? '') ||
  !['before-engine', 'after-engine', 'before-sync'].includes(phase)
) {
  throw new Error('Crash loader requires an explicit disposable fixture.');
}
const target = join(root, '.actual-cli', 'changes', id + '.json');
const originalRename = fs.promises.rename;
async function checkpoint() {
  process.stderr.write(
    JSON.stringify({ crashCheckpoint: phase, operationId: id }) + '\n',
  );
  await new Promise(() =>
    setInterval(() => {
      /* Keep this explicitly paused test child alive. */
    }, 1000),
  );
}
fs.promises.rename = async (from, to) => {
  if (resolve(to) !== target || !basename(from).endsWith('.pending')) {
    return originalRename(from, to);
  }
  const receipt = JSON.parse(await fs.promises.readFile(from, 'utf8'));
  if (phase === 'after-engine' && receipt.state === 'committed-local') {
    await checkpoint();
  }
  await originalRename(from, to);
  if (
    (phase === 'before-engine' && receipt.state === 'uncertain') ||
    (phase === 'before-sync' && receipt.state === 'committed-local')
  ) {
    await checkpoint();
  }
};
syncBuiltinESMExports();
