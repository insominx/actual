import { useState } from 'react';

import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useDrop } from './useDragDrop';

function DropRow({ id }: { id: string }) {
  const { dropRef, dropPos } = useDrop({
    types: 'transaction',
    id,
  });

  return <div ref={dropRef} data-drop-pos={dropPos ?? ''} />;
}

function DropList({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map(id => (
        <DropRow key={id} id={id} />
      ))}
    </>
  );
}

function RecyclingList() {
  const [page, setPage] = useState(0);
  const ids = Array.from({ length: 80 }, (_, index) => `tx-${page}-${index}`);

  return (
    <>
      <button type="button" onClick={() => setPage(current => current + 1)}>
        Next page
      </button>
      <DropList ids={ids} />
    </>
  );
}

describe('useDrop', () => {
  it('mounts many rows without scheduling drop-position updates', () => {
    const ids = Array.from({ length: 80 }, (_, index) => `tx-${index}`);

    expect(() => {
      const view = render(<DropList ids={ids} />);
      view.rerender(<DropList ids={ids} />);
      view.unmount();
    }).not.toThrow();
  });

  it('recycles a large virtual window without an update loop', async () => {
    const user = userEvent.setup();
    const view = render(<RecyclingList />);

    for (let page = 0; page < 3; page++) {
      await user.click(view.getByRole('button', { name: 'Next page' }));
    }

    view.unmount();
  });
});
