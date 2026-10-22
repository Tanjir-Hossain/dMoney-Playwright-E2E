import { test, expect } from '@playwright/test';

/**
 * Smoke suite — positive, fast-loading page checks only.
 * These confirm the core public pages render before running the heavier
 * regression journey.
 */
test.describe('DMoney Smoke @smoke', () => {
  test('Login page loads successfully', async ({ page }) => {
    await page.goto('/login');

    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByPlaceholder('Enter email or phone number')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /login/i })
    ).toBeVisible();

    console.log('Smoke pass: login page loaded');
  });

  test('Registration page loads successfully', async ({ page }) => {
    await page.goto('/register');

    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator('input').first()).toBeVisible();

    console.log('Smoke pass: registration page loaded');
  });

  test('Forgot password page loads successfully', async ({ page }) => {
    await page.goto('/forgot-password');

    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(
      page.getByRole('textbox', { name: 'Email or Phone Number' })
    ).toBeVisible();

    console.log('Smoke pass: forgot-password page loaded');
  });
});
