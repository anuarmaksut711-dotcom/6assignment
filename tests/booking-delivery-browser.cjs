'use strict';
// Requests are intercepted or use the dry-run server. Never run live test bookings.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const base = process.env.PIXEL_TEST_URL || 'http://127.0.0.1:8899';
const tomorrow = new Date(Date.now() + 86400000 + 5 * 3600000).toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Asia/Almaty'});
    const config = await (await context.request.get(`${base}/api/booking-config`)).json();
    assert.equal(config.mode, 'test', 'Only a dry-run server is allowed for these tests.');
    const page = await context.newPage();
    const errors = [], attempts = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/booking-config', route => route.fulfill({json: {available: true, mode: 'live'}}));
    let release;
    await page.route('**/api/bookings', async route => {
      attempts.push(route.request().postDataJSON());
      await new Promise(resolve => { release = resolve; });
      await route.fulfill(attempts.length === 1
        ? {status: 502, json: {code: 'delivery_failed', message: 'Не удалось отправить заявку. Попробуйте позже или позвоните в клуб.'}}
        : {json: {status: 'sent', reference: attempts.at(-1).requestId.slice(0, 8).toUpperCase()}});
    });
    await page.goto(`${base}/booking.html?mode=hourly`);
    await page.locator('#booking-date').fill(tomorrow);
    await page.locator('#booking-time').fill('14:00');
    await page.locator('#booking-name').fill('Проверка формы');
    await page.locator('#booking-phone').fill('+7 700 123 45 67');
    await page.waitForFunction(() => !document.getElementById('booking-submit').disabled);
    await page.locator('#booking-submit').click();
    await page.waitForFunction(() => document.getElementById('booking-form').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#booking-submit').textContent(), 'Отправляем…');
    assert.equal(await page.locator('#booking-submit').isDisabled(), true);
    assert.equal(await page.locator('#booking-result').isVisible(), false);
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    release(); release = null;
    await page.locator('#booking-errors').waitFor({state: 'visible'});
    assert.equal(await page.locator('#booking-result').isVisible(), false);
    assert.equal(await page.locator('#booking-name').inputValue(), 'Проверка формы');
    assert.equal(await page.locator('#booking-phone').inputValue(), '+7 700 123 45 67');
    assert.equal(await page.locator('#booking-errors').evaluate(node => node === document.activeElement), true);
    await page.locator('#booking-submit').click();
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    release();
    await page.locator('#booking-result').waitFor({state: 'visible'});
    assert.equal(await page.locator('#booking-result-title').textContent(), 'Заявка отправлена');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].requestId, attempts[1].requestId, 'retry keeps the same idempotency key');
    assert.equal(attempts[1].contact.name, 'Проверка формы');
    assert.equal(attempts[1].plan.time, '14:00');
    const stored = await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}));
    assert.equal(stored.includes('Проверка формы') || stored.includes('77001234567'), false);
    assert.deepEqual(await page.locator('.visit-result-actions a').allTextContents(), ['Позвонить в клуб', 'Новый визит']);
    await page.locator('#booking-edit').click();
    await page.locator('#booking-form').waitFor({state: 'visible'});
    assert.equal(await page.locator('#booking-time').inputValue(), '');
    assert.equal(attempts.length, 2);
    await page.route('**/api/booking-config', route => route.fulfill({json: {available: false, mode: 'live'}}));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('booking-delivery-state').textContent.includes('недоступны'));
    assert.equal(await page.locator('#booking-submit').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: pending state, rejected delivery/focus/data retention, same-ID retry, confirmed success, contact privacy, clean new visit and unavailable API. No Telegram messages sent.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
