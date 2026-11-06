(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const visit = params.has('visit');
  const orderId = params.get(visit ? 'visit' : 'order');
  const validId = visit ? /^[a-f0-9]{32}$/.test(orderId || '') : /^[A-Za-z0-9_-]{16,80}$/.test(orderId || '');
  const orderPath = !(visit && params.has('order')) && validId
    ? (visit ? './api/visit-checkout/orders/' : './api/account/topups/') + encodeURIComponent(orderId)
    : '';
  const profileUrl = new URL('account.html', document.baseURI);
  if (!visit && params.get('return') === 'booking') {
    profileUrl.searchParams.set('return', 'booking');
    profileUrl.searchParams.set('wallet', '1');
  }
  const ids = [
    'back', 'title', 'status', 'error', 'retry', 'order', 'amount-label', 'amount', 'visit', 'card-form',
    'test-number', 'test-expiry', 'test-code', 'pay'
  ];
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById('checkout-' + id)]));
  const number = new Intl.NumberFormat('ru-RU');
  const money = amount => number.format(amount) + '\u00a0₸';
  const visitDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const checkoutMonth = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'numeric', timeZone: 'Asia/Almaty'
  });
  const roomNames = { standard: 'Standard', duo: 'Duo', vip: 'VIP' };
  const fields = [
    { input: ui['test-number'], error: value => /^\d{13,16}$/.test(value.replace(/ /g, ''))
      ? '' : 'Введите от 13 до 16 цифр.' },
    { input: ui['test-expiry'], error: expiryError },
    { input: ui['test-code'], error: value => /^\d{3}$/.test(value)
      ? '' : 'Введите ровно три цифры.' }
  ];
  let order;
  let busy = false;
  let previousExpiry = '';

  if (visit) {
    document.title = 'Оплата визита | PIXEL';
    ui.title.textContent = 'Оплата визита';
    ui.back.href = 'booking.html?checkout=1';
    ui.back.textContent = '← К плану визита';
    ui['amount-label'].textContent = 'К оплате';
  } else {
    ui.back.href = profileUrl.href;
  }

  async function request(path, post = false) {
    const options = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout?.(15000) };
    if (post) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = '{}';
    }
    const response = await fetch(path, options);
    if (!response.ok) {
      const error = new Error('Checkout request failed');
      error.status = response.status;
      const data = await response.json().catch(() => null);
      error.publicMessage = typeof data?.message === 'string' ? data.message : '';
      throw error;
    }
    return response.json();
  }

  function showOrder() {
    ui.order.hidden = false;
    ui.amount.textContent = money(order.amount);
    ui['card-form'].hidden = false;
    if (visit) {
      const plan = order.plan;
      const date = new Date((plan?.date || '') + 'T00:00:00Z');
      if (Object.hasOwn(roomNames, plan?.room) && !Number.isNaN(date.getTime())
          && /^\d{2}:\d{2}$/.test(plan.time)) {
        ui.visit.textContent = [roomNames[plan.room], visitDate.format(date) + ', ' + plan.time,
          Number.isInteger(plan.guests) ? plan.guests + ' ПК' : '',
          Number.isInteger(plan.duration) ? plan.duration + ' ч' : ''].filter(Boolean).join(' · ');
        ui.visit.hidden = false;
      }
    }
  }

  function expiryError(value) {
    if (!/^(?:0[1-9]|1[0-2])\/\d{2}$/.test(value)) {
      return 'Укажите месяц от 01 до 12 и две цифры года.';
    }
    const [month, shortYear] = value.split('/').map(Number);
    const year = 2000 + shortYear;
    const parts = checkoutMonth.formatToParts(new Date());
    const currentYear = Number(parts.find(part => part.type === 'year').value);
    const currentMonth = Number(parts.find(part => part.type === 'month').value);
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      return 'Срок действия карты истёк.';
    }
    return '';
  }

  function formatExpiry(event) {
    const input = event.target;
    const text = input.value;
    const caret = input.selectionStart ?? text.length;
    let digits = text.replace(/\D/g, '').slice(0, 4);
    let digitsBeforeCaret = text.slice(0, caret).replace(/\D/g, '').length;

    // When Backspace would only remove the separator, remove the preceding month digit instead.
    if (event.inputType === 'deleteContentBackward' && caret === 2 && previousExpiry[2] === '/'
        && text === previousExpiry.slice(0, 2) + previousExpiry.slice(3)) {
      digits = digits[0] + digits.slice(2);
      digitsBeforeCaret = 1;
    }

    const formatted = digits.length >= 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits;
    if (formatted !== text) {
      input.value = formatted;
      const position = Math.min(formatted.length, digitsBeforeCaret + Number(digitsBeforeCaret >= 2));
      input.setSelectionRange(position, position);
    }
    previousExpiry = formatted;
  }

  function resetCardForm() {
    ui['card-form'].reset();
    previousExpiry = '';
    for (const { input } of fields) input.removeAttribute('aria-invalid');
  }

  function digitsOnly(input, maxDigits = input.maxLength, format = value => value) {
    const digits = value => value.replace(/\D/g, '');
    const notifyInput = () => input.dispatchEvent(new Event('input', { bubbles: true }));
    input.addEventListener('input', () => {
      const current = input.value;
      const filtered = digits(current).slice(0, maxDigits);
      const formatted = format(filtered);
      if (current === formatted) return;
      const digitsBeforeCaret = digits(current.slice(0, input.selectionStart)).length;
      const position = format(filtered.slice(0, digitsBeforeCaret)).length;
      input.value = formatted;
      input.setSelectionRange(position, position);
    });
    input.addEventListener('beforeinput', event => {
      const caret = input.selectionStart;
      if (!event.cancelable || caret !== input.selectionEnd) return;

      // Delete the adjacent digit when the caret is next to a formatting space.
      if (event.inputType === 'deleteContentBackward' && input.value[caret - 1] === ' ') {
        event.preventDefault();
        input.setRangeText('', caret - 2, caret, 'end');
        notifyInput();
      } else if (event.inputType === 'deleteContentForward' && input.value[caret] === ' ') {
        event.preventDefault();
        input.setRangeText('', caret, caret + 2, 'end');
        notifyInput();
      }
    });
    input.addEventListener('paste', event => {
      if (!event.clipboardData) return;
      event.preventDefault();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const retained = input.value.slice(0, start) + input.value.slice(end);
      const available = maxDigits - digits(retained).length;
      const inserted = digits(event.clipboardData.getData('text')).slice(0, Math.max(0, available));
      if (!inserted) return;
      input.setRangeText(inserted, start, end, 'end');
      notifyInput();
    });
  }

  function finish() {
    const url = visit ? new URL('booking.html', document.baseURI) : new URL(profileUrl);
    url.searchParams.set(visit ? 'paid' : 'topup', orderId);
    location.replace(url.href);
  }

  async function run(message, fallback, operation) {
    if (busy) return false;
    busy = true;
    ui.error.textContent = '';
    ui.status.textContent = message;
    ui.retry.hidden = true;
    ui.pay.disabled = true;
    for (const { input } of fields) input.disabled = true;
    try {
      await operation();
      return true;
    } catch (error) {
      if (error.status === 401) {
        ui.order.hidden = true;
        ui.error.textContent = 'Войдите в аккаунт, чтобы продолжить.';
        ui.back.textContent = 'Войти в аккаунт';
        const signInUrl = new URL(profileUrl);
        if (visit) {
          signInUrl.searchParams.set('return', 'checkout');
          signInUrl.searchParams.set('visit', orderId);
        } else {
          signInUrl.searchParams.set('topup', orderId);
        }
        ui.back.href = signInUrl.href;
      } else if (error.status === 404) {
        ui.order.hidden = true;
        ui.error.textContent = visit ? 'Оплата визита недоступна. Вернитесь к плану.'
          : 'Пополнение недоступно. Вернитесь в профиль.';
      } else {
        ui.error.textContent = error.publicMessage || fallback;
        ui.retry.hidden = false;
      }
      return false;
    } finally {
      busy = false;
      ui.pay.disabled = false;
      for (const { input } of fields) input.disabled = false;
      ui.status.textContent = '';
    }
  }

  function load() {
    return run(visit ? 'Загружаем оплату…' : 'Загружаем пополнение…',
      visit ? 'Не удалось проверить оплату.' : 'Не удалось проверить пополнение.', async () => {
      const data = await request(orderPath);
      if (data.id !== orderId || !Number.isSafeInteger(data.amount) || data.amount <= 0
        || !['pending', 'paid'].includes(data.status) || (visit && data.method !== 'card')) {
        throw new Error('Invalid order');
      }
      order = data;
      if (order.status === 'paid') finish();
      else showOrder();
    });
  }

  ui.retry.addEventListener('click', async () => {
    if (await load() && order?.status === 'pending') ui['test-number'].focus();
  });

  ui['test-expiry'].addEventListener('input', formatExpiry);
  digitsOnly(ui['test-number'], 16, value => value.replace(/(\d{4})(?=\d)/g, '$1 '));
  digitsOnly(ui['test-code']);
  for (const { input } of fields) {
    input.addEventListener('input', () => {
      if (input.hasAttribute('aria-invalid')) {
        input.removeAttribute('aria-invalid');
        ui.error.textContent = '';
      }
    });
  }

  ui['card-form'].addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || order?.status !== 'pending') return;
    for (const { input, error } of fields) {
      const message = error(input.value);
      if (!message) continue;
      input.setAttribute('aria-invalid', 'true');
      ui.error.textContent = message;
      input.focus();
      return;
    }
    resetCardForm();
    const paid = await run(visit ? 'Подтверждаем оплату…' : 'Подтверждаем пополнение…',
      'Не удалось подтвердить операцию. Проверьте статус.', async () => {
      // Only the built-in demo instrument is registered. Form values never leave the browser.
      if (!visit && !order.card) {
        const { card } = await request('./api/account/demo-card', true);
        if (!card) throw new Error('Demo instrument not registered');
        order.card = card;
      }
      const result = await request(orderPath + '/confirm', true);
      if (result.id !== orderId || result.status !== 'paid' || (visit && result.method !== 'card')) {
        throw new Error('Payment not confirmed');
      }
      finish();
    });
    if (!paid && !ui.order.hidden) ui['test-number'].focus();
  });

  if (orderPath) {
    window.addEventListener('pagehide', resetCardForm);
    window.addEventListener('pageshow', event => {
      if (event.persisted) load();
    });
    load();
  } else {
    ui.error.textContent = visit ? 'Откройте оплату из плана визита.' : 'Откройте пополнение из профиля.';
  }
})();
