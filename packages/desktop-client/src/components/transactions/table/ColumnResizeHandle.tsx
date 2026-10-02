import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import {
  clampColumnWidth,
  MAX_TEXT_COLUMN_WIDTH,
  MIN_TEXT_COLUMN_WIDTH,
} from './columnWidths';

const KEYBOARD_STEP = 10;

type PointerGesture = {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  moved: boolean;
};

type ColumnResizeHandleProps = {
  columnLabel: string;
  // The column's custom width (including an in-progress draft), or
  // undefined while it is flexible.
  width: number | undefined;
  onDraft: (width: number | null) => void;
  onCommit: (width: number | null) => void;
  onCancel: () => void;
};

/**
 * Drag or arrow-key handle on the right edge of a header cell. Widths are
 * only reported as drafts until the gesture completes (pointer up, key up or
 * blur); cancelling reports nothing but `onCancel`.
 */
export function ColumnResizeHandle({
  columnLabel,
  width,
  onDraft,
  onCommit,
  onCancel,
}: ColumnResizeHandleProps) {
  const { t } = useTranslation();
  const handleRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<PointerGesture | null>(null);
  const keyDraftRef = useRef<{ width: number | null } | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const [isDragging, setIsDragging] = useState(false);

  function measureColumn() {
    const cell = handleRef.current?.parentElement;
    return Math.round(cell?.getBoundingClientRect().width ?? 0);
  }

  useLayoutEffect(() => {
    if (width == null) {
      setMeasuredWidth(measureColumn());
    }
  }, [width]);

  function releaseCapture(pointerId: number) {
    const el = handleRef.current;
    if (el?.hasPointerCapture?.(pointerId)) {
      el.releasePointerCapture(pointerId);
    }
  }

  function endPointerGesture() {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setIsDragging(false);
    if (gesture) {
      releaseCapture(gesture.pointerId);
    }
    return gesture;
  }

  function cancelAll() {
    const gesture = endPointerGesture();
    const hadKeyDraft = keyDraftRef.current != null;
    keyDraftRef.current = null;
    if (gesture?.moved || hadKeyDraft) {
      onCancel();
    }
  }

  function commitKeyDraft() {
    const draft = keyDraftRef.current;
    if (!draft) {
      return;
    }
    keyDraftRef.current = null;
    onCommit(draft.width);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    commitKeyDraft();
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    el.focus();

    const startWidth = width ?? measureColumn();
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth,
      width: startWidth,
      moved: false,
    };
    setIsDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) {
      return;
    }
    e.stopPropagation();

    if (e.clientX !== gesture.startX) {
      gesture.moved = true;
    }
    if (!gesture.moved) {
      return;
    }
    const next = clampColumnWidth(
      gesture.startWidth + e.clientX - gesture.startX,
    );
    if (next !== gesture.width) {
      gesture.width = next;
      onDraft(next);
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) {
      return;
    }
    e.stopPropagation();
    endPointerGesture();
    if (gesture.moved) {
      onCommit(gesture.width);
    }
  }

  function onPointerCancel(e: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) {
      return;
    }
    e.stopPropagation();
    cancelAll();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        e.stopPropagation();
        const base = keyDraftRef.current
          ? (keyDraftRef.current.width ?? measureColumn())
          : (width ?? measureColumn());
        const next = clampColumnWidth(
          base + (e.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP),
        );
        keyDraftRef.current = { width: next };
        onDraft(next);
        break;
      }
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        keyDraftRef.current = { width: null };
        onDraft(null);
        break;
      case 'Escape':
        if (keyDraftRef.current || gestureRef.current) {
          e.preventDefault();
          e.stopPropagation();
          cancelAll();
        }
        break;
      default:
    }
  }

  function onKeyUp(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      commitKeyDraft();
    }
  }

  function stopPropagation(e: SyntheticEvent) {
    e.stopPropagation();
  }

  const valueNow = width ?? measuredWidth;

  return (
    <View
      innerRef={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize {{column}} column', { column: columnLabel })}
      aria-valuenow={valueNow}
      aria-valuemin={MIN_TEXT_COLUMN_WIDTH}
      aria-valuemax={MAX_TEXT_COLUMN_WIDTH}
      tabIndex={0}
      data-testid="column-resize-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={commitKeyDraft}
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      onDoubleClick={stopPropagation}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: 0,
        width: 7,
        cursor: 'col-resize',
        touchAction: 'none',
        zIndex: 1,
        outline: 'none',
        borderRadius: 2,
        '::after': {
          content: '""',
          position: 'absolute',
          top: 6,
          bottom: 6,
          right: 2,
          width: 2,
          borderRadius: 1,
          backgroundColor: isDragging
            ? theme.formInputBorderSelected
            : 'transparent',
        },
        ':hover::after': {
          backgroundColor: isDragging
            ? theme.formInputBorderSelected
            : theme.tableBorderHover,
        },
        ':focus-visible': {
          boxShadow: `inset 0 0 0 2px ${theme.formInputBorderSelected}`,
        },
      }}
    />
  );
}
