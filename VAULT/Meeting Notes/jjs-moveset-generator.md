# JJS Moveset Generator — Pet Project

## Статус: CLOSED BETA

Полностью изолированный пет-проект. Никакого влияния на COLUMBUS VPS или рабочие агенты.

## Архитектура

- **GitHub**: `sverdlikdan-code/jjs-moveset-generator` (отдельный репо)
- **Хостинг**: Railway (`jjs-moveset-generator-production.up.railway.app`)
- **База данных**: Supabase (project: `jjs-generator`, ID: `karnkpgzgmvwgioowijp`)
- **Стек**: Node.js / Express + @mongodb-js/zstd + @supabase/supabase-js

## Страницы

| URL | Назначение |
|-----|-----------|
| `/` | Лендинг + password gate |
| `/app.html` | Генератор кодов (15 языков i18n) |
| `/library.html` | Галерея кодов сообщества |

## Доступ

- **Пароль**: `JJS2026` (Railway env: BETA_PASSWORD)
- **Closed Beta**: 2 пользователя, лимиты отключены
- **Сессия**: 30 дней в localStorage

## База данных (Supabase)

Таблица `codes`: id, name, character, code (base64), tags[], author, likes, copies, created_at

## API

| Endpoint | Метод | Описание |
|----------|-------|---------|
| `/api/auth` | POST | Проверка бета-пароля |
| `/api/generate` | POST | Генерация JJS кода |
| `/api/decode` | POST | Декодирование кода |
| `/api/library` | GET | Список кодов (sort: likes/copies/new) |
| `/api/library/:id` | GET | Один код + bump copies |
| `/api/library/:id/like` | POST | Лайк |
| `/api/library` | POST | Добавить код |

## Pending

- Stripe $4.99 one-time unlock (после бета)
- Free vs Pro лимиты (после бета)
- Кастомный домен
- Реальные коды от @RedInkJJS YouTube

---

## Сессии

### 2026-07-17 #closed-beta
- Отдельный GitHub репо + Railway деплой (изолирован от COLUMBUS)
- Gaming UI: тёмная тема, neon glow, scanlines, Rajdhani, slot badges
- 15 языков i18n (EN PT-BR ES PH ID TR DE FR PL RU AR JA IT KO NL)
- Password gate "CLOSED BETA" + Web Audio звуки
- Supabase подключён, таблица codes создана через SQL Editor
- Лендинговая страница → Generator / Library
- Библиотека наполнена 10 стартовыми билдами (Sukuna, Gojo, Yuta...)
- **Статус: CLOSED BETA готов к тестированию**
