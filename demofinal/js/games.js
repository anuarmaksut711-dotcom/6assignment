'use strict';
(() => {
  const catalog = [
    {
      id: 'cs2', anchor: 'game-1', name: 'Counter-Strike 2', category: 'shooters',
      genre: 'Шутер', aliases: 'Counter-Strike 2 CS2 CS 2 КС2 КС 2 Counter Strike', artwork: 'cs2.jpg'
    },
    {
      id: 'fortnite', anchor: 'game-2', name: 'Fortnite', category: 'battle-royale',
      genre: 'Королевская битва', aliases: 'Fortnite Фортнайт', artwork: 'fortnite.jpg'
    },
    {
      id: 'minecraft', anchor: 'game-3', name: 'Minecraft', category: 'sandbox',
      genre: 'Песочница', aliases: 'Minecraft Майнкрафт', artwork: 'minecraft.jpg'
    },
    {
      id: 'dota2', anchor: 'game-4', name: 'Dota 2', category: 'moba',
      genre: 'Командная стратегия (MOBA)', aliases: 'Dota 2 Dota2 Дота Дота2 Дота 2', artwork: 'dota2.jpg'
    },
    {
      id: 'valorant', anchor: 'game-5', name: 'Valorant', category: 'shooters',
      genre: 'Тактический шутер', aliases: 'Valorant Валорант', artwork: 'valorant.webp', logo: true
    },
    {
      id: 'gtav', anchor: 'game-6', name: 'GTA V', category: 'action',
      genre: 'Экшен', aliases: 'GTA V GTA 5 ГТА ГТА 5 Grand Theft Auto', artwork: 'gtav.jpg'
    },
    {
      id: 'gtaonline', anchor: 'game-7', name: 'GTA Online', category: 'action',
      genre: 'Экшен', aliases: 'GTA Online GTA Онлайн ГТА Онлайн Grand Theft Auto', artwork: 'gtav.jpg'
    },
    {
      id: 'pubg', anchor: 'game-8', name: 'PUBG', category: 'battle-royale',
      genre: 'Королевская битва', aliases: 'PUBG Пабг', artwork: 'pubg.jpg'
    },
    {
      id: 'apex', anchor: 'game-9', name: 'Apex Legends', category: 'battle-royale',
      genre: 'Королевская битва', aliases: 'Apex Legends Apex Апекс', artwork: 'apex.jpg'
    },
    {
      id: 'lol', anchor: 'game-10', name: 'League of Legends', category: 'moba',
      genre: 'Командная стратегия (MOBA)', aliases: 'League of Legends LoL Лига Легенд ЛОЛ', artwork: 'lol.webp', logo: true
    },
    {
      id: 'rust', anchor: 'game-11', name: 'Rust', category: 'sandbox',
      genre: 'Выживание', aliases: 'Rust Раст', artwork: 'rust.jpg'
    },
    {
      id: 'roblox', anchor: 'game-12', name: 'Roblox', category: 'sandbox',
      genre: 'Песочница', aliases: 'Roblox Роблокс', artwork: 'roblox.svg', logo: true
    },
    {
      id: 'fc', anchor: 'game-13', name: 'EA Sports FC', category: 'sports-simulation',
      genre: 'Спорт', aliases: 'EA Sports FC FC FIFA ФИФА', artwork: 'fc.svg', logo: true
    },
    {
      id: 'cod', anchor: 'game-14', name: 'Call of Duty', category: 'shooters',
      genre: 'Шутер', aliases: 'Call of Duty COD Кол оф Дьюти', artwork: 'cod.jpg'
    },
    {
      id: 'r6', anchor: 'game-15', name: 'Rainbow Six Siege', category: 'shooters',
      genre: 'Тактический шутер', aliases: 'Rainbow Six Siege R6 Радуга Рейнбоу', artwork: 'r6.jpg'
    },
    {
      id: 'overwatch2', anchor: 'game-16', name: 'Overwatch 2', category: 'shooters',
      genre: 'Геройский шутер', aliases: 'Overwatch 2 Overwatch2 Овервотч Овервотч 2', artwork: 'overwatch2.jpg'
    },
    {
      id: 'rocketleague', anchor: 'game-17', name: 'Rocket League', category: 'sports-simulation',
      genre: 'Спорт', aliases: 'Rocket League Рокет Лига', artwork: 'rocketleague.jpg'
    },
    {
      id: 'warthunder', anchor: 'game-18', name: 'War Thunder', category: 'sports-simulation',
      genre: 'Боевой симулятор', aliases: 'War Thunder Вар Тандер Вартандер', artwork: 'warthunder.jpg'
    },
    {
      id: 'ets2', anchor: 'game-19', name: 'Euro Truck Simulator 2', category: 'sports-simulation',
      genre: 'Автосимулятор', aliases: 'Euro Truck Simulator 2 ETS2 ETS 2 Евро Трак', artwork: 'ets2.jpg'
    },
    {
      id: 'chrome', anchor: 'game-20', name: 'Google Chrome', category: 'apps',
      genre: 'Браузер', aliases: 'Google Chrome Chrome Гугл Хром Браузер', artwork: 'chrome.svg', logo: true
    }
  ];

  const search = document.getElementById('games-search');
  if (!search) return;

  const tools = document.getElementById('games-tools');
  const category = document.getElementById('games-category');
  const games = document.getElementById('games-list');
  const apps = document.getElementById('apps-list');
  const gamesHeading = document.getElementById('games-heading');
  const appsSection = document.getElementById('apps-section');
  const empty = document.getElementById('games-empty');
  const results = document.getElementById('games-results');
  const resetButton = document.getElementById('games-reset');
  const section = tools.closest('section');
  const categories = new Map([...category.options].map(option => [option.value, option.textContent]));
  const filters = node('div', 'd-flex flex-wrap gap-2 mt-3');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Применённые фильтры');
  tools.append(filters);

  function node(tag, classes, label = '') {
    const element = document.createElement(tag);
    element.className = classes;
    element.textContent = label;
    return element;
  }

  function visible(element, show) {
    element.hidden = false;
    element.classList.toggle('d-none', !show);
  }

  function normalize(value) {
    return value.normalize('NFKC').toLocaleLowerCase('ru-RU').trim().replace(/\s+/g, ' ');
  }

  function renderCards(container, items) {
    const cards = document.createDocumentFragment();
    for (const item of items) {
      const listItem = node('li', 'col');
      listItem.dataset.gameId = item.id;
      listItem.dataset.gameCategory = item.category;
      listItem.dataset.gameSearch = item.aliases;

      const card = node('article', 'pixel-game-card card pixel-device-card h-100 p-4');
      card.id = item.anchor;

      const image = node('img', item.logo ? 'game-art game-art-logo' : 'game-art');
      image.src = `assets/games/${item.artwork}`;
      image.alt = '';
      image.width = 460;
      image.height = 215;
      image.loading = 'lazy';
      image.decoding = 'async';
      card.append(image);

      const app = item.category === 'apps';
      if (app) card.append(node('p', 'pixel-accent small mb-3', 'Приложение'));
      const actionLabel = app ? 'Добавить к пожеланиям' : 'Выбрать для визита';
      const action = node('a', 'pixel-game-action btn btn-outline-light mt-auto', actionLabel);
      action.href = `booking.html?game=${encodeURIComponent(item.id)}`;
      action.setAttribute('aria-label', `${actionLabel}: ${item.name}`);

      card.append(node('h2', 'h3 mb-3', item.name),
        node('p', 'text-body-secondary small mb-3', item.genre), action);
      listItem.append(card);
      cards.append(listItem);
    }
    container.replaceChildren(cards);
    return items.length;
  }

  function filterButton(field, label) {
    const button = node('button', 'btn btn-sm btn-outline-light text-start text-break', `${label} ×`);
    button.type = 'button';
    button.dataset.clearGameFilter = field;
    button.setAttribute('aria-label', `${label}. Снять фильтр`);
    return button;
  }

  function applyFilters() {
    const query = search.value.trim();
    const genre = category.value;
    const words = normalize(query).split(' ').filter(Boolean);
    const filtered = catalog.filter(item => {
      if (genre !== 'all' && item.category !== genre) return false;
      const aliases = normalize(item.aliases);
      return words.every(word => aliases.includes(word));
    });
    const gameCount = renderCards(games, filtered.filter(item => item.category !== 'apps'));
    const appCount = renderCards(apps, filtered.filter(item => item.category === 'apps'));
    results.textContent = `Показано: ${gameCount + appCount} из ${catalog.length}`;
    visible(games, gameCount > 0);
    visible(gamesHeading, gameCount > 0);
    visible(appsSection, appCount > 0);
    visible(empty, filtered.length === 0);

    const activeFilters = [];
    if (query) activeFilters.push(filterButton('search', `Поиск: «${query}»`));
    if (genre !== 'all') activeFilters.push(filterButton('category', `Жанр: ${categories.get(genre)}`));
    filters.replaceChildren(...activeFilters);
    visible(filters, activeFilters.length > 0);
    resetButton.disabled = activeFilters.length === 0;

    // Keep a shareable filter state without adding a history entry for each keystroke.
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    if (genre !== 'all') url.searchParams.set('genre', genre);
    else url.searchParams.delete('genre');
    if (url.href !== window.location.href) {
      try { window.history.replaceState(window.history.state, '', url); }
      catch { /* Filtering also works when the browser disallows URL updates. */ }
    }
  }

  function restoreFilters() {
    const params = new URLSearchParams(window.location.search);
    const genre = params.get('genre');
    search.value = (params.get('q') || '').slice(0, search.maxLength);
    category.value = categories.has(genre) ? genre : 'all';
    applyFilters();
  }

  search.addEventListener('input', applyFilters);
  category.addEventListener('change', applyFilters);
  section.addEventListener('click', event => {
    const control = event.target.closest('button[data-clear-game-filter], #games-reset, #games-empty-reset');
    if (!control) return;
    const field = control.dataset.clearGameFilter;
    if (field !== 'category') search.value = '';
    if (field !== 'search') category.value = 'all';
    applyFilters();
    (field === 'category' ? category : search).focus();
  });
  window.addEventListener('popstate', restoreFilters);
  visible(tools, true);
  visible(results, true);
  restoreFilters();
})();
