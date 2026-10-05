import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep complete diagnostic output beyond the workflow verifier's text limit.
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
if (resolve(process.cwd()) !== root) {
  throw new Error('Run packaged verification from the repository root.');
}
const cli = join(root, 'packages/cli');
const manifest = JSON.parse(await readFile(join(cli, 'package.json'), 'utf8'));
const command = manifest.scripts['test:integration'].split(/\s+/);
if (
  command[0] !== 'node' ||
  command[1] !== '--test' ||
  command.slice(2).some(file => !/^integration\/[a-z-]+\.test\.mjs$/.test(file))
) {
  throw new Error(
    'Packaged verification requires the explicit integration test list.',
  );
}
const logPath = join(
  directory,
  'verification-publication-integration-full.txt',
);
const log = createWriteStream(logPath);
await once(log, 'open');
const child = spawn(
  'yarn',
  ['workspace', '@actual-app/cli', 'test:integration'],
  {
    cwd: root,
    windowsHide: true,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', data => log.write(data));
child.stderr.on('data', data => log.write(data));
const [code, signal] = await once(child, 'close');
log.end();
await once(log, 'finish');
console.log(JSON.stringify({ log: logPath, exitCode: code, signal }));
process.exitCode = code ?? 1;
