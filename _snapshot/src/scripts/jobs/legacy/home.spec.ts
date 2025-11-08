import { test, expect } from '@playwright/test';

test.describe('Home smoke', () => {
  test('loads root and renders body', async ({ page }) => {
    const baseURL = process.env.BASE_URL || 'http://localhost:3000';
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });

    // basic DOM presence
    await expect(page.locator('body')).toBeVisible();

    // sanity: no obvious Next error overlay
    const errorOverlay = page.locator('#nextjs__container_errors, .nextjs-container-errors');
    await expect(errorOverlay).toHaveCount(0);
  });
});
