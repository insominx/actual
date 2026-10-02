import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const RESERVATION_CATEGORY = 'Reserved bills';

// In 2017-01 (the Playwright current month) the By claim accrues
// 1200 - 100 * 11 = 100.00 and the simple template allows 50.00.
const RESERVATION_NOTE =
  '#template 50\n#template 1200 by 2017-12 repeat every year';

type TestWindow = {
  $send: <T>(name: string, args?: unknown) => Promise<T>;
  __TANSTACK_QUERY_CLIENT__: {
    invalidateQueries: (filters: unknown) => Promise<void>;
  };
};

/**
 * Adds a category budgeted at 500.00 in 2017-01 whose notes hold one By
 * template and one simple template. Returns the category ID.
 */
export async function addReservationCategory(page: Page) {
  return page.evaluate(
    async ({ name, note }) => {
      const testWindow = window as unknown as TestWindow;
      const $send = testWindow.$send;
      const groupId = await $send<string>('category-group-create', {
        name: 'Reservations',
      });
      const id = await $send<string>('category-create', { name, groupId });
      await $send('notes-save', { id, note });
      await $send('budget/budget-amount', {
        month: '2017-01',
        category: id,
        amount: 50000,
      });
      await testWindow.__TANSTACK_QUERY_CLIENT__.invalidateQueries({
        queryKey: ['categories', 'lists'],
      });
      return id;
    },
    { name: RESERVATION_CATEGORY, note: RESERVATION_NOTE },
  );
}

/** Posts a 100.00 payment from the first open on-budget account. */
export async function addReservationPayment(page: Page, categoryId: string) {
  await page.evaluate(async category => {
    const $send = (window as unknown as TestWindow).$send;
    const accounts =
      await $send<Array<{ id: string; offbudget: number; closed: number }>>(
        'accounts-get',
      );
    const account = accounts.find(a => !a.offbudget && !a.closed);
    if (!account) {
      throw new Error('No on-budget account');
    }
    await $send('transactions-batch-update', {
      added: [
        {
          id: crypto.randomUUID(),
          account: account.id,
          amount: -10000,
          category,
          date: '2017-01-15',
        },
      ],
    });
  }, categoryId);
}

export async function undoLastChange(page: Page) {
  await page.evaluate(async () => {
    await (window as unknown as TestWindow).$send('undo');
  });
}

export class ReservationBreakdown {
  readonly locator: Locator;

  constructor(page: Page) {
    this.locator = page.getByTestId('reservation-breakdown');
  }

  /** The innermost element holding both the exact label and the amount. */
  line(label: string, amount: string) {
    const page = this.locator.page();
    return this.locator
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .filter({ has: page.getByText(amount, { exact: true }) })
      .last();
  }

  async expectAmounts({ balance, spare }: { balance: string; spare: string }) {
    await expect(this.line('Total balance', balance)).toBeVisible();
    await expect(this.line('Reserved', '100.00')).toBeVisible();
    await expect(this.line('Allowance remaining', '50.00')).toBeVisible();
    await expect(this.line('Spare', spare)).toBeVisible();
    await expect(
      this.line(
        `${RESERVATION_CATEGORY}, due 12/01/2017`,
        '100.00 of 1,200.00',
      ),
    ).toBeVisible();
  }
}
