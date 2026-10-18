import { useTranslation } from 'react-i18next';

import type {
  AverageTemplate,
  CopyTemplate,
} from '@actual-app/core/types/models/templates';

import { AmountAdjustmentSummary } from './AmountAdjustmentSummary';

type HistoricalAutomationReadOnlyProps = {
  template: CopyTemplate | AverageTemplate;
};

export const HistoricalAutomationReadOnly = ({
  template,
}: HistoricalAutomationReadOnlyProps) => {
  const { t } = useTranslation();

  if (template.type === 'copy') {
    return (
      <>
        {t('budget-copy-months-ago', {
          count: template.lookBack,
          defaultValue_one: 'Budget the same amount as {{count}} month ago',
          defaultValue_other: 'Budget the same amount as {{count}} months ago',
        })}
      </>
    );
  }

  const base = (
    <>
      {t('budget-average-complete-months', {
        count: template.numMonths,
        defaultValue_one:
          'Budget the average of the last {{count}} complete month',
        defaultValue_other:
          'Budget the average of the last {{count}} complete months',
      })}
    </>
  );

  if (template.adjustment === undefined) {
    return base;
  }

  return (
    <>
      {base} <AmountAdjustmentSummary template={template} />
    </>
  );
};
