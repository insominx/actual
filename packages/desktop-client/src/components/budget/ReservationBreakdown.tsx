import React from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AlignedText } from '@actual-app/components/aligned-text';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type {
  ReadyReservationRow,
  ReservationUnavailableReason,
} from '@actual-app/core/types/models/reservations';
import type { TFunction } from 'i18next';

import { useEnvelopeSheetValue } from '#components/budget/envelope/EnvelopeBudgetComponents';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useReservations } from '#hooks/useReservations';
import { envelopeBudget } from '#spreadsheet/bindings';

type ReservationBreakdownProps = {
  categoryId: string;
  month: string;
  style?: CSSProperties;
};

export function ReservationBreakdown({
  categoryId,
  month,
  style,
}: ReservationBreakdownProps) {
  const { t } = useTranslation();
  const state = useReservations(month);
  const canonicalBalance =
    useEnvelopeSheetValue(envelopeBudget.catBalance(categoryId)) ?? 0;

  if (state.status === 'disabled') {
    return null;
  }

  if (state.status !== 'ready') {
    return (
      <Panel style={style}>
        <AmountLine label={t('Total balance')} amount={canonicalBalance} />
        <Message>
          {state.status === 'loading' ? (
            <Trans>Calculating reservations…</Trans>
          ) : (
            <Trans>Reservations are unavailable right now.</Trans>
          )}
        </Message>
      </Panel>
    );
  }

  const row = state.result.categories.find(c => c.categoryId === categoryId);
  if (!row) {
    return null;
  }

  if (row.state === 'unavailable') {
    return (
      <Panel style={style}>
        <AmountLine label={t('Total balance')} amount={canonicalBalance} />
        <Message>{getReasonText(row.reason, t)}</Message>
      </Panel>
    );
  }

  if (row.claims.length === 0 && row.allowanceTotal === 0) {
    return null;
  }

  return <ReadyBreakdown row={row} style={style} />;
}

function ReadyBreakdown({
  row,
  style,
}: {
  row: ReadyReservationRow;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';

  return (
    <Panel style={style}>
      <AmountLine label={t('Total balance')} amount={row.balance} />
      <AmountLine label={t('Reserved')} amount={row.reserved} />
      {row.claims.map(claim => (
        <AlignedText
          key={claim.key}
          style={{ paddingLeft: 10, color: theme.pageTextSubdued }}
          left={
            <Text>
              {t('{{label}}, due {{date}}', {
                label: claim.label,
                date: monthUtils.format(claim.nextDate, dateFormat),
              })}
            </Text>
          }
          right={
            <PrivacyFilter>
              <FinancialText>
                {t('{{accrued}} of {{target}}', {
                  accrued: format(claim.accrued, 'financial'),
                  target: format(claim.target, 'financial'),
                })}
              </FinancialText>
            </PrivacyFilter>
          }
        />
      ))}
      <AmountLine label={t('Allowance remaining')} amount={row.allowance} />
      <AmountLine
        label={t('Spare')}
        amount={row.spare}
        color={row.spare < 0 ? theme.errorText : undefined}
      />
    </Panel>
  );
}

function Panel({
  style,
  children,
}: {
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <View
      data-testid="reservation-breakdown"
      style={{
        gap: 4,
        padding: '8px 10px',
        borderBottom: `1px solid ${theme.tableBorder}`,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

function AmountLine({
  label,
  amount,
  color,
}: {
  label: string;
  amount: number;
  color?: string;
}) {
  const format = useFormat();
  return (
    <AlignedText
      left={<Text>{label}</Text>}
      right={
        <PrivacyFilter>
          <FinancialText style={{ color }}>
            {format(amount, 'financial')}
          </FinancialText>
        </PrivacyFilter>
      }
    />
  );
}

function Message({ children }: { children: ReactNode }) {
  return <Text style={{ color: theme.pageTextSubdued }}>{children}</Text>;
}

function getReasonText(reason: ReservationUnavailableReason, t: TFunction) {
  switch (reason) {
    case 'invalid-template':
      return t('A template in this category could not be read.');
    case 'missing-schedule':
      return t('A schedule used by this category no longer exists.');
    case 'ambiguous-schedule':
      return t('A template matches more than one schedule with that name.');
    case 'inactive-schedule':
      return t('A schedule used by this category is not active this month.');
    case 'duplicate-schedule':
      return t(
        'The same schedule is used by templates with different options.',
      );
    case 'unsupported-template':
      return t(
        'This category uses templates that reservations do not support.',
      );
    default:
      return t('Reservations are unavailable for this category.');
  }
}
