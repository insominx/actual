import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';

import { useLocale } from '#hooks/useLocale';
import { useLocalPref } from '#hooks/useLocalPref';
import { useMetadataPref } from '#hooks/useMetadataPref';

import { parseExpensePeriod } from './expenseData';
import { ExpenseTable } from './ExpenseTable';

export function ExpenseView({ initialMonth }: { initialMonth: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { isNarrowWidth } = useResponsive();
  const controlStyle = { minHeight: isNarrowWidth ? 40 : undefined };
  const [budgetId] = useMetadataPref('id');
  const [periodPref, setPeriod] = useLocalPref('budget.expensePeriod');
  const period = parseExpensePeriod(periodPref);
  const [month, setMonth] = useState(() =>
    monthUtils.isValidYearMonth(initialMonth) &&
    initialMonth >= '0001-01' &&
    initialMonth < '9999-01'
      ? initialMonth
      : monthUtils.currentMonth(),
  );
  const anchor = period === 'year' ? month.slice(0, 4) : month;
  const step = period === 'year' ? 12 : 1;
  return (
    <View
      data-testid="expense-view"
      style={{ flex: 1, minWidth: 0, minHeight: 0, padding: 8, gap: 10 }}
    >
      <View
        role="group"
        aria-label={t('Expense navigation')}
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <Button
          style={controlStyle}
          aria-label={t('Previous expense period')}
          isDisabled={period === 'year' ? anchor <= '0001' : month <= '0001-01'}
          onPress={() => setMonth(monthUtils.subMonths(month, step))}
        >
          ‹
        </Button>
        <strong data-testid="expense-period">
          {period === 'year'
            ? anchor
            : monthUtils.format(month, 'MMMM yyyy', locale)}
        </strong>
        <Button
          style={controlStyle}
          aria-label={t('Next expense period')}
          isDisabled={period === 'year' ? anchor >= '9998' : month >= '9998-12'}
          onPress={() => setMonth(monthUtils.addMonths(month, step))}
        >
          ›
        </Button>
        <Button
          style={controlStyle}
          onPress={() => setMonth(monthUtils.currentMonth())}
        >
          <Trans>Today</Trans>
        </Button>
      </View>
      <View
        role="group"
        aria-label={t('Expense period')}
        style={{ flexDirection: 'row', gap: 5 }}
      >
        <Button
          style={controlStyle}
          variant={period === 'month' ? 'primary' : 'normal'}
          aria-pressed={period === 'month'}
          onPress={() => setPeriod('month')}
        >
          <Trans>Month</Trans>
        </Button>
        <Button
          style={controlStyle}
          variant={period === 'year' ? 'primary' : 'normal'}
          aria-pressed={period === 'year'}
          onPress={() => setPeriod('year')}
        >
          <Trans>Year</Trans>
        </Button>
      </View>
      <ExpenseTable
        key={`${budgetId}-${period}-${anchor}`}
        budgetId={budgetId}
        period={period}
        anchor={anchor}
      />
    </View>
  );
}
