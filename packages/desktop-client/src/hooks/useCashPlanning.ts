import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import * as months from '@actual-app/core/shared/months';
import type {
  CashPlanningRequest,
  CashPlanningSummary,
} from '@actual-app/core/types/models/cash-planning';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { useMetadataPref } from './useMetadataPref';

export const cashPlanningQueries = {
  all: () => ['cash-planning'],
  summary: (budgetId: string, request: CashPlanningRequest, today: string) =>
    queryOptions<CashPlanningSummary>({
      queryKey: [...cashPlanningQueries.all(), budgetId, request, today],
      queryFn: async ({ signal }) => {
        const result = await send('cash-planning/get-summary', request);
        signal.throwIfAborted();
        return result;
      },
      staleTime: 0,
      retry: false,
    }),
};

export function useCashPlanning(request: CashPlanningRequest, enabled = true) {
  const [budgetId] = useMetadataPref('id');
  const [today, setToday] = useState(() => months.currentDay());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refreshDay() {
      setToday(months.currentDay());
    }
    function schedule() {
      const now = new Date();
      timer = setTimeout(
        () => {
          refreshDay();
          schedule();
        },
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1,
        ).getTime() - now.getTime(),
      );
    }
    schedule();
    document.addEventListener('visibilitychange', refreshDay);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshDay);
    };
  }, []);
  const query = useQuery({
    ...cashPlanningQueries.summary(budgetId ?? '', request, today),
    enabled: Boolean(budgetId) && enabled,
  });
  return {
    ...query,
    // Never expose cached figures while a newer request is pending or failed.
    data:
      enabled && budgetId && !query.isFetching && !query.isError
        ? query.data
        : undefined,
  };
}
