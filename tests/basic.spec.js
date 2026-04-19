const { test, expect } = require('@playwright/test');

test.describe('Basic Application Setup', () => {
  test('homepage has title and UI elements', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/MathMuseSynth/);

    // Expect the canvas to be visible
    await expect(page.locator('#waveform-canvas')).toBeVisible();

    // Expect MathLive to be visible
    await expect(page.locator('#formula')).toBeVisible();

    // Expect standard play button to be visible
    await expect(page.locator('#btn-play')).toBeVisible();
  });

  test('visual regression testing of default canvas state', async ({ page }) => {
    await page.goto('/');
    // Wait a moment for the canvas to draw its initial state
    await page.waitForTimeout(500); 
    
    // Snap the canvas
    await expect(page.locator('#waveform-canvas')).toHaveScreenshot('default-graph.png', { maxDiffPixels: 300 });
  });
});
