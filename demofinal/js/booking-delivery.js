/* A static site has a local config file. The optional server supplies its own mode. */
$(function () {
  'use strict';
  let pending = null;
  const unavailable = {available: false, mode: 'unavailable'};
  const ready = fetch('./api/booking-config', {
    headers: {Accept: 'application/json'}, cache: 'no-store', signal: AbortSignal.timeout?.(5000)
  }).then(response => response.ok ? response.json() : null)
    .then(value => ['local', 'test', 'live'].includes(value?.mode)
      ? {available: value.available === true, mode: value.mode}
      : unavailable)
    .catch(() => unavailable);

  async function send(plan, contact) {
    const config = await ready;
    if (!config.available || config.mode === 'local') {
      throw Object.assign(new Error('Отправка заявок пока недоступна. Свяжитесь с клубом по телефону.'), {code:'unavailable'});
    }
    if (!crypto.subtle || !crypto.getRandomValues) throw new Error('Откройте сайт по защищённому адресу HTTPS и повторите отправку.');
    const data = JSON.stringify({plan, contact});
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const digest = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    try {
      const stored = JSON.parse(sessionStorage.getItem('pixel-assignment-request-attempt-v1'));
      if (stored?.digest === digest && /^[a-f0-9]{32}$/.test(stored.id)) pending = stored;
    } catch { /* In-memory protection remains available when session storage is disabled. */ }
    if (!pending || pending.digest !== digest) {
      pending = {digest, id: [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')};
      try { sessionStorage.setItem('pixel-assignment-request-attempt-v1', JSON.stringify(pending)); } catch { /* No contact data is stored. */ }
    }
    let response, result;
    try {
      response = await fetch('./api/bookings', {
        method:'POST', mode:'same-origin', headers:{'Content-Type':'application/json', Accept:'application/json'},
        body:JSON.stringify({requestId:pending.id, plan, contact}), signal:AbortSignal.timeout(25000)
      });
      result = await response.json();
    } catch {
      throw Object.assign(new Error('Не удалось подтвердить отправку. Повторите без изменения данных или свяжитесь с клубом: повторная попытка с теми же данными не создаст вторую заявку.'), {code:'uncertain'});
    }
    if (!response.ok) throw Object.assign(new Error(result?.message || 'Не удалось отправить заявку. Попробуйте позже.'), {code:result?.code, fields:result?.fields});
    if (!['sent', 'test'].includes(result?.status) || !/^[A-F0-9]{8}$/.test(result.reference)) {
      throw Object.assign(new Error('Не удалось подтвердить отправку. Свяжитесь с клубом перед повтором.'), {code:'uncertain'});
    }
    return result;
  }
  window.PixelBookingDelivery = Object.freeze({ready, send});
});
