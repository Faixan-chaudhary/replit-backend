import { test, expect } from '@playwright/test';

test('SauceDemo login and purchase flow', async ({ page }) => {
  // Navigate to the login page
  await page.goto('https://www.saucedemo.com/');
  
  // Login as standard user
  await page.locator('[data-test="username"]').fill('standard_user');
  await page.locator('[data-test="password"]').fill('secret_sauce');
  await page.locator('[data-test="login-button"]').click();

  // Verify successful login by checking URL
  await expect(page).toHaveURL('https://www.saucedemo.com/inventory.html');

  // Add Sauce Labs Backpack to the cart
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();

  // Go to cart
  await page.locator('[data-test="shopping-cart-link"]').click();
  await expect(page).toHaveURL('https://www.saucedemo.com/cart.html');

  // Checkout
  await page.locator('[data-test="checkout"]').click();

  // Fill checkout information
  await page.locator('[data-test="firstName"]').fill('Test');
  await page.locator('[data-test="lastName"]').fill('User');
  await page.locator('[data-test="postalCode"]').fill('12345');
  await page.locator('[data-test="continue"]').click();

  // Finish purchase
  await page.locator('[data-test="finish"]').click();
  await expect(page).toHaveURL('https://www.saucedemo.com/checkout-complete.html');

  // Verify order complete
  await expect(page.locator('h2')).toHaveText('Thank you for your order!');
});
