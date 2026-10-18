import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';

import { useSyncServerStatus } from './useSyncServerStatus';

export function useAkahuStatus(enabled = true) {
  const [configuredAkahu, setConfiguredAkahu] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const status = useSyncServerStatus();

  useEffect(() => {
    if (!enabled) return;

    async function fetch() {
      setIsLoading(true);
      // A failed request must not leave the loading state on forever
      try {
        const results = await send('akahu-status');
        setConfiguredAkahu(results.configured || false);
      } catch {
        setConfiguredAkahu(false);
      } finally {
        setIsLoading(false);
      }
    }

    if (status === 'online') {
      void fetch();
    }
  }, [status, enabled]);

  return {
    configuredAkahu,
    isLoading,
  };
}
