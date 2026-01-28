import { test, expect } from '@playwright/test';

test('SauceDemo Login and Add to Cart', async ({ page }) => {
  // Navigate to the SauceDemo website
  await page.goto('https://www.saucedemo.com/');
  
  // Login with standard user credentials
  await page.fill('[data-test="username"]', 'standard_user');
  await page.fill('[data-test="password"]', 'secret_sauce');
  await page.click('[data-test="login-button"]');

  // Verify successful navigation to the inventory page
  await expect(page).toHaveURL('https://www.saucedemo.com/inventory.html');
  await expect(page.locator('.title')).toHaveText('Products');

  // Add Sauce Labs Backpack to the cart
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');

  // Check if the cart badge shows 1 item
  const cartBadge = await page.locator('.shopping_cart_badge').textContent();
  expect(cartBadge).toBe('1');
});
