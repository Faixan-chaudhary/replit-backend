import { test, expect } from '@playwright/test';

test.describe('SauceDemo Tests', () => {
  test('E2E Purchase Flow', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping_cart_link"]');
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'John');
    await page.fill('[data-test="lastName"]', 'Doe');
    await page.fill('[data-test="postalCode"]', '12345');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');
    await expect(page.locator('.complete-header')).toHaveText('THANK YOU FOR YOUR ORDER');
  });

  test('Locked Out User Login', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');
    await page.fill('[data-test="username"]', 'locked_out_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    const errorMessage = await page.locator('[data-test="error"]');
    await expect(errorMessage).toHaveText('Epic sadface: Sorry, this user has been locked out.');
  });
});