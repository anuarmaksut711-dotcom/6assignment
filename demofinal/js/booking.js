/* Visit planning, validation and local or server-backed confirmation. */
$(async function () {
  'use strict';
  await window.PixelCart?.ready;

  const M = window.PixelMain;
  const form = $('#booking-form');
  if (!form.length) return;
  const emailWrap = $('<div>');
  $('<label>').attr('for', 'booking-email').text('E-mail (необязательно)').appendTo(emailWrap);
  $('<input>').attr({id: 'booking-email', name: 'email', type: 'email', maxlength: 254,
    autocomplete: 'email', 'aria-describedby': 'booking-email-help booking-email-error'})
    .addClass('form-control').appendTo(emailWrap);
  $('<p>').attr({id: 'booking-email-error', role: 'alert'}).addClass('field-error d-none').appendTo(emailWrap);
  $('<p>').attr('id', 'booking-email-help').addClass('form-text').appendTo(emailWrap);
  $('#booking-email-slot').append(emailWrap);

  const ids = ['room', 'guests', 'duration', 'date', 'time', 'nearby', 'seat', 'game', 'name', 'phone', 'email', 'package',
    'submit', 'reset', 'errors', 'status', 'total', 'price-note',
    'result', 'result-title', 'cart-items', 'cart-note', 'mode', 'success', 'end'];
  const ui = Object.fromEntries(ids.map(id => [id, $('#' + `booking-${id}`)]));
  if (ids.some(id => !ui[id].length)) return;

  const storageKey = 'pixel-assignment-visit-draft-v1';
  const visitRequestKey = 'pixel-visit-payment-request-v1';
  const visitMethodKey = 'pixel-visit-payment-return-v1';
  const guestReservationsKey = 'pixel-visit-guest-reservations-v1';
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
    [ui.room, 'Зал'], [ui.guests, 'Число игроков'], [ui.date, 'Дата'], [ui.time, 'Время'], [ui.duration, 'Длительность'],
    [ui.mode, 'Тариф'], [ui.package, 'Пакет'], [ui.seat, 'Пожелание по ПК'], [ui.game, 'Игра'],
    [ui.name, 'Имя'], [ui.phone, 'Телефон'], [ui.email, 'E-mail']
  ]);
  labels.forEach((label, field) => {
    const id = field.attr('id') + '-error';
    if (!$('#' + id).length) $('<p>').attr({id, role: 'alert'}).addClass('field-error d-none').insertAfter(field);
    const described = new Set((field.attr('aria-describedby') || '').split(/\s+/).filter(Boolean));
    described.add(id);
    field.attr('aria-describedby', [...described].join(' '));
  });
  const effectDuration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
  let sending = false;
  let delivery = {available: false, mode: 'pending'};
  let checkoutAvailable = false;
  let checkout = null;
  let resumeMethod = '';
  let visitRequests = {};
  let validationAttempted = false;
  const layout = $('.booking-layout');
  const help = $("#booking-help");
  const extras = $("#booking-extras");
  const roomChoices = $("#booking-room-choices");
  const stepButtons = form.find('[data-visit-step]');
  const dialog = $('#booking-checkout')[0];
  const checkoutForm = $('#booking-checkout-form');
  const checkoutMethods = $('#booking-checkout-methods');
  const checkoutSubmit = $('#booking-checkout-submit');
  const checkoutBack = $('#booking-checkout-back');
  const checkoutNote = $('#booking-checkout-note');
  const checkoutMessage = $('#booking-checkout-message');
  const checkoutWallet = $('#booking-checkout-wallet');
  for (const [id, room] of Object.entries(rooms)) {
    const choiceId = `visit-room-${id}`;
    const radio = $("<input>").attr({id: choiceId, name: 'room-choice', type: 'radio', value: id})
      .addClass('visually-hidden');
    const label = $("<label>").attr('for', choiceId)
      .append(M.node('strong', room.name), M.node('span', `${money.format(room.hourly)} ₸`));
    roomChoices.append(M.node('div', '', 'visit-room-choice').append(radio, label));
  }
  M.show($("#booking-room-native"), false);
  M.show(roomChoices, true);
  let cart = { items: [], total: 0, count: 0 };

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

  function countText(value) {
    const raw = String(value ?? '').trim();
    const count = Number(raw);
    return raw && integer(count, 0, 999) ? String(count) : '';
  }

  function isPast(date, time, now = clubNow()) {
    return date < now.date || (date === now.date &&
      (time < now.time || (time === now.time && now.second > 0)));
  }

  function announce(message) {
    const resultVisible = !ui.result.is('[hidden], .d-none');
    ui.status.text(resultVisible ? '' : message);
    $("#booking-result-status").text(resultVisible ? message : '');
  }

  function syncSubmitLabels() {
    ui.submit.text(checkoutAvailable ? 'Продолжить' : delivery.mode === 'local' ? 'Сохранить план' : 'Отправить заявку');
  }

  function configureDelivery(config) {
    delivery = config;
    const local = config.mode === 'local';
    const needsContact = config.available && !local;
    M.show($("#booking-contact-step"), needsContact);
    ui.name.add(ui.phone).add(ui.email).prop('disabled', !needsContact);
    $("#booking-email-help").text('Войдёт в заявку, если заполнить.');
    $('#booking-submit-note').text(local ? (checkoutAvailable ? '' : 'Сохранение без оплаты и брони.')
      : 'Клуб подтвердит места и условия оплаты.');
    const state = $("#booking-delivery-state");
    state.text(config.mode === 'test' ? 'Тестовая заявка без бронирования.'
      : !config.available ? 'Онлайн-заявки пока недоступны. Для брони позвоните: +7 775 351 36 93.' : '');
    M.show(state, Boolean(state.text()));
    ui.submit.prop('disabled', !config.available);
    syncSubmitLabels();
  }

  function focusRoom() {
    const selected = roomChoices.find(':checked');
    (selected.length ? selected : roomChoices.find('input').first()).trigger('focus');
  }

  function editing() {
    M.show(layout, true);
    M.show(ui.result, false);
    M.show(ui.success, false);
    M.show(help, true);
  }

  function clearErrors() {
    M.show(ui.errors, false);
    ui.errors.text('');
    labels.forEach((label, field) => field.removeAttr('aria-invalid'));
  }

  function showErrors(invalidFields) {
    invalidFields.forEach(field => field.parents('details').prop('open', true));
    ui.errors.text('Проверьте отмеченные поля: ' + invalidFields.map(field => labels.get(field)).join(', ') + '.');
    M.show(ui.errors, true);
  }

  function packageRooms() {
    return [...new Set(cart.items.map(item => String(item.id || '').split('-')[0]))];
  }

  // required/min/max/type stay as browser constraints. They are bypassable, so
  // booking_server.py must independently validate all fields and recompute prices.
  // Native Constraint Validation has no jQuery equivalent; [0] bridges only those APIs.
  function refreshConstraints() {
    if (sending) return;
    const email = ui.email.val().trim();
    ui.email[0].setCustomValidity(email && !/^[^\s@\x00-\x1f\x7f]+@[^\s@.\x00-\x1f\x7f]+(?:\.[^\s@.\x00-\x1f\x7f]+)+$/.test(email)
      ? 'Укажите e-mail в формате name@example.com или оставьте поле пустым.' : '');
    const name = ui.name.val().trim();
    ui.name[0].setCustomValidity(name.length < 2 || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)
      ? 'Укажите имя: от 2 до 80 символов.' : '');
    const phone = ui.phone.val().trim();
    const digits = phone.replace(/\D/g, '');
    ui.phone[0].setCustomValidity(!/^\+?[\d ()-]+$/.test(phone) || digits.length < 10 ||
      digits.length > 15 || digits.startsWith('0')
      ? 'Укажите телефон с кодом страны, например +7 700 000 00 00.' : '');
    const now = clubNow();
    const room = has(rooms, ui.room.val()) ? rooms[ui.room.val()] : null;
    ui.room[0].setCustomValidity(room ? '' : 'Выберите Standard, Duo или VIP.');
    const packageMode = ui.mode.val() === 'packages';
    ui.mode[0].setCustomValidity(!['hourly','packages'].includes(ui.mode.val()) ? 'Выберите способ расчёта.'
      : packageMode && (!window.PixelPackagePricing || !window.PixelCart?.getCatalog().length) ? 'Прайс не загрузился. Обновите страницу или выберите почасовой тариф.' : '');
    ui.package.prop('disabled', !packageMode);
    ui.package.prop('required', packageMode);
    M.show($("#booking-package-wrap"), packageMode);
    const selectedPackage = window.PixelCart?.getCatalog().find(item => item.id === ui.package.val());
    $("#booking-package-condition").text(selectedPackage?.condition || '');
    const quote = packageMode ? packageQuote() : null;
    ui.package[0].setCustomValidity(packageMode && !quote?.ok ? quoteError(quote?.code) : '');
    roomChoices.find('input').each(function () {
      this.checked = this.value === ui.room.val();
    });
    ui.guests.prop('max', room ? String(room.capacity) : '20');
    ui.guests[0].setCustomValidity('');
    const guests = Number(ui.guests.val());
    if (ui.guests.val() && !integer(guests, 1, room ? room.capacity : 20)) {
      ui.guests[0].setCustomValidity(room && guests > room.capacity
        ? `В ${room.name} ${room.capacity} ПК. Уменьшите число игроков или выберите другой зал.`
        : 'Укажите целое число игроков от 1.');
    }
    ui.duration.prop('disabled', false);
    M.show($("#booking-duration-wrap"), true);
    M.show($("#booking-nearby-wrap"), Number(ui.guests.val()) > 1);
    if (Number(ui.guests.val()) <= 1) ui.nearby.prop('checked', false);
    ui.duration[0].setCustomValidity('');
    if (ui.duration.val() && !integer(Number(ui.duration.val()), 1, 12)) {
      ui.duration[0].setCustomValidity('Укажите целое число часов от 1 до 12.');
    }
    ui.date.prop('min', now.date);
    ui.date[0].setCustomValidity('');
    if (ui.date.val() && !validDate(ui.date.val())) {
      ui.date[0].setCustomValidity('Укажите существующую календарную дату.');
    } else if (ui.date.val() && ui.date.val() < now.date) {
      ui.date[0].setCustomValidity('Выберите сегодняшнюю или будущую дату.');
    }
    ui.time.prop('min', ui.date.val() === now.date ? now.time : '');
    ui.time[0].setCustomValidity('');
    if (ui.time.val() && !validTime(ui.time.val())) {
      ui.time[0].setCustomValidity('Укажите время в формате часы:минуты.');
    } else if (validDate(ui.date.val()) && validTime(ui.time.val())
      && isPast(ui.date.val(), ui.time.val(), now)) {
      ui.time[0].setCustomValidity('Время начала уже прошло в Астане. Выберите будущие дату и время.');
    }
    ui.seat[0].setCustomValidity('');
    if (ui.seat.val() && !seats.has(ui.seat.val())) {
      ui.seat[0].setCustomValidity('Выберите ПК из списка или оставьте пожелание пустым.');
    } else if (ui.seat.val() && seats.get(ui.seat.val()).room !== ui.room.val()) {
      ui.seat[0].setCustomValidity('Этот ПК находится в другом зале. Измените зал или пожелание по ПК.');
    }
    ui.game[0].setCustomValidity(ui.game.val() && !has(games, ui.game.val())
      ? 'Выберите игру из списка или оставьте поле пустым.' : '');
    stepButtons.each(function () {
      const field = ui[this.dataset.visitStep][0];
      const count = field.valueAsNumber;
      this.disabled = Number.isFinite(count) &&
        (this.dataset.delta === '-1' ? count <= Number(field.min) : count >= Number(field.max));
    });
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
    target.empty();
    for (const [label, value] of facts) {
      const row = $("<div>");
      const dt = $("<dt>"); dt.text(label);
      const dd = $("<dd>"); dd.text(value);
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
    const plan = collectPlan();
    const packages = plan.mode === 'packages';
    const hourly = hourlyEstimate({...plan, guests: Number(plan.guests), duration: Number(plan.duration)});
    const quote = packages ? packageQuote(plan) : null;
    const estimate = packages ? quote?.ok ? quote.total : null : hourly;
    const total = estimate === null ? '—' : `${money.format(estimate)} ₸`;
    if (ui.total.text() !== total) ui.total.text(total);
    $("#booking-call-title").text(packages ? 'Предварительно' : 'Итого');
    M.show($("#booking-packages-section"), packages && Boolean(quote?.ok));
    const formula = $("#booking-package-formula");
    M.show(formula, packages && Boolean(quote?.ok));
    formula.text(quote?.ok ? packageFormula(quote) : '');
    ui['price-note'].text(packages
      ? quote?.ok ? 'Итог по пакету подтвердит клуб.' : quoteError(quote?.code)
      : estimate === null ? 'Укажите число игроков и часов.' : '');
    const end = endTime(plan);
    ui.end.text(end ? `Окончание: ${end} · время Астаны` : '');
    M.show(ui.end, Boolean(end));
    if (quote?.ok) {
      renderPackageFacts(ui['cart-items'], quote);
      ui['cart-note'].text(quote.extraHours
        ? `Доплата за ${quote.extraHours} ч на каждом ПК.` : 'Весь визит покрыт пакетом.');
      if (quote.assumedWindow) ui['cart-note'].text(ui['cart-note'].text() + ' Интервал ночного Duo принят по модели сайта: 22:00–08:00.');
      $("#booking-package-math").text(`${money.format(quote.unitPrice)} ₸ × ${quote.quantity} ПК = ${money.format(quote.packageTotal)} ₸ за пакеты. Доплата: ${quote.extraHours} ч × ${money.format(rooms[ui.room.val()].hourly)} ₸ × ${quote.quantity} ПК = ${money.format(quote.extraTotal)} ₸.`);
    }
    const chosenPackage = packages && window.PixelCart?.getCatalog().find(item => item.id === plan.packageId);
    $("#booking-options-caption").text(chosenPackage?.title || games[plan.game] || '');
  }


  function fillReview(target, plan, contact = null) {
    const date = validDate(plan.date) ? displayDate.format(new Date(`${plan.date}T12:00:00Z`)) : 'Выберите дату';
    const facts = [['Сеанс', `${rooms[plan.room].name} · ${plan.guests} ПК · ${plan.duration} ч`],
      ['Начало', `${date}${plan.time ? `, ${plan.time}` : ' · выберите время'}`],
      ['Окончание', endTime(plan)]];
    if (plan.seat) facts.push(['Место', `${seats.get(plan.seat)?.label} · пожелание`]);
    if (plan.nearby) facts.push(['Посадка', 'Рядом · пожелание']);
    if (plan.game) facts.push(['Игра', games[plan.game]]);
    if (contact?.name) facts.push(['Имя', contact.name]);
    if (contact?.phone) facts.push(['Телефон', contact.phone]);
    if (contact?.email) facts.push(['E-mail', contact.email]);
    target.empty();
    for (const [name, value] of facts) {
      const row = $("<div>");
      const dt = $("<dt>"); dt.text(name);
      const dd = $("<dd>"); dd.text(value);
      row.append(dt, dd); target.append(row);
    }
  }

  function renderInlineErrors(includeEmpty) {
    for (const [field] of labels) {
      const error = $('#' + `${field.attr('id')}-error`);
      if (!error.length) continue;
      const invalid = field[0].willValidate && !field.prop('validity').valid &&
        (includeEmpty || validationAttempted || !!field.val());
      M.show(error, invalid);
      error.text(invalid ? field.prop('validationMessage') : '');
      field.toggleClass('is-invalid', invalid);
      if (invalid) field.attr('aria-invalid', 'true');
      else field.removeAttr('aria-invalid');
    }
  }

  // Array -> generated package cards: their markup exists only here, never in HTML.
  function renderPackagePicker(snapshot) {
    const target = $("#package-options");
    const catalog = window.PixelCart?.getCatalog() || [];
    if (ui.package.attr('data-room') !== ui.room.val()) {
      const previous = (ui.package.val() || '').replace(/^[^-]+-/, `${ui.room.val()}-`);
      ui.package.empty();
      for (const item of catalog.filter(p => p.room === ui.room.val() && p.kind !== 'hourly')) {
        const option = $("<option>"); option.val(item.id);
        option.text(`${item.title} · ${money.format(item.price)} ₸ / ПК${item.manualOnly ? ' · по телефону' : ''}`);
        option.prop('disabled', !!item.manualOnly); ui.package.append(option);
      }
      if (catalog.some(p => p.id === previous && !p.manualOnly)) ui.package.val(previous);
      ui.package.attr('data-room', ui.room.val());
    }
    const roomPackages = catalog.filter(item => item.room === ui.room.val());
    target.empty();
    M.show(target, roomPackages.length > 0);
    for (const item of roomPackages) {
      const quantity = snapshot?.items.find(p => p.id === item.id)?.quantity || 0;
      if (item.id.endsWith('1-hour') && !quantity) continue;
      const row = $("<div>"); row.addClass('package-option').attr('data-package-id', item.id);
      const detail = $("<div>");
      const title = $("<h3>"); title.text(item.title);
      const price = $("<strong>"); price.text(`${money.format(item.price)} ₸ / пакет`);
      const note = $("<p>"); note.text(item.condition);
      detail.append(title, price, note);
      if (item.id.endsWith('3-hours') || item.id.endsWith('5-hours')) {
        const compare = $("<p>");
        const hours = item.id.endsWith('3-hours') ? 3 : 5;
        compare.text(`Для сравнения: ${hours} ч почасово — ${money.format(rooms[ui.room.val()].hourly * hours)} ₸ / ПК.`);
        detail.append(compare);
      }
      if (quantity) {
        const subtotal = $("<p>");
        subtotal.text(`${quantity} × ${money.format(item.price)} ₸ = ${money.format(quantity * item.price)} ₸`);
        detail.append(subtotal);
      }
      row.append(detail);
      row.toggleClass('active', quantity > 0);
      if (!item.manualOnly) row.append(packageCounter(item, quantity));
      target.append(row);
    }
    $("#package-selection-status").text(!roomPackages.length
      ? 'Прайс пакетов недоступен. Можно продолжить с почасовым тарифом.'
      : cart.count
      ? `В корзине: ${cart.count} пакетов · ${money.format(cart.total)} ₸. Для расчёта визита нажмите «В план» у нужного пакета.`
      : 'Корзина пуста. Добавьте пакет кнопкой «+» или рассчитайте визит почасово.');
    const otherRooms = packageRooms().filter(room => room !== ui.room.val() && has(rooms, room));
    const otherPackages = $("#other-room-packages").empty();
    if (otherRooms.length) {
      const switches = M.node('div', '', 'd-flex flex-wrap gap-3');
      for (const room of otherRooms) {
        switches.append(M.node('button', `Переключиться на ${rooms[room].name}`, 'text-button')
          .attr({type:'button', 'data-package-room':room}));
      }
      otherPackages.append(M.node('p', 'В корзине есть пакеты для других залов.', 'mb-1'), switches);
    }
    M.show(otherPackages, otherRooms.length > 0);
    renderCartActions();
  }

  function packageCounter(item, quantity) {
    const M = window.PixelMain;
    const actions = M.node('div', '', 'd-flex flex-column gap-2');
    const counter = M.node('div', '', 'package-counter');
    for (const delta of [-1, 1]) {
      const button = M.node('button', delta < 0 ? '−' : '+')
        .attr({type: 'button', 'data-quantity': `${item.id}:${delta}`, 'data-delta': delta,
          'aria-label': `${delta < 0 ? 'Уменьшить' : 'Добавить'}: ${item.name}`})
        .prop('disabled', delta < 0 ? quantity === 0 : quantity >= rooms[item.room].capacity);
      if (delta === 1) counter.append(M.node('output', String(quantity)));
      counter.append(button);
    }
    actions.append(counter);
    if (quantity > 0) {
      actions.append(M.node('button', 'Удалить', 'text-button').attr({type: 'button',
        'data-package-action': 'remove', 'aria-label': `Удалить: ${item.name}`}));
      if (item.kind !== 'hourly') actions.append(M.node('button', 'В план', 'btn btn-outline-light')
        .attr({type: 'button', 'data-package-action': 'apply', 'aria-label': `В план: ${item.name}`}));
    }
    return actions;
  }

  // Binding directly to these buttons now would miss buttons created on the next
  // render. #package-options exists from HTML and receives their bubbling clicks.
  $('#package-options').on('click', '[data-quantity], [data-package-action]', function () {
    const button = $(this);
    const row = button.closest('.package-option');
    const id = row.attr('data-package-id');
    const item = window.PixelCart.getCatalog().find(entry => entry.id === id);
    if (!item) return;
    const quantity = window.PixelCart.getSnapshot().items.find(entry => entry.id === id)?.quantity || 0;
    const action = button.attr('data-package-action');
    if (action === 'apply') {
      ui.mode.val('packages'); ui.package.val(id); ui.guests.val(String(quantity));
      onChange(); $('#package-picker').prop('open', false);
      announce(`${item.name}: выбран для ${quantity} игроков. Проверьте дату и время визита.`);
      ui.date.trigger('focus');
    } else if (action === 'remove') {
      window.PixelCart.setQuantity(id, 0);
      announce(`${item.name}: удалено из корзины.`);
      $('#cart-clear:not(:disabled)').trigger('focus');
      if (!$('#cart-clear:focus').length) $('#package-picker > summary').trigger('focus');
    } else {
      const delta = Number(button.attr('data-delta'));
      const next = Math.max(0, Math.min(rooms[item.room].capacity, quantity + delta));
      window.PixelCart.setQuantity(id, next);
      announce(`${item.name}: ${next} шт. в корзине.`);
      const options = $('#package-options');
      const current = options.find(`[data-quantity="${id}:${delta}"]:not(:disabled)`);
      (current.length ? current : options.find(`[data-quantity="${id}:${-delta}"]:not(:disabled)`)).trigger('focus');
    }
  });

  $("#other-room-packages").on('click', '[data-package-room]', function () {
    const room = $(this).attr('data-package-room');
    if (!has(rooms, room)) return;
    ui.room.val(room);
    onChange(ui.room[0]);
    $('#package-picker > summary').trigger('focus');
    announce(`Показаны пакеты зала ${rooms[room].name}.`);
  });

  function renderCartActions() {
    const M = window.PixelMain;
    let actions = $("#cart-actions");
    if (!actions.length) {
      actions = M.node('div', '', 'd-flex flex-wrap gap-3 my-3'); actions.attr('id', 'cart-actions');
      const checkout = M.node('button', 'Подтвердить выбор', 'btn btn-outline-light');
      checkout.prop('type', 'button'); checkout.attr('id', 'cart-checkout');
      const clear = M.node('button', 'Очистить корзину', 'text-button'); clear.prop('type', 'button'); clear.attr('id', 'cart-clear');
      const receipt = M.node('div', '', 'small my-3'); receipt.attr('id', 'cart-receipt'); receipt.attr('role', 'status');
      checkout.on('click', () => {
        const snapshot = window.PixelCart.getSnapshot();
        if (!snapshot.count) return;
        receipt.empty();
        const title = M.node('p', 'Подбор пакетов готов');
        const list = $("<ul>");
        for (const item of snapshot.items) list.append(M.node('li', `${item.name}: ${item.quantity} × ${M.money(item.price)} = ${M.money(item.quantity * item.price)}`));
        receipt.append(title, list, M.node('p', `Всего: ${snapshot.count} · ${M.money(snapshot.total)}. Данные не отправлены на сервер; реальный заказ, оплата и бронь не созданы.`));
        receipt.addClass('success-message');
      });
      clear.on('click', () => {
        window.PixelCart.replaceItems([]); announce('Корзина очищена.');
        $("#package-picker").find('summary').first().trigger('focus');
      });
      actions.append(checkout, clear);
      $("#package-selection-status").after(actions, receipt);
    }
    $("#cart-checkout").prop('disabled', cart.count === 0);
    $("#cart-clear").prop('disabled', cart.count === 0);
  }

  function saveDraft() {
    try { localStorage.setItem(storageKey, JSON.stringify(collectPlan())); return true; }
    catch { announce('Черновик недоступен после закрытия страницы.'); return false; }
  }

  function readDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (!value || typeof value !== 'object' || !has(rooms, value.room)) return {};
      const safe = {...value};
      for (const key of ['guests', 'duration']) {
        safe[key] = countText(value[key]);
      }
      safe.date = validDate(value.date) ? value.date : '';
      safe.time = validTime(value.time) ? value.time : '';
      safe.seat = seats.has(value.seat) ? value.seat : '';
      safe.game = has(games, value.game) ? value.game : '';
      return {draft: safe};
    } catch { return {}; }
  }

  function sameVisit(first, second) {
    return first && second && ['room', 'mode', 'date', 'time', 'duration', 'guests', 'seat', 'game', 'nearby', 'packageId']
      .every(key => String(first[key] ?? '') === String(second[key] ?? ''));
  }

  function finishDraft(plan) {
    try {
      if (sameVisit(readDraft().draft, plan)) localStorage.removeItem(storageKey);
    } catch { /* The next visit can still start from an empty form. */ }
  }

  function applyDraft(draft) {
    for (const key of ['room', 'guests', 'duration', 'date', 'time', 'seat', 'game']) {
      ui[key].val(typeof draft[key] === 'string' || typeof draft[key] === 'number' ? String(draft[key]) : '');
    }
    // prop('checked') is the live boolean; attr('checked') only describes the
    // original/default markup and would not track the visitor's latest toggle.
    ui.nearby.prop('checked', draft.nearby === true);
    ui.mode.val(draft.mode === 'packages' ? 'packages' : 'hourly');
    renderPackagePicker(window.PixelCart?.getSnapshot());
    if (draft.packageId && [...ui.package.find('option').toArray().map(element => $(element))].some(option => option.val() === draft.packageId && !option.prop('disabled'))) ui.package.val(draft.packageId);
  }

  function filterSeats() {
    for (const group of ui.seat.find('optgroup').toArray().map(element => $(element))) {
      const matching = group.prop('label') === rooms[ui.room.val()]?.name;
      M.show(group, matching);
      for (const option of group.children().toArray().map(element => $(element))) option.prop('disabled', !matching);
    }
    if (ui.seat.val() && seats.get(ui.seat.val())?.room !== ui.room.val()) ui.seat.val('');
  }

  function applyQuery() {
    const query = new URLSearchParams(window.location.search);
    const messages = [];
    const roomValue = query.get('room');
    const seatValue = query.get('seat');
    const gameValue = query.get('game');
    const queryRoom = roomValue !== null && has(rooms, roomValue) ? roomValue : null;
    if (query.has('room') && !queryRoom) messages.push('Зал из ссылки не распознан.');
    if (queryRoom) ui.room.val(queryRoom);
    if (seatValue !== null) {
      const seat = seats.get(seatValue);
      if (!seat) messages.push('ПК из ссылки не распознан.');
      else if (queryRoom && seat.room !== queryRoom) {
        messages.push('ПК из ссылки относится к другому залу; он не выбран.');
        if (ui.seat.val() && seats.get(ui.seat.val())?.room !== queryRoom) {
          ui.seat.val('');
          messages.push('Пожелание по ПК из предыдущего плана сброшено: выбран другой зал.');
        }
      } else {
        if (!queryRoom) ui.room.val(seat.room);
        ui.seat.val(seatValue);
        messages.push('Номер ПК добавлен в пожелания.');
      }
    } else if (queryRoom && ui.seat.val() && seats.get(ui.seat.val())?.room !== queryRoom) {
      ui.seat.val('');
      messages.push('Пожелание по ПК из предыдущего плана сброшено: выбран другой зал.');
    }
    if (gameValue !== null) {
      if (has(games, gameValue)) ui.game.val(gameValue);
      else messages.push('Игра из ссылки не распознана.');
    }
    return messages.join(' ');
  }

  function revealPreferences() {
    if (window.location.hash === '#preferences') $("#preferences").prop('open', true);
    for (const field of [ui.seat, ui.game]) {
      const details = field.val() ? field.closest('details') : null;
      if (details) details.prop('open', true);
    }
  }

  function clearEntryQuery(keys = ['room', 'seat', 'game', 'mode']) {
    try {
      const url = new URL(window.location.href);
      for (const key of keys) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Local field reset still works if browser history is unavailable.
    }
  }

  function collectPlan() {
    const item = window.PixelCart?.getCatalog().find(p => p.id === ui.package.val());
    return { version: 2, mode: ui.mode.val(), room: ui.room.val(), guests: countText(ui.guests.val()),
      duration: countText(ui.duration.val()), date: ui.date.val(), time: ui.time.val(),
      nearby: ui.nearby.prop('checked'), seat: ui.seat.val(), game: ui.game.val(),
      packageCatalogVersion: 2,
      ...(ui.mode.val() === 'packages' ? {pricingPolicy:window.PixelPackagePricing?.policy, packageId:ui.package.val()} : {}),
      packages: ui.mode.val() === 'packages' && item ? [{id:item.id, name:item.name, price:item.price, quantity:Number(ui.guests.val())}] : [] };
  }

  function collectContact() {
    let digits = ui.phone.val().replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8') && !ui.phone.val().trim().startsWith('+')) digits = '7' + digits.slice(1);
    return {name: ui.name.val().trim(), phone: digits ? '+' + digits : '', email: ui.email.val().trim()};
  }

  async function visitApi(path, {payload, uid} = {}) {
    const headers = {Accept: 'application/json'};
    if (uid) headers['X-Pixel-Account'] = uid;
    if (payload) headers['Content-Type'] = 'application/json';
    const response = await fetch(`./api/${path}`, {
      method: payload ? 'POST' : 'GET', headers, credentials: 'same-origin', cache: 'no-store',
      body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout?.(8000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw Object.assign(new Error(data?.message || 'Не удалось связаться с сервером. Попробуйте ещё раз.'),
        {code: data?.code, status: response.status});
    }
    return data;
  }

  function checkoutMethod() {
    return checkoutMethods.find(':checked').val();
  }

  function syncCheckout(view) {
    if (checkout !== view) return;
    const method = checkoutMethod();
    const shortfall = method === 'balance' && view.user && Number.isInteger(view.user.balance)
      && view.user.balance < view.amount;
    let note = 'Демо-бронь. Места подтвердит клуб.';
    let action = 'Забронировать';
    let disabled = view.busy;
    if (method !== 'reserve') {
      note = 'Демо-оплата. Места подтвердит клуб.';
      if (method === 'balance' && Number.isInteger(view.user?.balance)) {
        note = `Демо-баланс ${money.format(view.user.balance)} ₸. Места подтвердит клуб.`;
      }
      if (view.sessionError) action = 'Проверить вход';
      else if (view.user === null) action = 'Войти для оплаты';
      else if (!view.user) { action = 'Проверяем вход…'; disabled = true; }
      else if (method === 'card') action = 'Перейти к оплате';
      else action = `Оплатить ${money.format(view.amount)} ₸`;
    }
    checkoutNote.text(shortfall ? `${note} Не хватает ${money.format(view.amount - view.user.balance)} ₸.` : note);
    M.show(checkoutWallet, shortfall && !view.busy);
    const progress = method === 'reserve' ? 'Оформляем бронь…' : 'Проверяем оплату…';
    checkoutSubmit.text(view.busy ? progress : action).prop('disabled', disabled || shortfall);
    checkoutMethods.add(checkoutBack).prop('disabled', view.busy);
    checkoutForm.attr('aria-busy', String(view.busy));
  }

  async function readCheckoutSession(view) {
    if (view.sessionPending) return;
    view.sessionPending = true;
    view.sessionError = false;
    view.user = undefined;
    syncCheckout(view);
    try {
      const {user} = await visitApi('auth/session');
      if (user !== null && typeof user?.uid !== 'string') throw new Error('Invalid session');
      view.user = user;
    } catch {
      view.sessionError = true;
      if (checkout === view && checkoutMethod() !== 'reserve') {
        checkoutMessage.text('Не удалось проверить вход. Попробуйте ещё раз.');
      }
    }
    view.sessionPending = false;
    syncCheckout(view);
  }

  function openCheckout(plan) {
    const amount = plan.mode === 'packages' ? packageQuote(plan)?.total
      : hourlyEstimate({...plan, guests: Number(plan.guests), duration: Number(plan.duration)});
    if (!integer(amount, 1, Number.MAX_SAFE_INTEGER)) return;
    checkout = {plan, amount, busy: false};
    const date = displayDate.format(new Date(`${plan.date}T12:00:00Z`));
    const pack = plan.mode === 'packages' && window.PixelCart?.getCatalog().find(item => item.id === plan.packageId);
    const room = pack ? `${rooms[plan.room].name} · пакет «${pack.title}»\n` : `${rooms[plan.room].name} · `;
    $('#booking-checkout-summary').text(`${room}${plan.guests} ПК · ${plan.duration} ч\n${date}, ${plan.time}`);
    $('#booking-checkout-total').text(`${money.format(amount)} ₸`);
    checkoutMethods.find('input').val([resumeMethod || 'reserve']);
    resumeMethod = '';
    checkoutMessage.text('');
    saveDraft();
    dialog.showModal();
    checkoutMethods.find(':checked').trigger('focus');
    syncCheckout(checkout);
    if (checkoutMethod() !== 'reserve') void readCheckoutSession(checkout);
  }

  function checkoutRequest(view, method) {
    const fingerprint = JSON.stringify([method === 'reserve' ? null : view.user.uid, view.plan, view.amount]);
    if (visitRequests[method]?.fingerprint !== fingerprint) {
      visitRequests[method] = {fingerprint, id: crypto.randomUUID()};
      try { sessionStorage.setItem(visitRequestKey, JSON.stringify(visitRequests)); }
      catch { /* Retries in this tab still share an in-memory request identifier. */ }
    }
    return visitRequests[method].id;
  }

  function validReceipt(order, status, id = order?.id) {
    if (!/^[0-9a-f]{32}$/.test(id) || order?.id !== id || order.status !== status
      || !integer(order.amount, 1, Number.MAX_SAFE_INTEGER) || !has(rooms, order.plan?.room)
      || !validDate(order.plan.date) || !validTime(order.plan.time)) return false;
    return status === 'reserved' || status === 'cancelled' || order.method === 'card'
      || (order.method === 'balance' && integer(order.balance, 0, Number.MAX_SAFE_INTEGER));
  }

  function rememberReservation(id, requestId) {
    try {
      const saved = JSON.parse(localStorage.getItem(guestReservationsKey) || '[]');
      const claims = Array.isArray(saved) ? saved.filter(item => item?.id !== id) : [];
      localStorage.setItem(guestReservationsKey, JSON.stringify([...claims, {id, requestId}].slice(-30)));
      return true;
    } catch { return false; }
  }

  function displayReceipt(order) {
    finishDraft(order.plan);
    const method = order.method || 'reserve';
    const attempt = visitRequests[method];
    try {
      if (attempt && sameVisit(JSON.parse(attempt.fingerprint)?.[1], order.plan)
        && (order.status !== 'reserved' || rememberReservation(order.id, attempt.id))) {
        delete visitRequests[method];
        sessionStorage.setItem(visitRequestKey, JSON.stringify(visitRequests));
      }
    } catch { /* A damaged attempt or unavailable storage does not block the receipt. */ }
    showConfirmation({kind: order.status, plan: order.plan, receipt: order}, true);
  }

  function rememberCheckoutMethod(method) {
    try { sessionStorage.setItem(visitMethodKey, method); }
    catch { /* The draft still restores and the guest can select a payment method again. */ }
  }

  checkoutBack.on('click', () => dialog.close());
  $(dialog).on('cancel', event => { if (checkout?.busy) event.preventDefault(); });
  $(dialog).on('close', () => { if (!dialog.open) checkout = null; });
  checkoutMethods.on('change', () => {
    if (!checkout) return;
    checkoutMessage.text(checkout.sessionError && checkoutMethod() !== 'reserve'
      ? 'Не удалось проверить вход. Попробуйте ещё раз.' : '');
    syncCheckout(checkout);
    if (checkoutMethod() !== 'reserve' && checkout.user === undefined && !checkout.sessionError) {
      void readCheckoutSession(checkout);
    }
  });
  checkoutWallet.on('click', event => {
    if (saveDraft()) rememberCheckoutMethod('balance');
    else {
      event.preventDefault();
      checkoutMessage.text('Разрешите сохранение в браузере, чтобы вернуться к плану после пополнения.');
    }
  });
  checkoutForm.on('submit', async event => {
    event.preventDefault();
    const view = checkout;
    if (!view || view.busy || checkoutSubmit.prop('disabled')) return;
    const method = checkoutMethod();
    const reserve = method === 'reserve';
    checkoutMessage.text('');
    if (!reserve && view.sessionError) { void readCheckoutSession(view); return; }
    if (!reserve && !view.user) {
      if (!saveDraft()) {
        checkoutMessage.text('Разрешите сохранение в браузере, чтобы вернуться к плану после входа.');
        return;
      }
      rememberCheckoutMethod(method);
      window.location.assign('account.html?return=booking');
      return;
    }
    view.busy = true;
    syncCheckout(view);
    try {
      const payload = {plan: view.plan, requestId: checkoutRequest(view, method)};
      const order = reserve ? await visitApi('visit-checkout/reservations', {payload})
        : await visitApi('visit-checkout/orders', {uid: view.user.uid,
          payload: {...payload, method, expectedAmount: view.amount}});
      const status = reserve ? 'reserved' : 'paid';
      if ((reserve || order.method === method) && validReceipt(order, status)) {
        const url = new URL(window.location.href);
        url.searchParams.delete('paid');
        url.searchParams.delete('reserved');
        url.searchParams.set(status, order.id);
        window.history.replaceState(window.history.state, '', url);
        dialog.close();
        displayReceipt(order);
      } else if (method === 'card' && order.method === 'card' && order.status === 'pending' && /^[0-9a-f]{32}$/.test(order.id)) {
        rememberCheckoutMethod(method);
        window.location.assign(`checkout.html?visit=${order.id}`);
      } else {
        throw new Error('Invalid checkout response');
      }
    } catch (error) {
      if (!reserve && ['sign_in', 'account_changed', 'insufficient_balance'].includes(error.code)) void readCheckoutSession(view);
      checkoutMessage.text(error.code ? error.message : reserve ? 'Не удалось проверить бронь. Попробуйте ещё раз.'
        : 'Не удалось проверить оплату. Попробуйте ещё раз.');
    } finally {
      view.busy = false;
      syncCheckout(view);
    }
  });

  function showConfirmation(record, focus = false) {
    announce('');
    const request = record.kind === 'request';
    const paid = record.kind === 'paid';
    const reserved = record.kind === 'reserved';
    const cancelled = record.kind === 'cancelled';
    const ordered = paid || reserved;
    const test = request && record.receipt?.status === 'test';
    ui['result-title'].text(cancelled ? 'Визит отменён' : reserved ? 'Бронь создана' : paid ? 'Демо-оплата принята'
      : request ? test ? 'Проверка завершена' : 'Заявка отправлена' : 'План визита готов');
    ui.success.find('p').first().text(cancelled ? '' : reserved ? `Код брони ${record.receipt.id.slice(0, 8).toUpperCase()}. Места подтвердит клуб.` : paid ? (record.receipt.method === 'balance'
      ? `Остаток на демо-балансе ${money.format(record.receipt.balance)} ₸. Места подтвердит клуб.`
      : 'Места подтвердит клуб.') : request ? test
      ? 'Тестовая заявка. Она не отправлена администратору.'
      : 'Заявка отправлена администратору. Дождитесь подтверждения мест и условий по телефону.'
      : 'Позвоните в клуб, чтобы подтвердить места и уточнить оплату.');
    M.show(ui.result, true);
    M.show(layout, false);
    M.show(help, false);
    M.show(ui.success, !cancelled);
    if (!cancelled) {
      ui.success.stop(true, true).addClass('success-message').fadeOut(0).fadeIn(effectDuration());
    }
    fillReview($("#booking-saved-review"), record.plan, record.contact);
    const price = $("#booking-saved-price");
    price.empty();
    const packages = record.plan.mode === 'packages';
    const quote = !ordered && !cancelled && packages && record.plan.pricingPolicy === window.PixelPackagePricing?.policy ? packageQuote(record.plan) : null;
    const packageItems = Array.isArray(record.plan.packages) ? record.plan.packages : [];
    const amount = ordered ? record.receipt.amount : quote?.ok ? quote.total : packages ? packageItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
      : hourlyEstimate({...record.plan, guests:Number(record.plan.guests), duration:Number(record.plan.duration)});
    if (!cancelled) {
      const label = paid ? 'Оплачено' : reserved ? 'Стоимость визита' : quote?.ok ? 'Предварительно за весь визит'
        : packages ? 'Стоимость выбранных пакетов' : 'Стоимость сеанса';
      price.append(M.node('p', label, 'form-text'), M.node('strong', `${money.format(amount)} ₸`));
    }
    M.show(price, !cancelled);
    if (focus) { ui['result-title'][0].focus({preventScroll:true}); ui.result[0].scrollIntoView({behavior: 'auto', block: 'start'}); }
  }

  function completePlan(record, contact) {
    finishDraft(record.plan);
    showConfirmation({...record, contact}, true);
    form[0].reset();
    validationAttempted = false;
    clearErrors();
    renderInlineErrors(false);
  }

  function renderCart(snapshot) {
    const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items.filter(item =>
      typeof item?.id === 'string' && typeof item.name === 'string' && integer(item.price, 1, Number.MAX_SAFE_INTEGER)
      && integer(item.quantity, 1, 99) && Number.isSafeInteger(item.price * item.quantity))
      .map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })) : [];
    cart = { items, total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      count: items.reduce((sum, item) => sum + item.quantity, 0) };
    renderPackagePicker(snapshot);
    refreshConstraints();
    renderEstimate();
  }

  function updateCart() {
    renderCart(window.PixelCart?.getSnapshot());
  }

  function onChange(field) {
    if (sending) return;
    clearErrors();
    filterSeats();
    if (field === ui.room[0]) updateCart();
    else { refreshConstraints(); renderEstimate(); }
    renderInlineErrors(false);
    saveDraft();
  }

  roomChoices.on('change', 'input', function () {
    ui.room.val(this.value);
    onChange(ui.room[0]);
  });
  form.on('click', '[data-visit-step]', function () {
    const field = ui[this.dataset.visitStep][0];
    const delta = Number(this.dataset.delta);
    const minimum = Number(field.min);
    const maximum = Number(field.max);
    const value = Number.isFinite(field.valueAsNumber) ? Math.trunc(field.valueAsNumber) + delta : minimum;
    field.value = String(Math.min(maximum, Math.max(minimum, value)));
    onChange(field);
    if (this.disabled) field.focus({preventScroll: true});
  });
  form.on('input change', 'input:not([name="room-choice"]), select, textarea', function () {
    $(this).removeClass('is-invalid');
    onChange(this);
  });
  form.on('focusout', () => { refreshConstraints(); renderInlineErrors(false); });
  form.on('submit', async event => {
    // Without this the browser navigates/reloads and loses the asynchronous delivery result.
    event.preventDefault();
    if (!delivery.available || sending || dialog.open || !ui.result.hasClass('d-none')) return;
    // Normalize on submit, so typing a space between words is still possible.
    form.find('input:not([type="checkbox"]), select, textarea').each(function () {
      const field = $(this);
      const value = field.val();
      if (typeof value === 'string') field.val(value.trim());
    });
    refreshConstraints();
    validationAttempted = true;
    const invalid = [...labels.keys()].filter(field => field[0].willValidate && !field.prop('validity').valid);
    if (invalid.length) {
      const first = invalid[0];
      showErrors(invalid);
      renderInlineErrors(true);
      if (first === ui.room) focusRoom();
      else first.trigger('focus');
      return;
    }
    clearErrors();
    const plan = collectPlan();
    if (checkoutAvailable) {
      openCheckout(plan);
      return;
    }
    if (delivery.mode === 'local') {
      completePlan({kind: 'local', plan});
      return;
    }
    const contact = collectContact();
    sending = true;
    const controls = [...form.find('input,select,button').toArray().map(element => $(element)), ui.reset];
    const disabled = controls.map(control => control.prop('disabled'));
    controls.forEach(control => { control.prop('disabled', true); });
    form.attr('aria-busy', 'true');
    ui.submit.text('Отправляем…');
    announce('Отправляем заявку администратору.');
    try {
      const receipt = await window.PixelBookingDelivery.send(plan, contact);
      completePlan({kind: 'request', plan, receipt}, contact);
    } catch (error) {
      announce('');
      ui.errors.text(error.message || 'Не удалось отправить заявку. Свяжитесь с клубом.');
      M.show(ui.errors, true);
      for (const [key, message] of Object.entries(error.fields || {})) {
        const field = ui[key];
        if (!labels.has(field) || typeof message !== 'string') continue;
        field.parents('details').prop('open', true);
        field.addClass('is-invalid').attr('aria-invalid', 'true');
        const note = $('#' + `${field.attr('id')}-error`);
        if (note) { note.text(message); M.show(note, true); }
      }
      ui.errors.trigger('focus');
    } finally {
      sending = false;
      controls.forEach((control, index) => { control.prop('disabled', disabled[index]); });
      form.removeAttr('aria-busy');
      syncSubmitLabels();
    }
  });

  ui.reset.on('click', () => {
    validationAttempted = false;
    form[0].reset();
    applyDraft({room: 'standard', guests: 1, duration: 2, date: clubNow().date, time: '', nearby: false, seat: '', game: ''});
    extras.find('details').add(extras).prop('open', false);
    clearErrors(); filterSeats(); updateCart(); refreshConstraints(); renderEstimate(); renderInlineErrors(false); clearEntryQuery(); saveDraft();
    editing();
    announce('Поля очищены.');
    ui.time.trigger('focus');
  });

  $("#booking-use-hourly").on('click', () => {
    ui.mode.val('hourly');
    $("#package-picker").prop('open', false);
    onChange(); ui.mode.trigger('focus');
  });

  $(window).on('focus', refreshConstraints);
  const query = new URLSearchParams(window.location.search);
  const receiptEntry = query.has('paid') || query.has('reserved');
  const returningToCheckout = query.get('checkout') === '1';
  const reloadingDraft = !receiptEntry && performance.getEntriesByType('navigation')[0]?.type === 'reload';
  const restored = returningToCheckout || reloadingDraft ? readDraft() : {};
  if (restored.draft) applyDraft(restored.draft);
  const today = clubNow().date;
  if (!ui.time.val() && ui.date.val() < today) ui.date.val(today);
  const queryMessage = applyQuery();
  filterSeats(); revealPreferences(); updateCart();
  if (query.get('mode') === 'packages') {
    ui.mode.val('packages');
    const selectedRooms = packageRooms();
    if (!query.has('room') && selectedRooms.length === 1 && has(rooms, selectedRooms[0])) ui.room.val(selectedRooms[0]);
    filterSeats();
    renderPackagePicker(window.PixelCart?.getSnapshot());
  }
  if (query.get('mode') === 'hourly') ui.mode.val('hourly');
  refreshConstraints(); renderEstimate();
  if (ui.mode.val() === 'packages' || window.location.hash === '#packages' || $("#preferences").prop('open')) {
    extras.prop('open', true);
  }
  clearEntryQuery();
  editing();
  function onCartChange() {
    $("#cart-receipt").empty().removeClass('success-message');
    updateCart();
  }
  if (window.PixelCart) window.PixelCart.subscribe(onCartChange);
  else $(window).on('pixel:cartchange', onCartChange);
  const meaningfulDraft = restored.draft && (restored.draft.time || restored.draft.seat ||
    restored.draft.game || restored.draft.room !== 'standard' || Number(restored.draft.guests) !== 1 ||
    Number(restored.draft.duration) !== 2 || restored.draft.mode === 'packages' ||
    restored.draft.date > today);
  announce([meaningfulDraft && !layout.hasClass('d-none') ? 'Черновик восстановлен.' : '', queryMessage].filter(Boolean).join(' '));
  ui.reset.prop('disabled', false);
  try {
    const requests = JSON.parse(sessionStorage.getItem(visitRequestKey));
    for (const method of ['reserve', 'card', 'balance']) {
      if (typeof requests?.[method]?.fingerprint === 'string' && /^[0-9a-f-]{36}$/.test(requests[method].id)) {
        visitRequests[method] = requests[method];
      }
    }
  } catch { /* The current tab can still create and retry new payment requests. */ }
  const deliveryConfig = await window.PixelBookingDelivery.ready;
  if (deliveryConfig.mode === 'local' && typeof dialog.showModal === 'function') {
    const checkoutConfig = await visitApi('visit-checkout/config').catch(() => null);
    checkoutAvailable = checkoutConfig?.available === true;
  }
  configureDelivery(deliveryConfig);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('reserved') || url.searchParams.has('paid')) window.location.reload();
    else if (checkout && !sameVisit(readDraft().draft, checkout.plan)) window.location.replace('booking.html');
  });
  if (receiptEntry) {
    const reserve = query.has('reserved');
    const status = reserve ? 'reserved' : 'paid';
    const id = query.get(status);
    const failure = reserve ? 'Не удалось проверить бронь.' : 'Не удалось проверить оплату визита.';
    if (!checkoutAvailable || !/^[0-9a-f]{32}$/.test(id)) {
      announce(failure);
      return;
    }
    announce(reserve ? 'Проверяем бронь…' : 'Проверяем оплату…');
    ui.submit.prop('disabled', true);
    try {
      const order = await visitApi(`visit-checkout/${reserve ? 'reservations' : 'orders'}/${id}`);
      if (validReceipt(order, status, id) || validReceipt(order, 'cancelled', id)) displayReceipt(order);
      else announce(reserve ? failure : 'Оплата визита ещё не подтверждена.');
    } catch (error) {
      announce(error.status === 401 ? 'Войдите в личный кабинет и снова откройте эту страницу.'
        : error.status === 404 ? reserve ? 'Бронь не найдена.' : 'Оплата визита не найдена.' : `${failure} Обновите страницу.`);
    } finally {
      ui.submit.prop('disabled', false);
    }
  } else if (returningToCheckout) {
    clearEntryQuery(['checkout']);
    if (!checkoutAvailable) return;
    try {
      const method = sessionStorage.getItem(visitMethodKey);
      if (['balance', 'card'].includes(method)) resumeMethod = method;
      sessionStorage.removeItem(visitMethodKey);
    } catch { /* The dialog opens with the first option selected. */ }
    form[0].requestSubmit();
  }
});
