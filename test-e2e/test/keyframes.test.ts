import { test, expect } from '@playwright/test';

test('a finite animation holds the frame it ends on', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="keyframes-box"]');
  const box = page.locator('[data-testid="keyframes-box"]');

  await expect(box).not.toHaveCSS('animation-name', 'none');
  await expect(box).toHaveCSS('background-color', 'rgb(0, 128, 0)');
  await expect(box).toHaveCSS('translate', '120px');
});
