/* Assignment comparison only: original vanilla JavaScript, never linked to a page.
 * Feature 1: catalog/filter (games.js); feature 2: visibility (main.js show);
 * feature 3: main-form validation (booking.js). Original files retained verbatim below. */

// ===== ORIGINAL main.js =====
'use strict';
(() => {
  function node(tag, text = '', classes = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    for (const name of classes.split(' ').filter(Boolean)) element.classList.add(name);
    return element;
  }
  function show(element, visible) {
    element.hidden = !visible;
    element.classList.toggle('d-none', !visible);
    return visible;
  }
  function money(amount) { return `${new Intl.NumberFormat('ru-RU').format(amount)} ₸`; }
  function reference() { return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0').toUpperCase(); }
  window.PixelMain = Object.freeze({node, show, money, reference});
  document.addEventListener('DOMContentLoaded', () => {
    const visitNote = document.querySelector('.visit-note .small');
    if (visitNote) visitNote.textContent = 'Составьте план визита. Для реального посещения администратор подтвердит места и условия по телефону.';
    for (const paragraph of document.querySelectorAll('.pixel-disclosure p')) {
      if (paragraph.firstChild?.nodeType === Node.TEXT_NODE) {
        paragraph.firstChild.textContent = paragraph.firstChild.textContent.replace('Кнопка «Отправить заявку»', 'Кнопка «Забронировать»');
      }
    }
    // Existing navigation keeps its appearance and describes the shared selection.
    const update = () => {
      const state = window.PixelCart?.getSnapshot();
      for (const link of document.querySelectorAll('nav a[href="booking.html"]')) {
        if (state?.count) link.title = `Выбрано пакетов: ${state.count}, ${money(state.total)}`;
        else link.removeAttribute('title');
      }
    };
    window.addEventListener('pixel:cartchange', update);
    window.PixelCart?.ready?.then(update);
    update();
  });
})();


// ===== ORIGINAL games.js =====
'use strict';
(() => {
  const M = window.PixelMain;
  const search = document.getElementById('games-search');
  if (!search) return;
  const category = document.getElementById('games-category');
  const tools = document.getElementById('games-tools');
  const results = document.getElementById('games-results');
  const empty = document.getElementById('games-empty');
  const games = document.getElementById('games-list');
  const apps = document.getElementById('apps-list');
  const catalog = [...document.querySelectorAll('#games-list > [data-game-id], #apps-list > [data-game-id]')].map(element => ({
    id: element.dataset.gameId,
    name: element.querySelector('h2').textContent,
    category: element.dataset.gameCategory,
    aliases: element.dataset.gameSearch,
    genre: element.querySelector('article > p').textContent,
    template: element.cloneNode(true)
  }));
  function normalize(value) { return value.normalize('NFKC').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' '); }
  function matches(item, query, selectedCategory) {
    const words = normalize(query).split(' ').filter(Boolean);
    return (selectedCategory === 'all' || item.category === selectedCategory)
      && words.every(word => normalize(`${item.name} ${item.aliases}`).includes(word));
  }
  function renderCard(item) {
    // Reuse the original card structure, artwork and all existing classes.
    return item.template.cloneNode(true);
  }
  function renderCards(parent, items) {
    parent.replaceChildren(...items.map(renderCard));
    return items.length;
  }
  function filter() {
    const filtered = catalog.filter(item => matches(item, search.value, category.value));
    const gameCount = renderCards(games, filtered.filter(item => item.category !== 'apps'));
    const appCount = renderCards(apps, filtered.filter(item => item.category === 'apps'));
    results.textContent = `Показано: ${filtered.length} из ${catalog.length}`;
    M.show(empty, filtered.length === 0);
    M.show(document.getElementById('games-heading'), gameCount > 0);
    M.show(games, gameCount > 0);
    M.show(document.getElementById('apps-section'), appCount > 0);
    return filtered.length;
  }
  function reset() { search.value = ''; category.value = 'all'; filter(); search.focus(); }
  search.addEventListener('input', filter);
  category.addEventListener('change', filter);
  document.getElementById('games-reset').addEventListener('click', reset);
  document.getElementById('games-empty-reset').addEventListener('click', reset);
  M.show(tools, true); M.show(results, true); filter();
})();


