(() => {
  'use strict';

  const firebaseUrl = 'https://www.gstatic.com/firebasejs/13.2.0/';
  const ids = [
    'title', 'status', 'error', 'retry', 'entry', 'login-form', 'register-form', 'login', 'register',
    'show-login', 'show-register', 'login-email', 'register-email', 'google-option', 'google',
    'profile', 'name', 'email', 'balance', 'logout', 'topup-toggle', 'topup-form',
    'topup-amount', 'topup-submit', 'topup-status', 'topup-refresh', 'topup-resume', 'wallet-notice', 'wallet-retry',
    'checkout-return', 'visits', 'visits-list', 'visits-notice', 'visits-retry'
  ];
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById('account-' + id)]));
  const shell = document.querySelector('.account-shell');
  const amount = new Intl.NumberFormat('ru-RU');
  const query = new URL(location.href).searchParams;
  const returnsToBooking = query.get('return') === 'booking';
  const opensWallet = returnsToBooking && query.get('wallet') === '1';
  const returnsFromTopup = validOrderId(query.get('topup'));
  const visitOrder = query.get('visit');
  const returnPath = returnsToBooking ? 'booking.html?checkout=1'
    : query.get('return') === 'checkout' && /^[a-f0-9]{32}$/.test(visitOrder || '')
      ? 'checkout.html?visit=' + visitOrder : null;
  const googleErrors = {
    'auth/app-not-authorized': 'Вход через Google недоступен по этому адресу.',
    'auth/unauthorized-domain': 'Вход через Google недоступен по этому адресу.',
    'auth/network-request-failed': 'Проверьте подключение к интернету и повторите попытку.',
    'auth/popup-blocked': 'Разрешите всплывающие окна для PIXEL и повторите попытку.',
    'auth/popup-closed-by-user': 'Вход через Google отменён.'
  };

  let sdk;
  let auth;
  let busy = false;
  let passwordEnabled = true;
  let sessionCheck = false;
  let sessionRefreshPending = false;
  let sessionRevision = 0;
  let lastSessionCheck = 0;
  let methodsRequested = false;
  let topupDraft = null;
  let sessionChannel;
  try { sessionChannel = new BroadcastChannel('pixel-account-session'); }
  catch { /* Checking the server when the tab becomes visible also synchronizes sessions. */ }
  const sessionProblem = 'Не удалось проверить вход. Попробуйте ещё раз.';
  const loginCookieProblem = 'Не удалось сохранить вход в браузере. Нажмите «Повторить».';
  const wallet = {
    uid: null, busy: false, order: null, polling: null, timer: null, pollUntil: 0,
    revision: 0, state: null, loading: null, enabled: false
  };
  const topupMemory = 'pixel-wallet-topup';
  const formatMoney = value => amount.format(value) + '\u00a0₸';
  const visitDate = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'});
  const visitRooms = {standard: 'Standard', duo: 'Duo', vip: 'VIP'};
  const guestClaimsKey = 'pixel-visit-guest-reservations-v1';
  const visitAttemptsKey = 'pixel-visit-payment-request-v1';
  const guestProof = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const visitId = /^[a-f0-9]{32}$/;
  const visits = {entries: [], selected: null, loading: null};

  async function api(path, data, accountUid) {
    const options = {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout?.(15000)
    };
    if (accountUid) options.headers = { 'X-Pixel-Account': accountUid };
    if (data !== undefined) {
      options.method = 'POST';
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(data);
    }
    const response = await fetch('./api/' + path, options);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const error = new Error('Account request failed');
      error.status = response.status;
      error.code = payload?.code;
      if (typeof payload?.message === 'string') error.publicMessage = payload.message;
      throw error;
    }
    return payload;
  }

  const request = (action, data) => api('auth/' + action, data);

  async function readSession() {
    const { user } = await request('session');
    if (user !== null && (typeof user?.uid !== 'string' || !Number.isSafeInteger(user.balance))) {
      throw new Error('Invalid session response');
    }
    return user;
  }

  function syncControls() {
    ui.login.disabled = ui.register.disabled = busy || !passwordEnabled;
    ui.google.disabled = busy || !auth;
    ui['show-login'].disabled = ui['show-register'].disabled = busy;
    ui.logout.disabled = busy || wallet.busy;
    ui.retry.disabled = busy;
    ui['topup-toggle'].disabled = ui['topup-submit'].disabled = busy || wallet.busy;
    for (const button of ui['visits-list'].querySelectorAll('button')) {
      button.disabled = busy || wallet.busy || !!visits.loading;
    }
    ui['visits-retry'].disabled = busy || wallet.busy || !!visits.loading;
  }

  async function run(message, fallback, action) {
    if (busy) return false;
    busy = true;
    sessionRevision += 1;
    ui.error.textContent = '';
    ui.status.textContent = message;
    syncControls();
    try {
      await action();
      return true;
    } catch (error) {
      const googleMessage = Object.hasOwn(googleErrors, error?.code) && googleErrors[error.code];
      ui.error.textContent = error?.publicMessage || googleMessage || fallback;
      return false;
    } finally {
      ui.status.textContent = '';
      busy = false;
      syncControls();
      flushSessionRefresh();
    }
  }

  function showEntry(mode, focus = false) {
    const registering = mode === 'register';
    resetWallet(null);
    shell.classList.remove('account-signed-in');
    ui.entry.hidden = false;
    ui.profile.hidden = true;
    ui['login-form'].hidden = registering;
    ui['register-form'].hidden = !registering;
    ui.title.textContent = registering ? 'Создать аккаунт' : 'Войти в PIXEL';
    document.title = (registering ? 'Регистрация' : 'Вход') + ' | PIXEL';
    if (focus) ui.title.focus();
  }

  function showProfile(user, focus = false) {
    if (!user || typeof user.uid !== 'string' || !Number.isSafeInteger(user.balance)) {
      throw new Error('Invalid account profile');
    }
    resetWallet(user.uid);
    shell.classList.add('account-signed-in');
    ui.entry.hidden = true;
    ui.profile.hidden = false;
    ui.retry.hidden = true;
    ui.title.textContent = 'Личный кабинет';
    document.title = 'Личный кабинет | PIXEL';
    if (returnPath) {
      ui['checkout-return'].href = returnPath;
      ui['checkout-return'].hidden = false;
    }
    showBalance(user.balance);
    if (user.walletMode === 'test') {
      enableTopup();
      void loadVisits(user.uid);
    }
    for (const [id, value] of [['name', user.name], ['email', user.email]]) {
      ui[id].textContent = value || '';
      ui[id].closest('div').hidden = !value;
    }
    ui['login-form'].reset();
    ui['register-form'].reset();
    if (topupDraft?.uid === user.uid && user.walletMode === 'test') {
      ui['topup-amount'].value = String(topupDraft.amount);
      ui['topup-amount'].dispatchEvent(new Event('input'));
      setTopupOpen(true);
    }
    topupDraft = null;
    if (focus) ui.title.focus();
    void loadWallet(user.uid);
  }

  function switchEntry(from, to) {
    if (busy) return;
    ui.error.textContent = '';
    ui[to + '-email'].value = ui[from + '-email'].value;
    showEntry(to, true);
  }

  function showBalance(balance) {
    if (!Number.isSafeInteger(balance) || balance < 0) return;
    ui.balance.textContent = formatMoney(balance);
  }

  function walletMessage(id, message, state = '') {
    ui[id].textContent = message;
    ui[id].dataset.state = state;
  }

  function setTopupOpen(open) {
    ui['topup-toggle'].setAttribute('aria-expanded', String(open));
    ui['topup-toggle'].textContent = open ? 'Свернуть пополнение' : 'Пополнить баланс';
    ui['topup-form'].hidden = !open;
  }

  function resetWallet(uid) {
    if (wallet.uid === uid) return;
    clearTimeout(wallet.timer);
    Object.assign(wallet, {
      uid, order: null, polling: null, revision: 0, state: null, loading: null, enabled: false
    });
    ui['topup-toggle'].hidden = ui['topup-refresh'].hidden = ui['topup-resume'].hidden = true;
    setWalletNotice('');
    setTopupOpen(false);
    walletMessage('topup-status', '');
    Object.assign(visits, {entries: [], selected: null, loading: null});
    ui['visits-list'].replaceChildren();
    ui['visits'].hidden = ui['visits-retry'].hidden = true;
    walletMessage('visits-notice', '');
  }

  function readWalletMemory(key) {
    try {
      const value = JSON.parse(sessionStorage.getItem(key));
      return value?.uid === wallet.uid ? value : null;
    } catch { return null; }
  }

  function writeWalletMemory(key, value) {
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify({ ...value, uid: wallet.uid }));
      else sessionStorage.removeItem(key);
    } catch {
      // An explicit return link also identifies the payment.
    }
  }

  function validOrderId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(id);
  }

  function finishTopup(order) {
    wallet.order = null;
    ui['topup-refresh'].hidden = ui['topup-resume'].hidden = true;
    writeWalletMemory(topupMemory, null);
    const url = new URL(location.href);
    if (url.searchParams.get('topup') === order) {
      url.searchParams.delete('topup');
      history.replaceState(history.state, '', url);
    }
  }

  async function checkTopup() {
    clearTimeout(wallet.timer);
    const order = wallet.order;
    if (!order || wallet.polling === order) return;
    const revision = wallet.revision;
    wallet.polling = order;
    ui['topup-refresh'].disabled = true;
    try {
      const result = await api('account/topups/' + encodeURIComponent(order));
      if (wallet.order !== order) return;
      if (result.id !== order || !Number.isSafeInteger(result.amount)) throw new Error('Invalid payment');
      if (wallet.revision === revision) {
        wallet.revision += 1;
        showBalance(result.balance);
      } else {
        void loadWallet(wallet.uid);
      }
      if (result.status === 'paid') {
        walletMessage('topup-status', 'Баланс пополнен на ' + formatMoney(result.amount) + '.', 'success');
        finishTopup(order);
      } else if (result.status === 'pending') {
        walletMessage('topup-status', 'Ждём подтверждение оплаты.');
        ui['topup-resume'].hidden = false;
        if (Date.now() < wallet.pollUntil) wallet.timer = setTimeout(checkTopup, 1800);
      } else {
        walletMessage('topup-status', 'Оплата не завершена.', 'error');
        finishTopup(order);
      }
    } catch (error) {
      if (wallet.order !== order) return;
      walletMessage('topup-status', 'Не удалось проверить оплату.', 'error');
      if (error.status === 404) finishTopup(order);
    } finally {
      if (wallet.polling === order) wallet.polling = null;
      ui['topup-refresh'].disabled = false;
    }
  }

  function resumeTopup() {
    const returned = new URL(location.href).searchParams.get('topup');
    const order = returned || readWalletMemory(topupMemory)?.order;
    if (!validOrderId(order)) return;
    if (wallet.order === order) {
      void checkTopup();
      return;
    }
    wallet.order = order;
    wallet.pollUntil = Date.now() + 25000;
    ui['topup-refresh'].hidden = false;
    ui['topup-resume'].hidden = true;
    const checkout = new URL('checkout.html', document.baseURI);
    checkout.searchParams.set('order', order);
    if (returnsToBooking) checkout.searchParams.set('return', 'booking');
    ui['topup-resume'].href = checkout.href;
    walletMessage('topup-status', 'Проверяем оплату…');
    void checkTopup();
  }

  function setWalletNotice(message, canRetry = false) {
    ui['wallet-notice'].textContent = message;
    ui['wallet-retry'].hidden = !canRetry;
  }

  function enableTopup() {
    if (!wallet.enabled && opensWallet && !returnsFromTopup) setTopupOpen(true);
    wallet.enabled = true;
    ui['topup-toggle'].hidden = false;
  }

  async function loadWallet(uid) {
    if (!uid || wallet.loading) return;
    const revision = wallet.revision;
    const current = () => wallet.uid === uid && wallet.revision === revision;
    const pending = api('account/wallet');
    wallet.loading = pending;
    if (!wallet.state) setWalletNotice('Загружаем кошелёк…');
    ui['wallet-retry'].disabled = true;
    try {
      const data = await pending;
      if (!current()) return;
      if (data.mode !== 'test' || !Number.isSafeInteger(data.balance) || data.balance < 0) {
        throw new Error('Invalid wallet data');
      }
      wallet.revision += 1;
      wallet.state = 'ready';
      showBalance(data.balance);
      setWalletNotice('');
      enableTopup();
      resumeTopup();
    } catch (error) {
      if (!current()) return;
      if (error.status === 404 && !wallet.enabled) {
        wallet.state = 'off';
        ui['topup-toggle'].hidden = true;
        setTopupOpen(false);
        setWalletNotice('Пополнение доступно в локальной версии.');
      } else if (error.status === 401) {
        setWalletNotice('Не удалось подтвердить вход для кошелька.', true);
      } else {
        setWalletNotice('Не удалось обновить кошелёк.', true);
      }
    } finally {
      if (wallet.loading === pending) {
        wallet.loading = null;
        ui['wallet-retry'].disabled = false;
      }
    }
  }

  async function walletAction(statusId, progress, fallback, action) {
    if (busy || wallet.busy) return false;
    const uid = wallet.uid;
    wallet.busy = true;
    walletMessage(statusId, progress);
    syncControls();
    try {
      await action();
      return true;
    } catch (error) {
      if (wallet.uid === uid && !ui.profile.hidden) {
        walletMessage(statusId, error.publicMessage || fallback, 'error');
      }
      return false;
    } finally {
      wallet.busy = false;
      syncControls();
      flushSessionRefresh();
    }
  }

  function readGuestClaims() {
    try {
      const claims = JSON.parse(localStorage.getItem(guestClaimsKey));
      return Array.isArray(claims) ? claims.filter(claim => guestProof.test(claim?.requestId)) : [];
    } catch { return []; }
  }

  function readVisitAttempts() {
    try { return JSON.parse(sessionStorage.getItem(visitAttemptsKey)); }
    catch { return null; }
  }

  function forgetGuestClaim(requestId) {
    try {
      const claims = readGuestClaims().filter(claim => claim.requestId !== requestId);
      if (claims.length) localStorage.setItem(guestClaimsKey, JSON.stringify(claims));
      else localStorage.removeItem(guestClaimsKey);
    } catch { /* The server can safely recheck an already claimed visit. */ }
    try {
      const attempts = readVisitAttempts();
      if (attempts?.reserve?.id === requestId) {
        delete attempts.reserve;
        sessionStorage.setItem(visitAttemptsKey, JSON.stringify(attempts));
      }
    } catch { /* Older requests might still be available in the current tab. */ }
  }

  async function claimGuestVisits(uid) {
    const requests = new Set(readGuestClaims().map(claim => claim.requestId));
    const legacyProof = readVisitAttempts()?.reserve?.id;
    if (guestProof.test(legacyProof)) requests.add(legacyProof);
    for (const requestId of requests) {
      if (wallet.uid !== uid) return;
      try { await api('visit-checkout/reservations/claim', { requestId }, uid); }
      catch (error) { if (error.status !== 404) throw error; }
      forgetGuestClaim(requestId);
    }
  }

  function isActiveVisit(visit) {
    const plan = visit?.plan;
    return visitId.test(visit?.id) && (
      (visit.kind === 'reservation' && visit.status === 'reserved') ||
      (visit.kind === 'order' && visit.status === 'paid' && ['card', 'balance'].includes(visit.method))
    ) && plan && Object.hasOwn(visitRooms, plan.room) && Number.isSafeInteger(plan.guests)
      && /^\d{4}-\d{2}-\d{2}$/.test(plan.date) && Number.isFinite(Date.parse(plan.date))
      && /^\d{2}:\d{2}$/.test(plan.time) && Number.isSafeInteger(visit.amount);
  }

  function createVisitAction(visit, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'visit-link';
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.visit = visit.id;
    return button;
  }

  function renderVisit(visit) {
    const {plan} = visit;
    const date = visitDate.format(new Date(plan.date + 'T00:00:00Z'));
    const label = date + ', ' + plan.time;
    const row = document.createElement('li');
    const summary = document.createElement('div');
    const title = document.createElement('p');
    const titleText = document.createElement('strong');
    titleText.textContent = label;
    title.append(titleText);
    const details = document.createElement('p');
    details.className = 'account-visit-details';
    details.textContent = visitRooms[plan.room] + ' · ' + plan.guests + ' ПК';
    summary.append(title, details);
    row.append(summary);

    if (visits.selected === visit.id) {
      const confirmation = document.createElement('div');
      confirmation.className = 'account-visit-confirm';
      const note = document.createElement('p');
      note.textContent = visit.method === 'balance'
        ? 'На баланс вернётся ' + formatMoney(visit.amount) + '.'
        : 'Отменить визит ' + label + '?';
      const actions = document.createElement('div');
      actions.className = 'account-visit-actions';
      const confirm = createVisitAction(visit, 'Подтвердить отмену', 'confirm');
      confirm.classList.add('account-visit-cancel');
      actions.append(createVisitAction(visit, 'Сохранить запись', 'back'), confirm);
      confirmation.append(note, actions);
      row.append(confirmation);
    } else {
      const button = createVisitAction(visit, 'Отменить запись', 'select');
      button.classList.add('account-visit-cancel');
      button.setAttribute('aria-label', 'Отменить запись ' + label);
      row.append(button);
    }
    return row;
  }

  function renderVisits(focusSelector) {
    ui['visits-list'].replaceChildren(...visits.entries.map(renderVisit));
    ui['visits'].hidden = !visits.entries.length && !ui['visits-notice'].textContent;
    syncControls();
    if (focusSelector) (ui['visits-list'].querySelector(focusSelector) || ui['visits-notice']).focus();
  }

  function visitNotice(message, state = '', canRetry = false) {
    walletMessage('visits-notice', message, state);
    ui['visits-retry'].hidden = !canRetry;
  }

  async function loadVisits(uid) {
    if (wallet.uid !== uid || visits.loading || wallet.busy) return;
    const pending = (async () => {
      const claimFailed = await claimGuestVisits(uid).then(() => false, () => true);
      const data = await api('visit-checkout/visits', undefined, uid);
      if (!Array.isArray(data.visits) || !data.visits.every(isActiveVisit)) throw new Error('Invalid visits');
      return {entries: data.visits, claimFailed};
    })();
    visits.loading = pending;
    const current = () => wallet.uid === uid && visits.loading === pending;
    try {
      const {entries, claimFailed} = await pending;
      if (!current()) return;
      visits.entries = entries;
      if (!entries.some(visit => visit.id === visits.selected)) visits.selected = null;
      if (claimFailed) visitNotice('Не удалось загрузить гостевую бронь.', 'error', true);
      else if (ui['visits-notice'].dataset.state === 'error') visitNotice('');
    } catch (error) {
      if (!current()) return;
      visits.entries = [];
      visits.selected = null;
      if (error.status === 404) visitNotice('');
      else visitNotice('Не удалось загрузить визиты.', 'error', true);
    } finally {
      if (current()) {
        visits.loading = null;
        renderVisits();
      }
    }
  }

  async function cancelVisit(visit) {
    if (visits.loading || wallet.busy || busy) return;
    const uid = wallet.uid;
    const succeeded = await walletAction('visits-notice', 'Отменяем запись…', 'Не удалось отменить запись.', async () => {
      const path = 'visit-checkout/visits/' + visit.kind + '/' + visit.id + '/cancel';
      const result = await api(path, {}, uid);
      if (result.id !== visit.id || result.status !== 'cancelled' || !Number.isSafeInteger(result.balance)) {
        throw new Error('Invalid cancellation');
      }
      if (wallet.uid !== uid) return;
      wallet.revision += 1;
      showBalance(result.balance);
      visits.selected = null;
      visits.entries = visits.entries.filter(entry => entry.id !== visit.id);
      visitNotice('Запись отменена.', 'success');
    });
    if (wallet.uid === uid) {
      renderVisits(succeeded ? '[data-action="select"]' : '[data-action="confirm"]');
      if (succeeded) void loadWallet(uid);
    }
  }

  async function createTopup(amount) {
    const path = 'account/topups';
    const data = { amount };
    const uid = wallet.uid;
    try {
      return await api(path, data, uid);
    } catch (error) {
      if (error.status !== 401 && error.code !== 'account_changed') throw error;
    }

    let user;
    try { user = await readSession(); }
    catch { throw Object.assign(new Error('Session check failed'), { publicMessage: sessionProblem }); }
    if (!user || user.uid !== uid) {
      sessionRevision += 1;
      if (!user) {
        topupDraft = { uid, amount };
        showEntry('login', true);
        ui.error.textContent = 'Вход больше не действует. Войдите снова, чтобы продолжить пополнение.';
        void loadSignInMethods();
      } else {
        showProfile(user, true);
        ui.error.textContent = 'Аккаунт в браузере изменился. Проверьте, в какой профиль вы вошли.';
      }
      throw new Error('Session changed before wallet operation');
    }

    // Session errors come before any wallet write. Retry once for the same account.
    try {
      return await api(path, data, uid);
    } catch (error) {
      if (error.status === 401) error.publicMessage = 'Кошелёк не получил подтверждение входа. Попробуйте ещё раз.';
      throw error;
    }
  }

  async function loadGoogle(config) {
    if (!config?.enabled || !config.firebase || config.googleEnabled === false || auth) return;
    try {
      const [{ initializeApp }, authModule] = await Promise.all([
        import(firebaseUrl + 'firebase-app.js'),
        import(firebaseUrl + 'firebase-auth.js')
      ]);
      sdk = authModule;
      auth = sdk.initializeAuth(initializeApp(config.firebase), {
        persistence: sdk.inMemoryPersistence,
        popupRedirectResolver: sdk.browserPopupRedirectResolver
      });
      auth.languageCode = 'ru';
      ui['google-option'].hidden = false;
      syncControls();
    } catch {
      // Email and password remain available if the optional Google SDK fails to load.
    }
  }

  async function loadSignInMethods() {
    if (methodsRequested) return;
    methodsRequested = true;
    const config = await request('config').catch(() => null);
    if (!config) methodsRequested = false;
    passwordEnabled = config?.passwordEnabled !== false;
    if (!passwordEnabled && !ui.entry.hidden) ui.error.textContent = 'Откройте PIXEL по HTTPS, чтобы войти.';
    syncControls();
    void loadGoogle(config);
  }

  function flushSessionRefresh() {
    if (!sessionRefreshPending || busy || wallet.busy || sessionCheck) return;
    sessionRefreshPending = false;
    void refreshSession(true);
  }

  async function refreshSession(force = false) {
    if (busy || wallet.busy || sessionCheck) {
      if (force) sessionRefreshPending = true;
      return;
    }
    if (!force && Date.now() - lastSessionCheck < 500) return;
    lastSessionCheck = Date.now();
    sessionCheck = true;
    const revision = sessionRevision;
    const initial = ui.entry.hidden && ui.profile.hidden;
    if (initial) ui.status.textContent = 'Проверяем вход…';
    ui.retry.disabled = true;
    try {
      const user = await readSession();
      if (sessionRevision !== revision) return;
      if (ui.error.textContent === sessionProblem || (user && ui.error.textContent === loginCookieProblem)) {
        ui.error.textContent = '';
      }
      ui.retry.hidden = true;
      if (user) {
        if (ui.profile.hidden || wallet.uid !== user.uid) showProfile(user);
        else {
          if (user.walletMode === 'test') {
            enableTopup();
            void loadVisits(user.uid);
          }
          void loadWallet(user.uid);
        }
      } else {
        if (ui.entry.hidden) showEntry('login');
        void loadSignInMethods();
      }
    } catch {
      if (sessionRevision === revision) {
        ui.error.textContent = sessionProblem;
        ui.retry.hidden = false;
      }
    } finally {
      sessionCheck = false;
      if (initial && sessionRevision === revision) ui.status.textContent = '';
      syncControls();
      flushSessionRefresh();
    }
  }

  function signalSessionChange() {
    sessionChannel?.postMessage('changed');
  }

  async function finishLogin(expectedUser) {
    let user;
    try { user = await readSession(); }
    catch { /* Leave the login form open so the browser session can be checked again. */ }
    if (!user || user.uid !== expectedUser?.uid) {
      ui.retry.hidden = false;
      throw Object.assign(new Error('Browser session not confirmed'), { publicMessage: loginCookieProblem });
    }
    signalSessionChange();
    if (returnPath && !opensWallet && !returnsFromTopup && topupDraft?.uid !== user.uid) location.assign(returnPath);
    else showProfile(user, true);
  }

  async function submit(event, action) {
    event.preventDefault();
    if (busy || !passwordEnabled) return;
    const values = new FormData(event.currentTarget);
    const data = {
      email: values.get('email').trim(),
      password: values.get('password')
    };
    if (action === 'register') data.name = '';
    const progress = action === 'register' ? 'Создаём аккаунт…' : 'Входим…';
    const fallback = action === 'register' ? 'Не удалось создать аккаунт.' : 'Не удалось войти.';
    const succeeded = await run(progress, fallback, async () => {
      const { user } = await request(action, data);
      await finishLogin(user);
    });
    if (!succeeded) ui[action].focus();
  }

  ui['login-form'].addEventListener('submit', event => submit(event, 'login'));
  ui['register-form'].addEventListener('submit', event => submit(event, 'register'));
  ui['show-register'].addEventListener('click', () => switchEntry('login', 'register'));
  ui['show-login'].addEventListener('click', () => switchEntry('register', 'login'));
  ui.retry.addEventListener('click', () => refreshSession(true));
  ui['wallet-retry'].addEventListener('click', () => loadWallet(wallet.uid));
  ui['visits-retry'].addEventListener('click', () => loadVisits(wallet.uid));

  ui['visits-list'].addEventListener('click', event => {
    const button = event.target.closest('button[data-visit]');
    if (!button || busy || wallet.busy || visits.loading) return;
    const visit = visits.entries.find(entry => entry.id === button.dataset.visit);
    if (!visit) return;
    if (button.dataset.action === 'confirm') {
      void cancelVisit(visit);
      return;
    }
    const selecting = button.dataset.action === 'select';
    visits.selected = selecting ? visit.id : null;
    renderVisits('[data-action="' + (selecting ? 'back' : 'select') + '"][data-visit="' + visit.id + '"]');
  });

  ui['topup-toggle'].addEventListener('click', () => {
    const opening = ui['topup-form'].hidden;
    setTopupOpen(opening);
    if (opening) (ui['topup-form'].querySelector('input[name="preset"]:checked') || ui['topup-amount']).focus();
  });

  ui['topup-form'].addEventListener('change', event => {
    if (event.target.name === 'preset') ui['topup-amount'].value = event.target.value;
  });

  ui['topup-amount'].addEventListener('input', () => {
    for (const preset of ui['topup-form'].querySelectorAll('input[name="preset"]')) {
      preset.checked = preset.value === ui['topup-amount'].value;
    }
  });

  ui['topup-form'].addEventListener('submit', async event => {
    event.preventDefault();
    const value = ui['topup-amount'].valueAsNumber;
    if (!Number.isSafeInteger(value) || value < 100 || value > 50000) return;
    const succeeded = await walletAction('topup-status', 'Открываем оплату…', 'Не удалось открыть оплату.', async () => {
      const data = await createTopup(value);
      if (!validOrderId(data.id) || typeof data.checkoutUrl !== 'string') throw new Error('Invalid checkout');
      const checkout = new URL(data.checkoutUrl, document.baseURI);
      if (checkout.origin !== location.origin ||
          checkout.pathname !== new URL('checkout.html', document.baseURI).pathname ||
          checkout.searchParams.get('order') !== data.id) throw new Error('Invalid checkout URL');
      if (returnsToBooking) checkout.searchParams.set('return', 'booking');
      writeWalletMemory(topupMemory, { order: data.id });
      location.assign(checkout.href);
    });
    if (!succeeded) ui['topup-submit'].focus();
  });

  ui['topup-refresh'].addEventListener('click', () => {
    wallet.pollUntil = Date.now() + 25000;
    void checkTopup();
  });

  ui.google.addEventListener('click', async () => {
    if (!auth || busy) return;
    const signedIn = await run('Открываем вход через Google…', 'Не удалось войти через Google.', async () => {
      const { user } = await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
      try {
        const session = await request('session', { idToken: await user.getIdToken() });
        await finishLogin(session.user);
      } finally {
        await sdk.signOut(auth).catch(() => {});
      }
    });
    if (!signedIn) ui.google.focus();
  });

  ui.logout.addEventListener('click', async () => {
    const signedOut = await run('Выходим из аккаунта…', 'Не удалось выйти. Попробуйте ещё раз.', async () => {
      await request('logout', {});
      topupDraft = null;
      const url = new URL(location.href);
      url.searchParams.delete('topup');
      history.replaceState(history.state, '', url);
      showEntry('login', true);
      ui.retry.hidden = true;
      void loadSignInMethods();
      signalSessionChange();
    });
    if (!signedOut) ui.logout.focus();
  });

  window.addEventListener('pageshow', event => {
    if (event.persisted) void refreshSession(true);
  });
  window.addEventListener('focus', () => { if (!document.hidden) void refreshSession(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshSession(); });
  sessionChannel?.addEventListener('message', event => {
    if (event.data === 'changed') void refreshSession(true);
  });
  void refreshSession(true);
})();
