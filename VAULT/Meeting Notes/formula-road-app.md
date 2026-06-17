---
title: Formula Road App — сессия сборки и настройки
date: 2026-05-01
status: in-progress
---

## Что сделано в этой сессии

### APK / EAS Build
- Установлен EAS CLI глобально
- Создан `app/eas.json` с профилями `preview` (APK) и `production` (AAB)
- Добавлен `android.package: "com.formularoad.app"` в `app.json`
- Проект привязан к Expo: ID `5a329f0b-5cc6-495f-bacb-1ff4d7ff25aa`, org `dansverdliks-organization`
- EXPO_TOKEN: `DVM_Ak4bBvaulEQM9MClYGszIBm04UKjFm5TDEOr`
- Собраны APK:
  - v1: `https://expo.dev/artifacts/eas/9c4gbKqVA9nZSv9JrFFdCs.apk` — базовая
  - v2: `https://expo.dev/artifacts/eas/9cXYiJCK8Q4xoZ1x9tb6A7.apk` — с UI правками (без Cloudflare URL)
  - v3: `b8a3654a` — in progress, с Cloudflare URL + все правки

### UI исправления
- **ClientCard** — имя магазина на отдельную строку (было обрезано)
- **RouteScreen** — адаптивный layout: на широком экране список (420px) + карта рядом
- **Toggle סדר ביקור / AI** — перенесён над списком на всю ширину
- **KmPanel** — иконка Excel заменена на SVG (убран emoji 📊)
- **ExportExcel** — добавлен web fallback (скачивание через браузер)
- **App.tsx** — модалка при первом запуске "создал ли shortcut на рабочий стол"

### Баг-фиксы
- **teams.js** — исправлена маппировка колонок Excel (row[0]=manager, row[1]=agentCode, row[3]=agentName). Раньше все строки пропускались → демо-режим всегда

### Cloudflare Tunnel
- Установлен `cloudflared.exe` на Desktop
- Временный туннель: `https://calculators-nextel-locator-james.trycloudflare.com`
- `client.ts` обновлён на этот URL
- `start-tunnel.bat` на Desktop — запускает сервер + туннель
- Ярлык добавлен в автозагрузку Windows
- **Минус:** URL меняется при перезагрузке компьютера → нужна новая сборка APK
- **Решение:** купить домен и создать Named Tunnel (постоянный URL)

## PBI Guard — 2026-06-16 ✅

**Задача:** спрятать Formula Road за Power BI кнопкой — нельзя открыть без прохождения через BI.

**Реализация** (идентична MMD ORDERS guard):
- Middleware `formulaRoadGuard` в `server/index.js`
- URL `https://api.sverdlik-apps.site/formula-road?k=FORMULA_PBI_KEY`
- При первом доступе с ключом → cookie `fr_ok=1; Path=/formula-road; HttpOnly; Max-Age=2592000` (30 дней)
- Без ключа и без cookie → 403 страница "גישה דרך Power BI בלבד"
- Данные: `/gps-corrections.json` и `/formula-road-data.json` — отдельные маршруты (без guard, публичны как GitHub Pages)

**Ключ:** `LN80v9eK7hEng5LagaHs2Feh` (в `.env` как `FORMULA_PBI_KEY`)

**URL для PBI кнопки:**
```
https://api.sverdlik-apps.site/formula-road?k=LN80v9eK7hEng5LagaHs2Feh
```

**Проверено:** без ключа → 403, с ключом → 200

---

## Что нужно сделать

- [ ] Дождаться APK v3 (`b8a3654a`)
- [ ] Купить домен (~$8-10/год на cloudflare.com/products/registrar)
- [ ] Создать Named Tunnel с постоянным URL
- [ ] Обновить `client.ts` на постоянный URL → финальная сборка APK
- [ ] Протестировать APK на телефоне агента
- [ ] Google Play: $25 аккаунт разработчика + сборка AAB + листинг
