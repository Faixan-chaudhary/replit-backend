import { test, expect } from '@playwright/test';

test('Negative Login Test for Locked Out User', async ({ page }) => {
  // Navigate to the login page
  await page.goto('https://www.saucedemo.com/');

  // Attempt login with locked out user credentials
  await page.fill('input[data-test="username"]', 'locked_out_user');
  await page.fill('input[data-test="password"]', 'secret_sauce');
  await page.click('input[data-test="login-button"]');

  // Assert that an error message is displayed
  await expect(page.locator('[data-test="error"]')).toHaveText(/locked out/);
});

