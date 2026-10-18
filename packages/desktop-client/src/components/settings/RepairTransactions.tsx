import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { Handlers } from '@actual-app/core/types/handlers';

import { Setting } from './UI';

type Results = Awaited<ReturnType<Handlers['tools/fix-split-transactions']>>;

function useRenderResults() {
  const { t } = useTranslation();

  function renderResults(results: Results) {
    const {
      numBlankPayees,
      numCleared,
      numDeleted,
      numTransfersFixed,
      mismatchedSplits,
      numNonParentErrorsFixed,
      numParentTransactionsWithCategoryFixed,
    } = results;
    const result: string[] = [];

    if (
      numBlankPayees === 0 &&
      numCleared === 0 &&
      numDeleted === 0 &&
      numTransfersFixed === 0 &&
      numNonParentErrorsFixed === 0 &&
      mismatchedSplits.length === 0 &&
      numParentTransactionsWithCategoryFixed === 0
    ) {
      result.push(t('No split transactions found needing repair.'));
    } else {
      if (numBlankPayees > 0) {
        result.push(
          t('repair-blank-payee-splits', {
            count: numBlankPayees,
            defaultValue_one: 'Fixed {{count}} split with a blank payee.',
            defaultValue_other: 'Fixed {{count}} splits with a blank payee.',
          }),
        );
      }
      if (numCleared > 0) {
        result.push(
          t('repair-cleared-splits', {
            count: numCleared,
            defaultValue_one:
              'Fixed {{count}} split with the wrong cleared flag.',
            defaultValue_other:
              'Fixed {{count}} splits with the wrong cleared flag.',
          }),
        );
      }
      if (numDeleted > 0) {
        result.push(
          t('repair-deleted-splits', {
            count: numDeleted,
            defaultValue_one:
              "Fixed {{count}} split that wasn't properly deleted.",
            defaultValue_other:
              "Fixed {{count}} splits that weren't properly deleted.",
          }),
        );
      }
      if (numNonParentErrorsFixed > 0) {
        result.push(
          t('repair-non-split-errors', {
            count: numNonParentErrorsFixed,
            defaultValue_one:
              'Fixed {{count}} non-split transaction with split errors.',
            defaultValue_other:
              'Fixed {{count}} non-split transactions with split errors.',
          }),
        );
      }
      if (numTransfersFixed > 0) {
        result.push(
          t('repair-transfers', {
            count: numTransfersFixed,
            defaultValue_one: 'Fixed {{count}} transfer.',
            defaultValue_other: 'Fixed {{count}} transfers.',
          }),
        );
      }
      if (mismatchedSplits.length > 0) {
        const mismatchedSplitInfo = mismatchedSplits
          .map(t => `- ${t.date}`)
          .join('\n');

        result.push(
          t(
            'Found {{count}} split transactions with mismatched amounts on the below dates. Please review them manually:',
            { count: mismatchedSplits.length },
          ) + `\n${mismatchedSplitInfo}`,
        );
      }
      if (numParentTransactionsWithCategoryFixed > 0) {
        result.push(
          t('repair-parent-category', {
            count: numParentTransactionsWithCategoryFixed,
            defaultValue_one:
              'Fixed {{count}} split transaction with non-null category.',
            defaultValue_other:
              'Fixed {{count}} split transactions with non-null category.',
          }),
        );
      }
    }

    return (
      <Paragraph
        style={{
          color:
            mismatchedSplits.length === 0
              ? theme.noticeTextLight
              : theme.errorText,
          whiteSpace: 'pre-wrap',
        }}
      >
        {result.join('\n')}
      </Paragraph>
    );
  }

  return { renderResults };
}

export function RepairTransactions() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results | null>(null);

  const { renderResults } = useRenderResults();

  async function onFix() {
    setLoading(true);
    try {
      const res = await send('tools/fix-split-transactions');
      setResults(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Setting
      primaryAction={
        <View
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '1em',
          }}
        >
          <ButtonWithLoading isLoading={loading} onPress={onFix}>
            <Trans>Repair transactions</Trans>
          </ButtonWithLoading>
          {results && renderResults(results)}
        </View>
      }
    >
      <Trans>
        <Text>
          <strong>Repair transactions</strong> if you are experiencing bugs
          relating to split transactions or transfers and the "Reset budget
          cache" button above does not help, this tool may fix them. Some
          examples of bugs include seeing blank payees on splits or incorrect
          account balances. This tool does six things:
        </Text>
        <ul style={{ margin: 0, paddingLeft: '1.5em' }}>
          <li style={{ marginBottom: '0.5em' }}>
            Ensures that deleted split transactions are fully deleted. In
            previous versions of the app, certain split transactions may appear
            deleted but not all of them are actually deleted. This causes the
            transactions list to look correct, but certain balances may be
            incorrect when filtering.
          </li>
          <li>
            Sync the payee and cleared flag of a split transaction to the main
            or "parent" transaction, if appropriate. The payee will only be set
            if it currently doesn't have one.
          </li>
          <li>
            Checks that the sum of all child transactions adds up to the total
            amount. If not, these will be flagged below to allow you to easily
            locate and fix the amounts.
          </li>
          <li>
            Checks for any non-split transactions with erroneous split errors
            and removes the errors if found.
          </li>
          <li>
            Check if you have any budget transfers that erroneously contain a
            category, and remove the category.
          </li>
          <li>
            Checks for any parent transactions with a category and removes the
            category if found.
          </li>
        </ul>
      </Trans>
    </Setting>
  );
}
