import { test, expect } from '@playwright/test';

test('End-to-End Purchase Flow', async ({ page }) => {
  // Navigate to the login page
  await page.goto('https://www.saucedemo.com/');

  // Fill login form
  await page.fill('input[data-test="username"]', 'standard_user');
  await page.fill('input[data-test="password"]', 'secret_sauce');
  await page.click('input[data-test="login-button"]');

  // Ensure login was successful and navigate to the inventory
  await expect(page).toHaveURL('https://www.saucedemo.com/inventory.html');

  // Add the first product to the cart
  await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
  await page.click('.shopping_cart_link');

  // Proceed to Checkout
  await page.click('[data-test="checkout"]');
  await page.fill('input[data-test="firstName"]', 'John');
  await page.fill('input[data-test="lastName"]', 'Doe');
  await page.fill('input[data-test="postalCode"]', '12345');
  await page.click('[data-test="continue"]');
  
  // Finish checkout
  await page.click('[data-test="finish"]');
  
  // Assert checkout completion
  await expect(page.locator('.complete-header')).toHaveText('THANK YOU FOR YOUR ORDER');
});

