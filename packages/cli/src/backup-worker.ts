import { readFile } from 'node:fs/promises';

import * as api from '@actual-app/api';
import { strFromU8, unzipSync } from 'fflate';

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
    const archive = await readFile(request.archivePath);
    // An import gets a fresh local ID, so the archive's own identity comes
    // from its metadata.json; that is the ID the backup manifest recorded.
    const entries = unzipSync(archive, {
      filter: file => file.name === 'metadata.json',
    });
    const metadata: unknown = JSON.parse(strFromU8(entries['metadata.json']));
    if (!isRecord(metadata) || typeof metadata.id !== 'string') {
      throw new Error('Archive metadata has no budget ID.');
    }
    await api.importBudget(archive);
    const identity = await api.inspectBudget();
    if (
      identity.syncId !== null ||
      identity.cloudFileId !== null ||
      identity.encryptKeyId !== null
    ) {
      throw new Error('Imported budget retains remote identity.');
    }
    const snapshot = await captureBudgetSnapshot();
    process.stdout.write(
      JSON.stringify({ identity, archiveId: metadata.id, snapshot }) + '\n',
    );
  } finally {
    await api.shutdown();
  }
} catch {
  process.stderr.write('Backup could not be imported and read in isolation.\n');
  process.exitCode = 1;
}
