import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, FocusEventHandler, Ref } from 'react';

import { Input } from '@actual-app/components/input';
import { evalArithmetic } from '@actual-app/core/shared/arithmetic';
import { getNumberFormat } from '@actual-app/core/shared/util';

import { useFormat } from '#hooks/useFormat';
import { useMergedRefs } from '#hooks/useMergedRefs';

type PercentInputProps = {
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  value?: number;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onChangeValue?: (value: string) => void;
  onUpdatePercent?: (percent: number) => void;
  style?: CSSProperties;
  focused?: boolean;
  disabled?: boolean;
  max?: number;
};

const clampToPercent = (value: number, max: number) =>
  Math.max(Math.min(value, max), 0);

export function PercentInput({
  id,
  inputRef,
  value: initialValue = 0,
  onFocus,
  onBlur,
  onChangeValue,
  onUpdatePercent,
  style,
  focused,
  disabled = false,
  max = 100,
}: PercentInputProps) {
  const format = useFormat();

  const [isFocused, setIsFocused] = useState(focused ?? false);
  const [value, setValue] = useState(() =>
    format(clampToPercent(initialValue, max), 'percentage'),
  );

  useEffect(() => {
    const clamped = clampToPercent(initialValue, max);
    if (clamped !== initialValue) {
      onUpdatePercent?.(clamped);
    }
    // drop the symbol while editing so the value can be edited freely
    setValue(isFocused ? String(clamped) : format(clamped, 'percentage'));
  }, [initialValue, max, isFocused, onUpdatePercent, format]);

  const ref = useRef<HTMLInputElement>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(inputRef, ref);

  useEffect(() => {
    if (focused) {
      ref.current?.focus();
    }
  }, [focused]);

  function onInputTextChange(val: string) {
    const number = sanitizePercentText(val, getNumberFormat().decimalSeparator);
    setValue(number);
    onChangeValue?.(number);
  }

  function fireUpdate() {
    const clamped = clampToPercent(parsePercentText(value), max);
    onUpdatePercent?.(clamped);
    return clamped;
  }

  function onInputFocus(e: FocusEvent<HTMLInputElement>) {
    setIsFocused(true);
    onFocus?.(e);
  }

  function onInputBlur(e: FocusEvent<HTMLInputElement>) {
    if (!ref.current?.contains(e.relatedTarget)) {
      const clamped = fireUpdate();
      setIsFocused(false);
      setValue(format(clamped, 'percentage'));
    }
    onBlur?.(e);
  }

  return (
    <Input
      id={id}
      ref={mergedRef}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      style={{ flex: 1, alignItems: 'stretch', ...style }}
      onEnter={fireUpdate}
      onChangeValue={onInputTextChange}
      onBlur={onInputBlur}
      onFocus={onInputFocus}
    />
  );
}

// Keeps only what a percentage can contain. With a decimal-comma number format
// the user types "12,5", so that comma has to become the decimal point
// instead of being dropped (which would turn it into 125).
export function sanitizePercentText(text: string, decimalSeparator: string) {
  const withDecimalPoint =
    decimalSeparator === ',' ? text.replace(/,/g, '.') : text;
  return withDecimalPoint.replace(/[^0-9.]/g, '');
}

// The field holds either plain dot-decimal text (while editing) or text
// formatted for the user's locale (at rest). Plain text is read directly:
// running it through the locale-aware parser would take "0.125" in a
// dot-thousands format for 125.
export function parsePercentText(text: string): number {
  const bare = text.replace('%', '').trim();
  if (/^\d+(\.\d+)?$/.test(bare) || /^\.\d+$/.test(bare)) {
    return Number(bare);
  }
  return evalArithmetic(bare, 0) ?? 0;
}
