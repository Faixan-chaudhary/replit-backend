import { test, expect } from '@playwright/test';

test.describe('SauceDemo E-Commerce Functional Tests', () => {
  test('Successful Login and Add Item to Cart', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');

    // Login
    await page.fill('[data-test="username"]', 'standard_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    await expect(page).toHaveURL('https://www.saucedemo.com/inventory.html');

    // Add Sauce Labs Bolt T-Shirt to cart
    await page.click('[data-test="add-to-cart-sauce-labs-bolt-t-shirt"]');
    
    // Validate the item count increases in cart icon
    const cartBadge = await page.locator('.shopping_cart_badge');
    await expect(cartBadge).toHaveText('1');
    
    // Proceed to cart
    await page.click('.shopping_cart_link');
    await expect(page).toHaveURL('https://www.saucedemo.com/cart.html');
  });

  test('Locked Out User Cannot Login', async ({ page }) => {
    await page.goto('https://www.saucedemo.com/');

    // Attempt login with locked out user
    await page.fill('[data-test="username"]', 'locked_out_user');
    await page.fill('[data-test="password"]', 'secret_sauce');
    await page.click('[data-test="login-button"]');
    
    // Check for error message
    const errorMessage = await page.locator('[data-test="error"]');
    await expect(errorMessage).toHaveText('Epic sadface: Sorry, this user has been locked out.');
  });
});
