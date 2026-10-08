import { startBackendWorker } from '@actual-app/core/platform/client/backend-worker';
import { disconnect, send } from '@actual-app/core/platform/client/connection';
import type { InitConfig } from '@actual-app/core/server/main';

import InlineWorker from './browser-worker?worker&inline';

export * from './methods';
export * as utils from './utils';

let worker: Worker | null = null;
let ownsSession = false;

// Terminate the current backend worker. The client connection is dropped
// first: messages posted to a terminated worker are silently discarded, so
// without it pending and later `send` calls would never settle.
function stopWorker(reason: string) {
  if (worker) {
    disconnect(reason);
    worker.terminate();
    worker = null;
  }
}

export async function init(
  config: InitConfig = {},
): Promise<{ send: typeof send }> {
  stopWorker('The API was re-initialized');
  const ownWorker = new InlineWorker();
  worker = ownWorker;

  try {
    await startBackendWorker(ownWorker, config);
    ownsSession = Boolean(config.serverURL && config.password);
  } catch (error) {
    // A concurrent init() may already have replaced (and terminated) this
    // worker; only tear down the connection if it still belongs to us.
    if (worker === ownWorker) {
      stopWorker('The API failed to initialize');
    } else {
      ownWorker.terminate();
    }
    throw error;
  }

  return { send };
}

export async function shutdown() {
  if (worker) {
    try {
      await send('sync');
    } catch {
      // most likely that no budget is loaded, so the sync failed
    }
    try {
      await send('close-budget');
    } finally {
      try {
        if (ownsSession) {
          await send('subscribe-sign-out');
        }
      } finally {
        ownsSession = false;
        stopWorker('The API was shut down');
      }
    }
  }
}
