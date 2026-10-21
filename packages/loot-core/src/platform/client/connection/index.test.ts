import type * as Connection from './index';

type FakeWorker = {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: unknown }) => void) | null;
};

function createFakeWorker(): FakeWorker {
  return { postMessage: vi.fn(), onmessage: null };
}

function emit(worker: FakeWorker, data: unknown) {
  worker.onmessage?.({ data });
}

async function connect(connection: typeof Connection, worker: FakeWorker) {
  const initPromise = connection.init(worker as unknown as Worker);
  emit(worker, { type: 'connect' });
  await initPromise;
}

function lastRequestId(worker: FakeWorker): string {
  const requests = worker.postMessage.mock.calls
    .map(([message]) => message)
    .filter(message => message.id);
  return requests[requests.length - 1].id;
}

describe('client connection (browser)', () => {
  let connection: typeof Connection;

  beforeEach(async () => {
    // The global test setup mocks this module; exercise the real one with
    // fresh module state for every test.
    vi.resetModules();
    connection = await vi.importActual<typeof Connection>('./index');
  });

  it('rejects in-flight requests when disconnected', async () => {
    const worker = createFakeWorker();
    await connect(connection, worker);

    const pending = connection.send('get-budgets');
    const pendingCatch = connection.sendCatch('get-budgets');

    connection.disconnect('shut down');

    await expect(pending).rejects.toMatchObject({
      type: 'ServerError',
      code: 'disconnected',
      message: 'shut down',
    });
    await expect(pendingCatch).resolves.toMatchObject({
      data: undefined,
      error: { code: 'disconnected', message: 'shut down' },
    });
  });

  it('rejects requests sent while disconnected without posting them', async () => {
    const worker = createFakeWorker();
    await connect(connection, worker);
    connection.disconnect();
    worker.postMessage.mockClear();

    await expect(connection.send('get-budgets')).rejects.toMatchObject({
      code: 'disconnected',
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('rejects an init still waiting for the backend to connect', async () => {
    const worker = createFakeWorker();
    const initPromise = connection.init(worker as unknown as Worker);

    connection.disconnect('replaced');

    await expect(initPromise).rejects.toMatchObject({
      code: 'disconnected',
      message: 'replaced',
    });
  });

  it('routes requests to the new backend after reconnecting', async () => {
    const oldWorker = createFakeWorker();
    await connect(connection, oldWorker);
    connection.disconnect();

    const newWorker = createFakeWorker();
    await connect(connection, newWorker);

    const result = connection.send('get-budgets');
    const id = lastRequestId(newWorker);
    // A late reply from the old backend must not reach the new request.
    expect(oldWorker.onmessage).toBeNull();
    emit(newWorker, { type: 'reply', id, result: ['budget'], mutated: true });

    await expect(result).resolves.toEqual(['budget']);
  });
});
