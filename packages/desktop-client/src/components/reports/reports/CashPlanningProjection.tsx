import { Trans } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import type { CashPlanningProjection as Projection } from '@actual-app/core/types/models/cash-planning';

import { usePrivacyMode } from '#hooks/usePrivacyMode';

import { CashPlanningMoney } from './CashPlanningMoney';

export function CashPlanningProjection({
  projection,
  title,
}: {
  projection: Projection;
  title: string;
}) {
  const privacy = usePrivacyMode();
  return (
    <section style={{ flex: '1 1 280px', minWidth: 0 }}>
      <h3>{title}</h3>
      <p>
        <Trans>Monthly category outflows</Trans>:{' '}
        <CashPlanningMoney amount={projection.monthlyOutflow} />
      </p>
      <p>
        <Trans>Monthly surplus</Trans>:{' '}
        <CashPlanningMoney amount={projection.monthlySurplus} />
      </p>
      {projection.remaining !== null && (
        <p>
          <Trans>Remaining to goal</Trans>:{' '}
          <CashPlanningMoney amount={projection.remaining} />
        </p>
      )}
      {projection.goalState !== 'none' && (
        <p data-testid="goal-completion">
          <Trans>Estimated completion</Trans>:{' '}
          {privacy ? (
            '••••'
          ) : projection.goalState === 'reached' ? (
            <Trans>Already reached</Trans>
          ) : projection.goalState === 'unreachable' ? (
            <Trans>Not reached at this rate</Trans>
          ) : (
            (projection.completionDate ?? (
              <Trans>Beyond supported date range</Trans>
            ))
          )}
        </p>
      )}
      {projection.deadline && (
        <>
          {projection.deadline.requiredSurplus !== null ? (
            <>
              <p>
                <Trans>Required monthly surplus</Trans>:{' '}
                <CashPlanningMoney
                  amount={projection.deadline.requiredSurplus}
                />
              </p>
              <p>
                <Trans>Maximum monthly category outflows</Trans>:{' '}
                <CashPlanningMoney
                  amount={projection.deadline.maximumOutflow ?? 0}
                />
              </p>
              <p>
                <Trans>Monthly surplus gap (projected minus required)</Trans>:{' '}
                <CashPlanningMoney
                  amount={projection.deadline.surplusGap ?? 0}
                />
              </p>
            </>
          ) : (
            <p>
              <Trans>The deadline is today or has passed.</Trans>
            </p>
          )}
          <p>
            <Trans>Balance gap at deadline (projected minus goal)</Trans>:{' '}
            <CashPlanningMoney amount={projection.deadline.balanceGap} />
          </p>
        </>
      )}
      {projection.depletionDate && (
        <p style={{ color: theme.errorText }}>
          <Trans>Net cash depletion</Trans>:{' '}
          {privacy ? '••••' : projection.depletionDate}
        </p>
      )}
    </section>
  );
}
