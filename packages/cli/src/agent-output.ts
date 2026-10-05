export const ERROR_EXIT_CODES = {
  INVALID_INPUT: 2,
  MISSING_CONTEXT: 3,
  STALE_PREVIEW: 4,
  ENGINE_FAILURE: 5,
  PARTIAL_COMPLETION: 6,
} as const;

export type AgentErrorCode = keyof typeof ERROR_EXIT_CODES;

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type AgentContext = {
  budgetId: string | null;
  syncId: string | null;
  serverUrl: string | null;
  mode: 'remote-cache' | 'offline-local' | 'no-budget';
  currency: string | null;
  scale: 100;
  lastSyncedAt: number | null;
  freshness: 'unknown' | 'observed';
  commit: 'none' | 'committed-local' | 'synced' | 'uncertain';
};

type Invocation = {
  operation: string;
  context: AgentContext;
  data?: unknown;
  hasOutput: boolean;
  warnings: string[];
};

// A CLI process runs one command. Do not use this state in a concurrent daemon.
let invocation: Invocation | undefined;

export function beginAgentOutput(operation: string) {
  invocation = {
    operation,
    context: {
      budgetId: null,
      syncId: null,
      serverUrl: null,
      mode: 'no-budget',
      currency: null,
      scale: 100,
      lastSyncedAt: null,
      freshness: 'unknown',
      commit: 'none',
    },
    warnings: [],
    hasOutput: false,
  };
}

export function updateAgentContext(context: Partial<AgentContext>) {
  if (invocation) Object.assign(invocation.context, context);
}

export function bufferAgentOutput(data: unknown): boolean {
  if (!invocation) return false;
  if (invocation.hasOutput) {
    throw new AgentError(
      'ENGINE_FAILURE',
      'The operation returned multiple results.',
    );
  }
  invocation.data = data;
  invocation.hasOutput = true;
  return true;
}

export function flushAgentOutput() {
  if (!invocation) return;
  const { operation, context, data, warnings } = invocation;
  invocation = undefined;
  process.stdout.write(
    JSON.stringify(
      { schemaVersion: 2, operation, context, data: data ?? null, warnings },
      null,
      2,
    ) + '\n',
  );
}

export function serializeAgentError(error: unknown) {
  const known = error instanceof AgentError;
  const code = known ? error.code : 'ENGINE_FAILURE';
  return {
    exitCode: ERROR_EXIT_CODES[code],
    error: {
      code,
      message: known
        ? error.message
        : 'The engine operation failed. Check connection, authentication, and server diagnostics.',
      retryable: known ? error.retryable : false,
      ...(known && error.details !== undefined
        ? { details: error.details }
        : {}),
    },
  };
}

export function writeAgentError(error: unknown, operation = 'unknown') {
  const result = serializeAgentError(error);
  process.stdout.write(
    JSON.stringify(
      {
        schemaVersion: 2,
        operation: invocation?.operation ?? operation,
        context: invocation?.context ?? null,
        error: result.error,
        warnings: [],
      },
      null,
      2,
    ) + '\n',
  );
  invocation = undefined;
  process.exitCode = result.exitCode;
}
