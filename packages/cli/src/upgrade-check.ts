// Read-only upgrade diagnosis for device-local CLI state. Every store this
// CLI writes carries a schemaVersion; this check lists what is on disk,
// which versions this CLI reads, and what to do about anything it cannot
// read. It never rewrites, migrates or deletes a file: all current stores
// are at their first schema version, so there is no older version to
// migrate, and a newer one needs a newer CLI.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { profilesPath } from './profiles';
import { evidencePath } from './statement-evidence';
import { isRecord } from './utils';

export const SUPPORTED_SCHEMA_VERSIONS = {
  profiles: [1],
  receipts: [1],
  workflowRuns: [1],
  jobs: [1],
  bankSyncRuns: [1],
  statementEvidence: [1],
} as const;

type StoreName = keyof typeof SUPPORTED_SCHEMA_VERSIONS;

type StoreReport = {
  store: StoreName;
  path: string;
  status: 'absent' | 'compatible' | 'incompatible';
  records: number;
  versions: Record<string, number>;
  unsupported: Array<{ file: string; schemaVersion: unknown }>;
  unreadable: string[];
};

async function files(dir: string, pattern: RegExp) {
  try {
    return (await readdir(dir))
      .filter(name => pattern.test(name))
      .sort()
      .map(name => join(dir, name));
  } catch {
    return null;
  }
}

async function inspect(
  store: StoreName,
  path: string,
  paths: string[] | null,
  extra?: (value: Record<string, unknown>) => void,
): Promise<StoreReport> {
  const report: StoreReport = {
    store,
    path,
    status: 'absent',
    records: 0,
    versions: {},
    unsupported: [],
    unreadable: [],
  };
  if (!paths) return report;
  const supported: readonly number[] = SUPPORTED_SCHEMA_VERSIONS[store];
  for (const file of paths) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      report.unreadable.push(file);
      continue;
    }
    report.records++;
    const version = isRecord(value) ? value.schemaVersion : undefined;
    const key = String(version);
    report.versions[key] = (report.versions[key] ?? 0) + 1;
    if (typeof version !== 'number' || !supported.includes(version)) {
      report.unsupported.push({ file, schemaVersion: version ?? null });
    } else if (extra && isRecord(value)) {
      extra(value);
    }
  }
  report.status =
    report.records === 0 && report.unreadable.length === 0
      ? 'absent'
      : report.unsupported.length || report.unreadable.length
        ? 'incompatible'
        : 'compatible';
  return report;
}

async function exists(path: string) {
  try {
    await readFile(path);
    return [path];
  } catch {
    return null;
  }
}

export async function upgradeCheck(
  dataDir: string,
  cliVersion: string,
  profilesFile?: string,
) {
  const root = resolve(dataDir);
  const pending: Array<{ operationId: unknown; state: unknown }> = [];
  const jobDirs = (await files(join(root, 'jobs'), /^[a-z0-9-]+$/)) ?? [];
  const jobFiles: string[] = [];
  for (const dir of jobDirs) {
    for (const name of ['job.json', 'state.json']) {
      const found = await exists(join(dir, name));
      if (found) jobFiles.push(...found);
    }
  }
  const unfinishedRuns: unknown[] = [];
  const stores = [
    await inspect(
      'profiles',
      profilesPath(profilesFile),
      await exists(profilesPath(profilesFile)),
    ),
    await inspect(
      'receipts',
      join(root, '.actual-cli', 'changes'),
      await files(join(root, '.actual-cli', 'changes'), /\.json$/),
      value => {
        if (value.state === 'prepared' || value.state === 'uncertain') {
          pending.push({ operationId: value.operationId, state: value.state });
        }
      },
    ),
    await inspect(
      'workflowRuns',
      join(root, 'workflow-runs'),
      await files(join(root, 'workflow-runs'), /^wf-[a-z0-9]+\.json$/),
      value => {
        if (['running', 'paused', 'failed'].includes(String(value.status))) {
          unfinishedRuns.push({ runId: value.runId, status: value.status });
        }
      },
    ),
    await inspect('jobs', join(root, 'jobs'), jobDirs.length ? jobFiles : null),
    await inspect(
      'bankSyncRuns',
      join(root, 'bank-sync-runs'),
      await files(join(root, 'bank-sync-runs'), /^[a-f0-9-]{36}\.json$/),
    ),
    await inspect(
      'statementEvidence',
      evidencePath(root),
      await exists(evidencePath(root)),
    ),
  ];
  const actions: string[] = [];
  for (const store of stores) {
    if (store.unsupported.length) {
      actions.push(
        `${store.store}: ${store.unsupported.length} record(s) use a schema version this CLI (${cliVersion}) does not read (supported: ${SUPPORTED_SCHEMA_VERSIONS[store.store].join(', ')}). Install the CLI version that wrote them; nothing was changed.`,
      );
    }
    if (store.unreadable.length) {
      actions.push(
        `${store.store}: ${store.unreadable.length} file(s) are not valid JSON. Restore them from a backup or move them aside; nothing was changed.`,
      );
    }
  }
  if (pending.length) {
    actions.push(
      `Inspect ${pending.length} prepared or uncertain receipt(s) with changes inspect <operation-id> before upgrading.`,
    );
  }
  if (unfinishedRuns.length) {
    actions.push(
      `Resume or cancel ${unfinishedRuns.length} unfinished workflow run(s) before upgrading (workflow run list).`,
    );
  }
  return {
    cli: {
      version: cliVersion,
      supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
    },
    dataDir: root,
    compatible: stores.every(s => s.status !== 'incompatible'),
    stores,
    pendingReceipts: pending,
    unfinishedRuns,
    preservedByEngine: [
      'budget IDs and sync IDs',
      'import mappings (synced budget preferences)',
      'cash planning (synced budget preferences)',
    ],
    actions,
  };
}
