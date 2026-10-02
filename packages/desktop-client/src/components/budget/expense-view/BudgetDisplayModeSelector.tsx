import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { View } from '@actual-app/components/view';

import { useLocalPref } from '#hooks/useLocalPref';

import { parseDisplayMode } from './expenseData';

export function BudgetDisplayModeSelector() {
  const { t } = useTranslation();
  const [preference, setPreference] = useLocalPref('budget.displayMode');
  const mode = parseDisplayMode(preference);
  return (
    <View
      role="group"
      aria-label={t('Budget display')}
      style={{ flexDirection: 'row', gap: 5, padding: '8px 0', flexShrink: 0 }}
    >
      <Button
        variant={mode === 'budget' ? 'primary' : 'normal'}
        aria-pressed={mode === 'budget'}
        onPress={() => setPreference('budget')}
      >
        <Trans>Budget</Trans>
      </Button>
      <Button
        variant={mode === 'expenses' ? 'primary' : 'normal'}
        aria-pressed={mode === 'expenses'}
        onPress={() => setPreference('expenses')}
      >
        <Trans>Expenses</Trans>
      </Button>
    </View>
  );
}
