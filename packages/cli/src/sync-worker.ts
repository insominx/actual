import * as api from '@actual-app/api';

import type { CliGlobalOpts } from './config';
import { withConnection } from './connection';

// The watch coordinator sends resolved configuration over stdin, never argv.
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const options: CliGlobalOpts = JSON.parse(input);
  const status = await withConnection(options, () => api.getSyncStatus(), {
    mutates: false,
  });
  process.stdout.write(JSON.stringify(status) + '\n');
} catch (error) {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown';
  process.stdout.write(JSON.stringify({ error: { code } }) + '\n');
  process.stderr.write('Synchronization attempt failed.\n');
  process.exitCode = 1;
}
