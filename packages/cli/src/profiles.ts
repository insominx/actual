import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { AgentError } from './agent-output';
import { isRecord } from './utils';

export type Profile = {
  serverUrl?: string;
  syncId?: string;
  budgetId?: string;
  dataDir?: string;
  offline?: boolean;
  passwordFile?: string;
  sessionTokenFile?: string;
  encryptionPasswordFile?: string;
};
type ProfileStore = {
  schemaVersion: 1;
  selected?: string;
  profiles: Record<string, Profile>;
};
const fields = [
  'serverUrl',
  'syncId',
  'budgetId',
  'dataDir',
  'passwordFile',
  'sessionTokenFile',
  'encryptionPasswordFile',
];

export function profilesPath(path?: string) {
  return (
    path ??
    process.env.ACTUAL_PROFILES_FILE ??
    join(homedir(), '.actual-cli', 'profiles.json')
  );
}

export function validateProfile(value: unknown): Profile {
  if (!isRecord(value)) {
    throw new AgentError('INVALID_INPUT', 'A profile must be a JSON object.');
  }
  for (const [key, field] of Object.entries(value)) {
    if (
      key === 'offline'
        ? typeof field !== 'boolean'
        : !fields.includes(key) || typeof field !== 'string' || !field.trim()
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Invalid profile field. Store secret file references, not passwords.',
        false,
        { field: key },
      );
    }
  }
  if (value.budgetId && value.syncId) {
    throw new AgentError(
      'INVALID_INPUT',
      'A profile must select a local budget ID or a remote sync ID, not both.',
    );
  }
  if (typeof value.serverUrl === 'string') {
    let url: URL;
    try {
      url = new URL(value.serverUrl);
    } catch {
      throw new AgentError(
        'INVALID_INPUT',
        'Profile server URL must be an HTTP or HTTPS URL.',
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        'Use an HTTP or HTTPS URL without embedded credentials.',
      );
    }
  }
  return value;
}

export async function readProfiles(path?: string): Promise<ProfileStore> {
  let text: string;
  try {
    text = await readFile(profilesPath(path), 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return { schemaVersion: 1, profiles: {} };
    }
    throw new AgentError('INVALID_INPUT', 'Cannot read the profiles file.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AgentError('INVALID_INPUT', 'Invalid profiles JSON.');
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.profiles) ||
    (value.selected !== undefined && typeof value.selected !== 'string')
  ) {
    throw new AgentError('INVALID_INPUT', 'Unsupported profiles file schema.');
  }
  const profiles = Object.fromEntries(
    Object.entries(value.profiles).map(([name, profile]) => [
      name,
      validateProfile(profile),
    ]),
  );
  if (
    value.selected !== undefined &&
    !Object.keys(profiles).includes(value.selected)
  ) {
    throw new AgentError('INVALID_INPUT', 'Selected profile does not exist.');
  }
  return {
    schemaVersion: 1,
    profiles,
    ...(typeof value.selected === 'string' ? { selected: value.selected } : {}),
  };
}

export async function selectedProfile(
  name?: string,
  path?: string,
): Promise<Profile | undefined> {
  const store = await readProfiles(path);
  const selected = name ?? store.selected;
  if (!selected) return undefined;
  if (!Object.keys(store.profiles).includes(selected)) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Unknown profile. Run profiles list.',
    );
  }
  return store.profiles[selected];
}

export async function saveProfiles(store: ProfileStore, path?: string) {
  const target = profilesPath(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(temporary, target);
}

export function readProfileSecret(path?: string): Promise<string | undefined> {
  if (!path) return Promise.resolve(undefined);
  return readFile(path, 'utf8')
    .then(value => value.trim())
    .catch(() => {
      throw new AgentError(
        'MISSING_CONTEXT',
        'Cannot read a configured profile secret file.',
      );
    });
}
