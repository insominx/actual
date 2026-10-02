import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import type { AccountPage } from './page-models/account-page';
import { ConfigurationPage } from './page-models/configuration-page';
import { Navigation } from './page-models/navigation';

type Edges = { left: number; right: number; width: number };

const WIDTH_KEY_SUFFIX = '-transaction-table-widths';

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- global Window augmentation requires interface
  interface Window {
    __setItemCounts: Record<string, number>;
  }
}

function countSetItemCalls() {
  window.__setItemCounts = {};
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    window.__setItemCounts[key] = (window.__setItemCounts[key] ?? 0) + 1;
    return setItem.call(this, key, value);
  };
}

async function edges(locator: Locator): Promise<Edges> {
  return locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });
}

function expectSameEdges(actual: Edges, expected: Edges) {
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.right - expected.right)).toBeLessThanOrEqual(1);
}

test.describe('Transaction column resizing', () => {
  let page: Page;
  let navigation: Navigation;
  let configurationPage: ConfigurationPage;
  let accountPage: AccountPage;

  const header = () => page.getByTestId('transaction-table-header');
  const headerCell = (id: string) => header().getByTestId(id);
  const handle = (label: string) =>
    page.getByRole('separator', { name: `Resize ${label} column` });
  const scrollShell = () => page.getByTestId('transaction-table-scroll');
  const row = (index: number) => accountPage.transactionTableRow.nth(index);

  async function widthKey() {
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const key = keys.find(k => k.endsWith(WIDTH_KEY_SUFFIX));
    return key ?? null;
  }

  async function setItemCount() {
    const counts = await page.evaluate(() => window.__setItemCounts);
    return Object.entries(counts)
      .filter(([key]) => key.endsWith(WIDTH_KEY_SUFFIX))
      .reduce((sum, [, count]) => sum + count, 0);
  }

  async function headerColumnIds() {
    return header().evaluate(el =>
      [...el.children]
        .map(child => child.getAttribute('data-testid'))
        .filter(Boolean),
    );
  }

  async function dragHandle(
    label: string,
    columnId: string,
    targetWidth: number,
    steps = 10,
  ) {
    const handleBox = await handle(label).boundingBox();
    const { width } = await edges(headerCell(columnId));
    if (!handleBox) {
      throw new Error(`No handle for ${label}`);
    }
    const x = Math.round(handleBox.x + handleBox.width / 2);
    const y = Math.round(handleBox.y + handleBox.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + targetWidth - Math.round(width), y, { steps });
    await page.mouse.up();
  }

  async function resizeTo(label: string, columnId: string, width: number) {
    await dragHandle(label, columnId, width);
    await expect
      .poll(async () =>
        Math.abs((await edges(headerCell(columnId))).width - width),
      )
      .toBeLessThanOrEqual(1);
  }

  async function createSplit() {
    await accountPage.createSplitTransaction([
      { payee: 'Krogger', notes: 'Split notes', debit: '333.33' },
      { category: 'General', debit: '222.22' },
      { debit: '111.11' },
    ]);
    await expect(row(0).getByTestId('category')).toHaveText('Split');
  }

  async function expectPayeeAligned(width: number) {
    const headerEdges = await edges(headerCell('payee'));
    expect(Math.abs(headerEdges.width - width)).toBeLessThanOrEqual(1);

    // Row 1 is the first split child, row 3 the first ordinary row
    await expect(row(1).getByTestId('category')).toHaveText('General');
    expectSameEdges(await edges(row(1).getByTestId('payee')), headerEdges);
    expectSameEdges(await edges(row(0).getByTestId('payee')), headerEdges);
    expectSameEdges(await edges(row(3).getByTestId('payee')), headerEdges);

    // Opening the editor can scroll the table horizontally, so measure the
    // header again afterwards
    await row(3).getByTestId('payee').click();
    const editor = row(3).getByTestId('payee').getByRole('textbox');
    await expect(editor).toBeVisible();
    expectSameEdges(
      await edges(row(3).getByTestId('payee')),
      await edges(headerCell('payee')),
    );
    await page.keyboard.press('Escape');
  }

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await page.addInitScript(countSetItemCalls);
    navigation = new Navigation(page);
    configurationPage = new ConfigurationPage(page);

    await page.goto('/');
    await configurationPage.createTestFile();
    accountPage = await navigation.goToAccountPage('Ally Savings');
    await expect(row(0)).toBeVisible();
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('payee edges stay aligned at 240, 80 and 1200 (G1, G4)', async () => {
    await createSplit();
    const amountBefore = await edges(headerCell('payment'));

    await resizeTo('Payee', 'payee', 240);
    await expectPayeeAligned(240);

    await dragHandle('Payee', 'payee', 60);
    await expect
      .poll(async () => Math.round((await edges(headerCell('payee'))).width))
      .toBe(80);
    await expectPayeeAligned(80);

    await dragHandle('Payee', 'payee', 1500);
    await expect
      .poll(async () => Math.round((await edges(headerCell('payee'))).width))
      .toBe(1200);
    await expectPayeeAligned(1200);

    // Wider than the viewport: header and body scroll together
    const shell = scrollShell();
    const { scrollWidth, clientWidth } = await shell.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    await shell.evaluate(el => {
      el.scrollLeft = 500;
    });
    await expect.poll(() => shell.evaluate(el => el.scrollLeft)).toBe(500);
    expectSameEdges(
      await edges(row(3).getByTestId('notes')),
      await edges(headerCell('notes')),
    );

    const amountAfter = await edges(headerCell('payment'));
    expect(
      Math.abs(amountAfter.width - amountBefore.width),
    ).toBeLessThanOrEqual(1);
  });

  test('new transaction row matches the header (G2)', async () => {
    await resizeTo('Payee', 'payee', 240);
    await accountPage.addNewTransactionButton.click();

    const newPayee = accountPage.newTransactionRow.first().getByTestId('payee');
    await expect(newPayee).toBeVisible();
    expectSameEdges(await edges(newPayee), await edges(headerCell('payee')));
    await accountPage.cancelTransactionButton.click();
  });

  test('other text columns stay aligned (G3)', async () => {
    await createSplit();

    for (const [label, id] of [
      ['Notes', 'notes'],
      ['Category', 'category'],
    ] as const) {
      await resizeTo(label, id, 240);
      const headerEdges = await edges(headerCell(id));
      expectSameEdges(await edges(row(1).getByTestId(id)), headerEdges);
      expectSameEdges(await edges(row(3).getByTestId(id)), headerEdges);
    }

    await accountPage.setTransactionColumnVisibility('group', true);
    await resizeTo('Category group', 'group', 240);
    expectSameEdges(
      await edges(row(3).getByTestId('group')),
      await edges(headerCell('group')),
    );

    // The account column only shows on multi-account views
    await page.getByRole('link', { name: /^All accounts/ }).click();
    await expect(headerCell('account')).toBeVisible();
    // Scheduled previews come first here, so find the split rows by amount
    const rowWithDebit = (amount: string) =>
      accountPage.transactionTableRow.filter({
        has: page.getByTestId('debit').getByText(amount, { exact: true }),
      });
    const parentRow = rowWithDebit('333.33');
    const childRow = rowWithDebit('222.22');
    await expect(childRow.getByTestId('category')).toHaveText('General');
    await resizeTo('Account', 'account', 240);
    const accountEdges = await edges(headerCell('account'));
    expectSameEdges(
      await edges(parentRow.getByTestId('account')),
      accountEdges,
    );
    // A split child's second cell is the blank account placeholder. Its
    // select cell sits after it, so only the width matches the header, and
    // the following columns still line up.
    const placeholder = childRow.locator(':scope > div').nth(1);
    expect(
      Math.abs((await edges(placeholder)).width - accountEdges.width),
    ).toBeLessThanOrEqual(1);
    expectSameEdges(
      await edges(childRow.getByTestId('payee')),
      await edges(headerCell('payee')),
    );
  });

  test('recycled rows keep the width after scrolling (G5)', async () => {
    // The all-accounts view has enough rows to scroll well past the overscan
    await page.getByRole('link', { name: /^All accounts/ }).click();
    await expect(headerCell('account')).toBeVisible();
    await resizeTo('Payee', 'payee', 240);
    const scrollList = (top: number) =>
      accountPage.transactionTable.evaluate((table, scrollTop) => {
        const scroller = [...table.querySelectorAll('div')].find(
          el => el.scrollHeight > el.clientHeight + 1,
        );
        if (!scroller) {
          throw new Error('No scrollable list');
        }
        scroller.scrollTop = scrollTop;
        return scroller.scrollTop;
      }, top);

    expect(await scrollList(31 * 40)).toBeGreaterThan(31 * 30);
    await page.waitForTimeout(100);
    await scrollList(0);
    await expect(row(0)).toBeVisible();
    const headerEdges = await edges(headerCell('payee'));
    // Recycled rows can briefly measure as empty while they re-render
    for (const index of [0, 2, 5]) {
      await expect
        .poll(async () => {
          const rowEdges = await edges(row(index).getByTestId('payee'));
          return Math.max(
            Math.abs(rowEdges.left - headerEdges.left),
            Math.abs(rowEdges.right - headerEdges.right),
          );
        })
        .toBeLessThanOrEqual(1);
    }
  });

  test('tabbing to an off-screen cell scrolls it into view', async () => {
    await resizeTo('Payee', 'payee', 1200);
    const shell = scrollShell();
    await expect.poll(() => shell.evaluate(el => el.scrollLeft)).toBe(0);

    await row(0).getByTestId('date').click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }
    const deposit = row(0).getByTestId('credit').getByRole('textbox');
    await expect(deposit).toBeFocused();
    await expect
      .poll(() => shell.evaluate(el => el.scrollLeft))
      .toBeGreaterThan(0);
    const [cellEdges, shellEdges] = await Promise.all([
      edges(deposit),
      edges(shell),
    ]);
    expect(cellEdges.left).toBeGreaterThanOrEqual(shellEdges.left - 1);
    expect(cellEdges.right).toBeLessThanOrEqual(shellEdges.right + 1);
    await page.keyboard.press('Escape');
  });

  test('dragging a handle does not sort, select, edit or move rows (G6)', async () => {
    const payeesBefore = await accountPage.transactionTableRow
      .getByTestId('payee')
      .allTextContents();
    const headerHtmlBefore = await headerCell('payee').innerText();

    await resizeTo('Payee', 'payee', 300);

    expect(await headerCell('payee').innerText()).toBe(headerHtmlBefore);
    expect(
      await accountPage.transactionTableRow
        .getByTestId('payee')
        .allTextContents(),
    ).toEqual(payeesBefore);
    await expect(accountPage.selectButton).toHaveCount(0);
    await expect(accountPage.transactionTable.getByRole('textbox')).toHaveCount(
      0,
    );
  });

  test('widths persist per view and column id (P1-P3)', async () => {
    await resizeTo('Payee', 'payee', 240);

    await page.reload();
    await expect(row(0)).toBeVisible();
    await expect
      .poll(async () => Math.round((await edges(headerCell('payee'))).width))
      .toBe(240);

    await navigation.goToAccountPage('Bank of America');
    await expect(accountPage.accountName).toHaveText('Bank of America');
    await expect
      .poll(async () => Math.round((await edges(headerCell('payee'))).width))
      .not.toBe(240);

    await navigation.goToAccountPage('Ally Savings');
    await expect(accountPage.accountName).toHaveText('Ally Savings');
    await expect
      .poll(async () => Math.round((await edges(headerCell('payee'))).width))
      .toBe(240);

    await accountPage.setTransactionColumnVisibility('payee', false);
    await expect(headerCell('payee')).toHaveCount(0);
    await accountPage.setTransactionColumnVisibility('payee', true);
    await expect
      .poll(async () => Math.round((await edges(headerCell('payee'))).width))
      .toBe(240);
  });

  test('only a completed gesture or reset writes, and only the width key (P4)', async () => {
    const columnsBefore = await headerColumnIds();
    const storageBefore = await page.evaluate(() => ({ ...localStorage }));

    const handleBox = await handle('Payee').boundingBox();
    if (!handleBox) {
      throw new Error('No payee handle');
    }
    const x = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    await page.evaluate(() => {
      window.__setItemCounts = {};
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x + i * 5, y);
    }
    expect(await setItemCount()).toBe(0);
    await page.mouse.up();
    await expect.poll(setItemCount).toBe(1);

    const storageAfter = await page.evaluate(() => ({ ...localStorage }));
    const changedKeys = Object.keys({
      ...storageBefore,
      ...storageAfter,
    }).filter(key => storageBefore[key] !== storageAfter[key]);
    expect(changedKeys).toEqual([await widthKey()]);

    const modal = await accountPage.openTransactionColumnsModal();
    await modal.getByRole('button', { name: 'Reset column widths' }).click();
    await expect.poll(setItemCount).toBe(2);
    await expect(
      modal.getByRole('button', { name: 'Reset column widths' }),
    ).toBeDisabled();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    expect(await headerColumnIds()).toEqual(columnsBefore);

    await page.reload();
    await expect(row(0)).toBeVisible();
    expect(await headerColumnIds()).toEqual(columnsBefore);
  });

  test('a narrow viewport scrolls without saving a smaller width (P5)', async () => {
    await resizeTo('Payee', 'payee', 1200);
    await expect.poll(setItemCount).toBe(1);
    const key = await widthKey();

    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(300);

    const { scrollWidth, clientWidth } = await scrollShell().evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    expect(await setItemCount()).toBe(1);
    const stored = await page.evaluate(
      k => JSON.parse(localStorage.getItem(k) ?? '{}'),
      key ?? '',
    );
    expect(Object.values(stored)).toEqual([{ payee: 1200 }]);
  });
});
