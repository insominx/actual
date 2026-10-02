import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { theme } from '@actual-app/components/theme';
import * as monthUtils from '@actual-app/core/shared/months';
import { css } from '@emotion/css';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import type { ExpensePeriod, ExpenseRow } from './expenseData';
import { useExpenseData } from './useExpenseData';

export function ExpenseTable({
  budgetId,
  period,
  anchor,
}: {
  budgetId: string | undefined;
  period: ExpensePeriod;
  anchor: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { status, summary, retry } = useExpenseData({
    budgetId,
    period,
    anchor,
  });
  if (!summary) {
    return status === 'error' ? (
      <div role="alert">
        <Trans>Expenses could not be loaded.</Trans>{' '}
        <Button onPress={retry}>
          <Trans>Retry</Trans>
        </Button>
      </div>
    ) : (
      <div role="status">
        <Trans>Loading expenses…</Trans>
      </div>
    );
  }
  const rows: { row: ExpenseRow; kind: 'group' | 'category' | 'total' }[] = [
    ...summary.groups.flatMap(group => [
      { row: group, kind: 'group' as const },
      ...(expanded.has(group.id)
        ? group.categories.map(row => ({ row, kind: 'category' as const }))
        : []),
    ]),
    {
      row: { ...summary.uncategorized, name: t('Uncategorized outflows') },
      kind: 'total',
    },
    { row: { ...summary.total, name: t('Total net spending') }, kind: 'total' },
  ];
  return (
    <div
      role="region"
      aria-label={t('Expense grid')}
      tabIndex={0}
      style={{ overflow: 'auto', minWidth: 0, flex: 1 }}
    >
      <table
        className={css({
          borderCollapse: 'separate',
          borderSpacing: 0,
          backgroundColor: theme.tableBackground,
          color: theme.pageText,
          width: 'max-content',
          minWidth: '100%',
          '& th, & td': {
            padding: '8px 10px',
            borderBottom: `1px solid ${theme.tableBorder}`,
            whiteSpace: 'nowrap',
          },
          '& thead th': {
            position: 'sticky',
            top: 0,
            backgroundColor: theme.tableBackground,
            zIndex: 2,
          },
          '& tr > :first-child': {
            position: 'sticky',
            left: 0,
            width: 150,
            minWidth: 150,
            maxWidth: 150,
            whiteSpace: 'normal',
            textAlign: 'left',
            backgroundColor: theme.tableBackground,
            zIndex: 1,
          },
          '& thead tr > :first-child': { zIndex: 3 },
          '& td': { textAlign: 'right', minWidth: 85 },
          '& button': {
            color: 'inherit',
            background: 'transparent',
            border: 0,
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            width: '100%',
            minHeight: 40,
            padding: 0,
          },
        })}
      >
        <caption style={{ textAlign: 'left', padding: '8px 0' }}>
          <Trans>Net spending</Trans>
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <Trans>Category</Trans>
            </th>
            {summary.columns.map(column => (
              <th
                key={column}
                scope="col"
                aria-label={monthUtils.format(
                  column,
                  period === 'month' ? 'MMMM d, yyyy' : 'MMMM yyyy',
                  locale,
                )}
              >
                {monthUtils.format(
                  column,
                  period === 'month' ? 'd' : 'MMM',
                  locale,
                )}
              </th>
            ))}
            <th scope="col">
              <Trans>Total</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, kind }) => (
            <tr
              key={`${kind}-${row.id}`}
              style={{ fontWeight: kind === 'category' ? 400 : 600 }}
            >
              <th
                scope="row"
                style={{
                  fontWeight: 'inherit',
                  paddingLeft: kind === 'category' ? 20 : 10,
                }}
              >
                {kind === 'group' ? (
                  <button
                    type="button"
                    aria-expanded={expanded.has(row.id)}
                    onClick={() =>
                      setExpanded(previous => {
                        const next = new Set(previous);
                        if (next.has(row.id)) {
                          next.delete(row.id);
                        } else {
                          next.add(row.id);
                        }
                        return next;
                      })
                    }
                  >
                    <span aria-hidden="true">
                      {expanded.has(row.id) ? '▾' : '▸'}{' '}
                    </span>
                    {row.name}
                  </button>
                ) : (
                  row.name
                )}
              </th>
              {[
                ...summary.columns.map(column => row.columns[column]),
                row.total,
              ].map((amount, index) => (
                <td key={index}>
                  <PrivacyFilter>
                    <FinancialText>{format(amount, 'financial')}</FinancialText>
                  </PrivacyFilter>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
