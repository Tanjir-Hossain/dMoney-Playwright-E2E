import { expect, Page } from '@playwright/test';
import { GmailClient } from '../utils/GmailClient';

/**
 * Drives the "Forgot password" flow end to end:
 *   request a reset link -> read it from Gmail -> open it -> set a new
 *   password. Runs in an isolated browser context so it never disturbs
 *   the main test session, and retries once if the link lands stale.
 */
export class PasswordResetPage {
  constructor(private readonly page: Page) {}

  async reset(email: string, newPassword: string, gmail: GmailClient) {
    const browser = this.page.context().browser();
    if (!browser) {
      throw new Error(
        'Cannot create an isolated browser context for password reset.'
      );
    }

    const context = await browser.newContext();
    const resetPage = await context.newPage();

    const forgotPasswordUrl = new URL(
      '/forgot-password',
      this.page.url()
    ).toString();

    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`Password reset attempt ${attempt}`);

        await resetPage.goto(forgotPasswordUrl);

        const emailInput = resetPage.getByRole('textbox', {
          name: 'Email or Phone Number',
        });
        await emailInput.waitFor({ state: 'visible', timeout: 15000 });
        await emailInput.fill(email);
        await expect(emailInput).toHaveValue(email);

        const knownIds = await gmail.snapshotMessageIds(email);

        const sendResetButton = resetPage.getByRole('button', {
          name: 'Send Reset Link →',
        });
        await sendResetButton.waitFor({
          state: 'visible',
          timeout: 10000,
        });
        await sendResetButton.click();
        console.log('Reset link requested for', email);

        const resetLink = await gmail.waitForResetLink(knownIds, email);
        console.log('Reset link received');

        await resetPage.goto(resetLink);

        const passwordFields = resetPage.locator(
          'input[type="password"], input[placeholder*="password" i], input[aria-label*="password" i], input[name*="password" i]'
        );
        await passwordFields
          .first()
          .waitFor({ state: 'visible', timeout: 10000 })
          .catch(() => undefined);

        const invalidLink = resetPage
          .getByText(
            /invalid reset link|request a new password reset|need a new link/i
          )
          .first();

        const passwordVisible = await passwordFields
          .first()
          .isVisible()
          .catch(() => false);
        const invalidVisible = await invalidLink
          .isVisible()
          .catch(() => false);

        // Occasionally the first link renders as expired — retry once.
        if (!passwordVisible && invalidVisible) {
          console.log('Reset link reported invalid');
          if (attempt === 2) {
            throw new Error(
              'Password reset link remained invalid after retry.'
            );
          }
          continue;
        }

        // Resolve the "new password" field (fallback to a label match).
        let firstPassword = passwordFields.first();
        if (!(await firstPassword.isVisible().catch(() => false))) {
          const fallback = resetPage
            .getByLabel(/new password|confirm password|password/i)
            .first();
          if (await fallback.isVisible().catch(() => false)) {
            firstPassword = fallback;
          }
        }

        await expect(firstPassword).toBeVisible({ timeout: 10000 });
        await firstPassword.fill(newPassword);

        // Fill the confirm-password field when the form has one.
        const secondPassword = passwordFields.nth(1);
        if (await secondPassword.isVisible().catch(() => false)) {
          await secondPassword.fill(newPassword);
        } else {
          const confirmPassword = resetPage
            .getByLabel(/confirm password|repeat password/i)
            .first();
          if (await confirmPassword.isVisible().catch(() => false)) {
            await confirmPassword.fill(newPassword);
          }
        }

        await resetPage
          .getByRole('button', {
            name: /reset|change|update password|submit/i,
          })
          .last()
          .click();

        await expect(
          resetPage
            .getByText(/success|updated|reset|password changed/i)
            .first()
        ).toBeVisible({ timeout: 15000 });

        console.log('Password reset successful');
        return;
      }
    } finally {
      await context.close();
    }
  }
}
