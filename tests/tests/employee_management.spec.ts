import { test, expect } from '@playwright/test';

test('Employee Management Navigation and Operations', async ({ page }) => {
  await page.goto('https://lpsapps.com:7543/');

  // Navigate to Product Management
  await page.getByRole('link', { name: 'Product' }).click();
  await expect(page).toHaveURL('https://lpsapps.com:7543/Product');

  // Navigate back to Employee Management
  await page.goBack();
  await expect(page).toHaveURL('https://lpsapps.com:7543/');

  // Click 'Add Employee'
  await page.getByRole('button', { name: 'Add Employee' }).click();
  await expect(page).toHaveTitle(/Error/);
}