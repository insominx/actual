import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { getDefaultTransactionTableColumns } from '#components/transactions/table/columns';
import { TestProviders } from '#mocks';

import { TransactionTableColumnsModal } from './TransactionTableColumnsModal';

function renderModal(
  props: Partial<Parameters<typeof TransactionTableColumnsModal>[0]> = {},
) {
  const onSave = vi.fn();
  render(
    <TestProviders>
      <TransactionTableColumnsModal
        columns={getDefaultTransactionTableColumns()}
        onSave={onSave}
        {...props}
      />
    </TestProviders>,
  );
  return { onSave };
}

describe('TransactionTableColumnsModal column width reset', () => {
  it.each([false, true])(
    'resets widths immediately without saving columns (apply to all: %s)',
    async applyToAll => {
      const user = userEvent.setup();
      const onResetWidths = vi.fn();
      const { onSave } = renderModal({ onResetWidths, hasCustomWidths: true });

      if (applyToAll) {
        await user.click(screen.getByLabelText(/Apply to all/));
        expect(screen.getByLabelText(/Apply to all/)).toBeChecked();
      }

      await user.click(
        screen.getByRole('button', { name: 'Reset column widths' }),
      );

      expect(onResetWidths).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'Reset column widths' }),
      ).toBeInTheDocument();
    },
  );

  it('hides the reset button when no reset callback is given', () => {
    renderModal();
    expect(
      screen.queryByRole('button', { name: 'Reset column widths' }),
    ).not.toBeInTheDocument();
  });

  it('disables the reset button without custom widths and after one click', async () => {
    const user = userEvent.setup();
    const onResetWidths = vi.fn();

    const { unmount } = render(
      <TestProviders>
        <TransactionTableColumnsModal
          columns={getDefaultTransactionTableColumns()}
          onSave={vi.fn()}
          onResetWidths={onResetWidths}
          hasCustomWidths={false}
        />
      </TestProviders>,
    );
    expect(
      screen.getByRole('button', { name: 'Reset column widths' }),
    ).toBeDisabled();
    unmount();

    renderModal({ onResetWidths, hasCustomWidths: true });
    const button = screen.getByRole('button', { name: 'Reset column widths' });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onResetWidths).toHaveBeenCalledTimes(1);
  });
});
