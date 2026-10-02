import { Button } from '@actual-app/components/button';
import { View } from '@actual-app/components/view';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColumnResizeHandle } from './ColumnResizeHandle';

function renderHandle(width: number | undefined = 200) {
  const onDraft = vi.fn();
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onSort = vi.fn();
  const onParentKeyDown = vi.fn();
  const onParentKeyUp = vi.fn();
  const onParentPointerDown = vi.fn();
  const onParentPointerUp = vi.fn();
  const onParentClick = vi.fn();

  render(
    <View
      onKeyDown={onParentKeyDown}
      onKeyUp={onParentKeyUp}
      onPointerDown={onParentPointerDown}
      onPointerUp={onParentPointerUp}
      onClick={onParentClick}
    >
      <Button variant="bare" onPress={onSort}>
        Payee
      </Button>
      <ColumnResizeHandle
        columnLabel="Payee"
        width={width}
        onDraft={onDraft}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </View>,
  );

  return {
    handle: screen.getByRole('separator'),
    onDraft,
    onCommit,
    onCancel,
    onSort,
    onParentKeyDown,
    onParentKeyUp,
    onParentPointerDown,
    onParentPointerUp,
    onParentClick,
  };
}

describe('ColumnResizeHandle', () => {
  it('is a focusable, labelled vertical separator', () => {
    const { handle } = renderHandle(240);

    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle.getAttribute('aria-label')).toMatch(/Resize/);
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    expect(handle).toHaveAttribute('aria-valuemin', '80');
    expect(handle).toHaveAttribute('aria-valuemax', '1200');
    expect(handle).toHaveAttribute('tabindex', '0');

    handle.focus();
    expect(handle).toHaveFocus();
  });

  it('drafts on repeated arrow keydowns and commits once on keyup', () => {
    const { handle, onDraft, onCommit } = renderHandle(200);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onDraft.mock.calls.map(([width]) => width)).toEqual([210, 220, 230]);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyUp(handle, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(230);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyUp(handle, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith(190);
  });

  it('clamps keyboard adjustments to the width range', () => {
    const { handle, onCommit } = renderHandle(85);

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyUp(handle, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenCalledWith(80);
  });

  it('commits null once for Home', () => {
    const { handle, onDraft, onCommit } = renderHandle(300);

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onDraft).toHaveBeenCalledWith(null);
    fireEvent.keyUp(handle, { key: 'Home' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('discards the draft on Escape before commit', () => {
    const { handle, onCommit, onCancel } = renderHandle(200);

    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'Escape' });
    fireEvent.keyUp(handle, { key: 'ArrowRight' });
    fireEvent.blur(handle);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits a pending draft on blur', () => {
    const { handle, onCommit } = renderHandle(200);

    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.blur(handle);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(210);

    fireEvent.blur(handle);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('drafts on pointer moves and commits once on pointer up', () => {
    const { handle, onDraft, onCommit } = renderHandle(200);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140 });
    expect(onDraft.mock.calls.map(([width]) => width)).toEqual([220, 240]);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(240);
  });

  it('does not commit a click without movement', () => {
    const { handle, onDraft, onCommit, onCancel } = renderHandle(200);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });

    expect(onDraft).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels on pointercancel and lost pointer capture', () => {
    const { handle, onCommit, onCancel } = renderHandle(200);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 });

    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 50 });
    fireEvent.lostPointerCapture(handle, { pointerId: 2 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 50 });

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps pointer and handled keys away from sort and parent handlers', () => {
    const {
      handle,
      onSort,
      onParentKeyDown,
      onParentKeyUp,
      onParentPointerDown,
      onParentPointerUp,
      onParentClick,
    } = renderHandle(200);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 130 });
    fireEvent.click(handle);

    for (const key of ['ArrowRight', 'ArrowLeft', 'Home']) {
      fireEvent.keyDown(handle, { key });
      fireEvent.keyUp(handle, { key });
    }
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'Escape' });

    expect(onSort).not.toHaveBeenCalled();
    expect(onParentPointerDown).not.toHaveBeenCalled();
    expect(onParentPointerUp).not.toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(onParentKeyUp).not.toHaveBeenCalled();
  });
});
