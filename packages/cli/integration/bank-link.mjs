// Test-only helper: links disposable accounts to the fake SimpleFIN provider
// through the engine's own link handler, as the app does after consent.
import { mkdir } from 'node:fs/promises';

import * as api from '@actual-app/api';

const dataDir = process.env.ACTUAL_DATA_DIR;
if (!dataDir || !dataDir.includes('actual-agent-cli-')) {
  throw new Error('Linking requires the disposable fixture directory.');
}
await mkdir(dataDir, { recursive: true });
const engine = await api.init({
  dataDir,
  serverURL: process.env.ACTUAL_SERVER_URL,
  password: process.env.ACTUAL_PASSWORD,
});
try {
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID);
  const links = JSON.parse(process.env.BANK_LINKS);
  for (const externalAccount of links) {
    await engine.send('simplefin-accounts-link', {
      externalAccount,
      offBudget: false,
    });
  }
  await api.sync();
  const names = links.map(l => l.name);
  const accounts = (await api.getAccounts()).filter(a =>
    names.includes(a.name),
  );
  process.stdout.write(
    '\nLINKED:' +
      JSON.stringify(accounts.map(a => ({ id: a.id, name: a.name }))) +
      '\n',
  );
} finally {
  await api.shutdown();
}
