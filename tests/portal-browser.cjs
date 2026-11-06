'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const base = process.env.PIXEL_TEST_URL || 'http://127.0.0.1:8898';
const output = path.join(os.tmpdir(), 'pixel-native-portal-qa');
fs.mkdirSync(output, {recursive: true});
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const scene = JSON.parse(fs.readFileSync(path.join(root, 'demofinal/assets/portal/scene.json'), 'utf8'));
assert.equal(scene.meshes.length, 6);
for (const mesh of scene.meshes) {
  assert.equal(mesh.position.length / 3, mesh.uv.length / 2);
  assert.equal(mesh.position.length % 9, 0);
  assert.ok(mesh.position.every(Number.isFinite) && mesh.uv.every(Number.isFinite));
}
for (const variant of scene.variants) {
  assert.equal(variant.atlases.length, 6);
  for (const file of variant.atlases) assert.ok(fs.existsSync(path.join(root, 'demofinal/assets/portal', file)));
}
assert.equal(fs.existsSync(path.join(root, 'demofinal/assets/vendor/three/three.module.js')), false);
assert.ok(!fs.readFileSync(path.join(root, 'demofinal/index.html'), 'utf8').includes('importmap'));
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader']});
  const context = await browser.newContext({reducedMotion: 'reduce'});
  const page = await context.newPage();
  const errors = [], dependencies = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/vendor\/three|three\.(?:module|core)\.js|Reflector\.js/.test(request.url())) dependencies.push(request.url()); });
  const ready = async target => target.waitForFunction(() => document.querySelector('.portal-hero').classList.contains('scene-ready') && document.querySelector('.portal-hero').dataset.engine === 'native');
  const sceneFrame = () => page.screenshot({clip: {x: 700, y: 160, width: 600, height: 500}});
  try {
    for (const [width, height] of [[1440, 1000], [1920, 1080], [768, 1000], [375, 900]]) {
      await page.setViewportSize({width, height});
      await page.goto(`${base}/index.html`, {waitUntil: 'networkidle'}); await ready(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.equal(await page.locator('h1').textContent(), 'Времядля вашейигры.');
      await page.screenshot({path: path.join(output, `portal-${width}.png`)});
    }
    console.log('PASS: original layout and native portal at 375/768/1440/1920 px, no obsolete 3D library requests.');
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(`${base}/index.html`, {waitUntil: 'networkidle'}); await ready(page);
    await page.waitForTimeout(800);
    const reducedA = digest(await sceneFrame());
    await page.waitForTimeout(200);
    assert.equal(digest(await sceneFrame()), reducedA, 'reduced-motion scene stays still');
    await page.goto(`${base}/rooms.html`, {waitUntil: 'networkidle'});
    await page.goBack({waitUntil: 'networkidle'}); await ready(page); await page.waitForTimeout(800);
    assert.equal(digest(await sceneFrame()), reducedA, 'static portal survives browser history restore');
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.locator('#portal-motion').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('#portal-motion').getAttribute('aria-pressed'), 'true');
    const paused = digest(await sceneFrame());
    await page.mouse.move(1200, 250); await page.mouse.move(10, 10);
    await page.waitForTimeout(200);
    assert.equal(digest(await sceneFrame()), paused, 'pause freezes the pose even after pointer leave');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#portal-motion').getAttribute('aria-pressed'), 'false');
    await page.mouse.move(1300, 250); await page.waitForTimeout(160);
    const moving = digest(await sceneFrame());
    assert.notEqual(moving, paused, 'pointer motion updates native geometry');
    await page.evaluate(() => window.scrollTo(0, 240)); await page.waitForTimeout(160);
    assert.notEqual(digest(await sceneFrame()), moving, 'scroll changes portal projection');
    console.log('PASS: reduced motion, keyboard pause/resume, frozen pose, pointer and scroll.');
    await page.evaluate(() => {
      window.__portalLoss = document.getElementById('portal-canvas').getContext('webgl').getExtension('WEBGL_lose_context');
      window.__portalLoss.loseContext();
    });
    await page.waitForFunction(() => document.querySelector('.portal-hero').dataset.renderer === 'fallback');
    assert.equal(await page.locator('.portal-fallback').isVisible(), true);
    await page.evaluate(() => window.__portalLoss.restoreContext()); await ready(page);
    console.log('PASS: context loss reveals existing photo fallback; restoration rebuilds GPU resources.');
    const unavailable = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await unavailable.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
    });
    const fallback = await unavailable.newPage();
    await fallback.goto(`${base}/index.html`, {waitUntil: 'networkidle'});
    await fallback.waitForFunction(() => document.querySelector('.portal-hero').dataset.renderer === 'fallback');
    assert.equal(await fallback.locator('.portal-fallback img').isVisible(), true);
    assert.equal(await fallback.locator('#portal-motion').isVisible(), false);
    await unavailable.close();
    assert.deepEqual(errors, []); assert.deepEqual(dependencies, []);
    console.log(`PASS: no-WebGL fallback, no console errors. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
