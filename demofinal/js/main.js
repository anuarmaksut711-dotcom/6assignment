'use strict';
// jQuery 3.7.1 (full CDN build, including effects) must load before this file.
// ready waits for the existing DOM before selecting or binding its controls.
$(function () {
  function node(tag, text = '', classes = '') {
    return $(`<${tag}>`).text(text).addClass(classes);
  }

  function show(element, visible) {
    $(element).removeAttr('hidden').toggleClass('d-none', !visible);
    return visible;
  }
  function money(amount) { return `${new Intl.NumberFormat('ru-RU').format(amount)} ₸`; }
  function reference() { return Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0').toUpperCase(); }
  window.PixelMain = Object.freeze({node, show, money, reference});
  $('[hidden]').removeAttr('hidden').addClass('d-none');
  function update() {
    const state = window.PixelCart?.getSnapshot();
    const links = $('nav').find('a[href="booking.html"]');
    if (state?.count) links.attr('title', `Выбрано пакетов: ${state.count}, ${money(state.total)}`);
    else links.removeAttr('title');
  }
  $(window).on('pixel:cartchange', update);
  update();

  const roomsIntro = $('.rooms-intro');
  if (roomsIntro.length) {
    $('#standard .room-title p').text('Основной зал');
    $('#duo .room-title p').text('Для игры вдвоём');
    $('#vip .room-title p').text('Самые мощные ПК клуба');

    const shortcuts = node('nav', '', 'd-flex d-md-none flex-wrap gap-2 mb-3')
      .attr({id: 'room-shortcuts', 'aria-label': 'Перейти к залу'});
    $('.room-editorial > article[id]').each(function () {
      this.tabIndex = -1;
      shortcuts.append(node('a', $(this).find('h2').first().text(), 'btn btn-outline-light col px-2')
        .attr('href', `#${this.id}`));
    });
    roomsIntro.find('h1').after(shortcuts);

    function markSelectedRoom() {
      shortcuts.children('a').each(function () {
        const link = $(this);
        const selected = link.attr('href') === window.location.hash;
        link.toggleClass('btn-primary', selected).toggleClass('btn-outline-light', !selected)
          .attr('aria-current', selected ? 'location' : null);
      });
    }
    $(window).on('hashchange', markSelectedRoom);
    markSelectedRoom();
  }

  const questions = $('.pixel-disclosure');
  if (!questions.length) return;

  const section = questions.first().closest('section');
  const bookingSteps = $('#help-booking-title').closest('.row');
  bookingSteps.find('p').first().text('Регистрация не нужна. Выберите зал и время, проверьте стоимость и сохраните план визита.');
  bookingSteps.find('ol > li').last().contents().filter(function () {
    return this.nodeType === Node.TEXT_NODE;
  }).last().replaceWith(' Номер ПК, игра и места рядом необязательны. Укажите имя и телефон, затем проверьте план.');
  questions.children('summary').filter(function () {
    return $(this).text() === 'Когда бронь подтверждена?';
  }).each(function () {
    const summary = $(this);
    const paragraph = summary.siblings('p').first();
    const phone = paragraph.find('a[href^="tel:"]').detach();
    summary.text('Как подтвердить визит?');
    paragraph.empty()
      .append('Кнопка «Сохранить план» оставляет расчёт на этом устройстве. Для подтверждения визита, изменения времени или отмены позвоните в клуб: ')
      .append(phone)
      .append('. Если вы отправили заявку, дождитесь подтверждения клуба по телефону.');
  });

  const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
  questions.each(function () {
    const details = $(this);
    const summary = details.children('summary');
    const answer = $('<div>').append(details.children().not('summary'));
    const open = details.prop('open');
    answer.toggleClass('d-none', !open).appendTo(details);
    summary.attr('aria-expanded', String(open));
  });
  function setExpanded(summary, opening, animate = true) {
    const details = summary.closest('details');
    const answer = summary.siblings('div');
    answer.stop(true, true);
    summary.attr('aria-expanded', String(opening));
    if (opening) {
      details.prop('open', true);
      answer.removeClass('d-none').removeAttr('style');
      if (animate) {
        answer.hide().slideDown(duration(), function () {
          $(this).removeAttr('style');
        });
      }
    } else {
      answer.slideUp(duration(), function () {
        details.prop('open', false);
        $(this).addClass('d-none').removeAttr('style');
      });
    }
  }
  section.on('click', '.pixel-disclosure > summary', function (event) {
    // Keep native keyboard activation, but close <details> after the answer collapses.
    event.preventDefault();
    const summary = $(this);
    setExpanded(summary, summary.attr('aria-expanded') !== 'true');
  });

  const fieldId = 'help-question-search';
  const search = $('<input>').attr({id: fieldId, type: 'search', placeholder: 'Например, пакеты или оплата'})
    .addClass('form-control');
  const reset = node('button', 'Сбросить', 'btn btn-outline-secondary').attr('type', 'button').prop('disabled', true);
  const status = node('p', '', 'text-body-secondary small mb-0').attr('role', 'status');
  const empty = node('p', 'Ничего не найдено. Попробуйте другое слово.', 'alert alert-secondary mt-3 mb-0 d-none');
  const searchForm = $('<form>').attr({role: 'search', 'aria-label': 'Поиск по вопросам'})
    .addClass('mb-3')
    .append(node('label', 'Поиск по вопросам', 'form-label fw-bold').attr('for', fieldId))
    .append($('<div>').addClass('input-group mb-2').append(search, reset), status, empty)
    .insertBefore(questions.first());

  function searchable(text) {
    return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
  }
  const searchIndex = new Map(questions.toArray().map(question => [question, searchable($(question).text())]));
  function filterQuestions() {
    const terms = searchable(search.val()).split(/\s+/).filter(Boolean);
    let visible = 0;
    questions.each(function () {
      if (show(this, terms.every(term => searchIndex.get(this).includes(term)))) visible += 1;
    });
    reset.prop('disabled', !search.val());
    status.text(terms.length ? `Найдено: ${visible} из ${questions.length}` : '');
    if (!visible && empty.hasClass('d-none')) {
      empty.removeClass('d-none').hide().fadeIn(duration(), function () {
        $(this).removeAttr('style');
      });
    } else if (visible) {
      empty.stop(true, true).addClass('d-none').removeAttr('style');
    }
  }
  function clearSearch() {
    search.val('');
    filterQuestions();
    search.trigger('focus');
  }
  search.on('input', filterQuestions).on('keydown', function (event) {
    if (event.key !== 'Escape' || !search.val()) return;
    event.preventDefault();
    clearSearch();
  });
  searchForm.on('submit', function (event) {
    event.preventDefault();
    filterQuestions();
  });
  reset.on('click', clearSearch);

  function revealLinkedAnswer() {
    const target = questions.filter(function () {
      return this.id && `#${this.id}` === window.location.hash;
    });
    if (!target.length) return;
    if (target.hasClass('d-none')) {
      search.val('');
      filterQuestions();
    }
    setExpanded(target.children('summary'), true, false);
    target[0].scrollIntoView({block: 'start'});
  }
  $(window).on('hashchange', revealLinkedAnswer);
  revealLinkedAnswer();
});
