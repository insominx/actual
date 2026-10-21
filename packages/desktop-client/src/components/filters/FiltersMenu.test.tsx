import type { ComponentProps } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestProviders } from '#mocks';

import { FilterEditor } from './FiltersMenu';

describe('FilterEditor amount sign', () => {
  const renderEditor = (
    props: Partial<ComponentProps<typeof FilterEditor>> = {},
  ) => {
    const onSave = vi.fn();
    render(
      <FilterEditor
        field="amount"
        op="gt"
        // New filters render null values as empty strings.
        value=""
        onSave={onSave}
        onClose={vi.fn()}
        {...props}
      />,
      { wrapper: TestProviders },
    );
    return { onSave };
  };

  it('submits a positive amount for a filter created without a value', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), '150');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'amount', op: 'gt', value: 15000 }),
    );
  });

  it('keeps an existing negative amount negative when edited', async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor({ value: -15000 });

    expect(
      screen.getByRole('button', { name: 'Make positive' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'amount', op: 'gt', value: -15000 }),
    );
  });
});

describe('FilterEditor text to ID op switch', () => {
  const renderPayeeEditor = (op: 'contains' | 'matches', value: string) => {
    const onSave = vi.fn();
    render(
      <FilterEditor
        field="payee"
        op={op}
        value={value}
        options={undefined}
        onSave={onSave}
        onClose={vi.fn()}
      />,
      { wrapper: TestProviders },
    );
    return { onSave };
  };

  it.each([
    ['is', ''],
    ['one of', []],
  ] as const)(
    'clears unresolved text when switching to "%s"',
    async (opLabel, expectedValue) => {
      const user = userEvent.setup();
      const { onSave } = renderPayeeEditor('contains', 'Some text');

      await user.click(screen.getByRole('button', { name: opLabel }));
      await user.click(screen.getByRole('button', { name: 'Apply' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ field: 'payee', value: expectedValue }),
      );
    },
  );
});
