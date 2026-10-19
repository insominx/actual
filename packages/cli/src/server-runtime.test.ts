import type * as ChildProcess from 'node:child_process';
import type * as Crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentError } from './agent-output';
import type * as RuntimeState from './runtime-state';

const mocks = vi.hoisted(() => ({
  controlRequest: vi.fn(),
  readRuntimeState: vi.fn(),
  exitCode: 1 as number | null,
}));

vi.mock('node:crypto', async importOriginal => ({
  ...(await importOriginal<typeof Crypto>()),
  randomBytes: () => Buffer.alloc(32, 1),
  randomUUID: () => 'owner-under-test',
}));

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawn: () =>
    Object.assign(new EventEmitter(), {
      unref: () => undefined,
      get exitCode() {
        return mocks.exitCode;
      },
    }),
}));

vi.mock('./lock', () => ({
  acquireExclusive: async () => async () => undefined,
}));

vi.mock('./runtime-state', async importOriginal => ({
  ...(await importOriginal<typeof RuntimeState>()),
  controlRequest: mocks.controlRequest,
  readRuntimeConfig: async () => ({
    serverDir: '/tmp/unit-runtime',
    port: 0,
    entryHash: 'entry',
  }),
  verifyRuntimeEntry: async () => undefined,
  readRuntimeState: mocks.readRuntimeState,
}));

const { runtimeLogs, startRuntime } = await import('./server-runtime');

async function startupError() {
  try {
    await startRuntime('/tmp/unit-runtime');
  } catch (error) {
    return error;
  }
  throw new Error('startRuntime should have failed');
}

describe('startRuntime failure reporting', () => {
  beforeEach(() => {
    mocks.controlRequest.mockReset();
    mocks.exitCode = 1;
    // First read: no previous runtime. Later reads: this launch's own state.
    mocks.readRuntimeState.mockReset();
    mocks.readRuntimeState.mockResolvedValueOnce(undefined).mockResolvedValue({
      owner: 'owner-under-test',
      token: '01'.repeat(32),
    });
  });

  it('reports startup-failed when the exiting supervisor cannot answer the stop request', async () => {
    mocks.controlRequest.mockRejectedValue(
      new AgentError('ENGINE_FAILURE', 'unreachable', false, {
        issue: 'ownership-unconfirmed',
      }),
    );
    const error = await startupError();
    expect(error).toBeInstanceOf(AgentError);
    expect((error as AgentError).details).toEqual({
      issue: 'startup-failed',
      stopConfirmed: true,
    });
  });

  it('does not claim the stop is confirmed while the supervisor still runs', async () => {
    mocks.exitCode = null;
    mocks.controlRequest.mockRejectedValue(new Error('unreachable'));
    // Skip the 15 second wait: the first clock read sets the deadline and
    // every later read is already past it.
    const realNow = Date.now();
    let reads = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      reads += 1;
      return reads === 1 ? realNow : realNow + 20000;
    });
    let error: unknown;
    try {
      error = await startupError();
    } finally {
      clock.mockRestore();
    }
    expect((error as AgentError).details).toEqual({
      issue: 'startup-failed',
      stopConfirmed: false,
    });
  });
});

describe('runtimeLogs', () => {
  let dir: string;

  function writeEvents(content: string) {
    mkdirSync(join(dir, '.actual-runtime'), { recursive: true });
    writeFileSync(join(dir, '.actual-runtime', 'events.jsonl'), content);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'actual-cli-runtime-logs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the recorded lifecycle events', async () => {
    writeEvents(
      '{"at":"2026-01-01T00:00:00.000Z","event":"starting"}\n' +
        '{"at":"2026-01-01T00:00:01.000Z","event":"healthy"}\n',
    );
    const logs = await runtimeLogs(dir);
    expect(logs.events.map(event => event.event)).toEqual([
      'starting',
      'healthy',
    ]);
  });

  it('reports a malformed line as an invalid event log', async () => {
    writeEvents('{"at":"2026-01-01T00:00:00.000Z","ev\n');
    await expect(runtimeLogs(dir)).rejects.toMatchObject({
      code: 'ENGINE_FAILURE',
      message: 'Invalid supervisor event log.',
    });
  });
});
