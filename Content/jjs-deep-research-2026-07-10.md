---
source: multiple (see individual sections)
retrieved: 2026-07-10
language: ru
original_title: JJS Moveset Generator — Deep Research: Legality, History, Similar Games, Monetization
---

# JJS Moveset Generator — Глубокое исследование по 4 темам

---

## ТЕМА 1: ЛЕГАЛЬНОСТЬ — Нарушает ли JJS Moveset Generator ToS Roblox?

### Короткий ответ
**Нет, если инструмент не трогает клиент Roblox, не торгует Robux и не собирает лишние данные.**
Генератор кодов на внешнем сайте — это fan tool, работающий полностью вне платформы. Roblox не имеет юрисдикции над тем, что пользователь делает в браузере до входа в игру.

### Что конкретно говорит ToS Roblox

**Запрещено (релевантные пункты):**
1. Продавать, покупать или передавать Robux и виртуальный контент через сторонние сервисы — нарушение ToS, аккаунт могут заблокировать. Источник: [Roblox Terms of Use](https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use)
2. Использовать модифицированные клиенты (exploits/cheats) — немедленный бан вплоть до перманентного. Источник: [Roblox Dev Forum — Modified Clients](https://devforum.roblox.com/t/an-update-on-automated-action-against-modified-clients/3640609)
3. Собирать данные пользователей через API сверх необходимого минимума — нарушение Third Party App Policy. Источник: [Creator Third Party App Policy](https://en.help.roblox.com/hc/en-us/articles/37924211313044-Creator-Third-Party-App-Policy)

**Запрещено для Third Party Apps через API:**
- Создавать профили пользователей Roblox без разрешения
- Продавать данные, полученные через Roblox API
- Использовать данные для обучения AI-моделей
- Агрегировать данные для анализа бизнес-показателей Roblox

**Разрешено / серая зона:**
- Внешние инструменты, которые помогают пользователям планировать и генерировать игровой контент, не касаясь Roblox-клиента
- Сайты, не использующие Roblox API вообще (чисто офлайн-генераторы)
- Сообщества и базы знаний (wikis, tier lists, build planners)

### Разница между "creative tool" и "exploit tool"

| Параметр | Creative Tool (наш случай) | Exploit Tool (запрещено) |
|---|---|---|
| Затрагивает клиент Roblox? | Нет | Да |
| Изменяет геймплей несанкционированно? | Нет | Да |
| Работает в браузере, вне игры? | Да | Нет |
| Торгует Robux/аккаунтами? | Нет | Часто да |
| Roblox может забанить за использование? | Нет | Да |

JJS Moveset Generator попадает в категорию creative tool: пользователь генерирует код в браузере, затем вводит его в игре через легальный in-game интерфейс (Skill Builder). Roblox сам предоставил эту функцию.

### Прецеденты: кого Roblox реально преследовала

**PlayerAuctions (2025):**
Roblox Corp. подала иск против PlayerAuctions — маркетплейса, где продавались Robux, аккаунты и игровые предметы (включая предметы из Adopt Me). Roblox обвинила их в нарушении товарного знака "Roblox" и "Robux", а также в нарушении ToS. Ключевая причина преследования: торговля виртуальной валютой и игровыми предметами за реальные деньги вне платформы. Прецедент Zynga vs. PlayerAuctions (2010) завершился мировым соглашением на нераскрытую сумму.
Источник: [Game Developer](https://www.gamedeveloper.com/business/roblox-sues-rule-breaking-third-party-marketplace-playerauctions), [Local News Matters](https://localnewsmatters.org/2025/02/08/roblox-puts-its-virtual-currency-to-the-test-in-real-world-lawsuit-against-online-reseller-site/)

**Вывод:** Roblox преследует только инструменты, которые (1) торгуют виртуальной валютой/аккаунтами, (2) используют торговые марки вводящим в заблуждение образом, (3) нарушают клиент. JJS Moveset Generator не попадает ни в одну из этих категорий.

### Что говорит dev-сообщество
На Roblox Developer Forum сообщество разграничивает: инструменты для планирования и создания контента (build planners, code generators) считаются нормой. Обсуждение "Is charging Robux for 3rd party website credits against the ToS?" показывает, что вопрос активно обсуждается, и основная красная линия — это работа с Robux как валютой, а не сам факт существования стороннего сайта.
Источник: [Dev Forum](https://devforum.roblox.com/t/is-charging-robux-for-3rd-party-website-credits-against-the-tos/3623679)

---

## ТЕМА 2: ИСТОРИЯ ПОХОЖИХ ИНСТРУМЕНТОВ

### Успешные legitimate third-party Roblox инструменты

**RoWifi (2021 — настоящее время)**
Discord-бот для верификации Roblox-аккаунтов в Discord-серверах. Написан на C#, предлагает кастомизируемые биндинги через группы, имена, роли и ассеты. Позиционируется как "следующее поколение" Roblox-Discord верификации. Стал стандартом для крупных Roblox-сообществ.
Источник: [Roblox Dev Forum — RoWifi](https://devforum.roblox.com/t/introducing-rowifi-2nd-gen-roblox-discord-verification-bot/648477/17)

**Bloxlink**
Позволяет пользователям связывать Roblox-аккаунт с Discord для верификации в тысячах Discord-серверов. Монетизация — премиум-план для серверов (расширенные функции). Альтернативы: RoWifi, RoVer.
Источник: [AlternativeTo](https://alternativeto.net/software/bloxlink/)

**Rolimons**
Торговый сайт для Roblox лимитедов. Функции: trade ads, item values, inventory tracking, resale history, leaderboard. Основная ценность — агрегация рыночных данных, которых нет в самом Roblox. Монетизация: премиум-членство, реклама.
Источник: [Rolimons](https://www.rolimons.com/)

**RTrack**
Аналитика Roblox игр: market research, исторические данные, CCU rankings. Позиционируется как инструмент для девелоперов и инвесторов. Существует с ~2019 года.
Источник: [RTrack](https://rtrack.live/), [Dev Forum](https://devforum.roblox.com/t/rtrack-free-roblox-analytics/355382)

**RoMonitor Stats**
Реальная статистика Roblox-игр: CCU, посещения, рейтинги разработчиков. Упор на live-данные (в отличие от RTrack с историческими). Используется для мониторинга роста игр.
Источник: [RoMonitor Stats](https://romonitorstats.com/)

**RoLive**
Discord-бот для трекинга статистики Roblox-игр и групп в реальном времени. Интуитивный интерфейс для роста комьюнити.
Источник: [RoLive](https://www.rolive.app/)

**Amaze Digital Fits (июнь 2025)**
Веб-инструмент для дизайна аватарной одежды. Запущен в июне 2025, увеличил вовлечённость в кастомизацию аватаров на 12%, ожидается прирост выручки Roblox на 1.5% к Q4 2025.
Источник: [Xtended View Roblox Statistics](https://xtendedview.com/roblox-statistics/)

### Случаи когда Roblox убивала сторонние инструменты

Задокументированных случаев закрытия legitimate creative/analytics инструментов нет. Roblox действовала только против:
1. Маркетплейсов с торговлей Robux и аккаунтами (PlayerAuctions, 2025)
2. Сервисов, нарушающих приватность пользователей
3. Exploit-инструментов и модифицированных клиентов

### Сколько времени занимает рост до 10K пользователей

Прямых кейс-стади с цифрами для нишевых Roblox-инструментов в открытом доступе нет. Однако контекст:
- Roblox DAU в 2025 году: 151.5 млн (Q3 2025) — огромная база для нишевых инструментов
- Jujutsu Shenanigans имел пик 338K одновременных игроков после обновления Disaster Plants — это ~0.5% всей платформы, что для нишевого инструмента означает аудиторию в десятки тысяч потенциальных пользователей
- Для сравнения: RoWifi появился в 2021 году и сейчас является стандартом де-факто для Roblox-Discord интеграции в крупных серверах — рост от нуля до доминирования занял ~2-3 года
- Нишевые game-specific инструменты (особенно для топ-10 игр) могут достичь 10K пользователей за 3-6 месяцев при активном продвижении через Discord сервер самой игры и TikTok

---

## ТЕМА 3: ДРУГИЕ ROBLOX ИГРЫ С ПОХОЖИМИ КОДАМИ

### The Strongest Battlegrounds (TSB)

TSB имеет собственный Skill Builder — аналогичную JJS систему создания кастомных скиллов через timeline-editor. Ключевые факты:
- Skill Builder V2 — эксклюзивный инструмент для частных серверов (Private Server+)
- Позволяет комбинировать существующие мувы, менять анимации, эффекты, трейлы, пропсы
- Система import-кодов СУЩЕСТВУЕТ: на TikTok более 2.2 миллиона публикаций по теме "import codes for The Strongest Battlegrounds Skill Builder"
- Специализированного внешнего веб-инструмента (аналога jjsbuilder.com) для TSB пока нет — коды шарятся напрямую через TikTok и Discord

Это прямая возможность для расширения нашего генератора.
Источник: [Pro Game Guides — TSB Skill Builder](https://progameguides.com/roblox/how-to-use-skill-builder-v2-in-the-strongest-battlegrounds/), [TSB Fandom Wiki](https://the-strongest-battlegrounds-rblx.fandom.com/wiki/Skill_Builder)

### JJS (Jujutsu Shenanigans) — текущее положение

Существующие инструменты:
- **jjsbuilder.com** — основной сайт с базой кодов кастомных муветов, работает
- **jjsskillbuilder.com** — AI-генератор с искусственным интеллектом, более новый
Оба инструмента существуют и активны. TikTok завален контентом по теме import/export кодов JJS.
Источник: [jjsbuilder.com](https://jjsbuilder.com/moveset-codes/)

### Другие игры с потенциалом

По результатам исследования — системы import/export кодов для кастомизации существуют (или находятся в разработке) в нескольких Roblox-баттлграундсах. Прямых данных по Blox Fruits и Anime Adventures нет — там другая механика (нет in-game code system для билдов).

**Потенциальные цели для расширения:**
1. The Strongest Battlegrounds (TSB) — ВЫСОКИЙ приоритет, система кодов уже есть, инструмента нет
2. Другие аниме-баттлграундсы с Skill Builder системами — требует дополнительного исследования

---

## ТЕМА 4: РЕАЛЬНАЯ МОНЕТИЗАЦИЯ

### Монетизация Roblox fan-tools (не через Roblox)

**Ключевой контекст рынка:**
- Roblox выплатил создателям ~$923 млн в 2024 году (через DevEx)
- В 2025 году DevEx распределил ~$1.5 млрд
- Ставка DevEx выросла с $0.0035 до $0.0038 за Robux (5 сентября 2025)
- Медианный создатель в DevEx получил $1,575 за 12 месяцев — рынок сильно поляризован

Для fan-tools (внешние сайты) монетизация работает через реальные деньги, не Robux.

### Stripe vs PayPal для gaming аудитории

**Stripe:**
- Рыночная доля: ~17.33% (второй по использованию в мире)
- Для EU подписок: 1.5% + €0.25 за транзакцию (значительно дешевле PayPal)
- Лучше для разработчиков: API, webhook, subscription management из коробки
- Hybrid модель "Subscription + Credits/Tokens" даёт на 20-30% больше ARPU, чем чистые подписки

**PayPal:**
- EU подписки: 4-5% эффективная комиссия (значительно дороже)
- Лучше конвертирует для аудитории, которая не доверяет вводить карту (особенно тинейджеры)
- Стандарт для gaming аудитории 13-17 лет (родители часто дают PayPal)

**Конверсия для gaming tools:**
- Средний App Store CVR в US: ~25%; Google Play: ~27.3%
- Game-специфичные инструменты (нишевые): реальная конверсия бесплатный → платный значительно ниже, типично 1-5% для freemium
- Средний чек для gaming tools: $2.99-9.99/месяц или $19.99-49.99 разовая оплата

### Discord-монетизация — реальные механики

**Native Discord Server Subscriptions:**
- Revenue split: 90% создателю / 10% Discord — самое выгодное соотношение среди всех платформ (лучше YouTube, Twitch)
- Пользователь платит прямо через Discord, без перехода на сторонний сайт
- Доступно в Server Settings для квалифицированных серверов

**Mee6 Premium:**
- $11.99/месяц для сервера
- Предлагает subscription tiers и автоматическое назначение ролей
- Популярен для монетизации Discord-сообществ вокруг игровых инструментов

**Custom bot + Stripe/PayPal интеграция:**
- Кастомный бот выдаёт роли после оплаты через Stripe/PayPal
- Полный контроль над процессом, но требует разработки

**Patreon + Discord интеграция:**
- Patreon берёт 8-12% комиссии → создатель сохраняет ~88-92%
- Official Patreon Discord Bot автоматически синхронизирует тиры Patreon с ролями Discord
- Наиболее проверенная схема для game tool creators
- Типичный Patreon для нишевого gaming tool: $2-5/месяц basic, $10-15/месяц premium

Источники: [Discord Monetization 2026 — AdvLaunch](https://advlaunch.us/blog/discord-monetization-creators), [EarnifyHub](https://earnifyhub.com/creator-economy/discord-server-monetisation-2026), [BuildMyDiscord](https://buildmydiscord.com/en/blog/discord-community-monetization-how-to-make-money-from-your-discord-server-in-202)

### Конкретные модели монетизации для JJS Moveset Generator

**Рекомендуемый стек (от низкого риска к высокому доходу):**

1. **Freemium сайт + Patreon:**
   - Бесплатно: генерация кодов, база кодов
   - Patreon $3/мес: сохранение билдов в облаке, больше слотов
   - Patreon $9/мес: AI-генерация, приоритетный доступ к новым фичам
   - Реалистичная цель: 100 платных подписчиков × $5 avg = $500/мес за 6-12 месяцев

2. **Discord Server Subscriptions:**
   - Эксклюзивный контент (редкие коды, туториалы) за $2.99/мес
   - 90/10 split — самые выгодные условия
   - Нет необходимости в своём payment processing

3. **One-time premium unlock (Stripe):**
   - $4.99 за разовую покупку = "Pro аккаунт"
   - Подходит для аудитории, которая не хочет подписки
   - Конверсия ожидаемая: 1-3% от активных пользователей

4. **Реклама (низкий барьер входа):**
   - Google AdSense или Carbon Ads для tech/gaming аудитории
   - При 10K MAU и RPM $2-5: $20-50/мес (несущественно само по себе, но как дополнение)

**Реалистичный прогноз для нишевого Roblox tool:**
- 0-3 месяца: 0-1K пользователей, $0 дохода (рост через Discord и TikTok)
- 3-6 месяцев: 1K-5K пользователей, $50-200/мес (первые Patreon-подписчики)
- 6-12 месяцев: 5K-15K пользователей, $200-800/мес (если продукт хорош и игра активна)
- 12+ месяцев: зависит от активности JJS и расширения на другие игры (TSB)

Источники: [BrightCoding — Six Figures Gaming](https://www.blog.brightcoding.dev/2026/07/08/how-gamers-are-making-six-figures-without-streaming-the-ultimate-2026-guide/), [Patreon Revenue 2026](https://geo.sig.ai/brands/patreon), [Meegle Discord Monetization](https://www.meegle.com/en_us/topics/game-monetization/game-monetization-for-discord)

---

## Итоговая матрица решений

| Вопрос | Ответ |
|---|---|
| Легально ли делать JJS generator? | Да — если не торгуем Robux и не трогаем клиент |
| Roblox может закрыть нас? | Нет исторических прецедентов против creative tools |
| Есть ли аналоги? | jjsbuilder.com, jjsskillbuilder.com — прямые конкуренты |
| TSB имеет похожую систему? | Да, import коды есть, внешнего инструмента нет |
| Реалистичный доход за год | $200-800/мес при 5K-15K пользователях |
| Лучший канал монетизации | Patreon + Discord Subscriptions |
