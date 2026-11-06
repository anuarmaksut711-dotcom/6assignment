const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../demofinal/js/packages.js'), 'utf8');
async function openCatalog(saved) {
  let stored = saved;
  const window = {addEventListener() {}, dispatchEvent() {}};
  // These unit tests isolate storage/pricing; real jQuery events are exercised in the browser suite.
  const $ = target => typeof target === 'function' ? target() : {on() {}, off() {}};
  vm.runInNewContext(source, {$, window, Event, fetch:async () => ({ok:true,json:async () => JSON.parse(fs.readFileSync(path.join(__dirname, '../demofinal/assets/club-pricing.json'),'utf8'))}), localStorage: {
    getItem: () => JSON.stringify(stored),
    setItem: (key, value) => { stored = JSON.parse(value); }
  }});
  await window.PixelCart.ready;
  return {cart: window.PixelCart, stored: () => stored};
}

test('published catalog uses 3/5 hours and explicit known intervals', async () => {
  const {cart} = await openCatalog(null);
  const catalog = cart.getCatalog();
  assert.equal(catalog.some(p => p.id.endsWith('2-hours')), false);
  assert.equal(catalog.find(p => p.id === 'standard-3-hours').price, 2100);
  assert.equal(catalog.find(p => p.id === 'standard-5-hours').price, 2800);
  assert.match(catalog.find(p => p.id === 'vip-night').condition, /22:00–08:00/);
  assert.match(catalog.find(p => p.id === 'standard-day').condition, /Пн–пт, 12:00–18:00/);
  assert.equal(catalog.find(p => p.id === 'standard-student').price, 1000);
});

test('legacy mislabeled tiers retain their price when migrated', async () => {
  const {cart, stored} = await openCatalog({version: 1, items: [
    {id: 'standard-2-hours', quantity: 2}, {id: 'standard-3-hours', quantity: 1}
  ]});
  const snapshot = cart.getSnapshot();
  assert.equal(snapshot.items[0].id, 'standard-3-hours');
  assert.equal(snapshot.items[1].id, 'standard-5-hours');
  assert.equal(snapshot.total, 7000);
  cart.setQuantity('standard-3-hours', 3);
  assert.equal(stored().version, 2);
});

test('new 3-hour selections are not migrated a second time', async () => {
  const {cart} = await openCatalog({version: 2, items: [{id: 'standard-3-hours', quantity: 2}]});
  assert.equal(cart.getSnapshot().items[0].id, 'standard-3-hours');
  assert.equal(cart.getSnapshot().total, 4200);
});

const pricing = require('../demofinal/js/package-pricing.js');
const catalogData = JSON.parse(fs.readFileSync(path.join(__dirname, '../demofinal/assets/club-pricing.json'), 'utf8'));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'package_quote_cases.json'), 'utf8'));
const rooms = {standard:{capacity:20,hourly:900},duo:{capacity:2,hourly:1000},vip:{capacity:5,hourly:1500}};
for (const scenario of cases) {
  test(scenario.name, () => {
    const result = pricing.calculate(scenario.plan, catalogData.packages, rooms);
    assert.equal(result.ok, !scenario.expected.code);
    for (const [key,value] of Object.entries(scenario.expected)) assert.equal(result[key], value, key);
  });
}
