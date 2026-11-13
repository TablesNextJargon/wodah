// Run against a prepared local map. Set PLAYWRIGHT_MODULE to an existing
// Playwright installation, or install playwright in your development environment.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  fs.mkdirSync('test-results', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors = [];
    const ranges = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (/flood-zones-.*\.bin/.test(response.url()) &&
          response.request().method() === 'GET') {
        ranges.push({ status: response.status(), range: response.request().headers().range });
      }
    });
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4321/');
    await page.locator('.map-status').filter({ hasText: 'loaded for this view' })
      .waitFor({ timeout: 90000 });
    assert.equal(await page.locator('canvas').count(), 1);
    assert(ranges.length > 0 && ranges.every((item) => item.status === 206 && item.range),
      `Expected byte-range responses: ${JSON.stringify(ranges)}`);
    await page.screenshot({ path: 'test-results/england-desktop.png' });

    await page.getByRole('button', { name: 'Somerset' }).click();
    await page.waitForTimeout(700);
    await page.locator('.map-status').filter({ hasText: 'loaded for this view' })
      .waitFor({ timeout: 60000 });
    await page.waitForTimeout(1000);
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    assert(box);
    // Inspect an actual rendered polygon; do not inject synthetic flood data.
    let inspected = false;
    for (const [x, y] of [[0.5, 0.5], [0.45, 0.55], [0.4, 0.6], [0.6, 0.6],
      [0.3, 0.5], [0.5, 0.7], [0.6, 0.4], [0.4, 0.4]]) {
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      if (await page.locator('.feature-card dl').count()) { inspected = true; break; }
    }
    await page.screenshot({ path: 'test-results/somerset-before-inspection.png' });
    assert(inspected, 'Could not inspect a real Somerset flood polygon');
    assert.match(await page.locator('.feature-card').innerText(), /FZ[23]/);
    await page.screenshot({ path: 'test-results/somerset-inspection.png' });
    const satelliteTile = page.waitForResponse((response) =>
      response.url().includes('World_Imagery/MapServer/tile/') && response.status() === 200,
    { timeout: 30000 });
    await page.getByRole('button', { name: 'Satellite', exact: true }).click();
    await satelliteTile;
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('button', { name: 'Satellite', exact: true })
      .getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.feature-card dl').count(), 1);
    await page.screenshot({ path: 'test-results/somerset-satellite.png' });
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Map', exact: true })
      .getAttribute('aria-pressed'), 'true');
    await page.locator('.zone-row input').nth(0).uncheck();
    await page.locator('.zone-row input').nth(1).uncheck();
    assert.equal(await page.locator('.feature-card dl').count(), 0);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.locator('.feature-card dl').count(), 0);
    await page.locator('.zone-row input').nth(0).check();
    await page.locator('.zone-row input').nth(1).check();
    await page.locator('#opacity').fill('25');
    assert.equal(await page.locator('output').innerText(), '25%');

    // Deterministic search responses test both sides of the England boundary.
    await page.route('https://api.postcodes.io/postcodes/*', async (route) => {
      const english = route.request().url().includes('YO1');
      await route.fulfill({ json: { result: {
        country: english ? 'England' : 'Wales', postcode: english ? 'YO1 7HD' : 'CF10 3NQ',
        longitude: -1.082, latitude: 53.959,
      } } });
    });
    await page.locator('#postcode').fill('CF10 3NQ');
    await page.getByRole('button', { name: 'Search postcode' }).click();
    await page.locator('.search-status').filter({ hasText: 'England coverage only' }).waitFor();
    await page.locator('#postcode').fill('YO1 7HD');
    await page.getByRole('button', { name: 'Search postcode' }).click();
    await page.locator('.search-status').filter({ hasText: 'YO1 7HD located' }).waitFor();
    assert.equal(await page.locator('.maplibregl-marker').count(), 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Search & map tools' }).click();
    assert.equal(await page.locator('#map-tools').isVisible(), true);
    await page.screenshot({ path: 'test-results/england-mobile-tools.png' });
    await page.getByRole('button', { name: 'Close tools' }).click();
    assert.equal(await page.locator('#map-tools').isVisible(), false);
    assert.equal(await canvas.evaluate((element) => document.activeElement === element), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', rangeResponses: ranges.length,
      inspectedRealFloodPolygon: inspected, desktopAndMobile: true,
      satelliteTilesVerified: true, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
