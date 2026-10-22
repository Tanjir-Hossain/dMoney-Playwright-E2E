import { Page, Locator } from '@playwright/test';

/**
 * Registration page — creates a new account and selects the Agent role.
 *
 * The form fields have no stable name/label attributes on the portal,
 * so they are addressed positionally in DOM order.
 */
export class SignupPage {
  readonly page: Page;

  readonly fullNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly phoneInput: Locator;
  readonly nidInput: Locator;
  readonly roleDropdown: Locator;
  readonly createAccountButton: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;

    // Inputs in visual/DOM order: name, email, password, phone, NID.
    this.fullNameInput = page.locator('input').nth(0);
    this.emailInput = page.locator('input').nth(1);
    this.passwordInput = page.locator('input').nth(2);
    this.phoneInput = page.locator('input').nth(3);
    this.nidInput = page.locator('input').nth(4);

    this.roleDropdown = page.getByRole('combobox');

    this.createAccountButton = page.getByRole('button', {
      name: /Create Account/i,
    });

    this.loginLink = page.getByRole('link', { name: /Login here/i });
  }

  async goto() {
    await this.page.goto('/register');
    await this.fullNameInput.waitFor({ state: 'visible' });
  }

  async fillRegistrationData(
    fullName: string,
    email: string,
    password: string,
    phone: string,
    nid: string
  ) {
    await this.fullNameInput.fill(fullName);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.phoneInput.fill(phone);
    await this.nidInput.fill(nid);
  }

  async selectAgentRole() {
    await this.roleDropdown.click();
    await this.page.locator('[role="listbox"] >> text=Agent').click();
  }

  async createAccount() {
    await this.createAccountButton.click();

    // Give the SPA a moment to render the success/pending message.
    await this.page.waitForTimeout(1500);

    console.log('After registration URL:', this.page.url());
  }
}
