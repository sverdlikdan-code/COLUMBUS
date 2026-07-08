# Session 2026-07-08 — Formula Road AI Analytics

**Статус:** #done  
**Тема:** Formula Road — AI кнопка на клиентах + day briefing + invite system + F5 restore

---

## Что сделано

### 1. AI кнопка на каждой карточке клиента
- Фиолетовый пилл "AI" в строке кнопок (после מקרר)
- Модал с вкладками языка: עברית / Українська / Русский
- `GET /api/client-analytics/:custId` — 3 закрытых месяца по `מחלקה`
- Источник: основной датасет FORMULA (`ALL_PARTS` + `ADIFUT[מחלקה]`) — НЕ MMD
- AI: Gemini 1.5 Flash (`v1/gemini-1.5-flash-latest`) — 1500 req/день бесплатно
- Сравнение с средним по компании, дни без заказа

### 2. Gemini URL фикс
- Было: `v1beta/models/gemini-1.5-flash` → ошибка "not found"
- Стало: `v1/models/gemini-1.5-flash-latest` ✓

### 3. Day Briefing (UI: "כרגע בפיתוח", backend готов)
- `GET /api/day-briefing?day=N&lang=he`
- 3 параллельных DAX запроса: текущие 3М + те же 3М прошлого года (YoY) + средний по компании
- Метрики: total, YoY%, avgBasket (total/orderDays), SKU count (`DISTINCTCOUNT(ALL_PARTS[מק'ט])`)
- TOP 10 по продажам → Gemini ищет зоны роста + провалы
- Кнопка "AI יום" серая, завтра подключаем UI

### 4. Magic Link Invite System (готово, НЕ отправлено)
- `signInvite()` / `verifyInvite()` — HMAC-SHA256
- `GET /invite/:token` → createSession → localStorage → redirect
- 15 агентов CONNECTED=YES: коды 215,53,158,52,51,258,123,234,293,219,226,120,117,149,94
- `send_invites.js` в scratchpad готов
- `GET /admin/send-test-invite` → тестовое письмо на sverdlikdan@gmail.com
- **КРИТИЧНО: не отправлять всем до одобрения пользователем**

### 5. F5 State Restore
- `selectDay()` сохраняет `frLastDay` + `frLastCity` в localStorage
- При F5: если saved agent + lastDay + lastCity → пропускает город/день → сразу маршрут

### 6. GPS Priority подтверждён
- Приоритет: ручные правки (`gps-corrections.json`) → PBI GPS → AI Google / geocode
- Ручные правки ГЛАВНЫЕ, Google их не перебивает

---

## Ключевые технические решения

### Правило данных — FORMULA ONLY
- Analytics: `ALL_PARTS` + `ADIFUT[מחלקה]` + `POWERBI_DATASET_ID` (без ID = основной датасет)
- `ALL_PARTS[מספר לקוח]` = text, сравнение через `"${custId}"` (не parseInt)
- Никогда не использовать `Data MMD` / `POWERBI_MMD_DATASET_ID` для Formula Roads

### AI провайдер
- Gemini 1.5 Flash бесплатно (1500/день) → выбор для Formula Roads
- Anthropic Haiku ~$9/месяц при 15 агентах → пока не используем
- В Gemini уходят только анонимизированные суммы (без имени/ID клиента)

### YoY сравнение
- Текущий период: последние 3 закрытых месяца
- Прошлый год: те же месяцы -1 год
- `DISTINCTCOUNT(ALL_PARTS[תאריך])` = кол-во дней заказов (прокси для кол-ва заказов)

---

## На завтра

1. Подключить UI для "AI יום" button (modal + fetch + render)
2. Получить одобрение тестового письма → отправить всем 15 агентам
3. Протестировать AI кнопку на реальном клиенте (проверить Gemini работает)
4. Hierarchy в client AI: 0=יום, 1=מחלקה, 2=כשר/שוק, 3=TOP5, 4=Problems, 5=>3 недель без заказа

---

## Коммиты сессии
- `645e3304` feat(formula-road): AI кнопка + модал + endpoint
- `a9183267` fix(formula-road): Gemini v1beta→v1
- `9abee008` feat(formula-road): day briefing YoY + test invite endpoint
- `44b92b5e` feat(formula-road): F5 state restore
