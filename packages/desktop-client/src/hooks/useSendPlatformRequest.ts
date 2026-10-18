// @ts-strict-ignore
import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import type { Handlers } from '@actual-app/core/types/handlers';

export function useSendPlatformRequest<K extends keyof Handlers>(
  name: K,
  args?: Parameters<Handlers[K]>[0],
  options?: { catchErrors?: boolean },
) {
  const [data, setData] = useState<Awaited<ReturnType<Handlers[K]>>>(null);
  const [isLoading, setIsLoading] = useState<boolean | null>(null);

  useEffect(() => {
    // Drop the response of a request that has since been superseded
    let cancelled = false;
    async function run() {
      setIsLoading(true);
      try {
        const result = await send(name, args, options);
        if (!cancelled) {
          setData(result);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [name, args, options]);

  return {
    data,
    isLoading,
  };
}
