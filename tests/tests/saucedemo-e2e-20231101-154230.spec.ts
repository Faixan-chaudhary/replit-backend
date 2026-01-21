import { test, expect } from '@playwright/test';

test('E2E Purchase Flow', async ({ page }) => {
  // Login
  await page.goto('https://www.saucedemo.com/');
  await page.locator('[data-test="username"]').fill('standard_user');
  await page.locator('[data-test="password"]').fill('secret_sauce');
  await page.locator('[data-test="login-button"]').click();

  // Add to cart
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();

  // Open cart and proceed to checkout
  await page.locator('[data-test="shopping-cart-container"]').click();
  await page.locator('[data-test="checkout"]').click();

  // Fill in checkout information
  await page.locator('[data-test="firstName"]').fill('John');
  await page.locator('[data-test="lastName"]').fill('Doe');
  await page.locator('[data-test="postalCode"]').fill('12345');
  await page.locator('[data-test="continue"]').click();

  // Finish purchase
  await page.locator('[data-test="finish"]').click();

  // Assert purchase confirmation
  await expect(page.locator('.complete-header')).toHaveText('THANK YOU FOR YOUR ORDER');
});

test('Negative Login Test for Locked Out User', async ({ page }) => {
  // Attempt login with locked out user
  await page.goto('https://www.saucedemo.com/');
  await page.locator('[data-test="username"]').fill('locked_out_user');
  await page.locator('[data-test="password"]').fill('secret_sauce');
  await page.locator('[data-test="login-button"]').click();

  // Assert error message
  await expect(page.locator('[data-test="error"]')).toHaveText('Epic sadface: Sorry, this user has been locked out.');
});
