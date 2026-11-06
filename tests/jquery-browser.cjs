'use strict';
// All requests stay on the documented dry-run server; no Telegram delivery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');
const base = process.env.PIXEL_TEST_URL || 'http://127.0.0.1:8899';
const output = path.join(os.tmpdir(), 'pixel-jquery-tests');
fs.mkdirSync(output, {recursive: true});
const tomorrow = new Date(Date.now() + 86400000 + 5 * 3600000).toISOString().slice(0, 10);
(async () => {
  const browser = await chromium.launch({headless: true, args: ['--enable-unsafe-swiftshader']});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Almaty'});
    const config = await (await context.request.get(`${base}/api/booking-config`)).json();
    assert.equal(config.mode, 'test');
    const page = await context.newPage();
    const errors = [], sent = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.method() === 'POST') sent.push(request.postDataJSON()); });
    const open = async route => page.goto(`${base}/${route}`, {waitUntil: 'networkidle'});
    for (const route of ['index', 'rooms', 'games', 'booking', 'help']) {
      await open(`${route}.html`);
      assert.equal(await page.evaluate(() => $.fn.jquery), '3.7.1', route);
      assert.equal(await page.locator('script[src*="old-js-version"]').count(), 0);
    }
    await page.evaluate(() => {
      window.effectCalls = [];
      for (const name of ['slideUp', 'slideDown', 'fadeIn', 'fadeOut']) {
        const original = $.fn[name];
        $.fn[name] = function (...args) { effectCalls.push({name, duration: args[0]}); return original.apply(this, args); };
      }
    });
    const faq = page.locator('#help-packages > summary');
    await faq.click();
    await page.waitForFunction(() => !$('#help-packages > div').is(':animated'));
    assert.equal(await faq.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#help-packages > div').isVisible(), true);
    await faq.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !$('#help-packages').prop('open'));
    assert.equal(await faq.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#help-packages > div').isVisible(), false);
    const effects = await page.evaluate(() => effectCalls);
    assert.ok(effects.some(effect => effect.name === 'slideDown' && effect.duration === 180));
    assert.ok(effects.some(effect => effect.name === 'slideUp' && effect.duration === 180));
    await faq.click(); await faq.click(); await faq.click();
    await page.waitForFunction(() => !$('#help-packages > div').is(':animated'));
    assert.equal(await page.locator('#help-packages > div').isVisible(), true, 'rapid toggles keep state consistent');
    console.log('PASS: real CDN version on all pages; FAQ effects, callback, keyboard and rapid toggles.');

    await open('booking.html?mode=hourly');
    await page.waitForFunction(() => !$('#booking-submit').prop('disabled'));
    assert.equal(await page.locator('#booking-email').count(), 1, 'email created in code');
    await page.locator('.visit-email > summary').click();
    await page.locator('#booking-date').fill('');
    await page.locator('#booking-phone').fill('123');
    await page.locator('#booking-email').fill('broken@address');
    await page.locator('#booking-submit').click();
    for (const name of ['name', 'phone', 'email', 'date', 'time']) {
      assert.equal(await page.locator(`#booking-${name}`).getAttribute('aria-invalid'), 'true', name);
      assert.equal(await page.locator(`#booking-${name}-error`).isVisible(), true, name);
      assert.ok((await page.locator(`#booking-${name}-error`).textContent()).length > 0);
      assert.ok((await page.locator(`#booking-${name}`).getAttribute('aria-describedby')).includes(`booking-${name}-error`));
    }
    assert.equal(await page.locator('#booking-result').isVisible(), false);
    assert.equal(sent.length, 0);
    await page.locator('#booking-name').pressSequentially('Тестовый гость');
    assert.equal(await page.locator('#booking-name').inputValue(), 'Тестовый гость', 'typing spaces is preserved');
    await page.locator('#booking-name').fill('  Тестовый гость  ');
    await page.locator('#booking-phone').fill(' +7 700 123 45 67 ');
    await page.locator('#booking-email').fill('guest@example.com');
    await page.locator('#booking-date').fill(tomorrow);
    await page.locator('#booking-time').fill('14:00');
    for (const name of ['name', 'phone', 'email', 'date', 'time']) {
      assert.equal(await page.locator(`#booking-${name}`).getAttribute('aria-invalid'), null, name);
      assert.equal(await page.locator(`#booking-${name}-error`).isVisible(), false, name);
    }
    await page.locator('#booking-guests').fill('2');
    await page.locator('#booking-extras > summary').click();
    await page.locator('#preferences > summary').click();
    await page.locator('#booking-nearby').check();
    assert.equal(await page.evaluate(() => $('#booking-nearby').prop('checked')), true);
    assert.equal(await page.locator('#booking-nearby').getAttribute('checked'), null, 'attr keeps original default');
    await page.screenshot({path: path.join(output, 'booking-1440.png'), fullPage: true});
    await page.locator('#booking-submit').click();
    await page.locator('#booking-success').waitFor({state: 'visible'});
    await page.waitForFunction(() => !$('#booking-success').is(':animated'));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].contact.name, 'Тестовый гость');
    assert.equal(sent[0].contact.phone, '+77001234567');
    assert.equal(sent[0].contact.email, 'guest@example.com');
    assert.equal(sent[0].plan.nearby, true);
    for (const name of ['name', 'phone', 'email', 'date', 'time']) assert.equal(await page.locator(`#booking-${name}`).inputValue(), '', `reset ${name}`);
    assert.ok((await page.locator('#booking-saved-review').textContent()).includes('guest@example.com'));
    const stored = await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}));
    assert.equal(stored.includes('guest@example.com') || stored.includes('Тестовый гость') || stored.includes('7001234567'), false);
    await page.locator('#booking-edit').click();
    assert.equal(await page.locator('#booking-time').inputValue(), '');
    assert.equal(await page.locator('#booking-email').inputValue(), '');
    await page.setViewportSize({width: 375, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({path: path.join(output, 'booking-375.png'), fullPage: true});
    console.log('PASS: per-field errors/correction, email/phone/trim, checkbox prop vs attr, successful response, reset, privacy, new visit and mobile layout.');

    await open('booking.html?mode=packages&room=vip');
    await page.waitForFunction(() => $('[data-quantity="vip-3-hours:1"]').length > 0);
    await page.locator('#package-picker > summary').click();
    for (let i = 0; i < 3; i += 1) await page.locator('[data-quantity="vip-3-hours:1"]').click();
    assert.equal(await page.evaluate(() => PixelCart.getSnapshot().items.find(item => item.id === 'vip-3-hours').quantity), 3);
    assert.equal(await page.locator('.package-option[data-package-id="vip-3-hours"] output').textContent(), '3');
    await page.locator('label[for="visit-room-duo"]').click();
    await page.locator('[data-quantity="duo-3-hours:1"]').click();
    await page.locator('[data-quantity="duo-3-hours:1"]').click();
    assert.equal(await page.locator('[data-quantity="duo-3-hours:1"]').isDisabled(), true, 'capacity preserved');
    assert.equal(await page.locator('.package-option[data-package-id="duo-3-hours"] output').textContent(), '2');
    console.log('PASS: delegated buttons survive repeated regeneration/room changes; cart capacities preserved.');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
