import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';

import { validateBackupArchive } from './backup-validation';

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: boundary.spawn }));

it('waits for the cancelled worker to close before removing its private directory', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  let directory = '';
  let ready!: () => void;
  const started = new Promise<void>(resolve => {
    ready = resolve;
  });
  boundary.spawn.mockImplementation((_executable, _args, options) => {
    directory = options.cwd;
    ready();
    return child;
  });
  const controller = new AbortController();
  const validation = validateBackupArchive(
    new Uint8Array([1, 2, 3]),
    60,
    controller.signal,
  );
  // Attach the rejection handler before interrupting the process boundary.
  const outcome = validation.catch(error => error);
  await started;
  controller.abort();
  const killed = child.kill.mock.calls.length;
  expect((await stat(directory)).isDirectory()).toBe(true);
  child.emit('close', 1);
  const error = await outcome;
  expect(killed).toBe(1);
  expect(error.message).toContain('cancelled');
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});
