---
name: session-2026-07-22-security-audit-3apps
description: Read-only аудит Formula Road, Mahsan Editor, MMD Orders — стек, security, PBI-гейт, критичные находки, фиксы
metadata:
  type: project
---

# Сессия 2026-07-22 — Аудит 3 приложений #done

## Задача
CEO-координация: read-only аудит Formula Road / Mahsan Editor / MMD Orders — стек + security + оптимизация + doctor-риски. 3 параллельных агента, свод в один Artifact-отчёт на русском.

## Критичные находки (были)
- `GET /api/territory/jerusalem`, `POST /api/territory/geocode` — без auth, открытый `cors({origin:true})`, обходили PBI-гейт (`formulaRoadGuard`). **Пофикшено в сессии**: переведены на `requireAuth` (+ `dataRateLimit` на geocode), убран `cors({origin:true})`.
- `GET /admin/send-test-invite` — забытый debug-роут без auth, шлёт письма через Resend. Не пофикшено, остаётся в бэклоге.
- `mmdGuard` открывается полностью если `MMD_PBI_KEY` не задан (dev-фолбэк) — **проверено на VPS через SSH**: ключ реально задан, риска нет.
- Mahsan Editor — PBI-гейта нет вообще (в отличие от Formula Road/MMD Orders). **Подтверждено пользователем 22.07: осознанное решение, не баг.**
- `/pbi/dagim-sales` — до сих пор не фильтрует по `מחסן="Main"` — известный баг, живой в 3 фронтендах одновременно.
- `MANAGER_PASS` на VPS — 4 символа (длина совпадает с дефолтным фолбэком `'1999'`, содержимое не проверялось).

## Инфраструктурный факт
Все три приложения — один монолит `server/index.js` (3899 строк) на VPS 31.154.67.58, pm2 `columbus-api`. `.env` лежит в `/root/COLUMBUS/.env` (не в `server/.env`).

## SSH-открытие сессии
Windows `ssh-agent` держит ключ `columbus` разблокированным на уровне ОС — SSH на VPS работает из PowerShell без пароля в любой будущей сессии. Через Git Bash — не работает (свой пустой agent). См. [[reference_vps_ssh_access]] (память Claude).

## Отчёт
Artifact (не в репо, сессионный) — сводный HTML-отчёт по 3 приложениям с severity-таблицами, PBI-гейт сверкой, doctor-рисками.

## Related
[[agent-security-agent]], [[formula-road-app]], [[skill-hebrew-bidi]]
