import { useEffect, useState } from 'react';

import * as monthUtils from '@actual-app/core/shared/months';
import type { ReservationsResult } from '@actual-app/core/types/models/reservations';
import { useQuery } from '@tanstack/react-query';

import { reservationQueries } from '#budget';

import { useFeatureFlag } from './useFeatureFlag';
import { useMetadataPref } from './useMetadataPref';
import { useSyncedPref } from './useSyncedPref';

export type ReservationsState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; result: ReservationsResult };

export function useReservations(month: string): ReservationsState {
  const isFlagEnabled = useFeatureFlag('budgetReservations');
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  const [budgetId] = useMetadataPref('id');
  const currentMonth = useCurrentMonth();

  const isEnabled =
    isFlagEnabled &&
    budgetType === 'envelope' &&
    Boolean(budgetId) &&
    month === currentMonth;

  const query = useQuery({
    ...reservationQueries.month(budgetId ?? '', month),
    enabled: isEnabled,
  });

  if (!isEnabled) {
    return { status: 'disabled' };
  }
  // Figures are only shown for a settled response, never while a newer one
  // is on its way.
  if (query.isFetching) {
    return { status: 'loading' };
  }
  if (query.isError) {
    return { status: 'error' };
  }
  if (!query.data) {
    return { status: 'loading' };
  }
  return { status: 'ready', result: query.data };
}

function useCurrentMonth() {
  const [currentMonth, setCurrentMonth] = useState(() =>
    monthUtils.currentMonth(),
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => setCurrentMonth(monthUtils.currentMonth());
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timer = setTimeout(() => {
        refresh();
        scheduleMidnight();
      }, nextMidnight.getTime() - now.getTime());
    };

    scheduleMidnight();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return currentMonth;
}
