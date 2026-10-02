import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Input } from '@actual-app/components/input';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  cashPlanningChart,
  completePlanningMonths,
  dateAfterMonths,
  isPlanningDate,
  parseCashPlanningConfig,
  projectCashPlanning,
  UNCATEGORIZED_ID,
} from '@actual-app/core/shared/cash-planning';
import * as months from '@actual-app/core/shared/months';
import type { CashPlanningConfig } from '@actual-app/core/types/models/cash-planning';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { MobilePageHeader, Page, PageHeader } from '#components/Page';
import { useCashPlanning } from '#hooks/useCashPlanning';
import { useFormat } from '#hooks/useFormat';
import { useMetadataPref } from '#hooks/useMetadataPref';
import { useNavigate } from '#hooks/useNavigate';
import { usePrivacyMode } from '#hooks/usePrivacyMode';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { saveSyncedPrefs } from '#prefs/prefsSlice';
import { useDispatch } from '#redux';

import { CashPlanningMoney } from './CashPlanningMoney';
import { CashPlanningProjection } from './CashPlanningProjection';

export function CashPlanning() {
  const [budgetId] = useMetadataPref('id');
  return <CashPlanningInner key={budgetId} />;
}

type Draft = {
  startDate: string;
  endDate: string;
  targets: Record<string, string>;
  goal: string;
  deadline: string;
  forecastEndDate: string;
};

