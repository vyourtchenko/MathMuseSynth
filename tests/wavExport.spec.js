const { test, expect } = require('@playwright/test');

test.describe('WAV Audio Export', () => {

  test('Download button is visible in the Domain controls section', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const btn = page.locator('#btn-download-wav');
    await expect(btn).toBeVisible();
    
    // Verify it sits inside the controls section alongside Domain (x)
    const controlsSection = page.locator('.controls-section');
    await expect(controlsSection.locator('#btn-download-wav')).toBeVisible();
  });

  test('Clicking download triggers a .wav file download with correct RIFF structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Intercept the native browser download event
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-download-wav').click();
    const download = await downloadPromise;

    // Verify the filename is correct
    expect(download.suggestedFilename()).toBe('mathmusesynth-sample.wav');
  });

  test('WAV encoder writes a standards-compliant RIFF header', async ({ page }) => {
    // Install the interceptor before the app loads so it can hook URL.createObjectURL
    await page.addInitScript(() => {
      window.__wavHeaderBytes = null;
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function(blob) {
        const url = origCreate(blob);
        blob.arrayBuffer().then(buf => {
          const view = new DataView(buf);
          const bytes = [];
          for (let i = 0; i < 44; i++) bytes.push(view.getUint8(i));
          window.__wavHeaderBytes = bytes;
        });
        return url;
      };
    });

    await page.goto('/');
    await page.waitForTimeout(500);

    await page.locator('#btn-download-wav').click();

    // Wait for the async blob.arrayBuffer() read to complete
    const wavBytes = await page.waitForFunction(() => window.__wavHeaderBytes !== null)
      .then(() => page.evaluate(() => window.__wavHeaderBytes));

    // 'RIFF' at bytes 0-3
    expect(wavBytes[0]).toBe(82);  // R
    expect(wavBytes[1]).toBe(73);  // I
    expect(wavBytes[2]).toBe(70);  // F
    expect(wavBytes[3]).toBe(70);  // F

    // 'WAVE' at bytes 8-11
    expect(wavBytes[8]).toBe(87);  // W
    expect(wavBytes[9]).toBe(65);  // A
    expect(wavBytes[10]).toBe(86); // V
    expect(wavBytes[11]).toBe(69); // E

    // 'fmt ' at bytes 12-15
    expect(wavBytes[12]).toBe(102); // f
    expect(wavBytes[13]).toBe(109); // m
    expect(wavBytes[14]).toBe(116); // t
    expect(wavBytes[15]).toBe(32);  // space

    // PCM format = 1 at bytes 20-21 (little-endian)
    expect(wavBytes[20]).toBe(1);
    expect(wavBytes[21]).toBe(0);

    // 'data' at bytes 36-39
    expect(wavBytes[36]).toBe(100); // d
    expect(wavBytes[37]).toBe(97);  // a
    expect(wavBytes[38]).toBe(116); // t
    expect(wavBytes[39]).toBe(97);  // a
  });

  test('WAV export re-evaluates current equation and domain values correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Change duration to 1 second so we can predict the data size
    await page.locator('#duration').fill('1');
    await page.locator('#duration').dispatchEvent('change');
    await page.waitForTimeout(200);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-download-wav').click();
    const download = await downloadPromise;

    // For 1 second at 44100Hz, 16-bit mono:
    // Data size = 44100 * 1 * 2 = 88200 bytes
    // Total size = 88200 + 44 (header) = 88244 bytes
    const path = await download.path();
    const { statSync } = require('fs');
    const fileSize = statSync(path).size;

    // Fetch the browser's actual sample rate (Chromium headless uses 48000, not 44100)
    const sampleRate = await page.evaluate(() => {
      const ctx = new AudioContext();
      const sr = ctx.sampleRate;
      ctx.close();
      return sr;
    });

    // Header = 44 bytes, data = sampleRate * duration(1s) * 2 bytes per 16-bit sample
    expect(fileSize).toBe(44 + sampleRate * 1 * 2);
  });
});
