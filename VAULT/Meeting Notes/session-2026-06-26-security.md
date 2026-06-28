---
name: session-2026-06-26-security
description: Еженедельный security scan + full hardening server/index.js — SSRF, auth guards, DAX injection, whitelist
metadata:
  type: project
---

# Сессия 2026-06-26 — Security Hardening #done

## Security Scan (security-agent)

Просканировано `server/index.js` (1802 строки), все Express routes.

## Закрытые уязвимости

### ❌ → ✅ SSRF (критический)
- **Routes:** `POST /api/export-order-xlsx`, `POST /api/export-position-xlsx`
- **Проблема:** `fetch(r.photoUrl)` без проверки URL — атакующий мог заставить сервер обращаться на 127.0.0.1, metadata API и т.д.
- **Фикс:** добавлена функция `isSafePhotoUrl()` — whitelist `https://` + блок приватных IP-диапазонов (127.x, 10.x, 192.168.x, 169.254.x, 172.16-31.x) и внутренних хостов (.internal, .local, .corp, localhost)

### ⚠️ → ✅ Открытые data endpoints без auth (высокий)
- `/pbi/dagim-sales` → добавлен `requireAuth`
- `/api/order-history` (GET + POST) → добавлен `requireAuth`
- `/pbi/mmd-orders` → добавлен `mmdGuard`
- `/gps-corrections.json` → добавлен `formulaRoadGuard`
- `/formula-road-data.json` → добавлен `formulaRoadGuard`
- `/pbi/formula-refresh` → добавлен `dataRateLimit`

### ⚠️ → ✅ DAX injection в /api/client-sales (средний)
- Убрана `'` из allowed chars regex
- Усилен эскейп: `.replace(/["\\\]]/g, '')` вместо только `"`

### ⚠️ → ✅ /api/mekarer-order — spread без whitelist (средний)
- `{ id, ...order }` заменён на explicit destructuring с `substring()` limits
- Принимаются только: custId, custName, city, agentName, contactName, phone, location, mekarerim (max 50), manager

### 🟢 → ✅ /log-access — rate limit не работал (низкий)
- `checkGeneralLimit` (возвращал boolean, не middleware) → `dataRateLimit`

## Коммиты
- `security: fix SSRF in export-xlsx routes - validate photoUrl before fetch`
- `security: fix all remaining scan findings - auth guards, DAX injection, mekarer whitelist, rate limit`
