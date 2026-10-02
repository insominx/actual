import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';
import { MobileNavigation } from './page-models/mobile-navigation';
import {
  addReservationCategory,
  RESERVATION_CATEGORY,
  ReservationBreakdown,
} from './page-models/reservation-breakdown';

test.describe('Mobile category reservations', () => {
  let page: Page;
  let navigation: MobileNavigation;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    navigation = new MobileNavigation(page);
    const configurationPage = new ConfigurationPage(page);

    await page.setViewportSize({ width: 350, height: 600 });
    await page.goto('/');
    await configurationPage.createTestFile();
    await addReservationCategory(page);
  });

  test.afterEach(async () => {
    await page?.close();
  });

  async function openBalanceMenu() {
    const budgetPage = await navigation.goToBudgetPage();
    await page
      .getByText(RESERVATION_CATEGORY, { exact: true })
      .scrollIntoViewIfNeeded();
    const balanceMenuModal =
      await budgetPage.openBalanceMenu(RESERVATION_CATEGORY);
    await expect(balanceMenuModal.heading).toHaveText(RESERVATION_CATEGORY);
    await expect(
      balanceMenuModal.transferToAnotherCategoryButton,
    ).toBeVisible();
    return balanceMenuModal;
  }

  test('shows the same breakdown in the balance modal', async () => {
    const settingsPage = await navigation.goToSettingsPage();
    await settingsPage.enableExperimentalFeature('Category reservations');

    const balanceMenuModal = await openBalanceMenu();
    const breakdown = new ReservationBreakdown(page);
    await expect(balanceMenuModal.locator).toContainText('Reserved');
    await breakdown.expectAmounts({ balance: '500.00', spare: '350.00' });
  });

  test('leaves the balance modal unchanged with the flag off', async () => {
    await openBalanceMenu();

    await expect(page.getByTestId('reservation-breakdown')).toHaveCount(0);
  });
});
