const { test, expect } = require('@playwright/test');

test.describe('Polyphonic Piano Mode Synthesizer', () => {

  test('Piano mode halts playback and triggers precise ADSR envelopes via internal GainNodes', async ({ page }) => {
    // Inject audio spy capturing gain nodes and linear ramps for volume shaping
    await page.addInitScript(() => {
      window.__gains = [];
      window.__ramps = [];
      const OrigContext = window.AudioContext || window.webkitAudioContext;
      window.AudioContext = function() {
        const ctx = new OrigContext();
        const origCreateGain = ctx.createGain.bind(ctx);
        ctx.createGain = function() {
          const gainNode = origCreateGain();
          window.__gains.push(gainNode);
          
          const origRamp = gainNode.gain.linearRampToValueAtTime.bind(gainNode.gain);
          gainNode.gain.linearRampToValueAtTime = function(value, time) {
             window.__ramps.push({ value, time, currentTime: ctx.currentTime });
             return origRamp(value, time);
          };
          return gainNode;
        };
        return ctx;
      };
    });

    await page.goto('/');
    await page.waitForTimeout(500);

    // Hit standard play natively
    const playBtn = page.locator('#btn-play');
    await playBtn.click();
    
    // Assert it is actively playing by checking mathmusesynth HTML state string
    await expect(playBtn).toContainText('Pause');

    const pianoBtn = page.locator('#btn-piano-mode');
    await pianoBtn.click();

    // Verify Piano activation securely halted standard playback
    await expect(playBtn).toContainText('Play');
    await expect(pianoBtn).toContainText('Exit Piano Mode');
    
    // Polyphonic Key press to trigger attack envelope!
    await page.keyboard.press('KeyA');
    await page.waitForTimeout(100);

    const attackRamps = await page.evaluate(() => window.__ramps.filter(r => r.value === 1));
    // Verify an attack ramp strictly fired (volume mathematically approaching 1.0)
    expect(attackRamps.length).toBeGreaterThanOrEqual(1);

    // Verify the math shaping limit computationally
    // Hardware popping rules require a 50ms attack fade. 
    // The precise explicit math passed dynamically natively was { currentTime + 0.05 }
    const attack = attackRamps[attackRamps.length - 1];
    expect(attack.time - attack.currentTime).toBeCloseTo(0.05, 2);

    // Release key sequentially triggering release envelope natively bounded
    await page.keyboard.up('KeyA');
    await page.waitForTimeout(100);

    const releaseRamps = await page.evaluate(() => window.__ramps.filter(r => r.value === 0));
    // Verify mathematical bounds applied pushing envelope to perfectly 0.0 sound output
    expect(releaseRamps.length).toBeGreaterThanOrEqual(1);

    const release = releaseRamps[releaseRamps.length - 1];
    expect(release.time - release.currentTime).toBeCloseTo(0.1, 2);
  });

  test('Variable Timbre Bending dynamically regenerates underlying piano audio buffer asynchronously', async ({ page }) => {
    // Inject audio spy tracking createBuffer calls sequentially
    await page.addInitScript(() => {
      window.__buffersCreated = 0;
      const OrigContext = window.AudioContext || window.webkitAudioContext;
      window.AudioContext = function() {
        const ctx = new OrigContext();
        const origCreateBuffer = ctx.createBuffer.bind(ctx);
        ctx.createBuffer = function(channels, length, sampleRate) {
          window.__buffersCreated++;
          return origCreateBuffer(channels, length, sampleRate);
        };
        return ctx;
      };
    });

    await page.goto('/');
    await page.waitForTimeout(500);

    const pianoBtn = page.locator('#btn-piano-mode');
    await pianoBtn.click();
    
    // Pause to grant audio thread generation time roughly mapping heavy equations
    await page.waitForTimeout(300);

    // Initial buffer tracked
    const initialBufferCount = await page.evaluate(() => window.__buffersCreated);

    // Mutate the mathematical system logically dragging a GUI domain value drastically
    const varGroupA = page.locator('.variable-control-group').first();
    const valueInput = varGroupA.locator('.variable-number-input');

    await valueInput.fill('800');
    await valueInput.dispatchEvent('change'); 
    
    // Yield execution allowing JS logic throttle tracking (100ms internal delta limit boundary)
    await page.waitForTimeout(400);

    const secondaryBufferCount = await page.evaluate(() => window.__buffersCreated);

    // Verify natively the system explicitly instantiated a totally new buffer without a manually re-trigger explicitly
    expect(secondaryBufferCount).toBeGreaterThan(initialBufferCount);
  });

  test('Piano visual UI correctly mounts split-screen and registers mechanical key illumination explicitly dynamically', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const pianoBtn = page.locator('#btn-piano-mode');
    const visualContainer = page.locator('#piano-visual-container');
    const telemetryMult = page.locator('#piano-telemetry-mult');

    // Enable Piano Mode physically verifying CSS layout splits successfully natively
    await pianoBtn.click();
    await expect(visualContainer).toHaveClass(/active/);
    
    // Press white KeyA explicitly holding it down geometrically physically
    await page.keyboard.down('KeyA');
    
    const keyA = page.locator('.piano-key[data-key="KeyA"]');
    
    // Verify physical UI key element explicitly triggers glowing state actively geometrically
    await expect(keyA).toHaveClass(/active/);
    
    // Verify telemetry mathematically dynamically updates string calculations correctly explicitly
    await expect(telemetryMult).toContainText('1.00 x');

    // Lift physical key cleanly validating strict DOM sweeping natively
    await page.keyboard.up('KeyA');
    await expect(keyA).not.toHaveClass(/active/);

    // Press black KeyW triggering mathematically offset fractional pitches precisely holding it
    await page.keyboard.down('KeyW');
    const keyW = page.locator('.piano-key[data-key="KeyW"]');
    
    // Validate Black keys effectively accurately register active bounds perfectly
    await expect(keyW).toHaveClass(/active/);
    
    // Verify telemetry realistically maps exact floating multipliers (~1.06 x dynamically calculated accurately)
    await expect(telemetryMult).toContainText('1.06 x');
    
    // Cleanup securely strictly closing physical bindings geometrically explicitly
    await page.keyboard.up('KeyW');
  });

  test('Polyphonic interactions seamlessly handle multiple concurrent key illuminations recursively', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    const pianoBtn = page.locator('#btn-piano-mode');
    await pianoBtn.click();
    
    // Select chords physically structurally grouping (Keys natively mapped A, D, G)
    const keyA = page.locator('.piano-key[data-key="KeyA"]');
    const keyD = page.locator('.piano-key[data-key="KeyD"]');
    const keyG = page.locator('.piano-key[data-key="KeyG"]');
    
    // Press multiple native keys cascading mathematically
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyD');
    await page.keyboard.down('KeyG');
    
    // Assert exactly all target keys structurally glow fully illuminated natively dynamically
    await expect(keyA).toHaveClass(/active/);
    await expect(keyD).toHaveClass(/active/);
    await expect(keyG).toHaveClass(/active/);
    
    // Release a single arbitrary key globally breaking the physical hold gracefully
    await page.keyboard.up('KeyD');
    
    // Validate strict DOM cleanup ensures ONLY the exact referenced key releases securely!
    await expect(keyD).not.toHaveClass(/active/);
    
    // Verify remaining logically bounded elements retain their active mathematical holds successfully natively
    await expect(keyA).toHaveClass(/active/);
    await expect(keyG).toHaveClass(/active/);
    
    // Clean up explicitly organically globally triggering events natively explicitly cleanly
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyG');
    
    await expect(keyA).not.toHaveClass(/active/);
    await expect(keyG).not.toHaveClass(/active/);
  });
});
