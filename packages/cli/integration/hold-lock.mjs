import { acquireShared } from '../src/lock.ts';

const release = await acquireShared(process.env.ACTUAL_TEST_LOCK_PATH, {
  timeoutMs: 1000,
});
process.stdout.write('ready\n');
process.stdin.resume();
process.stdin.on('end', async () => {
  await release();
  process.exit();
});
