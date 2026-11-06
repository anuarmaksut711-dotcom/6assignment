/* Existing local package quantities; no purchase or request is transmitted. */
$(function () {
  'use strict';
  const key = 'pixel-assignment-package-cart-v1';
  let catalog = [];
  let items = [];
  let persistenceAvailable = true;
  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      const unique = new Map();
      for (const item of [1, 2].includes(saved?.version) && Array.isArray(saved.items) ? saved.items : []) {
        // v1 mislabeled the 3/5-hour prices as 2/3 hours. Migrate by price tier.
        const id = saved.version === 1 && typeof item?.id === 'string'
          ? item.id.replace(/-3-hours$/, '-5-hours').replace(/-2-hours$/, '-3-hours') : item?.id;
        if (catalog.some(p => p.id === id) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99) {
          unique.set(id, {id, quantity: item.quantity});
        }
      }
      items = [...unique.values()];
    } catch (error) {
      if (!(error instanceof SyntaxError)) persistenceAvailable = false;
    }
  }
  function getSnapshot() {
    const selected = items.map(item => ({...catalog.find(p => p.id === item.id), quantity: item.quantity}));
    return {items: selected, total: selected.reduce((sum, p) => sum + p.price * p.quantity, 0),
      count: selected.reduce((sum, p) => sum + p.quantity, 0), persistenceAvailable};
  }
  function emit() { window.dispatchEvent(new Event('pixel:cartchange')); }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify({version: 2, items})); persistenceAvailable = true; }
    catch { persistenceAvailable = false; }
    emit();
  }
  function setQuantity(id, quantity) {
    if (!catalog.some(p => p.id === id) || !Number.isInteger(quantity) || quantity < 0 || quantity > 99) return;
    items = items.filter(item => item.id !== id);
    if (quantity) items.push({id, quantity});
    persist();
  }
  function replaceItems(values) {
    items = values.filter(item => catalog.some(p => p.id === item.id) && Number.isInteger(item.quantity)
      && item.quantity > 0 && item.quantity <= 99).map(({id, quantity}) => ({id, quantity}));
    persist();
  }
  function subscribe(fn) {
    const handler = () => fn(getSnapshot());
    $(window).on('pixel:cartchange', handler);
    return () => $(window).off('pixel:cartchange', handler);
  }
  const ready = fetch('assets/club-pricing.json', {cache:'no-cache'})
    .then(response => { if (!response.ok) throw new Error('Catalog unavailable'); return response.json(); })
    .then(data => {
      if (data.policy !== 'package-estimate-v1' || !Array.isArray(data.packages) || !data.packages.length
        || data.packages.some(p => !['standard','duo','vip'].includes(p.room) || typeof p.id !== 'string' || typeof p.name !== 'string' || !Number.isSafeInteger(p.price) || p.price <= 0)) throw new Error('Invalid catalog');
      catalog = data.packages; read(); emit(); return true;
    }).catch(() => false);
  window.PixelCart = Object.freeze({ready, getSnapshot, subscribe, setQuantity, replaceItems,
    getCatalog: () => catalog.map(p => ({...p}))});
  $(window).on('storage', event => {
    event = event.originalEvent;
    if (event.key === key || event.key === null) { read(); emit(); }
  });
});
