import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { cosmiconfig } from 'cosmiconfig';

import { AgentError } from './agent-output';
import { readProfileSecret, selectedProfile } from './profiles';
import { isRecord, parseBoolEnv, parseNonNegativeIntFlag } from './utils';

export type CliConfig = {
  offline?: boolean;
  budgetId?: string;
  serverUrl: string;
  password?: string;
  sessionToken?: string;
  syncId?: string;
  dataDir: string;
  encryptionPassword?: string;
  cacheTtl: number;
  lockTimeout: number;
  refresh: boolean;
  noLock: boolean;
};

export type CliGlobalOpts = {
  offline?: boolean;
  budgetId?: string;
  profile?: string;
  profilesFile?: string;
  outputVersion?: string;
  serverUrl?: string;
  password?: string;
  sessionToken?: string;
  syncId?: string;
  dataDir?: string;
  encryptionPassword?: string;
  cacheTtl?: number;
  lockTimeout?: number;
  refresh?: boolean;
  // Commander stores --no-foo flags under the positive key. Default true,
  // false when the flag is passed.
  cache?: boolean;
  lock?: boolean;
  format?: 'json' | 'table' | 'csv';
  verbose?: boolean;
};

const stringKeys = [
  'serverUrl',
  'password',
  'sessionToken',
  'syncId',
  'dataDir',
  'encryptionPassword',
] as const;

const numberKeys = ['cacheTtl', 'lockTimeout'] as const;
const booleanKeys = ['noLock'] as const;

type ConfigFileContent = {
  serverUrl?: string;
  password?: string;
  sessionToken?: string;
  syncId?: string;
  dataDir?: string;
  encryptionPassword?: string;
  cacheTtl?: number;
  lockTimeout?: number;
  noLock?: boolean;
};

const configFileKeys: readonly string[] = [
  ...stringKeys,
  ...numberKeys,
  ...booleanKeys,
];

function validateConfigFileContent(value: unknown): ConfigFileContent {
  if (!isRecord(value)) {
    throw new Error(
      'Invalid config file: expected an object with keys: ' +
        configFileKeys.join(', '),
    );
  }
  for (const key of Object.keys(value)) {
    if (!configFileKeys.includes(key)) {
      throw new Error(`Invalid config file: unknown key "${key}"`);
    }
    const v = value[key];
    if (v === undefined) continue;
    if (
      (stringKeys as readonly string[]).includes(key) &&
      typeof v !== 'string'
    ) {
      throw new Error(
        `Invalid config file: key "${key}" must be a string, got ${typeof v}`,
      );
    }
    if (
      (numberKeys as readonly string[]).includes(key) &&
      (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    ) {
      throw new Error(
        `Invalid config file: key "${key}" must be a non-negative integer`,
      );
    }
    if (
      (booleanKeys as readonly string[]).includes(key) &&
      typeof v !== 'boolean'
    ) {
      throw new Error(
        `Invalid config file: key "${key}" must be a boolean, got ${typeof v}`,
      );
    }
  }
  return value as ConfigFileContent;
}

async function loadConfigFile(): Promise<ConfigFileContent> {
  const explorer = cosmiconfig('actual', {
    searchStrategy: 'global',
    searchPlaces: [
      'package.json',
      '.actualrc',
      '.actualrc.json',
      '.actualrc.yaml',
      '.actualrc.yml',
      'actual.config.json',
      'actual.config.yaml',
      'actual.config.yml',
    ],
  });
  const result = await explorer.search();
  if (result && !result.isEmpty) {
    return validateConfigFileContent(result.config);
  }
  return {};
}

/**
 * Reads the value of a `<VAR>_FILE` environment variable, returning the
 * contents of the file it points at and throwing if the file is not accessible.
 */
function readFileEnv(fileEnvVar: string): string | undefined {
  const filePath = process.env[fileEnvVar];

  if (filePath === undefined) return undefined;

  try {
    return readFileSync(filePath, 'utf-8').trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read ${fileEnvVar} from "${filePath}": ${reason}`,
    );
  }
}

function parseNonNegativeIntEnv(
  raw: string | undefined,
  source: string,
): number | undefined {
  return raw === undefined ? undefined : parseNonNegativeIntFlag(raw, source);
}

function validateNonNegativeInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid ${name}: expected a non-negative integer, got ${value}`,
    );
  }
  return value;
}

