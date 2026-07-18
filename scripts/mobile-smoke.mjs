import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.env.DRIFTLINE_URL || 'http://127.0.0.1:4173/';
const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 414, height: 896 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
];

await mkdir('artifacts/mobile-smoke', { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
});

const report = [];
let failed = false;

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
      locale: 'en-AU',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__DRIFTLINE__?.state.status === 'ready');

    const ready = await page.evaluate(() => {
      const start = document.querySelector('#start-button').getBoundingClientRect();
      const sound = document.querySelector('#sound-button').getBoundingClientRect();
      return {
        title: document.title,
        state: window.__DRIFTLINE__.state,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        startTarget: { width: start.width, height: start.height },
        soundTarget: { width: sound.width, height: sound.height },
        canvas: {
          width: document.querySelector('#game-canvas').clientWidth,
          height: document.querySelector('#game-canvas').clientHeight,
        },
      };
    });

    await page.screenshot({
      path: `artifacts/mobile-smoke/${viewport.width}x${viewport.height}-ready.png`,
      fullPage: true,
    });

    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__DRIFTLINE__?.state.status === 'running');
    await page.dispatchEvent('#game-canvas', 'pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: viewport.width * 0.82,
      clientY: viewport.height * 0.7,
      buttons: 1,
    });
    await page.dispatchEvent('#game-canvas', 'pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: viewport.width * 0.9,
      clientY: viewport.height * 0.7,
      buttons: 1,
    });
    await page.dispatchEvent('#game-canvas', 'pointerup', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: viewport.width * 0.9,
      clientY: viewport.height * 0.7,
      buttons: 0,
    });
    await page.waitForTimeout(650);

    const running = await page.evaluate(() => window.__DRIFTLINE__.state);
    await page.screenshot({
      path: `artifacts/mobile-smoke/${viewport.width}x${viewport.height}-running.png`,
      fullPage: true,
    });

    await page.evaluate(() => window.__DRIFTLINE__.crash());
    const endScreenVisible = await page.locator('#end-screen').isVisible();

    const checks = {
      httpOk: response?.ok() === true,
      titleOk: ready.title.includes('Driftline'),
      webglReady: ready.state.pixelRatio > 0,
      noHorizontalOverflow: ready.noHorizontalOverflow,
      fullCanvas: ready.canvas.width === viewport.width && ready.canvas.height === viewport.height,
      touchTargets: ready.startTarget.height >= 44 && ready.soundTarget.height >= 44 && ready.soundTarget.width >= 44,
      touchSteering: running.targetX > 1.8 && running.playerX > 0.5,
      scoreAdvanced: running.score > 0,
      crashFlow: running.status === 'running' && endScreenVisible,
      noConsoleErrors: errors.length === 0,
    };

    const passed = Object.values(checks).every(Boolean);
    failed ||= !passed;
    report.push({ viewport, passed, checks, ready, running, errors });
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (failed) process.exitCode = 1;
