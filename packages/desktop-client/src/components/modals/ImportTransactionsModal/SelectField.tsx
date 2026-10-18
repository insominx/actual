import React from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { Select } from '@actual-app/components/select';

type SelectFieldProps = {
  style?: CSSProperties;
  options: string[];
  value: null | string;
  onChange: (newValue: string) => void;
  hasHeaderRow: boolean;
  firstTransaction: Record<string, unknown>;
};

export function SelectField({
  style,
  options,
  value,
  onChange,
  hasHeaderRow,
  firstTransaction,
}: SelectFieldProps) {
  const { t } = useTranslation();
  const columns = options.map(
    option =>
      [
        option,
        hasHeaderRow
          ? option
          : t('Column {{number}} ({{value}})', {
              number: parseInt(option) + 1,
              value: String(firstTransaction[option]),
            }),
      ] as const,
  );

  // If selected column does not exist in transaction sheet, ignore
  if (!columns.find(col => col[0] === value)) value = null;

  return (
    <Select
      options={[['choose-field', t('Choose field...')], ...columns]}
      value={value === null ? 'choose-field' : value}
      onChange={onChange}
      style={style}
    />
  );
}