export async function resolveConfig(
  cliOpts: CliGlobalOpts,
): Promise<CliConfig> {
  const fileConfig = await loadConfigFile();
  const profile = await selectedProfile(
    cliOpts.profile ?? process.env.ACTUAL_PROFILE,
    cliOpts.profilesFile,
  );
  const explicitLocal = cliOpts.budgetId !== undefined;
  const explicitRemote = cliOpts.syncId !== undefined;
  if (explicitLocal && explicitRemote) {
    throw new AgentError(
      'INVALID_INPUT',
      'Choose --budget-id or --sync-id, not both.',
    );
  }
  const budgetId =
    cliOpts.budgetId ??
    (!explicitRemote
      ? (process.env.ACTUAL_BUDGET_ID ?? profile?.budgetId)
      : undefined);
  const offline =
    cliOpts.offline ??
    parseBoolEnv(process.env.ACTUAL_OFFLINE, 'ACTUAL_OFFLINE') ??
    profile?.offline ??
    false;
  if (budgetId && !offline) {
    throw new AgentError(
      'INVALID_INPUT',
      'Local --budget-id selection requires --offline. Use a sync ID for online access.',
    );
  }
  if (offline && (cliOpts.refresh || cliOpts.cache === false)) {
    throw new AgentError(
      'INVALID_INPUT',
      'Offline access cannot request a server refresh.',
    );
  }

  const serverUrl =
    cliOpts.serverUrl ??
    process.env.ACTUAL_SERVER_URL ??
    profile?.serverUrl ??
    fileConfig.serverUrl ??
    '';

  const password = offline
    ? undefined
    : (cliOpts.password ??
      readFileEnv('ACTUAL_PASSWORD_FILE') ??
      process.env.ACTUAL_PASSWORD ??
      (await readProfileSecret(profile?.passwordFile)) ??
      fileConfig.password);

  const sessionToken = offline
    ? undefined
    : (cliOpts.sessionToken ??
      readFileEnv('ACTUAL_SESSION_TOKEN_FILE') ??
      process.env.ACTUAL_SESSION_TOKEN ??
      (await readProfileSecret(profile?.sessionTokenFile)) ??
      fileConfig.sessionToken);

  const syncId =
    cliOpts.syncId ??
    (!budgetId
      ? (process.env.ACTUAL_SYNC_ID ?? profile?.syncId ?? fileConfig.syncId)
      : undefined);

  const dataDir =
    cliOpts.dataDir ??
    process.env.ACTUAL_DATA_DIR ??
    profile?.dataDir ??
    fileConfig.dataDir ??
    join(homedir(), '.actual-cli', 'data');

  const encryptionPassword = offline
    ? undefined
    : (cliOpts.encryptionPassword ??
      readFileEnv('ACTUAL_ENCRYPTION_PASSWORD_FILE') ??
      process.env.ACTUAL_ENCRYPTION_PASSWORD ??
      (await readProfileSecret(profile?.encryptionPasswordFile)) ??
      fileConfig.encryptionPassword);

  if (!serverUrl && !offline) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Server URL is required. Set --server-url, ACTUAL_SERVER_URL env var, or serverUrl in config file.',
    );
  }

  if (!password && !sessionToken && !offline) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Authentication required. Set --password/--session-token, ACTUAL_PASSWORD/ACTUAL_SESSION_TOKEN env var, or password/sessionToken in config file.',
    );
  }

  const cacheTtl = validateNonNegativeInt(
    cliOpts.cacheTtl ??
      parseNonNegativeIntEnv(
        process.env.ACTUAL_CACHE_TTL,
        'ACTUAL_CACHE_TTL',
      ) ??
      fileConfig.cacheTtl ??
      60,
    'cacheTtl',
  );

  const lockTimeout = validateNonNegativeInt(
    cliOpts.lockTimeout ??
      parseNonNegativeIntEnv(
        process.env.ACTUAL_LOCK_TIMEOUT,
        'ACTUAL_LOCK_TIMEOUT',
      ) ??
      fileConfig.lockTimeout ??
      10,
    'lockTimeout',
  );

  const refresh = (cliOpts.refresh ?? false) || cliOpts.cache === false;

  const flagNoLock = cliOpts.lock === false ? true : undefined;
  const noLock =
    flagNoLock ??
    parseBoolEnv(process.env.ACTUAL_NO_LOCK, 'ACTUAL_NO_LOCK') ??
    fileConfig.noLock ??
    false;

  return {
    ...(offline ? { offline: true } : {}),
    ...(budgetId ? { budgetId } : {}),
    serverUrl,
    password,
    sessionToken,
    syncId,
    dataDir,
    encryptionPassword,
    cacheTtl,
    lockTimeout,
    refresh,
    noLock,
  };
}
