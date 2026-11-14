'use strict';

(() => {
  const storageKey = 'pixel-language';
  const attributes = ['alt', 'aria-label', 'title', 'placeholder', 'content'];
  const translations = new WeakMap();
  const cyrillic = /[А-Яа-яЁё]/;
  const english = {
    "Изменить бронь": "Edit booking",
    "Сохранить изменения": "Save changes",
    "Не менять": "Keep current booking",
    "Без предпочтений": "No preference",
    "Свободные места и посадку подтвердит клуб.": "The club will confirm availability and seating.",
    "Для оплаченного визита доступен перенос с прежней стоимостью.": "Paid visits can be moved to a time with the same price.",
    "Сохраняем изменения…": "Saving changes…",
    "Не удалось изменить бронь.": "Could not update the booking.",
    "Бронь изменена.": "Booking updated.",
    "Бронь уже изменена. Обновите список визитов и попробуйте снова.": "This booking has already changed. Refresh your visits and try again.",
    "Для выбранного времени меняется стоимость. Выберите время с прежним тарифом или свяжитесь с клубом.": "This time changes the price. Choose a time at the original rate or contact the club.",
    "Перейти к содержимому": "Skip to content",
    "Компьютерный клуб Pixel — главная": "Pixel Gaming Club — home",
    "Основная навигация": "Main navigation",
    "Главная": "Home",
    "Залы и цены": "Rooms & prices",
    "Игры": "Games",
    "План визита": "Plan a visit",
    "Личный кабинет": "My account",
    "Личный кабинет · Вы вошли": "My account · Signed in",
    "Личный кабинет | PIXEL": "My account | PIXEL",
    "Астана · 24/7": "Astana · 24/7",
    "Место для вашей игры.": "A place to play.",
    "© 2026 Компьютерный клуб Pixel": "© 2026 Pixel Gaming Club",
    "Заглядывайте в любое время": "Drop in anytime",
    "Астана, проспект Мәңгілік Ел, 36": "36 Mangilik El Avenue, Astana",
    "Круглосуточно, каждый день": "Open 24 hours, every day",
    "Маршрут в 2ГИС": "Directions on 2GIS",
    "(новая вкладка)": "(opens in a new tab)",
    "На связи": "Get in touch",
    "Перед первым визитом": "Before your first visit",
    "Спланировать визит": "Plan a visit",
    "Рассчитать визит": "Get a price estimate",
    "Позвонить в клуб": "Call the club",
    "Пополнить баланс": "Top up balance",
    "Перейти к оплате": "Proceed to payment",
    "Необязательно": "Optional",
    "Имя": "Name",
    "Телефон": "Phone",
    "Почта": "Email",
    "Назад": "Back",
    "Далее": "Next",
    "Повторить": "Retry",
    "Продолжить": "Continue",
    "Сбросить": "Reset",
    "Pixel в Астане: реальные фотографии клуба, три зала, цены и план визита. Круглосуточно.": "Pixel in Astana. See club photos, explore three gaming rooms, check prices, and plan your visit. Open 24/7.",
    "Время для вашей игры. Компьютерный клуб Pixel в Астане: Standard, Duo и VIP. От 900 ₸ за ПК в час, круглосуточно.": "Game on your time at Pixel in Astana. Standard, Duo, and VIP rooms from 900 ₸ per PC per hour. Open 24/7.",
    "Время для вашей игры — PIXEL": "Game on your time — PIXEL",
    "Время": "Time",
    "для вашей": "for your",
    "игры.": "game.",
    "Компьютерный клуб в Астане · 24/7.": "Gaming club in Astana · Open 24/7.",
    "От 900 ₸ за ПК в час.": "From 900 ₸ per PC per hour.",
    "Тарифы залов": "Room prices",
    "20 ПК ·": "20 PCs ·",
    "2 ПК ·": "2 PCs ·",
    "5 ПК ·": "5 PCs ·",
    "/ ПК / час": "/ PC / hour",
    "Металлический портал с фотографией интерьера клуба Pixel": "Metal portal with a photo of the Pixel club interior",
    "Приостановить движение сцены": "Pause scene animation",
    "Возобновить движение сцены": "Resume scene animation",
    "Пауза": "Pause",
    "Посмотреть залы": "Explore the rooms",
    "Дальше — ваша игра": "Your game is next",
    "Ваш способ": "Your way",
    "провести вечер.": "to spend the evening.",
    "Для себя и своей компании": "For you and your friends",
    "Когда вас двое": "For two players",
    "Больше мощности": "More power",
    "Посмотреть зал →": "Explore the room →",
    "Игровые кресла и клавиатуры с подсветкой в Pixel": "Gaming chairs and backlit keyboards at Pixel",
    "Фотография клуба Pixel": "Photo of the Pixel gaming club",
    "Просто приходите.": "Just show up.",
    "Остальное — игра.": "Then it’s game time.",
    "Игровые места, привычная периферия и время, которое вы оставили для себя.": "Gaming stations, familiar gear, and time to play.",
    "Найти свою игру →": "Find your game →",
    "Залы и цены | Pixel": "Rooms & prices | Pixel",
    "Сравнение залов": "Compare rooms",
    "за один ПК в час": "per PC per hour",
    "Выбрать Standard": "Choose Standard",
    "Выбрать Duo": "Choose Duo",
    "Выбрать VIP": "Choose VIP",
    "Мест": "Seats",
    "Видеокарта": "Graphics card",
    "Монитор": "Monitor",
    "Все характеристики Standard": "Standard specifications",
    "Все характеристики Duo": "Duo specifications",
    "Все характеристики VIP": "VIP specifications",
    "Процессор": "Processor",
    "Asus TUF Gaming · 280 Гц · 24.5 дюйма": "Asus TUF Gaming · 280 Hz · 24.5 in",
    "Asus TUF Gaming · 310 Гц · 24.5 дюйма": "Asus TUF Gaming · 310 Hz · 24.5 in",
    "Asus TUF Gaming · 360 Гц · 24.5 дюйма": "Asus TUF Gaming · 360 Hz · 24.5 in",
    "Клавиатура": "Keyboard",
    "Мышь": "Mouse",
    "Наушники": "Headset",
    "Два игровых места": "Two gaming stations",
    "Внутри Pixel": "Inside Pixel",
    "Ряд игровых кресел и компьютеров с синей подсветкой в Pixel": "A row of gaming chairs and blue-lit computers at Pixel",
    "Посадка за игровыми столами": "Seating at the gaming desks",
    "Клавиатуры с подсветкой и мониторы в открытом ряду Pixel": "Backlit keyboards and monitors in an open row at Pixel",
    "Игровые места и периферия": "Gaming stations and gear",
    "Общий вид интерьера Pixel с рядами ПК и светильниками на потолке": "Wide view of the Pixel interior with rows of PCs and ceiling lights",
    "Общий вид клуба": "Club overview",
    "Фотографии в Instagram клуба": "Club photos on Instagram",
    "Почасовой визит": "Pay by the hour",
    "или пакет?": "or choose a package?",
    "Для обычного сеанса стоимость считается сразу: цена часа × число ПК × длительность.": "For a regular session, the total is the hourly rate × number of PCs × hours.",
    "Пакеты на 3 и 5 часов не сгорают 96 часов. «Ночь» во всех залах — 22:00–08:00. Дневной пакет Standard — 12:00–18:00 по будням.": "The 3- and 5-hour packages are valid for 96 hours. Night packages run from 22:00 to 08:00 in all rooms. The Standard Daytime package runs from 12:00 to 18:00 on weekdays.",
    "Рассчитать визит с пакетом →": "Get a package estimate →",
    "Уточнить условия пакетов →": "Check package terms →",
    "Основной зал": "Main gaming room",
    "Для игры вдвоём": "Play as a pair",
    "Самые мощные ПК клуба": "The club’s most powerful PCs",
    "Перейти к залу": "Jump to a room",
    "Игры и приложения | Pixel": "Games & apps | Pixel",
    "Во что играем?": "What are we playing?",
    "Список игр и приложений": "Games and apps",
    "Поиск по названию": "Search by title",
    "Например, CS2 или Minecraft": "For example, CS2 or Minecraft",
    "Жанр": "Genre",
    "Все жанры": "All genres",
    "Шутеры": "Shooters",
    "Королевская битва": "Battle royale",
    "Песочницы и выживание": "Sandbox and survival",
    "Командные стратегии (MOBA)": "Team strategy (MOBA)",
    "Экшен": "Action",
    "Спорт и симуляторы": "Sports and simulation",
    "Приложения": "Apps",
    "Ничего не найдено": "No results found",
    "Попробуйте другое название или сбросьте поиск и жанр.": "Try another title or clear the search and genre filters.",
    "Сбросить поиск и жанр": "Clear search and genre filters",
    "Назовите выбранную игру при звонке в клуб:": "Mention your chosen game when you call the club:",
    "Шутер": "Shooter",
    "Песочница": "Sandbox",
    "Командная стратегия (MOBA)": "Team strategy (MOBA)",
    "Тактический шутер": "Tactical shooter",
    "Выживание": "Survival",
    "Спорт": "Sports",
    "Геройский шутер": "Hero shooter",
    "Боевой симулятор": "Combat simulator",
    "Автосимулятор": "Driving simulator",
    "Браузер": "Browser",
    "Применённые фильтры": "Active filters",
    "Приложение": "App",
    "Добавить к пожеланиям": "Add to preferences",
    "Выбрать для визита": "Choose for your visit",
    "Перед первым визитом | Pixel": "Before your first visit | Pixel",
    "Перед игрой": "Before you play",
    "Pixel работает круглосуточно: Астана, проспект Мәңгілік Ел, 36.": "Pixel is open 24/7 at 36 Mangilik El Avenue, Astana.",
    "Что нужно выбрать?": "What do I need to choose?",
    "Для расчёта регистрация не нужна. Перед отправкой заявки укажите имя и телефон для связи.": "You can get an estimate without an account. Enter your name and phone number before sending your request.",
    "Зал и число игроков.": "Room and number of players.",
    "Standard — 20 мест, Duo — два, VIP — пять.": "Standard seats 20, Duo seats two, and VIP seats five.",
    "Сравнить оборудование.": "Compare the equipment.",
    "Дату, начало и длительность.": "Date, start time, and duration.",
    "Планировщик покажет время окончания и расчёт стоимости.": "The planner shows the end time and estimated price.",
    "Пожелания и контакты.": "Preferences and contact details.",
    "Номер ПК, игра и места рядом необязательны. Для заявки нужны имя и телефон. Проверьте план перед отправкой.": "You can request a PC, a game, or seats together. Enter your name and phone number and review your plan before sending it.",
    "Понятный расчёт": "How pricing works",
    "Почасовая цена за один ПК: Standard — 900 ₸, Duo — 1 000 ₸, VIP — 1 500 ₸.": "Hourly rate per PC: Standard 900 ₸, Duo 1 000 ₸, VIP 1 500 ₸.",
    "Например, два игрока в Standard на два часа:": "For example, two players in Standard for two hours:",
    "900 ₸ × 2 ПК × 2 часа = 3 600 ₸": "900 ₸ × 2 PCs × 2 hours = 3 600 ₸",
    "У пакетов отдельные цены и правила использования. Их стоимость не равна почасовой цене, умноженной на длительность.": "Packages have their own prices and terms. Check the package price for your visit.",
    "Тарифы и условия пакетов →": "Package rates and terms →",
    "Вопросы перед визитом": "Frequently asked questions",
    "Что нужно уточнить о пакетах?": "What should I check about packages?",
    "В официальном прайсе Instagram пакеты на 3 и 5 часов не сгорают 96 часов. Это срок действия, а не непрерывная длительность сеанса.": "The official Instagram price list says 3- and 5-hour packages are valid for 96 hours from purchase.",
    "В 2ГИС опубликованы: «Ночь» во всех залах — 22:00–08:00 следующего дня; «Дневной» Standard — пн–пт, 12:00–18:00; «Студенческий» Standard — пн–пт, 11:00–17:00. Ночной пакет Duo есть в Instagram, но отдельного интервала для Duo нет.": "2GIS lists these hours: Night in all rooms, 22:00–08:00 the following day; Standard Daytime, Mon–Fri 12:00–18:00; Standard Student, Mon–Fri 11:00–17:00. Instagram lists a Duo Night package without separate hours for Duo.",
    "Порядок списания часов, число ПК на пакет и перенос остатка между посещениями не раскрыты. Для предварительного расчёта сайт берёт один пакет на каждый ПК, добавляет время вне покрытия по почасовому тарифу с округлением вверх до часа и не засчитывает остаток в будущие визиты. Это модель сайта: итог и условия подтвердит администратор. Скидки, студенческий статус и бонусы уточняйте у клуба — они не включены в сумму.": "The club has yet to publish how hours are deducted, how many PCs each package covers, or whether unused time carries over. The estimate uses one package per PC, rounds extra time up to the next hour at the regular rate, and excludes unused time from future visits. The club will confirm the final price and terms. Ask the club about discounts, student eligibility, and bonuses.",
    "Прайс клуба в 2ГИС": "Club prices on 2GIS",
    "Прайс в Instagram": "Prices on Instagram",
    "Когда бронь подтверждена?": "When is my booking confirmed?",
    "Кнопка «Отправить заявку» передаёт администратору ваше имя, телефон и план визита. Заявка ещё не удерживает места: дождитесь подтверждения клуба по телефону. Если нужно изменить или отменить заявку, свяжитесь с администратором:": "Send request shares your name, phone number, and visit plan with the club. Wait for the club to confirm your seats by phone. To change or cancel your request, call the club:",
    ". Удаление копии с устройства не отменяет отправленную заявку.": ". Deleting your local copy leaves the submitted request active.",
    "Можно сесть рядом с друзьями?": "Can I sit next to my friends?",
    "При выборе нескольких ПК отметьте пожелание «Хотим сидеть рядом». Конкретный номер ПК можно указать в разделе «Пожелания к месту и игре». Это пожелание: свободные места и посадку подтвердит администратор.": "When choosing several PCs, select “Seat us together.” You can also request a specific PC under “Seat and game.” The club will confirm availability and seating.",
    "Duo — отдельная комната?": "Is Duo a private room?",
    "Клуб поясняет: это два ПК отдельно от основного ряда, без отдельных стен и полной звукоизоляции. Если нужна приватность или тишина, заранее обсудите посадку с администратором.": "Duo has two PCs set apart from the main row in an open area. If you need privacy or quiet, ask the club about seating in advance.",
    "Ответ клуба в 2ГИС": "The club’s response on 2GIS",
    "Нужен ли свой аккаунт для игры?": "Do I need my own account to play?",
    "Требования к аккаунтам и версии игр пока не указаны. Найдите название в": "The club has yet to list account requirements and game versions. Find the title in the",
    "списке игр": "game list",
    "; если важна определённая версия или режим, уточните их у клуба перед посещением.": "; if you need a particular version or mode, check with the club before visiting.",
    "Как оплатить, отменить бронь или сообщить об опоздании?": "How do I pay, cancel, or let you know I’m running late?",
    "Оплата на сайте не проводится. Условия предоплаты, отмены и удержания места при опоздании пока не опубликованы. Для реального визита уточните их у администратора по номеру": "The site does not take real payments. Ask the club about deposits, cancellations, and how long your seats are held if you’re late:",
    "Вход в личный кабинет": "Sign in to your account",
    "Регистрация не нужна. Выберите зал и время, проверьте стоимость и сохраните план визита.": "Choose a room and time, check the price, and save your plan. You can do this without an account.",
    "Номер ПК, игра и места рядом необязательны. Укажите имя и телефон, затем проверьте план.": "You can request a PC, a game, or seats together. Enter your name and phone number, then review your plan.",
    "Как подтвердить визит?": "How do I confirm my visit?",
    "Кнопка «Сохранить план» оставляет расчёт на этом устройстве. Для подтверждения визита, изменения времени или отмены позвоните в клуб:": "Save plan keeps the estimate on this device. To confirm, reschedule, or cancel a visit, call the club:",
    ". Если вы отправили заявку, дождитесь подтверждения клуба по телефону.": ". If you sent a request, wait for the club to confirm it by phone.",
    "Например, пакеты или оплата": "For example, packages or payment",
    "Ничего не найдено. Попробуйте другое слово.": "No results found. Try another search term.",
    "Поиск по вопросам": "Search FAQs",
    "Управляйте балансом и записями на визит в личном кабинете PIXEL.": "Manage your PIXEL balance and bookings in your account.",
    "Вход | PIXEL": "Sign in | PIXEL",
    "Регистрация | PIXEL": "Create an account | PIXEL",
    "Войти в PIXEL": "Sign in to PIXEL",
    "Электронная почта": "Email address",
    "Пароль": "Password",
    "Войти": "Sign in",
    "Создать аккаунт": "Create an account",
    "Не менее 12 символов.": "Use at least 12 characters.",
    "Зарегистрироваться": "Sign up",
    "Уже есть аккаунт? Войти": "Already have an account? Sign in",
    "Войти через Google": "Sign in with Google",
    "Баланс": "Balance",
    "Выберите сумму": "Choose an amount",
    "Сумма в тенге": "Amount in tenge",
    "Обновить баланс": "Refresh balance",
    "Продолжить оплату": "Continue payment",
    "Проверить оплату": "Check payment",
    "Вернуться к оформлению": "Return to checkout",
    "Предстоящие визиты": "Upcoming visits",
    "Обновить визиты": "Refresh visits",
    "Данные аккаунта": "Account details",
    "Выйти": "Sign out",
    "Включите JavaScript, чтобы войти.": "Enable JavaScript to sign in.",
    "Выберите время, зал и длительность сеанса в PIXEL, чтобы рассчитать стоимость визита.": "Choose a time, room, and session length to get a price estimate for your PIXEL visit.",
    "План визита | Pixel": "Plan a visit | Pixel",
    "Для расчёта включите JavaScript или": "To get an estimate, enable JavaScript or",
    "позвоните в клуб": "call the club",
    "Когда играем?": "When are we playing?",
    "Время Астаны": "Astana time",
    "Дата": "Date",
    "Начало": "Start time",
    "Игроки": "Players",
    "Уменьшить число игроков": "Decrease the number of players",
    "Увеличить число игроков": "Increase the number of players",
    "Часы": "Hours",
    "Уменьшить длительность": "Decrease duration",
    "Увеличить длительность": "Increase duration",
    "Зал": "Room",
    "За 1 ПК в час": "Per PC per hour",
    "Standard · 900 ₸ / ПК / ч": "Standard · 900 ₸ / PC / hour",
    "Duo · 1 000 ₸ / ПК / ч": "Duo · 1 000 ₸ / PC / hour",
    "VIP · 1 500 ₸ / ПК / ч": "VIP · 1 500 ₸ / PC / hour",
    "Контакты для подтверждения": "Contact details for confirmation",
    "Контактные данные": "Contact details",
    "Добавить e-mail": "Add an email address",
    "Пакет и пожелания": "Package and preferences",
    "Тариф": "Rate",
    "По длительности визита": "Pay by the hour",
    "Условия пакетов": "Package terms",
    "Место и игра": "Seat and game",
    "Предпочтительный ПК": "Preferred PC",
    "Любой компьютер в выбранном зале": "Any PC in the selected room",
    "Посадку подтвердит клуб.": "The club will confirm seating.",
    "Игра": "Game",
    "Пока не выбрали": "Undecided",
    "Хотим сидеть рядом": "Seat us together",
    "Итого": "Total",
    "Сохранить план": "Save plan",
    "Оформление визита": "Review your visit",
    "Способ оформления": "Payment method",
    "Бронь без оплаты": "Book without paying",
    "Картой": "By card",
    "С баланса": "From balance",
    "Забронировать": "Book now",
    "План сохранён": "Plan saved",
    "Новый визит": "New visit",
    "Оплата и отмена": "Payment and cancellation",
    "Сбросить параметры": "Reset plan",
    "Пополнение баланса | PIXEL": "Top up balance | PIXEL",
    "← В профиль": "← Back to account",
    "Пополнение баланса": "Top up balance",
    "Проверить ещё раз": "Check again",
    "Сумма и тестовые данные": "Amount and test card details",
    "Сумма пополнения": "Top-up amount",
    "Номер карты": "Card number",
    "Месяц и год": "Expiry month and year",
    "ММ/ГГ": "MM/YY",
    "Оплатить": "Pay",
    "Для оформления включите JavaScript.": "Enable JavaScript to continue.",

    "E-mail (необязательно)": "Email (optional)",
    "Число игроков": "Number of players",
    "Длительность": "Duration",
    "Пожелание по ПК": "PC preference",
    "Отправить заявку": "Send request",
    "Войдёт в заявку, если заполнить.": "Include an email address if you’d like to add it to your request.",
    "Сохранение без оплаты и брони.": "Save the plan on this device.",
    "Клуб подтвердит места и условия оплаты.": "The club will confirm your seats and payment terms.",
    "Тестовая заявка без бронирования.": "This test request leaves seats available.",
    "Онлайн-заявки пока недоступны. Для брони позвоните: +7 775 351 36 93.": "Online requests are currently unavailable. To book, call +7 775 351 36 93.",
    "Укажите e-mail в формате name@example.com или оставьте поле пустым.": "Enter an email address like name@example.com, or leave it blank.",
    "Укажите имя: от 2 до 80 символов.": "Enter a name between 2 and 80 characters.",
    "Укажите телефон с кодом страны, например +7 700 000 00 00.": "Include the country code, for example +7 700 000 00 00.",
    "Выберите Standard, Duo или VIP.": "Choose Standard, Duo, or VIP.",
    "Укажите целое число игроков от 1.": "Enter a whole number of players, starting at 1.",
    "Укажите целое число часов от 1 до 12.": "Enter a whole number of hours from 1 to 12.",
    "Укажите существующую календарную дату.": "Enter a valid calendar date.",
    "Выберите сегодняшнюю или будущую дату.": "Choose today or a future date.",
    "Укажите время в формате часы:минуты.": "Enter a time in hours and minutes.",
    "Время начала уже прошло в Астане. Выберите будущие дату и время.": "That start time has already passed in Astana. Choose a future date and time.",
    "Выберите ПК из списка или оставьте пожелание пустым.": "Choose a PC from the list or leave this field blank.",
    "Этот ПК находится в другом зале. Измените зал или пожелание по ПК.": "This PC is in another room. Change the room or choose a different PC.",
    "Выберите игру из списка или оставьте поле пустым.": "Choose a game from the list or leave the field blank.",
    "Выберите пакет выбранного зала.": "Choose a package for this room.",
    "Студенческий тариф согласуется по телефону.": "Call the club to arrange the student rate.",
    "Проверьте число игроков и длительность.": "Check the number of players and the duration.",
    "Укажите дату и время для проверки интервала пакета.": "Enter a date and time to check the package hours.",
    "Этот пакет действует только по будням. Измените дату или тариф.": "This package is available on weekdays. Change the date or rate.",
    "Этот пакет действует только по будням. Выберите другую дату или тариф.": "This package is available on weekdays. Choose another date or rate.",
    "Визит не пересекается с интервалом пакета. Измените время или тариф.": "Your visit falls outside the package hours. Change the time or rate.",
    "Пакетный расчёт недоступен. Выберите расчёт по длительности.": "Package pricing is unavailable. Choose the hourly rate.",
    "Предварительно": "Estimate",
    "Укажите число игроков и часов.": "Enter the number of players and hours.",
    "Выберите дату": "Choose a date",
    "Сеанс": "Session",
    "Окончание": "End time",
    "Место": "Seat",
    "Посадка": "Seating",
    "Рядом · пожелание": "Together · request",
    "Ночь": "Night",
    "Дневной": "Daytime",
    "Студенческий": "Student",
    "1 час": "1 hour",
    "3 часа": "3 hours",
    "5 часов": "5 hours",
    "Обычный почасовой тариф.": "Regular hourly rate.",
    "В прайсе: время не сгорает 96 часов.": "The published rate is valid for 96 hours.",
    "22:00–08:00 следующего дня.": "22:00–08:00 the following day.",
    "22:00–08:00 следующего дня. Интервал опубликован на официальной странице клуба.": "22:00–08:00 the following day, as listed by the club.",
    "Пн–пт, 12:00–18:00 · Standard.": "Mon–Fri, 12:00–18:00 · Standard.",
    "Пн–пт, 11:00–17:00. Статус студента подтверждается клубом; расчёт по телефону.": "Mon–Fri, 11:00–17:00. Call the club to confirm student eligibility and pricing.",
    "Черновик недоступен после закрытия страницы.": "The draft will be unavailable after you close the page.",
    "Зал из ссылки не распознан.": "The room in the link was not recognized.",
    "ПК из ссылки не распознан.": "The PC in the link was not recognized.",
    "ПК из ссылки относится к другому залу; он не выбран.": "The linked PC is in a different room.",
    "Пожелание по ПК из предыдущего плана сброшено: выбран другой зал.": "Your previous PC preference was cleared because you selected another room.",
    "Номер ПК добавлен в пожелания.": "The PC number was added to your preferences.",
    "Игра из ссылки не распознана.": "The game in the link was not recognized.",
    "Не удалось связаться с сервером. Попробуйте ещё раз.": "Could not reach the server. Try again.",
    "Демо-бронь. Места подтвердит клуб.": "Demo booking. The club will confirm your seats.",
    "Демо-оплата. Места подтвердит клуб.": "Demo payment. The club will confirm your seats.",
    "Проверить вход": "Check sign-in",
    "Войти для оплаты": "Sign in to pay",
    "Проверяем вход…": "Checking sign-in…",
    "Оформляем бронь…": "Creating your booking…",
    "Проверяем оплату…": "Checking payment…",
    "Не удалось проверить вход. Попробуйте ещё раз.": "Could not verify sign-in. Try again.",
    "Разрешите сохранение в браузере, чтобы вернуться к плану после пополнения.": "Allow browser storage to return to your plan after topping up.",
    "Разрешите сохранение в браузере, чтобы вернуться к плану после входа.": "Allow browser storage to return to your plan after signing in.",
    "Не удалось проверить бронь. Попробуйте ещё раз.": "Could not check the booking. Try again.",
    "Не удалось проверить оплату. Попробуйте ещё раз.": "Could not check the payment. Try again.",
    "Визит отменён": "Visit cancelled",
    "Бронь создана": "Booking created",
    "Демо-оплата принята": "Demo payment accepted",
    "Проверка завершена": "Check complete",
    "Заявка отправлена": "Request sent",
    "План визита готов": "Visit plan ready",
    "Места подтвердит клуб.": "The club will confirm your seats.",
    "Заявка отправлена администратору.": "Your request was sent to the club.",
    "Заявка отправлена администратору. Дождитесь подтверждения мест и условий по телефону.": "Your request was sent to the club. Wait for a call confirming your seats and terms.",
    "Позвоните в клуб, чтобы подтвердить места и уточнить оплату.": "Call the club to confirm your seats and payment details.",
    "Оплачено": "Paid",
    "Стоимость визита": "Visit price",
    "Предварительно за весь визит": "Estimated total",
    "Стоимость выбранных пакетов": "Package total",
    "Стоимость сеанса": "Session price",
    "Отправляем…": "Sending…",
    "Отправляем заявку администратору.": "Sending your request to the club.",
    "Не удалось отправить заявку. Свяжитесь с клубом.": "Could not send your request. Contact the club.",
    "Поля очищены.": "Form cleared.",
    "Черновик восстановлен.": "Draft restored.",
    "Не удалось проверить бронь.": "Could not check the booking.",
    "Не удалось проверить оплату визита.": "Could not check payment for this visit.",
    "Проверяем бронь…": "Checking the booking…",
    "Оплата визита ещё не подтверждена.": "Payment for the visit is still awaiting confirmation.",
    "Войдите в личный кабинет и снова откройте эту страницу.": "Sign in and reopen this page.",
    "Бронь не найдена.": "Booking not found.",
    "Оплата визита не найдена.": "Payment for the visit was not found.",
    "Обновите страницу.": "Refresh the page.",
    "Отправка заявок пока недоступна. Свяжитесь с клубом по телефону.": "Online requests are currently unavailable. Call the club.",
    "Откройте сайт по защищённому адресу HTTPS и повторите отправку.": "Open the site over HTTPS and try again.",
    "Не удалось подтвердить отправку. Повторите без изменения данных или свяжитесь с клубом: повторная попытка с теми же данными не создаст вторую заявку.": "Could not confirm that your request was sent. Try again with the same details or contact the club. Retrying with the same details will keep a single request.",
    "Не удалось отправить заявку. Попробуйте позже.": "Could not send the request. Try again later.",
    "Не удалось подтвердить отправку. Свяжитесь с клубом перед повтором.": "Could not confirm that your request was sent. Contact the club before trying again.",
    "Чтобы войти, запустите start-local.cmd в папке проекта. Он откроет сайт через локальный сервер.": "To sign in, run start-local.cmd in the project folder. It opens the site on the local server.",
    "Вход через Google недоступен по этому адресу.": "Google sign-in is unavailable at this address.",
    "Проверьте подключение к интернету и повторите попытку.": "Check your internet connection and try again.",
    "Разрешите всплывающие окна для PIXEL и повторите попытку.": "Allow pop-ups for PIXEL and try again.",
    "Вход через Google отменён.": "Google sign-in was cancelled.",
    "Не удалось сохранить вход в браузере. Нажмите «Повторить».": "Could not keep you signed in. Select Retry.",
    "Свернуть пополнение": "Hide top-up options",
    "Ждём подтверждение оплаты.": "Waiting for payment confirmation.",
    "Оплата не завершена.": "Payment was not completed.",
    "Не удалось проверить оплату.": "Could not check the payment.",
    "Загружаем кошелёк…": "Loading your wallet…",
    "Пополнение доступно в локальной версии.": "Top-ups are available on the local site.",
    "Не удалось подтвердить вход для кошелька.": "Could not verify sign-in for your wallet.",
    "Не удалось обновить кошелёк.": "Could not refresh your wallet.",
    "Подтвердить отмену": "Confirm cancellation",
    "Сохранить запись": "Keep booking",
    "Отменить запись": "Cancel booking",
    "Не удалось загрузить гостевую бронь.": "Could not load your guest booking.",
    "Не удалось загрузить визиты.": "Could not load your visits.",
    "Отменяем запись…": "Cancelling your booking…",
    "Не удалось отменить запись.": "Could not cancel the booking.",
    "Запись отменена.": "Booking cancelled.",
    "Вход больше не действует. Войдите снова, чтобы продолжить пополнение.": "Your session has expired. Sign in again to continue topping up.",
    "Аккаунт в браузере изменился. Проверьте, в какой профиль вы вошли.": "The active account changed. Check which account you’re signed into.",
    "Кошелёк не получил подтверждение входа. Попробуйте ещё раз.": "Your wallet could not verify sign-in. Try again.",
    "Откройте PIXEL по HTTPS, чтобы войти.": "Open PIXEL over HTTPS to sign in.",
    "Создаём аккаунт…": "Creating your account…",
    "Входим…": "Signing in…",
    "Не удалось создать аккаунт.": "Could not create your account.",
    "Не удалось войти.": "Could not sign in.",
    "Открываем оплату…": "Opening payment…",
    "Не удалось открыть оплату.": "Could not open payment.",
    "Открываем вход через Google…": "Opening Google sign-in…",
    "Не удалось войти через Google.": "Could not sign in with Google.",
    "Выходим из аккаунта…": "Signing out…",
    "Не удалось выйти. Попробуйте ещё раз.": "Could not sign out. Try again.",
    "Введите от 13 до 16 цифр.": "Enter 13 to 16 digits.",
    "Введите ровно три цифры.": "Enter exactly three digits.",
    "Оплата визита | PIXEL": "Visit payment | PIXEL",
    "Оплата визита": "Pay for your visit",
    "← К плану визита": "← Back to visit plan",
    "К оплате": "Amount due",
    "Укажите месяц от 01 до 12 и две цифры года.": "Enter a month from 01 to 12 and the last two digits of the year.",
    "Срок действия карты истёк.": "The card has expired.",
    "Войдите в аккаунт, чтобы продолжить.": "Sign in to continue.",
    "Войти в аккаунт": "Sign in",
    "Оплата визита недоступна. Вернитесь к плану.": "Visit payment is unavailable. Return to your plan.",
    "Пополнение недоступно. Вернитесь в профиль.": "Top-up is unavailable. Return to your account.",
    "Загружаем оплату…": "Loading payment…",
    "Загружаем пополнение…": "Loading top-up…",
    "Не удалось проверить пополнение.": "Could not check the top-up.",
    "Подтверждаем оплату…": "Confirming payment…",
    "Подтверждаем пополнение…": "Confirming top-up…",
    "Не удалось подтвердить операцию. Проверьте статус.": "Could not confirm the transaction. Check its status.",
    "Откройте оплату из плана визита.": "Open payment from your visit plan.",
    "Откройте пополнение из профиля.": "Open top-up from your account.",

    // API validation and account errors.
    "Аккаунт в браузере изменился.": "The active account changed.",
    "Аккаунт с этой почтой уже есть. Войдите с паролем.": "This email already has an account. Sign in with your password.",
    "Визит уже отменён.": "This visit has already been cancelled.",
    "Войдите в аккаунт.": "Sign in to your account.",
    "Войдите в личный кабинет.": "Sign in to your account.",
    "Войдите ещё раз, чтобы открыть личный кабинет.": "Sign in again to open your account.",
    "Время визита уже наступило.": "Your visit has already started.",
    "Время визита уже прошло. Выберите новое время.": "The visit time has passed. Choose another time.",
    "Вход доступен только через HTTPS.": "Sign-in requires HTTPS.",
    "Вход пока недоступен. Попробуйте позже.": "Sign-in is currently unavailable. Try again later.",
    "Выберите ПК в выбранном зале.": "Choose a PC in the selected room.",
    "Выберите будущие дату и время по Астане.": "Choose a future date and time in Astana.",
    "Выберите зал.": "Choose a room.",
    "Выберите игру из списка.": "Choose a game from the list.",
    "Выберите пакет.": "Choose a package.",
    "Выберите почасовой тариф или пакеты.": "Choose an hourly rate or a package.",
    "Для каждого игрока нужен свой пакет. Проверьте число ПК.": "Each player needs their own package. Check the number of PCs.",
    "Для этой оплаты выбран баланс.": "Your balance was selected for this payment.",
    "На балансе не хватает средств.": "Your balance is too low for this payment.",
    "Не удалось завершить операцию. Попробуйте ещё раз.": "Could not complete the transaction. Try again.",
    "Не удалось отправить заявку. Попробуйте позже или позвоните в клуб.": "Could not send the request. Try again later or call the club.",
    "Не удалось отправить заявку. Проверьте связь или позвоните в клуб.": "Could not send the request. Check your connection or call the club.",
    "Не удалось подготовить заявку. Обновите страницу.": "Could not prepare the request. Refresh the page.",
    "Не удалось подготовить покупку. Повторите попытку.": "Could not prepare the purchase. Try again.",
    "Не удалось подтвердить аккаунт Google.": "Could not verify your Google account.",
    "Не удалось подтвердить вход. Войдите ещё раз.": "Could not verify sign-in. Sign in again.",
    "Не удалось подтвердить отправку. Чтобы не создать повторную заявку, свяжитесь с клубом.": "Could not confirm that your request was sent. Contact the club to avoid sending a duplicate.",
    "Не удалось привязать бронь.": "Could not link the booking to your account.",
    "Не удалось прочитать заявку.": "Could not read the request.",
    "Не удалось прочитать заявку. Проверьте поля.": "Could not read the request. Check the form fields.",
    "Не удалось прочитать данные для входа.": "Could not read the sign-in details.",
    "Неверная почта или пароль.": "Incorrect email address or password.",
    "Обновите страницу и проверьте предварительный расчёт пакетов.": "Refresh the page and check the package estimate.",
    "Откройте страницу входа на сайте клуба.": "Open the sign-in page on the club’s website.",
    "Откройте форму на сайте клуба и повторите отправку.": "Open the form on the club’s website and try again.",
    "Отправка заявок пока недоступна.": "Online requests are currently unavailable.",
    "Параметры визита изменились. Начните оплату снова.": "Your visit details changed. Start checkout again.",
    "Параметры визита изменились. Создайте новую бронь.": "Your visit details changed. Make a new booking.",
    "Параметры заявки изменились. Проверьте план перед отправкой.": "Your request details changed. Review the plan before sending it.",
    "Пароль должен содержать от 12 до 128 символов.": "Use a password between 12 and 128 characters.",
    "Пополнение не найдено.": "Top-up not found.",
    "Проверьте данные брони.": "Check your booking details.",
    "Проверьте данные визита.": "Check your visit details.",
    "Проверьте данные заявки.": "Check your request details.",
    "Проверьте данные операции.": "Check the transaction details.",
    "Проверьте данные оплаты визита.": "Check your payment details.",
    "Проверьте отмеченные поля.": "Check the highlighted fields.",
    "Проверьте пакет.": "Check the selected package.",
    "Проверьте пожелание по посадке.": "Check your seating preference.",
    "Слишком много заявок. Подождите несколько минут или позвоните в клуб.": "Too many requests. Wait a few minutes or call the club.",
    "Слишком много попыток. Попробуйте позже.": "Too many attempts. Try again later.",
    "Сначала добавьте тестовую карту.": "Add a test card first.",
    "Стоимость изменилась. Вернитесь к плану и проверьте итог.": "The price changed. Return to your plan and check the total.",
    "Страница не найдена.": "Page not found.",
    "Укажите действующий адрес электронной почты.": "Enter a valid email address.",
    "Укажите имя длиной до 80 символов.": "Enter a name up to 80 characters long.",
    "Укажите существующие дату и время.": "Enter a valid date and time.",
    "Укажите целую сумму от 100 до 50 000 ₸.": "Enter a whole amount from 100 to 50 000 ₸.",
    "Эта заявка уже отправляется или её отправка требует проверки. Свяжитесь с клубом перед повтором.": "This request is already being sent or needs verification. Contact the club before trying again.",
    "Этот запрос уже использован для другой покупки.": "This request was already used for another purchase.",
  };

  const months = {
    января: 'January', февраля: 'February', марта: 'March', апреля: 'April',
    мая: 'May', июня: 'June', июля: 'July', августа: 'August',
    сентября: 'September', октября: 'October', ноября: 'November', декабря: 'December',
    янв: 'Jan', февр: 'Feb', мар: 'Mar', апр: 'Apr', июн: 'Jun',
    июл: 'Jul', авг: 'Aug', сент: 'Sep', окт: 'Oct', нояб: 'Nov', дек: 'Dec'
  };
  const monthDate = new RegExp('\\b(\\d{1,2}) (' + Object.keys(months).join('|') + ')\\.?(?![а-яё])', 'gu');

  // Whole messages first, then messages containing a price, date, or other value.
  const patterns = [
    [/^Бронь изменена\. Новая стоимость: (.+)\.$/, 'Booking updated. New price: $1.'],
    [/^ПК (\d+)$/, 'PC $1'],
    [/^([A-Za-z]+) · ПК (\d+)( · пожелание)?$/, (_, room, pc, request) => room + ' · PC ' + pc + (request ? ' · request' : '')],
    [/^В (.+) (\d+) ПК\. Уменьшите число игроков или выберите другой зал\.$/, '$1 has $2 PCs. Reduce the number of players or choose another room.'],
    [/^Окончание: (.+) · время Астаны$/, 'Ends: $1 · Astana time'],
    [/^(.+) · выберите время$/, '$1 · choose a time'],
    [/^Пакет «(.+)»$/, (_, name) => translate(name) + ' package'],
    [/^(Ночь|Дневной|Студенческий)( · [\d:–]+)? · ([\d ]+) ₸ \/ ПК( · по телефону)?$/,
      (_, name, period = '', price, phone) => translate(name) + period + ' · ' + price + ' ₸ / PC' + (phone ? ' · call to book' : '')],
    [/^(.+) · пакет «(.+)»$/, (_, room, name) => room + ' · ' + translate(name) + ' package'],
    [/^Баланс ([\d ]+) ₸\.$/, 'Balance: $1 ₸.'],
    [/^Оплатить ([\d ]+) ₸$/, 'Pay $1 ₸'],
    [/^Не хватает ([\d ]+) ₸\.$/, 'You need $1 ₸ more.'],
    [/^Код брони (.+)\. Места подтвердит клуб\.$/, 'Booking code $1. The club will confirm your seats.'],
    [/^Остаток на (?:демо-)?балансе ([\d ]+) ₸\. Места подтвердит клуб\.$/, 'Remaining balance: $1 ₸. The club will confirm your seats.'],
    [/^Проверьте отмеченные поля: (.+)\.$/, (_, labels) => 'Check the highlighted fields: ' + labels.split(', ').map(translate).join(', ') + '.'],
    [/^Найдено: (\d+) из (\d+)$/, 'Found: $1 of $2'],
    [/^Показано: (\d+) из (\d+)$/, 'Showing $1 of $2'],
    [/^(Добавить к пожеланиям|Выбрать для визита): (.+)$/, (_, action, item) => translate(action) + ': ' + item],
    [/^(.+)\. Снять фильтр$/, (_, label) => translate(label) + '. Remove filter'],
    [/^(.+) ×$/, (_, label) => translate(label) + ' ×'],
    [/^Поиск: «(.+)»$/, 'Search: “$1”'],
    [/^Жанр: (.+)$/, (_, genre) => 'Genre: ' + translate(genre)],
    [/^Баланс пополнен на (.+)\.$/, 'Added $1 to your balance.'],
    [/^На баланс вернётся (.+)\.$/, '$1 will be returned to your balance.'],
    [/^Отменить визит (.+)\?$/, 'Cancel the visit on $1?'],
    [/^Отменить запись (.+)$/, 'Cancel the booking on $1'],
    [/^Укажите целое число от 1 до (\d+)\.$/, 'Enter a whole number from 1 to $1.'],
  ];

  function translate(source) {
    const normalized = source.trim().replace(/\s+/g, ' ');
    if (Object.hasOwn(english, normalized)) return english[normalized];

    // The booking summary uses separate lines for the room and the visit time.
    const lines = source.trim().split(/\n\s*/);
    if (lines.length > 1) {
      const result = lines.map(translate).join('\n');
      return result === lines.join('\n') ? source : result;
    }

    const dated = normalized.replace(monthDate, (_, day, month) => months[month] + ' ' + day)
      .replace(/(\d) в (\d\d:\d\d)/g, '$1 at $2');
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(dated)) return dated.replace(pattern, replacement);
    }

    const sentences = dated.match(/.+?(?:[.!?](?= |$)|…(?= |$)|$)/g);
    if (sentences?.length > 1) {
      const translated = sentences.map(sentence => translate(sentence)).join(' ');
      if (translated !== dated) return translated;
    }
    const units = dated.replace(/(\d) ПК(?![а-яё])/g, '$1 PCs')
      .replace(/(\d) ч(?![а-яё])/g, '$1 h')
      .replace(/(\d) Гц(?![а-яё])/g, '$1 Hz')
      .replace(/ \/ ПК(?![а-яё])/g, ' / PC')
      .replace(/ · пожелание$/, ' · request');
    return units === normalized ? source : units;
  }

  function update(node, key, read, write, language) {
    const current = read();
    let entries = translations.get(node);
    const previous = entries?.get(key);
    const source = previous?.rendered === current ? previous.source : current;
    if (!source || !cyrillic.test(source)) {
      entries?.delete(key);
      return;
    }

    let rendered = source;
    if (language === 'en') {
      const value = source.trim();
      const translated = translate(value);
      if (translated !== value) rendered = source.replace(value, () => translated);
    }
    if (!entries) translations.set(node, entries = new Map());
    entries.set(key, { source, rendered });
    if (rendered !== current) write(rendered);
  }

  function localize(root, language) {
    const skipped = 'script, style, textarea, [translate="no"]';
    if ((root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement)?.closest(skipped)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeType === Node.ELEMENT_NODE && node.matches(skipped)
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });

    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        update(node, 'text', () => node.data, value => { node.data = value; }, language);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (const attribute of attributes) {
          if (!node.hasAttribute(attribute) || (attribute === 'content' && node.localName !== 'meta')) continue;
          update(node, attribute, () => node.getAttribute(attribute), value => node.setAttribute(attribute, value), language);
        }
      }
    }
  }

  function init() {
    const header = document.querySelector('.pixel-site-header .premium-header');
    if (!header) return;

    const actions = document.createElement('div');
    actions.className = 'pixel-header-actions';
    const profile = header.querySelector('.pixel-account-link');
    if (profile) actions.append(profile);

    const picker = document.createElement('div');
    picker.className = 'pixel-language';
    picker.setAttribute('role', 'group');
    picker.setAttribute('translate', 'no');
    const buttons = ['ru', 'en'].map(locale => {
      const button = document.createElement('button');
      button.type = 'button';
      button.lang = locale;
      button.textContent = locale.toUpperCase();
      button.setAttribute('aria-label', locale === 'ru' ? 'Русский' : 'English');
      button.addEventListener('click', () => selectLanguage(locale));
      picker.append(button);
      return button;
    });
    actions.append(picker);
    header.append(actions);

    let language;
    function selectLanguage(locale) {
      if (language === locale) return;
      language = locale;
      document.documentElement.lang = locale;
      picker.setAttribute('aria-label', locale === 'ru' ? 'Язык сайта' : 'Site language');
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.lang === locale)));
      try { localStorage.setItem(storageKey, locale); } catch { /* The current page still switches. */ }
      localize(document.documentElement, locale);
      document.dispatchEvent(new Event('pixel-language-change'));
    }

    let preferred;
    try { preferred = localStorage.getItem(storageKey); } catch { /* Default to Russian. */ }
    selectLanguage(preferred === 'en' ? 'en' : 'ru');

    const observer = new MutationObserver(records => {
      const changed = new Set();
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach(node => changed.add(node));
        else changed.add(record.target);
      }
      for (const node of changed) {
        if (node.isConnected) localize(node, language);
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: attributes
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
