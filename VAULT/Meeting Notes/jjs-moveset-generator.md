# JJS Moveset Generator

**Статус:** #active
**Дата старта:** 2026-07-10
**Последнее обновление:** 2026-07-17

---

## Что это

Веб-инструмент для генерации кастомных moveset кодов в игре Jujutsu Shenanigans (Roblox).
Единственный работающий генератор на рынке (конкуренты — только мокапы без функционала).

**Репозиторий:** `JIUJITSU/` в COLUMBUS
**Стек:** Node.js + Express + zstd + base64

---

## Ключевые файлы

- `JIUJITSU/server.js` — Express сервер, `/api/generate` и `/api/decode` endpoints
- `JIUJITSU/public/index.html` — UI (тёмная тема, purple акценты #7c3aed)
- `JIUJITSU/BIZ-REPORT.md` — полный коммерческий анализ (удалён из текущего репо, см. git fa0f6e51)

---

## Бизнес-контекст

- Рынок: 6.14 млрд визитов в JJS, 145-200K concurrent daily
- Монетизация: $4.99 разовый Pro unlock через Stripe
- Аффилиаты: NATEZO, BAXTH, TECHYOP — 50% модель
- Деплой: Railway (НЕ Columbus VPS — изолирован)
- Аудитория: 10-17 лет, геймеры Roblox
- YouTube канал: @RedInkJJS (13.1K подписчиков, 5.2M просмотров)

---

## Конкуренты

| Сайт | Генератор | Decode | Монетизация |
|------|-----------|--------|-------------|
| jjsbuilder.com | нет | нет | нет |
| jjsskillbuilder.com | waitlist | нет | нет |
| **Наш** | **работает** | **работает** | **Stripe $4.99** |

---

## Скиллы для JJS (созданы 2026-07-17)

| Скилл | Когда использовать |
|-------|-------------------|
| `gaming-web-app-ui` | Редизайн UI, gaming эстетика, glow, анимации |
| `stripe-one-time-unlock` | Stripe Checkout, Pro unlock, webhook |
| `affiliate-promo-codes` | Промокоды NATEZO/BAXTH/TECHYOP, трекинг |
| `railway-deploy` | Деплой на Railway, env vars, custom domain |

---

## P0 приоритеты (к 2026-07-17)

- [ ] Railway деплой + домен
- [ ] Rate limiting (express-rate-limit)
- [ ] Stripe $4.99 Pro unlock
- [ ] Пост в JJS Discord (165K участников)

---

## Сессии

- **2026-07-10** — BIZ-REPORT написан, анализ рынка
- **2026-07-17** — skill-creator создал 4 скилла (gaming-web-app-ui, stripe-one-time-unlock, affiliate-promo-codes, railway-deploy)
