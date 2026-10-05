import { readFile } from 'node:fs/promises';

import * as api from '@actual-app/api';

import { captureBudgetSnapshot } from './budget-snapshot';
import { isRecord } from './utils';

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request: unknown = JSON.parse(input);
  if (
    !isRecord(request) ||
    typeof request.dataDir !== 'string' ||
    typeof request.archivePath !== 'string'
  ) {
    throw new Error('Invalid worker request.');
  }
  await api.init({ dataDir: request.dataDir, verbose: false });
  try {
    await api.importBudget(await readFile(request.archivePath));
    const identity = await api.inspectBudget();
    if (
      identity.syncId !== null ||
      identity.cloudFileId !== null ||
      identity.encryptKeyId !== null
    ) {
      throw new Error('Imported budget retains remote identity.');
    }
    const snapshot = await captureBudgetSnapshot();
    process.stdout.write(JSON.stringify({ identity, snapshot }) + '\n');
  } finally {
    await api.shutdown();
  }
} catch {
  process.stderr.write('Backup could not be imported and read in isolation.\n');
  process.exitCode = 1;
}
