import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import { usePrivacyMode } from '#hooks/usePrivacyMode';

export function CashPlanningMoney({ amount }: { amount: number }) {
  const format = useFormat();
  const privacy = usePrivacyMode();
  return (
    <FinancialText>
      {privacy ? '••••' : format(Math.round(amount), 'financial')}
    </FinancialText>
  );
}
