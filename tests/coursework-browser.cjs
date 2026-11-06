'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright');
const base = process.env.PIXEL_TEST_URL || 'http://127.0.0.1:8899';
const evidence = path.join(os.tmpdir(), 'pixel-original-qa');
fs.mkdirSync(evidence, {recursive: true});
const tomorrow = new Date(Date.now() + 86400000 + 5 * 3600000).toISOString().slice(0, 10);
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'ru-RU', timezoneId: 'Asia/Almaty', reducedMotion: 'reduce'});
  const page = await context.newPage();
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', request => { if (request.method() !== 'GET' || request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`); });
  async function open(route) { await page.goto(`${base}/${route}`, {waitUntil: 'networkidle'}); }
  async function contains(selector, expected) { assert.ok((await page.locator(selector).textContent()).includes(expected), `${selector}: ${expected}`); }
  async function contact() { await page.locator('#booking-name').fill('Тестовый посетитель'); await page.locator('#booking-phone').fill('+7 700 123 45 67'); }
  try {
    const config = await (await context.request.get(`${base}/api/booking-config`)).json();
    assert.equal(config.mode, 'test', 'This submitting test requires a dry-run server; live delivery is forbidden.');
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({width, height: 1000});
      for (const route of ['index', 'rooms', 'games', 'booking', 'help']) {
        await open(`${route}.html`);
        if (route === 'index') await page.waitForFunction(() => document.querySelector('.portal-hero').classList.contains('scene-ready'));
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.locator('#quick-title, #idea-title, #reviews-title, #games-saved, #room-filter-title').count(), 0, 'extra sections removed');
        assert.equal(await page.locator('.pixel-site-header > .container').count(), 1, 'original header');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${route}: overflow ${width}`);
        assert.equal(await page.locator('img').evaluateAll(images => images.filter(image => image.complete && image.naturalWidth === 0).length), 0);
        if (route === 'games') assert.equal(await page.locator('.game-art').count(), 20, 'original game covers');
        if (width !== 768) await page.screenshot({path: path.join(evidence, `${route}-${width}.png`), fullPage: true});
      }
    }
    console.log('PASS: original 3D portal, covers, header and 5 pages at 375/768/1440; no overflow.');
    await open('games.html');
    await page.locator('#games-search').fill('КС 2'); await contains('#games-results', '1 из 20');
    await page.locator('#games-category').selectOption('sandbox');
    assert.equal(await page.locator('#games-empty').isVisible(), true);
    await page.locator('#games-empty-reset').click(); await contains('#games-results', '20 из 20');
    await page.locator('#games-search').fill('Minecraft');
    await page.locator('[data-game-id="minecraft"] a').click();
    await page.waitForFunction(() => document.getElementById('booking-game').value === 'minecraft');
    assert.equal(await page.locator('#preferences').getAttribute('open'), '');
    console.log('PASS: original catalog appearance, connected search/category/reset and selected-game transition.');
    await open('booking.html?room=standard&mode=hourly');
    await page.waitForFunction(() => !document.getElementById('booking-submit').disabled);
    await page.locator('#booking-submit').click();
    assert.equal(await page.locator('[aria-invalid=true]').count() > 0, true);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-invalid')), 'true');
    await page.locator('#booking-guests').fill('2');
    await page.locator('#booking-date').fill(tomorrow); await page.locator('#booking-time').fill('14:00');
    await contact();
    await page.locator('#booking-submit').click();
    await page.locator('#booking-result').waitFor({state: 'visible'});
    assert.equal(await page.locator('#booking-result').isVisible(), true);
    await contains('#booking-success', 'не отправлена администратору');
    const saved = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => key.startsWith('pixel-assignment-'))));
    assert.equal(saved.includes('Тестовый посетитель') || saved.includes('700 123'), false);
    await page.locator('#booking-edit').click();
    assert.equal(await page.locator('#booking-form').isVisible(), true);
    assert.equal(await page.locator('#booking-time').inputValue(), '');
    await page.locator('#booking-date').fill(tomorrow);
    await page.locator('#booking-time').fill('14:00');
    await contact(); await page.locator('#booking-submit').click();
    await page.locator('#booking-result').waitFor({state: 'visible'});
    await page.reload({waitUntil: 'networkidle'});
    assert.equal(await page.locator('#booking-form').isVisible(), true);
    assert.equal(await page.locator('#booking-time').inputValue(), '');
    console.log('PASS: existing calculator/validation/focus, dry-run API confirmation, privacy and clean new visit.');
    await open('booking.html?mode=packages');
    await page.waitForFunction(() => document.querySelector('[data-quantity="standard-3-hours:1"]'));
    await page.locator('#package-picker summary').first().click();
    assert.equal(await page.locator('#cart-checkout').isDisabled(), true);
    await page.locator('[data-quantity="standard-3-hours:1"]').click();
    await page.locator('[data-quantity="standard-3-hours:1"]').click();
    await contains('#package-selection-status', '2 пакетов');
    await page.locator('#cart-checkout').click(); await contains('#cart-receipt', 'реальный заказ, оплата и бронь не созданы');
    await page.locator('[data-quantity="standard-3-hours:-1"]').click(); await contains('#package-selection-status', '1 пакетов');
    await page.getByRole('button', {name: 'В план: Standard · 3 часа', exact: true}).click();
    assert.equal(await page.locator('#booking-package').inputValue(), 'standard-3-hours');
    await page.locator('#package-picker summary').first().click();
    await page.getByRole('button', {name: 'Удалить: Standard · 3 часа', exact: true}).click();
    await contains('#package-selection-status', 'Корзина пуста');
    await page.locator('[data-quantity="standard-3-hours:1"]').click();
    await page.locator('#cart-clear').click(); await contains('#package-selection-status', 'Корзина пуста');
    await page.setViewportSize({width: 375, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'cart overflow');
    console.log('PASS: cart inside existing disclosure: +/-/remove/clear/totals/empty/confirmation/use in plan.');
    await open('booking.html?mode=hourly');
    await page.locator('#booking-date').fill(tomorrow); await page.locator('#booking-time').fill('14:00'); await contact();
    await page.locator('#booking-submit').click();
    await page.locator('#booking-result').waitFor({state: 'visible'});
    assert.equal(await page.locator('#booking-result').isVisible(), true);
    await page.screenshot({path: path.join(evidence, 'confirmation-375.png'), fullPage: true});
    for (const [route, target] of [['cart.html','booking.html'], ['computers.html','rooms.html'], ['all-locations.html','rooms.html']]) {
      await open(route); assert.ok(page.url().includes(target));
    }
    assert.deepEqual(errors, []);
    assert.ok(requests.some(request => request === `POST ${base}/api/bookings`));
    const expected = [`POST ${base}/api/bookings`, `GET ${base}/api/booking-config`, `GET ${base}/api/auth/session`];
    assert.deepEqual(requests.filter(request => !expected.includes(request)), []);
    console.log(`PASS: mobile confirmation, redirects, no console errors; API calls restricted to the dry-run server. Screenshots: ${evidence}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
