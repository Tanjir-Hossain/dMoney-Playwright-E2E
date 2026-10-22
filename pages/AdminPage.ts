import { Page, Locator, expect } from '@playwright/test';
import { agentData } from '../data/testData';

/**
 * Admin console: locate the pending Agent in the user list, activate it,
 * and harvest existing Customer phone numbers for the later Agent deposit.
 */
export class AdminPage {
  readonly page: Page;

  readonly usersMenu: Locator;
  readonly adminMenu: Locator;
  readonly logoutButton: Locator;

  readonly searchTypeDropdown: Locator;
  readonly searchByEmailOption: Locator;
  readonly emailInput: Locator;
  readonly searchButton: Locator;
  readonly resetButton: Locator;

  readonly agentRow: Locator;
  readonly agentEmail: Locator;
  readonly pendingStatus: Locator;

  readonly viewButton: Locator;
  readonly editUserButton: Locator;

  readonly accountStatusDropdown: Locator;
  readonly activeStatusOption: Locator;
  readonly saveChangesButton: Locator;

  readonly activeStatus: Locator;

  constructor(page: Page) {
    this.page = page;

    this.usersMenu = page.getByRole('link', {
      name: 'User List',
      exact: true,
    });
    this.adminMenu = page.getByText('Admin').nth(1);
    this.logoutButton = page.getByRole('menuitem', {
      name: '🚪 Logout',
    });

    this.searchTypeDropdown = page.getByRole('combobox').first();
    this.searchByEmailOption = page
      .locator('[role="listbox"]')
      .getByText('Search by Email', { exact: true });
    this.emailInput = page.getByRole('textbox', { name: 'Enter Email' });
    this.searchButton = page.getByRole('button', {
      name: 'Search',
      exact: true,
    });
    this.resetButton = page.getByRole('button', {
      name: 'Reset',
      exact: true,
    });

    // The Agent's table row, keyed by its unique email.
    this.agentRow = page
      .locator('tr')
      .filter({ hasText: agentData.email });
    this.agentEmail = this.agentRow.getByText(agentData.email, {
      exact: true,
    });
    this.pendingStatus = this.agentRow.getByText('PENDING', {
      exact: true,
    });
    this.viewButton = this.agentRow.getByRole('button', {
      name: /VIEW/i,
    });

    this.editUserButton = page.getByRole('button', {
      name: /Edit User/i,
    });
    this.accountStatusDropdown = page
      .getByText('Account Status', { exact: true })
      .locator('..')
      .getByRole('combobox');
    this.activeStatusOption = page
      .locator('[role="listbox"]')
      .getByText('Active', { exact: true });
    this.saveChangesButton = page.getByRole('button', {
      name: 'Save Changes',
      exact: true,
    });

    this.activeStatus = page.getByText('ACTIVE', { exact: true });
  }

  async openUsers() {
    await this.usersMenu.waitFor({ state: 'visible', timeout: 10000 });
    await this.usersMenu.click();
  }

  async selectEmailSearch() {
    await this.searchTypeDropdown.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.searchTypeDropdown.click();

    await this.searchByEmailOption.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.searchByEmailOption.click();
  }

  async searchByEmail(email: string) {
    await this.emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.emailInput.fill(email);
    await expect(this.emailInput).toHaveValue(email);

    await this.searchButton.click();
    await this.agentRow.waitFor({ state: 'visible', timeout: 10000 });
  }

  async verifyAgentExists() {
    await expect(this.agentRow).toBeVisible({ timeout: 10000 });
  }

  async verifyAgentPending() {
    await expect(this.pendingStatus).toBeVisible({ timeout: 10000 });
  }

  async openAgentDetails() {
    await this.viewButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.viewButton.click();
  }

  async editUser() {
    await this.editUserButton.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.editUserButton.click();
  }

  async changeStatusToActive() {
    await this.accountStatusDropdown.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.accountStatusDropdown.click();

    await this.activeStatusOption.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.activeStatusOption.click();
  }

  async saveChanges() {
    await this.saveChangesButton.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.saveChangesButton.click();
  }

  async verifyAgentActive() {
    await expect(this.activeStatus).toBeVisible({ timeout: 10000 });
  }

