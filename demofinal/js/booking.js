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
    'result', 'result-title', 'success', 'end'];
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
    [ui.package, 'Тариф'], [ui.seat, 'Пожелание по ПК'], [ui.game, 'Игра'],
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
  let checkoutPaymentsAvailable = false;
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
  const guestContact = $('#booking-guest-contact');
  const guestIdentity = $('#booking-guest-identity');
  const guestError = $('#booking-guest-error');
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

  function parseStartTime(value) {
    const parts = /^(\d{1,2}):?(\d{2})$/.exec(value.trim());
    if (!parts) return '';
    const time = `${parts[1].padStart(2, '0')}:${parts[2]}`;
    return validTime(time) ? time : '';
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
    ui.submit.text(checkoutAvailable ? 'Продолжить' : delivery.mode === 'local' ? 'Сохранить параметры' : 'Отправить бронь');
  }

  function configureDelivery(config) {
    delivery = config;
    const local = config.mode === 'local';
    const needsContact = config.available && !local && !checkoutAvailable;
    checkoutMethods.find('input:not([value="reserve"])').each(function () {
      M.show($(this).closest('label'), checkoutPaymentsAvailable);
      this.disabled = !checkoutPaymentsAvailable;
    });
    M.show($("#booking-contact-step"), needsContact);
    ui.name.add(ui.phone).add(ui.email).prop('disabled', !needsContact);
    $("#booking-email-help").text('Войдёт в заявку, если заполнить.');
    $('#booking-submit-note').text('');
    const state = $("#booking-delivery-state");
    state.text(!config.available ? 'Онлайн-бронирование сейчас недоступно. Позвоните: +7 775 351 36 93.' : '');
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

  // required/min/max/type stay as browser constraints. They are bypassable, so
  // booking_server.py must independently validate all fields and recompute prices.
  // Native Constraint Validation has no jQuery equivalent; [0] bridges only those APIs.
  function refreshConstraints() {
    if (sending) return;
    M.show($('#booking-room-note'), ui.room.val() === 'duo');
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
    const selectedId = ui.package.val();
    const selectedPackage = window.PixelCart?.getCatalog().find(item => item.id === selectedId);
    $("#booking-package-condition").text(selectedPackage?.condition || '');
    const quote = selectedId ? packageQuote() : null;
    ui.package[0].setCustomValidity(selectedId && !quote?.ok ? quoteError(quote?.code) : '');
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
    const timeInput = ui.time.val();
    const time = parseStartTime(timeInput);
    ui.time[0].setCustomValidity('');
    if (timeInput && !time) {
      ui.time[0].setCustomValidity('Укажите время в формате часы:минуты.');
    } else if (time && validDate(ui.date.val()) && isPast(ui.date.val(), time, now)) {
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
      window:'Визит не пересекается с интервалом пакета. Измените время или тариф.'})[code] || 'Пакетный расчёт недоступен. Выберите расчёт по длительности.';
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
    const chosenPackage = packages && window.PixelCart?.getCatalog().find(item => item.id === plan.packageId);
    const hourly = hourlyEstimate({...plan, guests: Number(plan.guests), duration: Number(plan.duration)});
    const quote = packages ? packageQuote(plan) : null;
    const estimate = packages ? quote?.ok ? quote.total : null : hourly;
    const total = estimate === null ? '—' : `${money.format(estimate)} ₸`;
    if (ui.total.text() !== total) ui.total.text(total);
    $("#booking-call-title").text(chosenPackage?.kind === 'window' ? 'Предварительно' : 'Итого');
    ui['price-note'].text(packages
      ? quote?.ok ? `Пакет «${chosenPackage.title}»` : quoteError(quote?.code)
      : estimate === null ? 'Укажите число игроков и часов.' : '');
    const end = endTime(plan);
    ui.end.text(end ? `Окончание: ${end} · время Астаны` : '');
    M.show(ui.end, Boolean(end));
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
      if (name === 'Имя' || name === 'Телефон' || name === 'E-mail') dd.attr('translate', 'no');
      row.append(dt, dd); target.append(row);
    }
  }

  function renderInlineErrors(includeEmpty, editingField) {
    for (const [field] of labels) {
      const error = $('#' + `${field.attr('id')}-error`);
      if (!error.length) continue;
      const invalid = field[0] !== editingField && field[0].willValidate && !field.prop('validity').valid &&
        (includeEmpty || validationAttempted || !!field.val());
      M.show(error, invalid);
      error.text(invalid ? field.prop('validationMessage') : '');
      field.toggleClass('is-invalid', invalid);
      if (invalid) field.attr('aria-invalid', 'true');
      else field.removeAttr('aria-invalid');
    }
  }

  function tariffClock(minutes) {
    const hours = Math.floor(minutes / 60) % 24;
    return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function renderTariffOptions() {
    const room = ui.room.val();
    if (ui.package.attr('data-room') === room) return;

    const catalog = window.PixelCart?.getCatalog() || [];
    const previous = (ui.package.val() || '').replace(/^[^-]+-/, `${room}-`);
    const options = catalog.filter(item => item.room === room && item.kind === 'window');
    ui.package.find('option').slice(1).remove();
    for (const item of options) {
      const period = item.manualOnly ? '' : ` · ${tariffClock(item.start)}–${tariffClock(item.end)}`;
      const option = $('<option>').val(item.id)
        .text(`${item.title}${period} · ${money.format(item.price)} ₸ / ПК${item.manualOnly ? ' · по телефону' : ''}`)
        .prop('disabled', !!item.manualOnly);
      ui.package.append(option);
    }
    ui.package.val(options.some(item => item.id === previous && !item.manualOnly) ? previous : '');
    ui.package.attr('data-room', room);
  }

  function saveDraft() {
    try { localStorage.setItem(storageKey, JSON.stringify(collectPlan())); return true; }
    catch { return false; }
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
    renderTariffOptions();
    const options = ui.package.find('option:not(:disabled)').toArray();
    ui.package.val(options.some(option => option.value === draft.packageId) ? draft.packageId : '');
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
    const room = ui.room.val();
    const duration = countText(ui.duration.val());
    const selectedId = ui.package.val();
    const item = window.PixelCart?.getCatalog().find(p => p.room === room && (selectedId
      ? p.id === selectedId : p.kind === 'hours' && p.hours === Number(duration)));
    return { version: 2, mode: item ? 'packages' : 'hourly', room, guests: countText(ui.guests.val()),
      duration, date: ui.date.val(), time: parseStartTime(ui.time.val()),
      nearby: ui.nearby.prop('checked'), seat: ui.seat.val(), game: ui.game.val(),
      packageCatalogVersion: 2,
      ...(item ? {pricingPolicy:window.PixelPackagePricing?.policy, packageId:item.id} : {}),
      packages: item ? [{id:item.id, name:item.name, price:item.price, quantity:Number(ui.guests.val())}] : [] };
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
    M.show(guestContact, method === 'reserve');
    guestIdentity.prop('disabled', view.busy || method !== 'reserve').prop('required', method === 'reserve');
    const shortfall = method === 'balance' && view.user && Number.isInteger(view.user.balance)
      && view.user.balance < view.amount;
    let note = '';
    let action = 'Создать бронь';
    let disabled = view.busy;
    if (method !== 'reserve') {
      note = '';
      if (method === 'balance' && Number.isInteger(view.user?.balance)) {
        note = `Баланс ${money.format(view.user.balance)} ₸.`;
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
    checkoutMethods.find('input').val([checkoutPaymentsAvailable ? resumeMethod || 'reserve' : 'reserve']);
    resumeMethod = '';
    checkoutMessage.text('');
    saveDraft();
    dialog.showModal();
    syncCheckout(checkout);
    guestError.text('');
    M.show(guestError, false);
    guestIdentity.removeAttr('aria-invalid');
    (checkoutMethod() === 'reserve' ? guestIdentity : checkoutMethods.find(':checked')).trigger('focus');
    if (checkoutMethod() !== 'reserve') void readCheckoutSession(checkout);
  }

  function newVisitRequestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // getRandomValues is also available on a phone over local-network HTTP.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function checkoutRequest(view, method) {
    const fingerprint = JSON.stringify([method === 'reserve' ? null : view.user.uid, view.plan, view.amount,
      method === 'reserve' ? view.contact : null]);
    if (visitRequests[method]?.fingerprint !== fingerprint) {
      visitRequests[method] = {fingerprint, id: newVisitRequestId()};
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
  guestIdentity.on('input', () => {
    guestIdentity.removeAttr('aria-invalid');
    guestError.text('');
    M.show(guestError, false);
  });
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
      checkoutMessage.text('Не удалось сохранить параметры визита. Попробуйте ещё раз.');
    }
  });
  checkoutForm.on('submit', async event => {
    event.preventDefault();
    const view = checkout;
    if (!view || view.busy || checkoutSubmit.prop('disabled')) return;
    const method = checkoutMethod();
    const reserve = method === 'reserve';
    checkoutMessage.text('');
    if (reserve) {
      const value = guestIdentity.val().trim();
      const phone = /^[+\d]/.test(value);
      const digits = value.replace(/\D/g, '');
      const error = !value ? 'Укажите имя или телефон.'
        : phone ? (!/^\+?[\d ()-]+$/.test(value) || value.length > 32 || digits.length < 10 || digits.length > 15 || digits[0] === '0'
          ? 'Проверьте номер телефона: от 10 до 15 цифр.' : '')
        : value.length < 2 || value.length > 80 || /[\p{Cc}\p{Cf}]/u.test(value) || !/\p{L}/u.test(value)
          ? 'Укажите имя: от 2 до 80 символов.' : '';
      if (error) {
        guestIdentity.attr('aria-invalid', 'true');
        guestError.text(error);
        M.show(guestError, true);
        guestIdentity.trigger('focus');
        return;
      }
      view.contact = phone ? {name: '', phone: value} : {name: value, phone: ''};
    }
    if (!reserve && view.sessionError) { void readCheckoutSession(view); return; }
    if (!reserve && !view.user) {
      if (!saveDraft()) {
        checkoutMessage.text('Не удалось сохранить параметры визита. Попробуйте ещё раз.');
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
      if (reserve) payload.contact = view.contact;
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
        guestIdentity.val('');
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
    ui['result-title'].text(cancelled ? 'Визит отменён' : reserved ? 'Бронь создана'
      : paid ? 'Оплата принята'
      : request ? test ? 'Бронь не отправлена' : 'Бронь отправлена' : 'Параметры визита');
    ui.success.find('p').first().text(cancelled ? ''
      : reserved ? `Код брони ${record.receipt.reference || record.receipt.id.slice(0, 8).toUpperCase()}.`
      : paid && record.receipt.method === 'balance' ? `Остаток на балансе ${money.format(record.receipt.balance)} ₸.`
      : '');
    M.show(ui.result, true);
    M.show(layout, false);
    M.show(help, false);
    M.show(ui.success, !cancelled);
    M.show($('#booking-manage'), ordered && !cancelled);
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

  function onChange(editingField) {
    if (sending) return;
    clearErrors();
    filterSeats();
    renderTariffOptions();
    refreshConstraints();
    renderEstimate();
    renderInlineErrors(false, editingField);
    saveDraft();
  }

  roomChoices.on('change', 'input', function () {
    ui.room.val(this.value);
    onChange();
  });
  form.on('click', '[data-visit-step]', function () {
    const field = ui[this.dataset.visitStep][0];
    const delta = Number(this.dataset.delta);
    const minimum = Number(field.min);
    const maximum = Number(field.max);
    const value = Number.isFinite(field.valueAsNumber) ? Math.trunc(field.valueAsNumber) + delta : minimum;
    field.value = String(Math.min(maximum, Math.max(minimum, value)));
    onChange();
    if (this.disabled) field.focus({preventScroll: true});
  });
  ui.time.on('input', function (event) {
    const input = event.originalEvent;
    if (input?.isComposing || input?.inputType?.startsWith('delete') || this.selectionStart !== this.value.length) return;
    // Format a complete digit sequence without selecting native time segments.
    if (/^\d{3,4}$/.test(this.value)) {
      const split = this.value.length === 3 && Number(this.value.slice(0, 2)) > 23 ? 1 : 2;
      this.value = this.value.slice(0, split) + ':' + this.value.slice(split);
    }
  });
  ui.time.on('change', function () {
    const value = this.value.trim();
    const wholeHour = /^\d{1,2}$/.test(value) && Number(value) < 24
      ? value.padStart(2, '0') + ':00' : '';
    const time = parseStartTime(value) || wholeHour;
    if (time) this.value = time;
  });
  form.on('input change', 'input:not([name="room-choice"]), select, textarea', function (event) {
    $(this).removeClass('is-invalid');
    onChange(event.type === 'input' && this === ui.time[0] ? this : undefined);
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
    announce('Отправляем бронь администратору.');
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
    clearErrors(); filterSeats(); refreshConstraints(); renderEstimate(); renderInlineErrors(false); clearEntryQuery(); saveDraft();
    editing();
    announce('');
    ui.time.trigger('focus');
  });

  $(window).on('focus', refreshConstraints);
  const query = new URLSearchParams(window.location.search);
  const receiptEntry = query.has('paid') || query.has('reserved');
  const returningToCheckout = query.get('checkout') === '1';
  const restored = !receiptEntry ? readDraft() : {};
  if (restored.draft) applyDraft(restored.draft);
  const today = clubNow().date;
  const expiredDraft = restored.draft && validDate(ui.date.val()) && validTime(ui.time.val())
    && isPast(ui.date.val(), ui.time.val(), clubNow());
  if (expiredDraft) { ui.date.val(today); ui.time.val(''); }
  if (!ui.time.val() && ui.date.val() < today) ui.date.val(today);
  const queryMessage = applyQuery();
  filterSeats(); revealPreferences(); renderTariffOptions();
  if (query.get('mode') === 'hourly') ui.package.val('');
  refreshConstraints(); renderEstimate();
  if (ui.package.val() || query.get('mode') === 'packages' || window.location.hash === '#packages' || $("#preferences").prop('open')) {
    extras.prop('open', true);
  }
  clearEntryQuery();
  editing();
  announce(queryMessage);
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
  if (typeof dialog.showModal === 'function') {
    const checkoutConfig = await visitApi('visit-checkout/config').catch(() => null);
    checkoutAvailable = checkoutConfig?.available === true;
    checkoutPaymentsAvailable = checkoutAvailable && checkoutConfig.paymentsAvailable !== false;
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