// ===== ORIGINAL booking.js =====
/* Visit planning, validation and explicit server-side request delivery. */
(async () => {
  'use strict';
  await window.PixelCart?.ready;

  const form = document.querySelector('#booking-form');
  if (!form) return;
  document.querySelector('.booking-heading > p').textContent = 'Рассчитайте визит и отправьте заявку. Места подтвердит клуб.';
  document.getElementById('booking-phone-help').textContent = 'Телефон с кодом страны. Имя и телефон получит администратор для подтверждения брони.';
  document.querySelector('.booking-actions + p').textContent = 'Реальную бронь и условия визита подтвердит администратор клуба.';
  document.querySelector('#booking-review-actions .form-text').textContent = 'Отправим заявку администратору. Дождитесь подтверждения мест.';

  const ids = ['room', 'guests', 'duration', 'date', 'time', 'nearby', 'seat', 'game', 'name', 'phone', 'package',
    'submit', 'reset', 'errors', 'status', 'total', 'price-note', 'summary',
    'result', 'result-title', 'copy', 'cart-items', 'cart-note', 'mode', 'success', 'edit', 'cancel', 'end', 'mobile-next', 'mobile-total', 'mobile-submit'];
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(`booking-${id}`)]));
  if (ids.some(id => !ui[id])) return;

  const storageKey = 'pixel-assignment-visit-draft-v1';
  const confirmationKey = 'pixel-assignment-demo-booking-v1';
  const rooms = {
    standard: { name: 'Standard', capacity: 20, hourly: 900 },
    duo: { name: 'Duo', capacity: 2, hourly: 1000 },
    vip: { name: 'VIP', capacity: 5, hourly: 1500 }
  };
  const games = {
    cs2: 'Counter-Strike 2', fortnite: 'Fortnite', minecraft: 'Minecraft',
    dota2: 'Dota 2', valorant: 'Valorant', gtav: 'GTA V', gtaonline: 'GTA Online',
    pubg: 'PUBG', apex: 'Apex Legends', lol: 'League of Legends', rust: 'Rust',
    roblox: 'Roblox', fc: 'EA Sports FC', cod: 'Call of Duty', r6: 'Rainbow Six Siege',
    overwatch2: 'Overwatch 2', rocketleague: 'Rocket League', warthunder: 'War Thunder',
    ets2: 'Euro Truck Simulator 2', chrome: 'Google Chrome'
  };
  const seats = new Map();
  for (const [room, prefix] of [['standard', 'pc'], ['duo', 'duo'], ['vip', 'vip']]) {
    for (let i = 1; i <= rooms[room].capacity; i += 1) {
      const number = String(i).padStart(2, '0');
      seats.set(`${prefix}-${number}`, { room, label: `${rooms[room].name} · ПК ${number}` });
    }
  }
  const money = new Intl.NumberFormat('ru-RU');
  const clubClock = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty', calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const displayDate = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
  const labels = new Map([
    [ui.room, 'Зал'], [ui.guests, 'Число игроков'], [ui.duration, 'Длительность'],
    [ui.date, 'Дата'], [ui.time, 'Время'], [ui.mode, 'Тариф'], [ui.package, 'Пакет'], [ui.seat, 'Пожелание по ПК'], [ui.game, 'Игра'],
    [ui.name, 'Имя'], [ui.phone, 'Телефон']
  ]);
  let preparedPlan = null;
  let savedRecord = null;
  let reviewed = false;
  let sending = false;
  let deliveryAvailable = false;
  let validationAttempted = false;
  const reviewSubmit = document.getElementById('booking-review-submit');
  reviewSubmit.textContent = 'Забронировать';
  const mobile = window.matchMedia('(max-width: 767px)');
  const layout = document.querySelector('.booking-layout');
  const showSaved = document.getElementById('booking-show-saved');
  const reviewActions = document.getElementById('booking-review-actions');
  let cart = { items: [], total: 0, count: 0, persistenceAvailable: true };
  let cartAvailable = false;

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function clubNow() {
    const parts = Object.fromEntries(clubClock.formatToParts(new Date())
      .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`, second: Number(parts.second) };
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1000 || year > 9999) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day;
  }

  function validTime(value) {
    return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function integer(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  }

  function isPast(date, time, now = clubNow()) {
    return date < now.date || (date === now.date &&
      (time < now.time || (time === now.time && now.second > 0)));
  }

  function announce(message) {
    ui.status.textContent = message;
  }

  function hideResult() {
    preparedPlan = null;
    savedRecord = null;
    ui.result.hidden = true;
    ui.success.hidden = true;
    layout.hidden = false;
    showSaved.hidden = true;
    ui['mobile-next'].hidden = false;
    ui.copy.disabled = true;
    ui.summary.value = '';
  }

  function editing() {
    reviewed = false;
    layout.hidden = false;
    ui.result.hidden = true;
    ui.success.hidden = true;
    ui['mobile-next'].hidden = false;
    reviewActions.hidden = true;
    showSaved.hidden = !savedRecord;
    ui.submit.textContent = mobile.matches ? 'Проверить план →' : 'Забронировать';
  }

  mobile.addEventListener('change', () => {
    ui.submit.textContent = mobile.matches ? 'Проверить план →' : 'Забронировать';
    reviewActions.hidden = !mobile.matches || !reviewed;
    ui['mobile-next'].hidden = !ui.result.hidden || (mobile.matches && reviewed);
  });

  function clearErrors() {
    ui.errors.hidden = true;
    ui.errors.textContent = '';
    labels.forEach((label, field) => field.removeAttribute('aria-invalid'));
  }

  function showErrors() {
    const invalidFields = [...form.querySelectorAll(':invalid')].filter(field => labels.has(field));
    labels.forEach((label, field) => {
      if (invalidFields.includes(field)) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    });
    for (const field of invalidFields) {
      const details = field.closest('details');
      if (details) details.open = true;
    }
    const messages = invalidFields.map(field =>
      `${labels.get(field) || 'Поле'}: ${field.validationMessage}`);
    ui.errors.textContent = messages.length ? `Проверьте данные. ${messages.join(' ')}`
      : 'Проверьте данные визита.';
    ui.errors.hidden = false;
  }

  function packageRooms() {
    return [...new Set(cart.items.map(item => String(item.id || '').split('-')[0]))];
  }

  function refreshConstraints() {
    if (sending) return;
    ui.name.setCustomValidity(ui.name.value.trim() ? '' : 'Введите имя: от 2 до 80 символов.');
    const name = ui.name.value.trim();
    if (ui.name.value && (name.length < 2 || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name))) ui.name.setCustomValidity('Укажите имя: от 2 до 80 символов.');
    ui.phone.setCustomValidity(ui.phone.value.trim() ? '' : 'Введите телефон с кодом страны, например +7 700 000 00 00.');
    const phone = ui.phone.value.trim();
    const digits = phone.replace(/\D/g, '');
    if (phone && (!/^[+\d ()-]+$/.test(phone) || digits.length < 10 || digits.length > 15 || digits.startsWith('0'))) ui.phone.setCustomValidity('Укажите телефон с кодом страны, например +7 700 000 00 00.');
    const now = clubNow();
    const room = has(rooms, ui.room.value) ? rooms[ui.room.value] : null;
    ui.room.setCustomValidity(room ? '' : 'Выберите Standard, Duo или VIP.');
    const packageMode = ui.mode.value === 'packages';
    ui.mode.setCustomValidity(!['hourly','packages'].includes(ui.mode.value) ? 'Выберите способ расчёта.'
      : packageMode && (!window.PixelPackagePricing || !window.PixelCart?.getCatalog().length) ? 'Прайс не загрузился. Обновите страницу или выберите почасовой тариф.' : '');
    ui.package.disabled = !packageMode;
    ui.package.required = packageMode;
    document.getElementById('booking-package-wrap').hidden = !packageMode;
    const selectedPackage = window.PixelCart?.getCatalog().find(item => item.id === ui.package.value);
    document.getElementById('booking-package-condition').textContent = selectedPackage?.condition || '';
    const quote = packageMode ? packageQuote() : null;
    ui.package.setCustomValidity(packageMode && !quote?.ok ? quoteError(quote?.code) : '');
    const hint = document.getElementById('booking-mode-hint');
    hint.hidden = packageMode;
    hint.textContent = packageMode ? '' : 'Почасовой тариф рассчитывается по числу ПК и часов.';
    ui.guests.max = room ? String(room.capacity) : '20';
    ui.guests.setCustomValidity('');
    const guests = Number(ui.guests.value);
    if (ui.guests.value && !integer(guests, 1, room ? room.capacity : 20)) {
      ui.guests.setCustomValidity(room && guests > room.capacity
        ? `В ${room.name} ${room.capacity} ПК. Уменьшите число игроков или выберите другой зал.`
        : 'Укажите целое число игроков от 1.');
    }
    ui.duration.disabled = false;
    document.getElementById('booking-duration-wrap').hidden = false;
    document.getElementById('booking-nearby-wrap').hidden = Number(ui.guests.value) <= 1;
    if (Number(ui.guests.value) <= 1) ui.nearby.checked = false;
    ui.duration.setCustomValidity('');
    if (ui.duration.value && !integer(Number(ui.duration.value), 1, 12)) {
      ui.duration.setCustomValidity('Укажите целое число часов от 1 до 12.');
    }
    ui.date.min = now.date;
    ui.date.setCustomValidity('');
    if (ui.date.value && !validDate(ui.date.value)) {
      ui.date.setCustomValidity('Укажите существующую календарную дату.');
    } else if (ui.date.value && ui.date.value < now.date) {
      ui.date.setCustomValidity('Выберите сегодняшнюю или будущую дату.');
    }
    ui.time.min = ui.date.value === now.date ? now.time : '';
    ui.time.setCustomValidity('');
    if (ui.time.value && !validTime(ui.time.value)) {
      ui.time.setCustomValidity('Укажите время в формате часы:минуты.');
    } else if (validDate(ui.date.value) && validTime(ui.time.value)
      && isPast(ui.date.value, ui.time.value, now)) {
      ui.time.setCustomValidity('Время начала уже прошло в Астане. Выберите будущие дату и время.');
    }
    ui.seat.setCustomValidity('');
    if (ui.seat.value && !seats.has(ui.seat.value)) {
      ui.seat.setCustomValidity('Выберите ПК из списка или оставьте пожелание пустым.');
    } else if (ui.seat.value && seats.get(ui.seat.value).room !== ui.room.value) {
      ui.seat.setCustomValidity('Этот ПК находится в другом зале. Измените зал или пожелание по ПК.');
    }
    ui.game.setCustomValidity(ui.game.value && !has(games, ui.game.value)
      ? 'Выберите игру из списка или оставьте поле пустым.' : '');
  }

  function hourlyEstimate(plan) {
    const room = has(rooms, plan.room) ? rooms[plan.room] : null;
    if (!room || room.hourly === null || !integer(plan.guests, 1, room.capacity)
      || !integer(plan.duration, 1, 12)) return null;
    return room.hourly * plan.guests * plan.duration;
  }

  function packageQuote(plan = collectPlan()) {
    return window.PixelPackagePricing?.calculate(plan, window.PixelCart?.getCatalog() || [], rooms);
  }

  function quoteError(code) {
    return ({package:'Выберите пакет выбранного зала.', manual:'Студенческий тариф согласуется по телефону.',
      inputs:'Проверьте число игроков и длительность.', 'date-time':'Укажите дату и время для проверки интервала пакета.',
      weekday:'Этот пакет действует только по будням. Измените дату или тариф.',
      window:'Визит не пересекается с интервалом пакета. Измените время или тариф.'})[code] || 'Пакетный расчёт недоступен. Выберите почасовой тариф.';
  }

  function timeAmount(minutes) {
    return `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}`;
  }

  function quoteLines(quote) {
    const item = window.PixelCart.getCatalog().find(p => p.id === quote.packageId);
    return [
      `Пакеты «${item.title}» для ${quote.quantity} ПК: ${money.format(quote.unitPrice)} ₸ × ${quote.quantity} = ${money.format(quote.packageTotal)} ₸.`,
      `Покрыто пакетом: ${timeAmount(quote.coveredMinutes)} на каждом ПК.`,
      `Доплата: ${quote.extraHours} ч × ${quote.quantity} ПК = ${money.format(quote.extraTotal)} ₸.`,
      `Неиспользовано: ${timeAmount(quote.unusedMinutes)} на каждом ПК. Дальнейшее использование подтвердит клуб.`,
      ...(quote.assumedWindow ? ['Для ночного Duo в модели принят интервал 22:00–08:00; клуб его отдельно не опубликовал.'] : []),
      'Расчёт по модели сайта: один пакет на ПК; доплата округляется до часа вверх; остаток не зачтён на будущие визиты. Условия и сумму подтверждает клуб.'
    ];
  }

  function packageFormula(quote) {
    return `Пакеты ${money.format(quote.packageTotal)} ₸ + доплата ${money.format(quote.extraTotal)} ₸ =`;
  }

  function renderPackageFacts(target, quote) {
    const item = window.PixelCart.getCatalog().find(p => p.id === quote.packageId);
    const facts = [
      ['Пакет', `${item.title} · ${quote.quantity} ПК`],
      ['Покрыто', `${timeAmount(quote.coveredMinutes)} на каждом ПК`],
      ['Остаток', `${timeAmount(quote.unusedMinutes)} на каждом ПК`],
      ['Почасовой визит', `${money.format(quote.hourlyTotal)} ₸ за всех`]
    ];
    target.replaceChildren();
    for (const [label, value] of facts) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      row.append(dt, dd); target.append(row);
    }
  }

  function endTime(plan) {
    if (!validDate(plan.date) || !validTime(plan.time) || !integer(Number(plan.duration), 1, 12)) return '';
    const end = new Date(`${plan.date}T${plan.time}:00+05:00`);
    end.setTime(end.getTime() + Number(plan.duration) * 3600000);
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(end);
  }

  function renderEstimate() {
    const packages = ui.mode.value === 'packages';
    const hourly = hourlyEstimate({room: ui.room.value, guests: Number(ui.guests.value), duration: Number(ui.duration.value)});
    const quote = packages ? packageQuote() : null;
    const estimate = packages ? quote?.ok ? quote.total : null : hourly;
    ui.total.textContent = estimate === null ? '—' : `${money.format(estimate)} ₸`;
    ui['mobile-total'].textContent = ui.total.textContent;
    document.getElementById('booking-total-label').textContent = packages ? 'Предварительно за весь визит' : 'Стоимость всего визита';
    document.getElementById('booking-packages-section').hidden = !packages || !quote?.ok;
    const formula = document.getElementById('booking-package-formula');
    formula.hidden = !packages || !quote?.ok;
    formula.textContent = quote?.ok ? packageFormula(quote) : '';
    ui['price-note'].textContent = packages
      ? quote?.ok ? 'По модели сайта. Условия и сумму подтвердит клуб.' : quoteError(quote?.code)
      : estimate === null ? 'Укажите допустимое число ПК и часов.'
      : `${money.format(rooms[ui.room.value].hourly)} ₸ × ${ui.guests.value} ПК × ${ui.duration.value} ч. Без пакетов и скидок.`;
    const end = endTime(collectPlan());
    ui.end.textContent = end ? `Окончание: ${end} · время Астаны` : '';
    if (quote?.ok) {
      renderPackageFacts(ui['cart-items'], quote);
      ui['cart-note'].textContent = quote.extraHours
        ? `Доплата за ${quote.extraHours} ч на каждом ПК.` : 'Весь визит покрыт пакетом.';
      if (quote.assumedWindow) ui['cart-note'].textContent += ' Интервал ночного Duo принят по модели сайта: 22:00–08:00.';
      document.getElementById('booking-package-math').textContent = `${money.format(quote.unitPrice)} ₸ × ${quote.quantity} ПК = ${money.format(quote.packageTotal)} ₸ за пакеты. Доплата: ${quote.extraHours} ч × ${money.format(rooms[ui.room.value].hourly)} ₸ × ${quote.quantity} ПК = ${money.format(quote.extraTotal)} ₸.`;
    }
    document.getElementById('booking-mobile-label').textContent = packages ? 'Предварительно' : 'Весь визит';
    renderReview();
  }


  function fillReview(target, plan, contact = null) {
    const date = validDate(plan.date) ? displayDate.format(new Date(`${plan.date}T12:00:00Z`)) : 'Выберите дату';
    const facts = [['Зал', rooms[plan.room]?.name || 'Выберите зал'],
      ['Игроки', `${plan.guests || '—'} · столько же ПК`],
      ['Начало', `${date}${plan.time ? `, ${plan.time}` : ' · выберите время'}`],
      ['Часы', `${plan.duration || '—'} ч · время Астаны`],
      ['Окончание', endTime(plan) || 'Укажите дату, время и часы']];
    if (plan.seat) facts.push(['Место', `${seats.get(plan.seat)?.label} · пожелание`]);
    if (plan.nearby) facts.push(['Посадка', 'Рядом · пожелание']);
    if (plan.game) facts.push(['Игра', games[plan.game]]);
    if (contact?.name) facts.push(['Имя', contact.name]);
    if (contact?.phone) facts.push(['Телефон', contact.phone]);
    target.replaceChildren();
    for (const [name, value] of facts) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = name;
      const dd = document.createElement('dd'); dd.textContent = value;
      row.append(dt, dd); target.append(row);
    }
  }

  function renderReview() {
    const plan = collectPlan();
    fillReview(document.getElementById('booking-review'), plan, collectContact());
    const hardware = {standard:'20 ПК · RTX 4060 · 280 Гц',duo:'2 ПК · RTX 4060 · 310 Гц',vip:'5 ПК · RTX 4070 Ti · 360 Гц'};
    document.getElementById('room-capacity-note').textContent = hardware[plan.room];
  }

  function renderInlineErrors(includeEmpty) {
    for (const [field] of labels) {
      const error = document.getElementById(`${field.id}-error`);
      if (!error) continue;
      const invalid = !field.validity.valid && (includeEmpty || validationAttempted || !!field.value);
      error.hidden = !invalid;
      error.textContent = invalid ? field.validationMessage : '';
      field.classList.toggle('is-invalid', invalid);
      if (invalid) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
  }

  function renderPackagePicker(snapshot) {
    const target = document.getElementById('package-options');
    const catalog = window.PixelCart?.getCatalog() || [];
    if (ui.package.dataset.room !== ui.room.value) {
      const previous = ui.package.value.replace(/^[^-]+-/, `${ui.room.value}-`);
      ui.package.replaceChildren();
      for (const item of catalog.filter(p => p.room === ui.room.value && p.kind !== 'hourly')) {
        const option = document.createElement('option'); option.value = item.id;
        option.textContent = `${item.title} · ${money.format(item.price)} ₸ / ПК${item.manualOnly ? ' · по телефону' : ''}`;
        option.disabled = !!item.manualOnly; ui.package.append(option);
      }
      if (catalog.some(p => p.id === previous && !p.manualOnly)) ui.package.value = previous;
      ui.package.dataset.room = ui.room.value;
    }
    target.replaceChildren();
    for (const item of catalog.filter(item => item.room === ui.room.value)) {
      const quantity = snapshot?.items.find(p => p.id === item.id)?.quantity || 0;
      if (item.id.endsWith('1-hour') && !quantity) continue;
      const row = document.createElement('div'); row.className = 'package-option';
      const detail = document.createElement('div');
      const title = document.createElement('h3'); title.textContent = item.title;
      const price = document.createElement('strong'); price.textContent = `${money.format(item.price)} ₸ / пакет`;
      const note = document.createElement('p'); note.textContent = item.condition;
      detail.append(title, price, note);
      if (item.id.endsWith('3-hours') || item.id.endsWith('5-hours')) {
        const compare = document.createElement('p');
        const hours = item.id.endsWith('3-hours') ? 3 : 5;
        compare.textContent = `Для сравнения: ${hours} ч почасово — ${money.format(rooms[ui.room.value].hourly * hours)} ₸ / ПК.`;
        detail.append(compare);
      }
      if (quantity) {
        const subtotal = document.createElement('p');
        subtotal.textContent = `${quantity} × ${money.format(item.price)} ₸ = ${money.format(quantity * item.price)} ₸`;
        detail.append(subtotal);
      }
      row.append(detail);
      row.classList.toggle('active', quantity > 0);
      if (!item.manualOnly) row.append(packageCounter(item, quantity));
      target.append(row);
    }
    document.getElementById('package-selection-status').textContent = cart.count
      ? `В корзине: ${cart.count} пакетов · ${money.format(cart.total)} ₸. Для расчёта визита нажмите «В план» у нужного пакета.`
      : 'Корзина пуста. Добавьте пакет кнопкой «+» или рассчитайте визит почасово.';
    renderCartActions();
  }

  function packageCounter(item, quantity) {
    const M = window.PixelMain;
    const actions = M.node('div', '', 'd-flex flex-column gap-2');
    const counter = M.node('div', '', 'package-counter');
    for (const delta of [-1, 1]) {
      const button = M.node('button', delta < 0 ? '−' : '+');
      button.type = 'button';
      button.dataset.quantity = `${item.id}:${delta}`;
      button.setAttribute('aria-label', `${delta < 0 ? 'Уменьшить' : 'Добавить'}: ${item.name}`);
      button.disabled = delta < 0 ? quantity === 0 : quantity >= rooms[item.room].capacity;
      button.addEventListener('click', () => {
        window.PixelCart.setQuantity(item.id, quantity + delta);
        announce(`${item.name}: ${quantity + delta} шт. в корзине.`);
        const next = [...document.querySelectorAll('[data-quantity]')].find(node => node.dataset.quantity === `${item.id}:${delta}`);
        if (next && !next.disabled) next.focus();
      });
      if (delta === 1) counter.append(M.node('output', String(quantity)));
      counter.append(button);
    }
    actions.append(counter);
    if (quantity > 0) {
      const remove = M.node('button', 'Удалить', 'text-button'); remove.type = 'button';
      remove.setAttribute('aria-label', `Удалить: ${item.name}`);
      remove.addEventListener('click', () => {
        window.PixelCart.setQuantity(item.id, 0);
        announce(`${item.name}: удалено из корзины.`);
        document.getElementById('cart-clear').focus();
      });
      actions.append(remove);
      if (item.kind !== 'hourly') {
        const apply = M.node('button', 'В план', 'btn btn-outline-light'); apply.type = 'button';
        apply.setAttribute('aria-label', `В план: ${item.name}`);
        apply.addEventListener('click', () => {
          ui.mode.value = 'packages'; ui.package.value = item.id; ui.guests.value = String(quantity);
          onChange(); document.getElementById('package-picker').open = false;
          announce(`${item.name}: выбран для ${quantity} игроков. Проверьте дату и время визита.`);
          ui.date.focus();
        });
        actions.append(apply);
      }
    }
    return actions;
  }

  function renderCartActions() {
    const M = window.PixelMain;
    let actions = document.getElementById('cart-actions');
    if (!actions) {
      actions = M.node('div', '', 'd-flex flex-wrap gap-3 my-3'); actions.id = 'cart-actions';
      const checkout = M.node('button', 'Подтвердить выбор', 'btn btn-outline-light');
      checkout.type = 'button'; checkout.id = 'cart-checkout';
      const clear = M.node('button', 'Очистить корзину', 'text-button'); clear.type = 'button'; clear.id = 'cart-clear';
      const receipt = M.node('div', '', 'small my-3'); receipt.id = 'cart-receipt'; receipt.setAttribute('role', 'status');
      checkout.addEventListener('click', () => {
        const snapshot = window.PixelCart.getSnapshot();
        if (!snapshot.count) return;
        receipt.replaceChildren();
        const title = M.node('p', `Демонстрационный выбор № ${M.reference()}`);
        const list = document.createElement('ul');
        for (const item of snapshot.items) list.append(M.node('li', `${item.name}: ${item.quantity} × ${M.money(item.price)} = ${M.money(item.quantity * item.price)}`));
        receipt.append(title, list, M.node('p', `Всего: ${snapshot.count} · ${M.money(snapshot.total)}. Данные не отправлены на сервер; реальный заказ, оплата и бронь не созданы.`));
        receipt.classList.add('success-message');
      });
      clear.addEventListener('click', () => {
        window.PixelCart.replaceItems([]); announce('Корзина очищена.');
        document.getElementById('package-picker').querySelector('summary').focus();
      });
      actions.append(checkout, clear);
      document.getElementById('package-selection-status').after(actions, receipt);
    }
    document.getElementById('cart-checkout').disabled = cart.count === 0;
    document.getElementById('cart-clear').disabled = cart.count === 0;
    const receipt = document.getElementById('cart-receipt');
    receipt.replaceChildren(); receipt.classList.remove('success-message');
  }

  function saveDraft() {
    try { localStorage.setItem(storageKey, JSON.stringify(collectPlan())); return true; }
    catch { announce('Сохранение в браузере недоступно. Не закрывайте страницу до копирования деталей.'); return false; }
  }

  function readDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (!value || typeof value !== 'object' || !has(rooms, value.room)) return {};
      const safe = {...value};
      for (const key of ['guests', 'duration']) {
        const raw = String(value[key] ?? '');
        safe[key] = /^\d{0,3}$/.test(raw) ? raw : '';
      }
      safe.date = validDate(value.date) ? value.date : '';
      safe.time = validTime(value.time) ? value.time : '';
      safe.seat = seats.has(value.seat) ? value.seat : '';
      safe.game = has(games, value.game) ? value.game : '';
      return {draft: safe};
    } catch { return {}; }
  }

  function applyDraft(draft) {
    for (const key of ['room', 'guests', 'duration', 'date', 'time', 'seat', 'game']) {
      ui[key].value = typeof draft[key] === 'string' || typeof draft[key] === 'number' ? String(draft[key]) : '';
    }
    ui.nearby.checked = draft.nearby === true;
    ui.mode.value = draft.mode === 'packages' ? 'packages' : 'hourly';
    renderPackagePicker(window.PixelCart?.getSnapshot());
    if (draft.packageId && [...ui.package.options].some(option => option.value === draft.packageId && !option.disabled)) ui.package.value = draft.packageId;
  }

  function filterSeats() {
    for (const group of ui.seat.querySelectorAll('optgroup')) {
      const matching = group.label === rooms[ui.room.value]?.name;
      group.hidden = !matching;
      for (const option of group.children) option.disabled = !matching;
    }
    if (ui.seat.value && seats.get(ui.seat.value)?.room !== ui.room.value) ui.seat.value = '';
  }

  function applyQuery() {
    const query = new URLSearchParams(window.location.search);
    const messages = [];
    const roomValue = query.get('room');
    const seatValue = query.get('seat');
    const gameValue = query.get('game');
    const queryRoom = roomValue !== null && has(rooms, roomValue) ? roomValue : null;
    if (query.has('room') && !queryRoom) messages.push('Зал из ссылки не распознан.');
    if (queryRoom) ui.room.value = queryRoom;
    if (seatValue !== null) {
      const seat = seats.get(seatValue);
      if (!seat) messages.push('ПК из ссылки не распознан.');
      else if (queryRoom && seat.room !== queryRoom) {
        messages.push('ПК из ссылки относится к другому залу; он не выбран.');
        if (ui.seat.value && seats.get(ui.seat.value)?.room !== queryRoom) {
          ui.seat.value = '';
          messages.push('Пожелание по ПК из предыдущего плана сброшено: выбран другой зал.');
        }
      } else {
        if (!queryRoom) ui.room.value = seat.room;
        ui.seat.value = seatValue;
        messages.push('Номер ПК добавлен в пожелания.');
      }
    } else if (queryRoom && ui.seat.value && seats.get(ui.seat.value)?.room !== queryRoom) {
      ui.seat.value = '';
      messages.push('Пожелание по ПК из предыдущего плана сброшено: выбран другой зал.');
    }
    if (gameValue !== null) {
      if (has(games, gameValue)) ui.game.value = gameValue;
      else messages.push('Игра из ссылки не распознана.');
    }
    return messages.join(' ');
  }

  function revealPreferences() {
    if (window.location.hash === '#preferences') document.getElementById('preferences').open = true;
    for (const field of [ui.seat, ui.game]) {
      const details = field.value ? field.closest('details') : null;
      if (details) details.open = true;
    }
  }

  function clearEntryQuery() {
    try {
      const url = new URL(window.location.href);
      for (const key of ['room', 'seat', 'game', 'mode']) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Local field reset still works if browser history is unavailable.
    }
  }

  function collectPlan() {
    const item = window.PixelCart?.getCatalog().find(p => p.id === ui.package.value);
    return { version: 2, mode: ui.mode.value, room: ui.room.value, guests: ui.guests.value,
      duration: ui.duration.value, date: ui.date.value, time: ui.time.value,
      nearby: ui.nearby.checked, seat: ui.seat.value, game: ui.game.value,
      packageCatalogVersion: 2,
      ...(ui.mode.value === 'packages' ? {pricingPolicy:window.PixelPackagePricing?.policy, packageId:ui.package.value} : {}),
      packages: ui.mode.value === 'packages' && item ? [{id:item.id, name:item.name, price:item.price, quantity:Number(ui.guests.value)}] : [] };
  }

  function collectContact() {
    let digits = ui.phone.value.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8') && !ui.phone.value.trim().startsWith('+')) digits = '7' + digits.slice(1);
    return {name: ui.name.value.trim(), phone: digits ? '+' + digits : ''};
  }

  function makeSummary(plan) {
    const lines = ['План визита PIXEL', `Зал: ${rooms[plan.room].name}.`,
      `Игроки / ПК: ${plan.guests}.`, `Начало: ${plan.date}, ${plan.time} (Астана).`];
    if (plan.mode === 'packages') {
      const quote = plan.pricingPolicy === window.PixelPackagePricing?.policy ? packageQuote(plan) : null;
      lines.push(`Планируемая длительность: ${plan.duration} ч. Окончание: ${endTime(plan)}.`, 'Выбранные пакеты:');
      for (const item of (plan.packages || cart.items)) lines.push(`${item.name}: ${item.quantity} × ${money.format(item.price)} ₸.`);
      if (quote?.ok) lines.push(...quoteLines(quote), `Предварительно за весь визит: ${money.format(quote.total)} ₸.`);
      else lines.push(`Стоимость пакетов по старому прайсу: ${money.format((plan.packages || cart.items).reduce((sum, item) => sum + item.price * item.quantity, 0))} ₸. Это не стоимость сеанса.`, 'Применимость пакетов к визиту нужно уточнить у клуба.');
    } else {
      lines.push(`Длительность: ${plan.duration} ч. Окончание: ${endTime(plan)}.`,
        `Стоимость: ${money.format(hourlyEstimate({...plan, guests: Number(plan.guests), duration: Number(plan.duration)}))} ₸.`);
    }
    if (plan.nearby) lines.push('Пожелание: сидеть рядом.');
    if (plan.seat) lines.push(`Пожелание: ${seats.get(plan.seat)?.label || ''}.`);
    if (plan.game) lines.push(`Игра: ${games[plan.game] || ''}.`);
    lines.push('Астана, проспект Мәңгілік Ел, 36.', '', 'Места и условия визита подтверждает администратор клуба.');
    return lines.join('\n');
  }

  function showConfirmation(record, focus = false) {
    announce('');
    savedRecord = record;
    preparedPlan = record.plan;
    const request = record.kind === 'request';
    const test = request && record.receipt?.status === 'test';
    ui['result-title'].textContent = request ? test ? 'Проверка завершена' : 'Заявка отправлена' : 'Сохранённый план';
    ui.success.querySelector('p').textContent = request ? test
      ? 'Тестовый режим: заявка не отправлена администратору; реальные места не забронированы.'
      : 'Заявка отправлена администратору. Дождитесь подтверждения мест и условий по телефону.'
      : 'Это локальная копия плана. Она не отправлена администратору.';
    ui.summary.value = record.summary + (record.contact ? `\nИмя: ${record.contact.name}.\nТелефон: ${record.contact.phone}.` : '')
      + (request ? `\n${test ? 'Демонстрационный план' : 'Заявка отправлена'}. Номер: ${record.receipt.reference}.` : '');
    ui.edit.textContent = request && !test ? 'Подготовить другой визит' : 'Изменить план';
    document.getElementById('booking-cancel-note').hidden = !request || test;
    ui.result.hidden = false;
    ui.copy.disabled = false;
    ui.success.hidden = false;
    ui.success.classList.add('success-message');
    layout.hidden = true;
    showSaved.hidden = true;
    fillReview(document.getElementById('booking-saved-review'), record.plan, record.contact);
    const price = document.getElementById('booking-saved-price');
    price.replaceChildren();
    const packages = record.plan.mode === 'packages';
    const quote = packages && record.plan.pricingPolicy === window.PixelPackagePricing?.policy ? packageQuote(record.plan) : null;
    const packageItems = Array.isArray(record.plan.packages) ? record.plan.packages : [];
    const amount = quote?.ok ? quote.total : packages ? packageItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
      : hourlyEstimate({...record.plan, guests:Number(record.plan.guests), duration:Number(record.plan.duration)});
    const label = document.createElement('p'); label.className = 'form-text';
    label.textContent = quote?.ok ? 'Предварительно за весь визит' : packages ? 'Стоимость выбранных пакетов' : 'Стоимость сеанса';
    const total = document.createElement('strong'); total.textContent = `${money.format(amount)} ₸`;
    price.append(label);
    if (quote?.ok) {
      const formula = document.createElement('p'); formula.className = 'package-formula'; formula.textContent = packageFormula(quote);
      price.append(formula);
    }
    price.append(total);
    if (quote?.ok) {
      const note = document.createElement('p'); note.className = 'form-text'; note.textContent = 'По модели сайта. Условия и сумму подтвердит клуб.';
      const facts = document.createElement('dl'); facts.className = 'review-list package-facts'; renderPackageFacts(facts, quote);
      const details = document.createElement('details'); details.className = 'package-method';
      const heading = document.createElement('summary'); heading.textContent = 'Как посчитали';
      const list = document.createElement('ul');
      for (const line of quoteLines(quote)) { const row = document.createElement('li'); row.textContent = line; list.append(row); }
      details.append(heading, list); price.append(note, facts, details);
    } else if (packages) {
      const list = document.createElement('ul');
      for (const item of packageItems) {
        const row = document.createElement('li');
        row.textContent = typeof item === 'string' ? item : `${item.name} · ${item.quantity} шт. · ${money.format(item.price * item.quantity)} ₸`;
        list.append(row);
      }
      const note = document.createElement('p'); note.className = 'form-text';
      note.textContent = 'Это сумма пакетов, не стоимость сеанса. Применение к визиту уточните у клуба.';
      price.append(list, note);
    }
    ui['mobile-next'].hidden = true;
    document.getElementById('booking-copy-details').open = false;
    if (focus) { ui['result-title'].focus({preventScroll:true}); ui.result.scrollIntoView({behavior: 'auto', block: 'start'}); }
  }

  function renderCart(snapshot) {
    const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items.filter(item =>
      item?.id?.startsWith(`${ui.room.value}-`) &&
      item && typeof item.name === 'string' && integer(item.price, 1, Number.MAX_SAFE_INTEGER)
      && integer(item.quantity, 1, 99) && Number.isSafeInteger(item.price * item.quantity))
      .map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })) : [];
    cart = { items, total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      persistenceAvailable: snapshot?.persistenceAvailable !== false };
    ui['cart-items'].replaceChildren();
    for (const item of cart.items) {
      const row = document.createElement('li');
      row.textContent = `${item.name} · ${item.quantity} шт. · ${money.format(item.price * item.quantity)} ₸`;
      ui['cart-items'].append(row);
    }
    ui['cart-note'].textContent = cart.count ? `Всего пакетов: ${cart.count}.` : 'Пакеты не выбраны.';
    renderPackagePicker(snapshot);
    refreshConstraints();
    renderEstimate();
  }

  function updateCart() {
    try {
      if (window.PixelCart && typeof window.PixelCart.getSnapshot === 'function') {
        cartAvailable = true;
        renderCart(window.PixelCart.getSnapshot());
        return;
      }
    } catch {
      cartAvailable = false;
    }
    cartAvailable = false;
    renderCart(null);
  }

  function onChange() {
    if (sending) return;
    editing();
    clearErrors();
    filterSeats();
    updateCart();
    refreshConstraints();
    renderEstimate();
    renderInlineErrors(false);
    saveDraft();
    if (savedRecord) {
      announce(savedRecord.receipt?.status === 'sent' ? 'Это новый план. Для изменения отправленной заявки свяжитесь с клубом.' : 'Вы меняете черновик. Отправка выполняется отдельным действием.');
    }
  }

  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);
  form.addEventListener('invalid', showErrors, true);
  form.addEventListener('focusout', () => { refreshConstraints(); renderInlineErrors(false); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !ui.result.hidden) return;
    refreshConstraints();
    validationAttempted = true;
    if (!form.checkValidity()) { showErrors(); renderInlineErrors(true); const first = [...labels.keys()].find(field => !field.validity.valid); first?.focus(); return; }
    clearErrors();
    if (mobile.matches && !reviewed) {
      reviewed = true;
      reviewActions.hidden = false;
      ui['mobile-next'].hidden = true;
      const heading = document.getElementById('booking-call-title');
      heading.focus({preventScroll:true});
      document.getElementById('visit-review').scrollIntoView({behavior:'auto', block:'start'});
      return;
    }
    const plan = collectPlan(), contact = collectContact();
    sending = true;
    const controls = [...form.querySelectorAll('input,select,button'), reviewSubmit, document.getElementById('booking-back'), ui['mobile-submit'], showSaved];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    reviewSubmit.textContent = ui.submit.textContent = 'Отправляем…';
    announce('Отправляем заявку администратору.');
    try {
      const receipt = await window.PixelBookingDelivery.send(plan, contact);
      const record = {kind: 'request', plan, summary: makeSummary(plan), receipt};
      saveDraft();
      // The browser keeps visit details and the receipt, never the name or phone.
      try { localStorage.setItem(confirmationKey, JSON.stringify(record)); } catch { /* Delivery already succeeded. */ }
      showConfirmation({...record, contact}, true);
      announce(receipt.status === 'test' ? 'Проверка завершена. Заявка администратору не отправлена.' : 'Заявка отправлена. Дождитесь звонка администратора.');
    } catch (error) {
      editing();
      announce('');
      ui.errors.textContent = error.message || 'Не удалось отправить заявку. Свяжитесь с клубом.';
      ui.errors.hidden = false;
      for (const [key, message] of Object.entries(error.fields || {})) {
        const field = ui[key];
        if (!labels.has(field) || typeof message !== 'string') continue;
        field.setAttribute('aria-invalid', 'true');
        const note = document.getElementById(`${field.id}-error`);
        if (note) { note.textContent = message; note.hidden = false; }
      }
      ui.errors.focus();
    } finally {
      sending = false;
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      form.removeAttribute('aria-busy');
      ui.submit.textContent = mobile.matches ? 'Проверить план →' : 'Забронировать';
      reviewSubmit.textContent = 'Забронировать';
    }
  });

  ui.edit.addEventListener('click', () => {
    const sent = savedRecord?.receipt?.status === 'sent';
    if (preparedPlan) {
      if (preparedPlan.mode === 'packages' && preparedPlan.packageCatalogVersion === 2 && Array.isArray(preparedPlan.packages)) {
        const otherRooms = window.PixelCart.getSnapshot().items.filter(item => !item.id.startsWith(`${preparedPlan.room}-`));
        window.PixelCart.replaceItems([...otherRooms, ...preparedPlan.packages]);
      }
      applyDraft(preparedPlan);
    }
    updateCart();
    editing();
    filterSeats(); revealPreferences(); refreshConstraints(); renderEstimate(); saveDraft();
    ui.room.focus();
    announce(sent ? 'Подготовьте новую заявку. Для изменения предыдущей свяжитесь с клубом.' : 'Измените параметры и проверьте план перед отправкой.');
  });
  ui.cancel.addEventListener('click', () => {
    const sent = savedRecord?.receipt?.status === 'sent';
    try { localStorage.removeItem(confirmationKey); }
    catch { announce('Не удалось удалить сохранённый план. Разрешите сохранение в браузере и повторите.'); return; }
    hideResult();
    announce(sent ? 'Локальная копия удалена. Отправленная заявка не отменена: для отмены свяжитесь с клубом.' : 'Копия плана удалена с устройства. Заявка администратору не отправлялась.');
    editing();
    ui.room.focus();
  });
  ui.reset.addEventListener('click', () => {
    validationAttempted = false;
    form.reset();
    applyDraft({room: 'standard', guests: 1, duration: 2, date: '', time: '', nearby: false, seat: '', game: ''});
    clearErrors(); filterSeats(); updateCart(); refreshConstraints(); renderEstimate(); renderInlineErrors(false); clearEntryQuery(); saveDraft();
    editing();
    announce('Поля очищены. Сохранённый план и выбранные пакеты не изменены.');
    ui.room.focus();
  });

  ui.copy.addEventListener('click', async () => {
    if (!preparedPlan || ui.result.hidden) return;
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(ui.summary.value);
      announce('Детали плана скопированы.');
    } catch {
      document.getElementById('booking-copy-details').open = true;
      ui.summary.focus();
      ui.summary.select();
      announce('Не удалось скопировать автоматически. Текст выделен: скопируйте его вручную.');
    }
  });

  showSaved.addEventListener('click', () => {
    if (savedRecord) { showConfirmation(savedRecord, true); announce('Показан сохранённый план.'); }
  });
  document.getElementById('booking-back').addEventListener('click', () => {
    editing(); ui.room.focus();
  });
  document.getElementById('booking-use-hourly').addEventListener('click', () => {
    ui.mode.value = 'hourly';
    document.getElementById('package-picker').open = false;
    onChange(); ui.name.focus();
  });

  window.addEventListener('focus', refreshConstraints);
  const restored = readDraft();
  if (restored.draft) applyDraft(restored.draft);
  const queryMessage = applyQuery();
  filterSeats(); revealPreferences(); hideResult(); updateCart();
  const query = new URLSearchParams(window.location.search);
  if (query.get('mode') === 'packages') {
    ui.mode.value = 'packages';
    const selectedRooms = packageRooms();
    if (!query.has('room') && selectedRooms.length === 1 && has(rooms, selectedRooms[0])) ui.room.value = selectedRooms[0];
    filterSeats();
    renderPackagePicker(window.PixelCart?.getSnapshot());
  }
  if (query.get('mode') === 'hourly') ui.mode.value = 'hourly';
  refreshConstraints(); renderEstimate(); saveDraft();
  const hasEntry = ['room', 'seat', 'game', 'mode'].some(key => query.has(key)) || !!window.location.hash;
  clearEntryQuery();
  editing();
  if (window.PixelCart && typeof window.PixelCart.subscribe === 'function') window.PixelCart.subscribe(() => {
    updateCart();
    if (!layout.hidden) { reviewed = false; reviewActions.hidden = true; ui['mobile-next'].hidden = false; }
  });
  else window.addEventListener('pixel:cartchange', updateCart);
  try {
    const record = JSON.parse(localStorage.getItem(confirmationKey));
    if ((record?.kind === 'demo' || (record?.kind === 'request' && ['sent', 'test'].includes(record.receipt?.status) && /^[A-F0-9]{8}$/.test(record.receipt?.reference))) && typeof record.summary === 'string' && has(rooms, record.plan?.room)
      && validDate(record.plan.date) && validTime(record.plan.time)
      && integer(Number(record.plan.guests), 1, rooms[record.plan.room].capacity)) {
      savedRecord = record; preparedPlan = record.plan;
      if (!hasEntry && JSON.stringify(record.plan) === JSON.stringify(collectPlan())) showConfirmation(record);
      else showSaved.hidden = false;
    }
  } catch { /* A missing or unreadable demo does not prevent a new booking. */ }
  const meaningfulDraft = restored.draft && (restored.draft.date || restored.draft.time || restored.draft.seat || restored.draft.game || restored.draft.room !== 'standard' || Number(restored.draft.guests) !== 1 || Number(restored.draft.duration) !== 2 || restored.draft.mode === 'packages');
  announce([meaningfulDraft && !layout.hidden ? 'Черновик восстановлен.' : '', queryMessage].filter(Boolean).join(' '));
  ui['mobile-submit'].disabled = false;
  ui.reset.disabled = false;
  window.PixelBookingDelivery.ready.then(config => {
    deliveryAvailable = config.available;
    const state = document.getElementById('booking-delivery-state');
    state.textContent = config.mode === 'test' ? 'Тестовый режим: заявки не отправляются администратору; реальные места не бронируются.'
      : config.available ? '' : 'Онлайн-заявки пока недоступны. Для брони позвоните: +7 775 351 36 93.';
    state.hidden = !state.textContent;
    ui.submit.disabled = !deliveryAvailable;
    reviewSubmit.disabled = !deliveryAvailable;
  });
})();
