import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';

import { useSyncServerStatus } from './useSyncServerStatus';

export function useGoCardlessStatus() {
  const [configuredGoCardless, setConfiguredGoCardless] = useState<
    boolean | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const status = useSyncServerStatus();

  useEffect(() => {
    async function fetch() {
      setIsLoading(true);
      // A failed request must not leave the loading state on forever
      try {
        const results = await send('gocardless-status');
        setConfiguredGoCardless(results.configured || false);
      } catch {
        setConfiguredGoCardless(false);
      } finally {
        setIsLoading(false);
      }
    }

    if (status === 'online') {
      void fetch();
    }
  }, [status]);

  return {
    configuredGoCardless,
    isLoading,
  };
}
