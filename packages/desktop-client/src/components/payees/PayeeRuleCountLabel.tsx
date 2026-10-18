import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';

type PayeeRuleCountLabelProps = {
  count: number;
  isLoading?: boolean;
  style?: CSSProperties;
};

export function PayeeRuleCountLabel({
  count,
  isLoading,
  style,
}: PayeeRuleCountLabelProps) {
  const { t } = useTranslation();
  return (
    <Text style={style}>
      {isLoading ? (
        <View>
          <AnimatedLoading style={{ width: 12, height: 12 }} />
        </View>
      ) : count > 0 ? (
        t('payee-associated-rules-count', {
          count,
          defaultValue_one: '{{count}} associated rule',
          defaultValue_other: '{{count}} associated rules',
        })
      ) : (
        <Trans>Create rule</Trans>
      )}
    </Text>
  );
}
