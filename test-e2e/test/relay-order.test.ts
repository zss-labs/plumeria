import { test, expect } from '@playwright/test';

/**
 * The child's own style and the one its caller passes down live in separate
 * modules, and the two pages import those modules in opposite orders. The losing
 * atom never reaches the element, so stylesheet order has nothing to decide.
 */

test.describe('a style passed through a prop', () => {
  for (const route of ['/relay-styles-first', '/relay-child-first']) {
    test(`beats the child's own style on ${route}`, async ({ page }) => {
      await page.goto(route);
      const element = page.locator('[data-testid="relay-order"]');

      await expect(element).toHaveCSS('color', 'rgb(0, 0, 255)');
      const classes = (await element.getAttribute('class'))!
        .trim()
        .split(/\s+/);
      expect(classes).toHaveLength(1);
    });
  }
});