function CashPlanningInner() {
  const { t } = useTranslation();
  const format = useFormat();
  const privacy = usePrivacyMode();
  const { isNarrowWidth } = useResponsive();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [saved] = useSyncedPref('cashPlanning');
  const today = months.currentDay();
  const settings = parseCashPlanningConfig(saved, today);
  const [edit, setEdit] = useState<{
    draft: Draft;
    source: string | undefined;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error' | null>(null);
  const draft = edit?.draft ?? toDraft(settings);
  function toDraft(config: CashPlanningConfig): Draft {
    return {
      ...config,
      targets: Object.fromEntries(
        Object.entries(config.categoryTargets).map(([id, amount]) => [
          id,
          format.forEdit(Math.round(amount)),
        ]),
      ),
      goal: config.goal ? format.forEdit(config.goal.balance) : '',
      deadline: config.goal?.deadline ?? '',
      forecastEndDate:
        config.forecastEndDate ?? dateAfterMonths(today, 12) ?? '',
    };
  }
  function update(change: Partial<Draft>) {
    if (saving) {
      return;
    }
    setEdit({
      draft: { ...draft, ...change },
      source: edit ? edit.source : saved,
    });
    setSaveStatus(null);
  }
  const categoryTargets: Record<string, number> = {};
  let amountsValid = true;
  for (const [id, value] of Object.entries(draft.targets)) {
    if (value.trim() === '') {
      continue;
    }
    const amount = format.fromEdit(value, null);
    if (amount === null || !Number.isFinite(amount) || amount < 0) {
      amountsValid = false;
    } else {
      categoryTargets[id] = amount;
    }
  }
  const goalBalance =
    draft.goal.trim() === '' ? null : format.fromEdit(draft.goal, null);
  const goalValid =
    draft.goal.trim() === '' ||
    (goalBalance !== null && Number.isFinite(goalBalance));
  const rangeValid =
    isPlanningDate(draft.startDate) &&
    isPlanningDate(draft.endDate) &&
    draft.startDate <= draft.endDate &&
    draft.endDate <= today;
  const forecastValid =
    isPlanningDate(draft.forecastEndDate) && draft.forecastEndDate > today;
  const deadlineValid = !draft.deadline || isPlanningDate(draft.deadline);
  const planValid = amountsValid && goalValid && forecastValid && deadlineValid;
  const config: CashPlanningConfig = {
    startDate: draft.startDate,
    endDate: draft.endDate,
    categoryTargets,
    goal:
      goalBalance !== null
        ? { balance: goalBalance, deadline: draft.deadline || undefined }
        : undefined,
    forecastEndDate: draft.forecastEndDate,
  };
  const query = useCashPlanning(
    { startDate: draft.startDate, endDate: draft.endDate },
    rangeValid,
  );
  const summary = query.data;
  const projections =
    summary && planValid && summary.transactionCount > 0
      ? {
          historical: projectCashPlanning(summary, config, false),
          targets: projectCashPlanning(summary, config, true),
        }
      : null;
  const chart =
    summary && projections ? cashPlanningChart(summary, config) : [];
  async function save() {
    setSaving(true);
    try {
      await dispatch(
        saveSyncedPrefs({ prefs: { cashPlanning: JSON.stringify(config) } }),
      ).unwrap();
      setEdit(null);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }
  const sectionStyle = {
    borderBottom: `1px solid ${theme.tableBorder}`,
    paddingBottom: 16,
    marginBottom: 16,
  };
  return (
    <Page
      header={
        isNarrowWidth ? (
          <MobilePageHeader title={t('Cash planning')} />
        ) : (
          <PageHeader title={t('Cash planning')} />
        )
      }
    >
      <View
        style={{
          display: 'block',
          flex: 1,
          overflowY: 'auto',
          padding: isNarrowWidth ? 12 : 24,
          paddingBottom: 80,
          '& > *': { marginBottom: 12 },
        }}
        data-testid="cash-planning"
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Button
            style={{ minHeight: isNarrowWidth ? 40 : undefined }}
            onPress={() => void navigate('/reports')}
          >
            <Trans>Reports</Trans>
          </Button>
          <Button
            style={{ minHeight: isNarrowWidth ? 40 : undefined }}
            variant="primary"
            isDisabled={!edit || !rangeValid || !planValid || saving}
            onPress={() => void save()}
          >
            <Trans>Save plan</Trans>
          </Button>
          {edit && (
            <Button
              style={{ minHeight: isNarrowWidth ? 40 : undefined }}
              isDisabled={saving}
              onPress={() => setEdit(null)}
            >
              <Trans>Discard changes</Trans>
            </Button>
          )}
        </View>
        <p>
          <Trans>
            Planning targets are separate from budget allocations. Projections
            repeat historical averages and include external cash movements.
          </Trans>
        </p>
        {saveStatus === 'saved' && (
          <output>
            <Trans>Plan saved.</Trans>
          </output>
        )}
        {saveStatus === 'error' && (
          <p role="alert">
            <Trans>Could not save the plan. Try Save plan again.</Trans>
          </p>
        )}
        {edit && saved !== edit.source && (
          <output>
            <Trans>
              Saved settings changed in another session. Discard changes to load
              them, or save your draft.
            </Trans>
          </output>
        )}
        <section style={sectionStyle}>
          <h2>
            <Trans>Historical period</Trans>
          </h2>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 12,
            }}
          >
            {[1, 3, 6, 12].map(count => (
              <Button
                style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                key={count}
                onPress={() => update(completePlanningMonths(today, count))}
              >
                <Trans count={count}>Last {{ count }} complete months</Trans>
              </Button>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <label htmlFor="cash-planning-start">
              <Trans>Start date</Trans>
              <Input
                disabled={saving}
                style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                id="cash-planning-start"
                aria-label={t('Start date')}
                type="date"
                value={draft.startDate}
                onChange={event => update({ startDate: event.target.value })}
              />
            </label>
            <label htmlFor="cash-planning-end">
              <Trans>End date</Trans>
              <Input
                disabled={saving}
                style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                id="cash-planning-end"
                aria-label={t('End date')}
                type="date"
                max={today}
                value={draft.endDate}
                onChange={event => update({ endDate: event.target.value })}
              />
            </label>
          </View>
          {!rangeValid && (
            <p role="alert">
              <Trans>
                Choose a valid history range ending on or before today.
              </Trans>
            </p>
          )}
          <p>
            <Trans>
              Averages include all selected days and depend on imported history.
              Opening balances and internal transfers are excluded from
              averages.
            </Trans>
          </p>
        </section>
        {rangeValid &&
          (query.isError ? (
            <View role="alert">
              <p>
                <Trans>
                  Could not load cash planning. Retry to refresh the figures.
                </Trans>
              </p>
              <Button
                style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                onPress={() => void query.refetch()}
              >
                <Trans>Retry</Trans>
              </Button>
            </View>
          ) : !summary ? (
            <output>
              <Trans>Refreshing cash planning…</Trans>
            </output>
          ) : (
            <>
              <section style={sectionStyle}>
                <h2>
                  <Trans>Net cash position</Trans>:{' '}
                  <CashPlanningMoney amount={summary.balance} />
                </h2>
                <p>
                  <Trans>Ledger balances through</Trans> {summary.asOf}.{' '}
                  <Trans>
                    Credit card debt reduces this total once. Uncleared
                    transactions and closed accounts are included.
                  </Trans>
                </p>
                <ul style={{ paddingLeft: 20 }}>
                  {summary.accounts.map(account => (
                    <li key={account.id} style={{ marginBottom: 8 }}>
                      {account.name} {account.closed && <Trans>(closed)</Trans>}
                      : <CashPlanningMoney amount={account.balance} />
                    </li>
                  ))}
                </ul>
                {!summary.accounts.length && (
                  <p>
                    <Trans>No on-budget accounts are included.</Trans>
                  </p>
                )}
              </section>
              {summary.transactionCount === 0 ? (
                <output>
                  <Trans>
                    No historical cash activity was found for this period.
                    Import history or choose another period before using
                    projections.
                  </Trans>
                </output>
              ) : (
                <section style={sectionStyle}>
                  <h2>
                    <Trans>Monthly historical averages</Trans>
                  </h2>
                  <p>
                    {summary.startDate} – {summary.endDate}.{' '}
                    <Trans>Calendar months</Trans>: {summary.months.toFixed(3)}
                  </p>
                  <p>
                    <Trans>Income</Trans>:{' '}
                    <CashPlanningMoney amount={summary.monthlyIncome} />
                  </p>
                  <p>
                    <Trans>Category outflows</Trans>:{' '}
                    <CashPlanningMoney amount={summary.monthlyOutflow} />
                  </p>
                  <p>
                    <Trans>External cash movements (signed)</Trans>:{' '}
                    <CashPlanningMoney
                      amount={summary.monthlyExternalMovement}
                    />
                  </p>
                  <p>
                    <Trans>
                      Transfers to tracking accounts reduce accessible cash.
                      Transfers from tracking accounts increase it.
                    </Trans>
                  </p>
                </section>
              )}
              <section style={sectionStyle}>
                <h2>
                  <Trans>Category targets</Trans>
                </h2>
                <p>
                  <Trans>
                    Clear a target to use its historical average. Refunds reduce
                    outflows. Unavailable categories remain in totals and are
                    read-only.
                  </Trans>
                </p>
                <View style={{ gap: 8 }}>
                  {summary.categories.map(category => {
                    const name =
                      category.id === UNCATEGORIZED_ID
                        ? t('Uncategorized')
                        : (category.name ?? t('Unavailable category'));
                    return (
                      <View
                        key={category.id}
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 0',
                          borderBottom: `1px solid ${theme.tableBorder}`,
                        }}
                      >
                        <span style={{ flex: '1 1 160px' }}>
                          {name}
                          {!category.available && (
                            <>
                              {' '}
                              (<Trans>unavailable</Trans>)
                            </>
                          )}
                        </span>
                        <span>
                          <Trans>Average</Trans>:{' '}
                          <CashPlanningMoney amount={category.monthlyOutflow} />
                        </span>
                        {category.available && !privacy ? (
                          <label
                            htmlFor={`cash-planning-target-${category.id}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <Trans>Target</Trans>
                            <Input
                              disabled={saving}
                              id={`cash-planning-target-${category.id}`}
                              style={{ width: 120, minHeight: 40 }}
                              aria-label={t('Monthly target for {{name}}', {
                                name,
                              })}
                              inputMode="decimal"
                              value={draft.targets[category.id] ?? ''}
                              placeholder={format.forEdit(
                                Math.round(category.monthlyOutflow),
                              )}
                              onChange={event =>
                                update({
                                  targets: {
                                    ...draft.targets,
                                    [category.id]: event.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        ) : (
                          <span>
                            <Trans>Target</Trans>:{' '}
                            <CashPlanningMoney
                              amount={
                                category.available
                                  ? (categoryTargets[category.id] ??
                                    category.monthlyOutflow)
                                  : category.monthlyOutflow
                              }
                            />
                          </span>
                        )}
                      </View>
                    );
                  })}
                </View>
              </section>
            </>
          ))}
        <section style={sectionStyle}>
          <h2>
            <Trans>Total-balance goal</Trans>
          </h2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {!privacy && (
              <label htmlFor="cash-planning-goal">
                <Trans>Desired net cash balance (optional)</Trans>
                <Input
                  disabled={saving}
                  style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                  id="cash-planning-goal"
                  aria-label={t('Desired net cash balance')}
                  inputMode="decimal"
                  value={draft.goal}
                  onChange={event => update({ goal: event.target.value })}
                />
              </label>
            )}
            <label htmlFor="cash-planning-deadline">
              <Trans>Goal deadline (optional)</Trans>
              <Input
                disabled={saving}
                style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                id="cash-planning-deadline"
                aria-label={t('Goal deadline')}
                type="date"
                value={draft.deadline}
                onChange={event => update({ deadline: event.target.value })}
              />
            </label>
            <label htmlFor="cash-planning-forecast-end">
              <Trans>Forecast end date</Trans>
              <Input
                disabled={saving}
                style={{ minHeight: isNarrowWidth ? 40 : undefined }}
                id="cash-planning-forecast-end"
                aria-label={t('Forecast end date')}
                type="date"
                min={months.addDays(today, 1)}
                value={draft.forecastEndDate}
                onChange={event =>
                  update({ forecastEndDate: event.target.value })
                }
              />
            </label>
          </View>
          {!planValid && (
            <p role="alert">
              <Trans>
                Enter valid amounts, nonnegative category targets, and a
                forecast end date after today.
              </Trans>
            </p>
          )}
        </section>
        {projections && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>
              <CashPlanningProjection
                title={t('Historical rate')}
                projection={projections.historical}
              />
              <CashPlanningProjection
                title={t('Category targets')}
                projection={projections.targets}
              />
            </View>
            {!privacy && (
              <View
                style={{ height: 300, flexShrink: 0 }}
                data-testid="cash-planning-chart"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart}>
                    <CartesianGrid stroke={theme.tableBorder} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: theme.pageText }}
                      minTickGap={40}
                    />
                    <YAxis
                      width={90}
                      tick={{ fill: theme.pageText }}
                      tickFormatter={value =>
                        format(Math.round(Number(value)), 'financial')
                      }
                    />
                    <Tooltip
                      formatter={value =>
                        format(Math.round(Number(value)), 'financial')
                      }
                    />
                    <Legend />
                    <ReferenceLine y={0} stroke={theme.errorText} />
                    <Line
                      name={t('Historical rate')}
                      dataKey="historical"
                      stroke={theme.reportsBlue}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      name={t('Category targets')}
                      dataKey="targets"
                      stroke={theme.reportsGreen}
                      strokeDasharray="6 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </View>
            )}
            <p>
              <Trans>
                Net cash depletion estimates when the combined balance reaches
                zero. It does not predict individual account overdrafts.
              </Trans>
            </p>
          </>
        )}
      </View>
    </Page>
  );
}
