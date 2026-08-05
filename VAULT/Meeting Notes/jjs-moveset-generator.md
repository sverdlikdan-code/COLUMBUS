# JJS Moveset Generator

#status/active #project/jjs

Веб-инструмент для создания кастомных мувсетов в игре Jujutsu Shenanigans (Roblox).
Изолирован от COLUMBUS — отдельный Railway-деплой и GitHub репозиторий.

---

## Деплой

- **URL:** https://jjs-moveset-generator-production.up.railway.app
- **Repo:** https://github.com/sverdlikdan-code/jjs-moveset-generator
- **Платформа:** Railway (auto-deploy при push в master)
- **Стек:** Node.js + Express + Helmet CSP + Railway PostgreSQL + zstd compression

---

## Архитектура

- `server.js` — Express API: /api/generate, /api/decode, /api/library, /api/auth
- `public/index.html` — Landing + Beta Gate (пароль JJS2026)
- `public/app.html` — Generator + Decode Code + Live Preview
- `public/library.html` — Community Movesets (Railway PostgreSQL)

### Слоты (SLOT_TYPES)
SKILL · MELEE · SPECIAL · CHASE · AWAKENING · EVASIVE

### Параметры мува (buildSlot в server.js)
- **HITBOX:** DAMAGE, STUN, ATTACK TYPE, BLOCKABLE
- **VELO:** FORCE (Z), Y (Launch), TIME, FADE, TRACK, LAST HIT
- **WAIT:** TIME (duration)

---

## Безопасность

- Helmet 8 CSP: `scriptSrc + scriptSrcAttr: ['unsafe-inline']` — нужны оба для onclick handlers
- `connectSrc` включает `cloud.umami.is` для аналитики
- Beta gate: Bearer token через sha256(password + 'jjs_api_v1')
- Rate limiting: 120/15min general, 10/15min write

---

## Аналитика

- **Umami Cloud** установлен на всех 3 страницах
- Website ID: `2b526684-82f7-4550-8fc6-bebbc645cbfb`
- Аккаунт: sverdlikdan@gmail.com
- Анализировать данные после запуска платной версии ($4.99)

---

## Аффилиаты / партнёры

- **RedInk (Марк Свердлик)** — партнёр и сын. YouTube: https://www.youtube.com/@RedInkJJS — основной JJS-канал, монетизирован через рекламу. Ссылка добавлена в app.html.
- NATEZO, BAXTH, TECHYOP — другие YouTube каналы по JJS

---

## Статус монетизации

- [ ] Ko-fi аккаунт — создать и заменить placeholder `ko-fi.com/jjsbuilder`
- [ ] Stripe $4.99 one-time unlock (будущее)
- [ ] Custom domain
- [x] Umami analytics установлен
- [x] Payment modal UI — Free / $1 / $3, кнопка в хедере + авто-триггер после 3 генераций

---

## Сессии

### 2026-07-17 #status/done
- CSP fix: `scriptSrcAttr: ['unsafe-inline']` — разблокировал все onclick handlers
- Убрал "Jujutsu Shenanigans" → "JJS" по всему приложению (15 языков)
- Добавил слот EVASIVE + поля Blockable (toggle) + Force Y (Launch)
- Decode cards → 2-column grid
- Umami analytics на всех 3 страницах
- "✏ Edit This Build →" кнопка: декодирует чужой код в Generator для редактирования

### 2026-07-18 #status/done
- Тултипы `data-tip` на всех 10 лейблах формы (hover CSS, без JS)
- Slot Type тултип упрощён для аудитории 10-17 лет
- Все изменения задеплоены на Railway (5 коммитов в этой сессии)

### 2026-08-05 #status/done
- **GSAP 3.12.5** подключён — stagger карточек библиотеки, bounce лайков, entrance анимации
- **CSP** обновлён в server.js — добавлен `cdnjs.cloudflare.com`
- **Фильтр по персонажам** в library.html — авто-чипы из загруженных кодов, toggle on/off
- **Mobile header fix** — library.html: RedInk и субтайтл скрыты на 375px, Submit Code всегда виден
- **Live Preview redesign** — заменён на Build Archetype (RUSH/SETUP/ZONER/AERIAL/BREAKER/BALANCED) + Combo Timeline с барами hit/stun/cd и chain hints между мувами
- **Payment modal** — Free/$1/$3, кнопка 💜 Support в хедере, авто-триггер после 3-й генерации; Ko-fi placeholder `ko-fi.com/jjsbuilder` — нужен реальный аккаунт
- Суммарно 6 коммитов (9764993)
