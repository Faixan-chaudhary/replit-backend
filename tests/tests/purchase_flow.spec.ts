import { test, expect } from '@playwright/test';

test.describe('SauceDemo Purchase Flow', () => {
  test('Positive purchase flow with standard_user', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');

    // Login as standard_user
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    // Add item to cart
    await page.click('[data-test="add-to-cart-sauce-labs-backpack"]');
    await page.click('[data-test="shopping-cart-link"]');

    // Checkout process
    await page.click('[data-test="checkout"]');
    await page.fill('[data-test="firstName"]', 'John');
    await page.fill('[data-test="lastName"]', 'Doe');
    await page.fill('[data-test="postalCode"]', '12345');
    await page.click('[data-test="continue"]');
    await page.click('[data-test="finish"]');

    // Assert that checkout completed page is shown with the thank you message
    await expect(page.locator('h2')).toHaveText('Thank you for your order!');
  });

  test('Negative login flow with locked_out_user', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');

    // Attempt to login with locked_out_user
    await page.fill('[data-test="username"]', 'locked_out_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');

    // Assert that the error message is displayed
    const errorMessage = await page.locator('[data-test="error"]').innerText();
    expect(errorMessage).toContain('Epic sadface: Sorry, this user has been locked out.');
  });
});
