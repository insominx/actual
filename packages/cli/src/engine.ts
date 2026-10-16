import type * as Api from '@actual-app/api';

// The engine (@actual-app/api and the whole budget server behind it) takes about
// half a second to load. Commands that never touch it (help, version,
// capabilities, schema, profiles, mcp) skip loading, so they start immediately.
// Every other process, including workers and tests, loads it before any command
// code runs, so `api` behaves exactly like a static namespace import.

// Global options that take a value; their value is not the command name. A unit
// test keeps this list in step with the options createProgram registers.
export const GLOBAL_VALUE_OPTIONS: readonly string[] = [
  '--profile',
  '--profiles-file',
  '--budget-id',
  '--server-url',
  '--password',
  '--session-token',
  '--sync-id',
  '--data-dir',
  '--encryption-password',
  '--cache-ttl',
  '--lock-timeout',
  '--format',
  '--output-version',
];

const ENGINE_FREE_COMMANDS = new Set([
  'capabilities',
  'schema',
  'profiles',
  'mcp',
  'help',
]);

export function engineNeeded(argv: readonly string[]): boolean {
  let command: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;
    if (
      arg === '-h' ||
      arg === '--help' ||
      arg === '-V' ||
      arg === '--version'
    ) {
      help = true;
      continue;
    }
    if (arg.startsWith('-')) {
      if (GLOBAL_VALUE_OPTIONS.includes(arg)) i++;
      continue;
    }
    command ??= arg;
  }
  if (help) return false;
  return command === undefined || !ENGINE_FREE_COMMANDS.has(command);
}

const unavailable = new Proxy(
  {},
  {
    get(_target, key) {
      if (typeof key === 'symbol' || key === 'then') return undefined;
      throw new Error(
        `The engine is not loaded for this command (api.${key}). This is a bug.`,
      );
    },
  },
) as typeof Api;

export const api: typeof Api = engineNeeded(process.argv.slice(2))
  ? await import('@actual-app/api')
  : unavailable;
