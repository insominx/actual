import React from 'react';
import type { ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import * as monthUtils from '@actual-app/core/shared/months';
import * as d from 'date-fns';

import { useLocale } from '#hooks/useLocale';

type DateRangeProps = {
  start: string;
  end: string;
  type?: string;
  comparisonLabel?: string;
};

// parseDate is noon on the calendar day. A Date object is always truthy,
// so an unparseable value must be rejected with isValid; formatting it
// throws. Re-parsing the day at midnight can move the 1st into the
// previous month.
export function parseReportRangeDate(date: string): Date | null {
  const parsed = monthUtils.parseDate(date);
  return d.isValid(parsed) ? parsed : null;
}

export function DateRange({
  start,
  end,
  type,
  comparisonLabel,
}: DateRangeProps): ReactElement {
  const { t } = useTranslation();
  const locale = useLocale();
  const startDate = parseReportRangeDate(start);
  const endDate = parseReportRangeDate(end);

  if (!startDate || !endDate) {
    return (
      <Text style={{ ...styles.mediumText, color: theme.errorText }}>
        <Trans>There was a problem loading your date range</Trans>
      </Text>
    );
  }

  const formattedStartDate = d.format(startDate, 'MMM yyyy', { locale });
  const formattedEndDate = d.format(endDate, 'MMM yyyy', { locale });
  let typeOrFormattedEndDate: string;

  if (type && ['budget', 'average'].includes(type)) {
    typeOrFormattedEndDate =
      comparisonLabel ?? (type === 'budget' ? t('budgeted') : t('average'));
  } else {
    typeOrFormattedEndDate = formattedEndDate;
  }

  let content: string | ReactElement;
  if (['budget', 'average'].includes(type || '')) {
    content = (
      <div>
        <Trans>
          Compare {{ formattedStartDate }} to {{ typeOrFormattedEndDate }}
        </Trans>
      </div>
    );
  } else if (
    startDate.getFullYear() !== endDate.getFullYear() ||
    startDate.getMonth() !== endDate.getMonth()
  ) {
    content = (
      <div>
        {type ? (
          <Trans>
            Compare {{ formattedStartDate }} to {{ typeOrFormattedEndDate }}
          </Trans>
        ) : (
          <>
            {formattedStartDate} - {formattedEndDate}
          </>
        )}
      </div>
    );
  } else {
    content = d.format(endDate, 'MMMM yyyy', { locale });
  }

  return <Block style={{ color: theme.pageTextSubdued }}>{content}</Block>;
}
