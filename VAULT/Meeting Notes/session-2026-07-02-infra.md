# Сессия 2026-07-02: Formula Road инфраструктура — туннель на VPS, GPS fixes

#status/done #agent/ceo #scope/formula-road #scope/infra

## Критическое открытие — архитектура туннелей

**Было (неправильно):**
- `api.sverdlik-apps.site` → LOCAL Windows cloudflared (tunnel `579497d4`, запущен 23 июня) → локальный node:3000
- `api-corp.sverdlik-apps.site` → VPS cloudflared (tunnel `37343a7f`) → VPS node:3000

**Стало (правильно):**
- `api.sverdlik-apps.site` → VPS `cloudflared-api` systemd service (tunnel `579497d4`) → VPS node:3000
- `api-corp.sverdlik-apps.site` → VPS `cloudflared` systemd service (tunnel `37343a7f`) → VPS node:3000

Это объясняет ВСЕ предыдущие проблемы: заказы на локальном ПК, демо-режим, данные от Jun 30.

## Детали туннелей

| Туннель | ID | Домен | Где |
|---|---|---|---|
| `579497d4` | `api.sverdlik-apps.site` | VPS `/etc/systemd/system/cloudflared-api.service` |
| `37343a7f` | `api-corp.sverdlik-apps.site` | VPS `/etc/systemd/system/cloudflared.service` |

Credentials файл: `/root/.cloudflared/579497d4-7250-41b5-a3d1-0e04b3094afa.json`
Config: `/root/.cloudflared/config-api.yml` → `ingress: http://localhost:3000`

## Цепочка ошибок сессии

1. **Демо-режим** → браузер заходил через localhost, токен не признавался VPS → добавлен redirect IS_LOCAL
2. **ERR_TOO_MANY_REDIRECTS** → IS_LOCAL redirect + локальный cloudflared = loop
3. **Error 1033** → убил локальный cloudflared → туннель api.sverdlik-apps.site упал
4. **Финальный фикс** → перенёс tunnel `579497d4` на VPS как новый systemd сервис `cloudflared-api`

## IS_LOCAL fix (server/index.js)
`/formula-road` на локальном сервере теперь возвращает HTML-страницу с ссылкой на VPS — НЕ redirect (чтобы не было loop если cloudflared запустится локально снова).

## Formula Road UX fixes

### GPS תקן מיקום — сохранение зума
- `fitBounds` теперь пропускается при `gpsCorrectMode === true`
- При входе в режим: `panTo` к клиенту без смены зума
- Тайл автоматически переключается на **OSM (מספרי בתים)** при входе в GPS-режим
- При выходе/отмене — тайл возвращается к предыдущему

### מקרר Excel (продолжение с 01.07)
- Invalid Date исправлен (`new Date()` вместо `new Date(order.submittedAt)`)
- `mergeCells` убраны → заголовок через `centerContinuous`, info-строки без merge
- CSS `#f-phone { text-align: right }` в форме

## Команды для диагностики туннелей
```bash
# Статус VPS туннелей
systemctl status cloudflared cloudflared-api

# Логи
journalctl -u cloudflared-api -n 20

# Тест
curl -s -o /dev/null -w '%{http_code}' https://api.sverdlik-apps.site/health
```