  /**
   * Collect phone numbers of existing Customer accounts from the Admin
   * user list. The Agent later deposits to one of these.
   *
   * Set CUSTOMER_ACCOUNT in .env to skip discovery and pin one number.
   */
  async findExistingCustomerAccounts(): Promise<string[]> {
    if (process.env.CUSTOMER_ACCOUNT) {
      return [process.env.CUSTOMER_ACCOUNT];
    }

    // After activating the Agent we are on /admin/users/:id whose first
    // combobox is the disabled role field — go back to the list first.
    await this.page.goto('/admin/users');
    await expect(this.page.locator('table')).toBeVisible({
      timeout: 10000,
    });

    // Filter the list by role = Customer.
    const searchType = this.page.getByRole('combobox').first();
    await searchType.waitFor({ state: 'visible', timeout: 10000 });
    await searchType.click();
    await this.page
      .getByRole('option', { name: /search by role/i })
      .click();

    const roleDropdown = this.page.getByRole('combobox').nth(1);
    await roleDropdown.waitFor({ state: 'visible', timeout: 10000 });
    await roleDropdown.click();
    await this.page
      .getByRole('option', { name: /^customer$/i })
      .click();

    // Trigger the search and wait for the result header to change.
    const totalHeading = this.page.getByRole('heading', {
      name: /total:/i,
    });
    const totalBeforeSearch = await totalHeading.innerText();

    await this.searchButton.click();
    await expect
      .poll(async () => totalHeading.innerText())
      .not.toBe(totalBeforeSearch);

    const rows = this.page.locator('tbody tr');

    // Jump to the first page if the list is paginated.
    const firstPage = this.page
      .getByRole('button', { name: /go to first page/i })
      .first();
    if (
      (await firstPage.isVisible().catch(() => false)) &&
      !(await firstPage.isDisabled())
    ) {
      await firstPage.click();
    }

    const accounts = new Set<string>();
    const pagination = this.page.getByRole('navigation', {
      name: /pagination navigation/i,
    });

    // Walk every page and extract each Customer's phone number.
    while (true) {
      await expect(rows.first()).toBeVisible({ timeout: 10000 });

      const rowCount = await rows.count();

      for (let index = 0; index < rowCount; index++) {
        const cells = rows.nth(index).locator('td');

        // A valid user row has at least 7 columns.
        if ((await cells.count()) < 7) {
          continue;
        }

        // Role lives in column index 5.
        const role = (await cells.nth(5).innerText()).trim();
        if (role.toLowerCase() !== 'customer') {
          continue;
        }

        // Cash-in needs a phone number, never an email.
        const rowText = await rows.nth(index).innerText();
        const phone = rowText.match(/\b01\d{9}\b/)?.[0];
        if (phone) {
          accounts.add(phone);
        }
      }

      // Advance to the next page if one exists.
      const nextPage = this.page
        .getByRole('button', { name: /go to next page/i })
        .last();
      if (
        !(await nextPage.isVisible().catch(() => false)) ||
        (await nextPage.isDisabled())
      ) {
        break;
      }

      const activePage = pagination
        .getByRole('button', { name: /^page \d+$/i })
        .last();
      const currentPage =
        (await activePage.getAttribute('aria-label')) ??
        (await activePage.innerText());

      await nextPage.click();

      await expect
        .poll(async () => {
          const pageButton = pagination
            .getByRole('button', { name: /^page \d+$/i })
            .last();
          return (
            (await pageButton.getAttribute('aria-label')) ??
            (await pageButton.innerText())
          );
        })
        .not.toBe(currentPage);
    }

    if (!accounts.size) {
      throw new Error(
        'No existing Customer account could be extracted from the Admin user list.'
      );
    }

    const result = [...accounts];
    console.log('Existing customer accounts found:', result);
    return result;
  }

  async logout() {
    await this.adminMenu.waitFor({ state: 'visible', timeout: 10000 });
    await this.adminMenu.click();

    await this.logoutButton.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.logoutButton.click();

    await expect(this.page).toHaveURL(/.*\/login/, { timeout: 10000 });
    console.log('Admin logged out');
  }
}
