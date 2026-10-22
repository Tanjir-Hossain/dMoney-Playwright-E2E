import { Page, Locator, expect } from '@playwright/test';

/**
 * Agent account view: balance check, cash-in to a Customer, logout, and
 * opening the Self Statement report.
 */
export class AgentPage {
  readonly page: Page;

  readonly balanceLabel: Locator;
  readonly balanceInput: Locator;

  readonly cashInLink: Locator;
  readonly customerPhoneInput: Locator;
  readonly amountInput: Locator;
  readonly cashInButton: Locator;

  readonly profileMenu: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.balanceLabel = page
      .locator('label')
      .filter({ hasText: 'Current Balance (BDT)' });
    this.balanceInput = page.getByLabel('Current Balance (BDT)');

    this.cashInLink = page.getByRole('link', {
      name: 'Cash In',
      exact: true,
    });
    this.customerPhoneInput = page.getByRole('textbox', {
      name: 'Customer Phone Number',
    });
    this.amountInput = page.getByLabel('Amount (BDT)');
    this.cashInButton = page.getByRole('button', { name: /Cash In/i });

    // The profile/account menu is an unlabelled icon in the header.
    this.profileMenu = page.locator('svg').nth(2);
    this.logoutButton = page.getByRole('menuitem', { name: /Logout/i });
  }

  /** Assert the Agent profile balance equals the expected numeric value. */
  async verifyBalance(expectedBalance: string) {
    await expect(this.page).toHaveURL(/.*\/profile/, { timeout: 10000 });

    await expect(this.balanceLabel).toHaveCount(1);
    await expect(this.balanceLabel).toBeVisible({ timeout: 10000 });
    await expect(this.balanceInput).toBeVisible({ timeout: 10000 });

    const actualBalance = await this.balanceInput.inputValue();
    console.log(
      `Balance check — expected: ${expectedBalance}, actual: ${actualBalance}`
    );

    expect(Number(actualBalance)).toBe(Number(expectedBalance));
  }

  async openCashIn() {
    await this.cashInLink.click();

    await expect(this.page).toHaveURL(/.*\/agent\/cash-in/, {
      timeout: 10000,
    });
    await expect(this.customerPhoneInput).toBeVisible({
      timeout: 10000,
    });

    console.log('Agent cash-in page opened');
  }

  /**
   * Try each candidate Customer phone number in turn and return the first
   * one that accepts the deposit. The portal rejects unknown accounts or
   * ones that have hit a limit, so we fall through to the next candidate.
   */
  async cashInToAnyCustomer(
    customerAccounts: string[],
    amount: string
  ): Promise<string> {
    const rejected =
      /user\s+does(?:n['’]?t| not)\s+exist|user\s+not\s+found|customer\s+not\s+found|account\s+not\s+found|limit\s+exceeded|cannot\s+deposit|insufficient\s+balance/i;

    let lastError = '';

    for (const customer of customerAccounts) {
      console.log(`Attempting deposit to customer: ${customer}`);

      try {
        await this.customerPhoneInput.fill('');
        await this.customerPhoneInput.fill(customer);
        await this.amountInput.fill('');
        await this.amountInput.fill(amount);

        await this.cashInButton.click();
        await this.page.waitForTimeout(1500);

        const bodyText = await this.page.locator('body').innerText();

        if (rejected.test(bodyText)) {
          lastError = bodyText;
          console.log(
            `Customer ${customer} rejected:`,
            bodyText.match(rejected)?.[0]
          );
          continue;
        }

        console.log(`Deposit accepted for customer: ${customer}`);
        return customer;
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : String(error);
        console.log(`Attempt failed for customer ${customer}`);
      }
    }

    throw new Error(
      `No customer accepted a ${amount} Tk deposit. Last error: ${lastError}`
    );
  }

  async logout() {
    await this.profileMenu.waitFor({ state: 'visible', timeout: 10000 });
    await this.profileMenu.click();

    await this.logoutButton.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await this.logoutButton.click();

    await expect(this.page).toHaveURL(/.*\/login/, { timeout: 10000 });
    console.log('Agent logged out');
  }

  async openSelfStatement() {
    const selfStatementLink = this.page.getByRole('link', {
      name: /Self Statement/i,
    });

    await selfStatementLink.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await selfStatementLink.click();

    await expect(this.page).toHaveURL(/.*self-statement.*/i, {
      timeout: 10000,
    });
    console.log('Self Statement page opened');
  }

  /**
   * Widen the Self Statement date filter so the run's transactions are
   * always in range. The page defaults From/To to a single day, which can
   * exclude same-day transactions depending on the portal's clock.
   */
  async setStatementDateRange(fromISO: string, toISO: string) {
    const fromInput = this.page.getByRole('textbox', { name: 'From Date' });
    const toInput = this.page.getByRole('textbox', { name: 'To Date' });

    for (const [input, value] of [
      [fromInput, fromISO],
      [toInput, toISO],
    ] as const) {
      await input.waitFor({ state: 'visible', timeout: 10000 });
      await input.click();
      await input.press('ControlOrMeta+A');
      await input.fill(value);
      await input.press('Enter');
    }

    console.log(`Statement date range set: ${fromISO} -> ${toISO}`);
  }
}
