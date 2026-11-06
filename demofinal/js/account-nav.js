(() => {
  'use strict';

  const links = document.querySelectorAll('.pixel-account-link');
  if (!links.length) return;

  let timer;
  let checking = false;
  let checkAgain = false;

  function refreshSoon() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 80);
  }

  async function refresh() {
    if (checking) {
      checkAgain = true;
      return;
    }
    checking = true;
    try {
      const response = await fetch('./api/auth/session', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: AbortSignal.timeout?.(5000),
      });
      if (!response.ok) return;
      const data = await response.json();
      const signedIn = typeof data?.user?.uid === 'string' && Boolean(data.user.uid);
      if (!signedIn && data?.user !== null) return;
      const label = signedIn ? 'Личный кабинет · Вы вошли' : 'Личный кабинет';
      for (const link of links) {
        link.toggleAttribute('data-signed-in', signedIn);
        link.setAttribute('aria-label', label);
        link.title = label;
      }
    } catch {
      // A temporary connection problem does not change the last known session.
    } finally {
      checking = false;
      if (checkAgain) {
        checkAgain = false;
        refreshSoon();
      }
    }
  }

  window.addEventListener('focus', refreshSoon);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refreshSoon();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSoon();
  });
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel('pixel-account-session');
    channel.addEventListener('message', refreshSoon);
  }
  refreshSoon();
})();
