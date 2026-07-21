# Сессия 2026-07-14: PBI Refresh Management + MMD Credentials

## Статус: ✅ частично завершено

## Что сделано

### FORMULA DASHBORD (юлин датасет)
- Диагностировано: schedule отключён PBI автоматически после consecutive errors
- Причина: gateway юли упал (её комп выключился/уснул)
- Кнопка **"Take over"** найдена в Settings — нужно нажать чтобы стать owner
- После Take over → включить Refresh schedule вручную в PBI UI
- Service principal не может включить schedule (403 — only dataset owner)

### MMD (датасет Дана)
- Owner: d.sverdlik ✅ (Take over не нужен)
- Schedule: enabled=true, 8 раз в день ✅
- Настроен cron на VPS: каждые 20 минут 06:00–22:00 IST (03:00–18:59 UTC)
- **Cron остановлен** — пришёл email "MMD data refresh disabled" из-за credentials на HEVRA.xlsx
- Причина: `\\dilerbmdsrv\yulia-dan\bi pilot\MMD\HEVRA.xlsx` — нет доступа

### Gateway
- Все источники MMD на локальной сети (192.168.100.x + \\dilerbmdsrv)
- Gateway обязателен для локальных источников, без него никак
- Если перенести HEVRA.xlsx в OneDrive → gateway для этого файла не нужен
- SQL 192.168.100.x — gateway обязателен

### Проверка מק"ט 1166
- Продукт: חתיכות פילה דג הרינג מלוח — DAGIM 🐟, статус פעיל
- מלאי Main (אשדוד): **4,041 קרטון**
- מלאי всего: 4,971 קרטון
- הזמנות פתוחות: 0

## Осталось сделать
- [ ] Нажать "Take over" на FORMULA DASHBORD в PBI UI
- [ ] Включить Refresh schedule для FORMULA DASHBORD
- [ ] Fix credentials для HEVRA.xlsx (Edit credentials → Windows auth)
- [ ] После fix — восстановить cron для MMD (каждые 20 мин)

## Технические детали
- MMD dsId: `77f218a5-cb23-4ad4-a6e4-e515e7eda1b9`
- FORMULA DASHBORD dsId: `457ddbf6-86f3-4d1f-8505-f4fd6ee0fb84`
- wsId (оба): `fa961d5f-21c6-4faa-aab6-12964ab3bf5b`
- Pro лимит: 48 refreshes/день → cron макс 20 мин интервал
- FORMULA dataset: таблица מלאי = `מלאי-תוקף` (не `מלאי INT+F+ICE`)
- VPS cron файл: `/root/COLUMBUS/server/refresh_mmd.js`
