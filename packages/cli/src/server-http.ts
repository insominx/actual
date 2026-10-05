import { AgentError } from './agent-output';
import { isRecord } from './utils';

export function serverUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentError(
      'INVALID_INPUT',
      'Provide a valid HTTP or HTTPS server URL.',
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AgentError(
      'INVALID_INPUT',
      'Use an HTTP or HTTPS server URL without credentials, query, or fragment.',
    );
  }
  return url.href.replace(/\/$/, '');
}

export async function serverRequest(
  base: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl(base)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AgentError(
      'ENGINE_FAILURE',
      'The server did not respond. Check its URL, process, and port.',
      true,
      { issue: 'server-unreachable' },
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AgentError(
      'ENGINE_FAILURE',
      'The server returned an incompatible response.',
      false,
      { issue: 'server-incompatible' },
    );
  }
  if (!response.ok || (isRecord(value) && value.status === 'error')) {
    const reason =
      isRecord(value) &&
      [
        'already-bootstrapped',
        'invalid-password',
        'too-many-requests',
      ].includes(String(value.reason))
        ? String(value.reason)
        : 'request-failed';
    throw new AgentError(
      reason === 'already-bootstrapped' || reason === 'invalid-password'
        ? 'INVALID_INPUT'
        : 'ENGINE_FAILURE',
      reason === 'already-bootstrapped'
        ? 'This server is already initialized. Bootstrap does not reset passwords.'
        : 'The server rejected the request.',
      false,
      { reason },
    );
  }
  return value;
}

export async function bootstrapServer(base: string, password: string) {
  if (!password) {
    throw new AgentError(
      'MISSING_CONTEXT',
      'Provide a first-run password through a secret file or environment variable.',
    );
  }
  const existing = await serverRequest(base, '/account/needs-bootstrap');
  if (
    !isRecord(existing) ||
    !isRecord(existing.data) ||
    typeof existing.data.bootstrapped !== 'boolean'
  ) {
    throw new AgentError(
      'ENGINE_FAILURE',
      'The server does not expose the supported bootstrap contract.',
      false,
      { issue: 'server-incompatible' },
    );
  }
  if (existing.data.bootstrapped) {
    throw new AgentError(
      'INVALID_INPUT',
      'This server is already initialized. Bootstrap does not reset passwords.',
      false,
      { reason: 'already-bootstrapped' },
    );
  }
  await serverRequest(base, '/account/bootstrap', { password });
  return { bootstrapped: true, authentication: 'password' };
}
