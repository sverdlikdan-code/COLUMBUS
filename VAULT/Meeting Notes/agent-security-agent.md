---
title: Security Agent — аудит безопасности веб-приложений COLUMBUS
date: 2026-05-28
status: active
---

## Что это

Security Agent — специалист по безопасности в системе COLUMBUS. Создан 2026-05-28 после полного аудита и hardening Formula Road PWA + API.

**Файлы:**
- `AGENT.md`: `.claude/AGENTS/security-agent/AGENT.md`
- `SKILL.md`: `.claude/AGENTS/security-agent/SKILL.md`
- `PRD`: `PRD/security-agent-prd.md`

---

## Что умеет

- Аудит веб-приложений по OWASP Top 10
- Hardening Express.js API (session tokens, rate limiting, validation, headers)
- Настройка Cloudflare WAF (geo-block, custom rules)
- Аудит клиентского кода (token management, apiFetch, DEMO_AGENTS)
- Создание профессиональных HTML security reports
- Мониторинг access-log.json на аномалии

---

## Текущая зона ответственности

**Проект:** Formula Road PWA  
**Компоненты:** `server/index.js`, `docs/formula-road.html`, `docs/formula-road-data.json`, Cloudflare WAF

---

## Сессия 2026-05-28 — Полный hardening Formula Road [done]

### Что было сделано

**Аутентификация:**
- Session tokens (UUID v4, 8ч TTL) через X-Session header
- Единый /auth эндпоинт (заменил /auth/manager) — валидирует и менеджера и агентов
- requireAuth middleware на всех 6 API-эндпоинтах
- isManager check на /save-kapua
- Пароль менеджера в .env

**Сетевая защита:**
- Cloudflare WAF: Block non-Israel (ip.geoip.country ne "IL") — Активно
- CORS whitelist: только sverdlikdan-code.github.io + localhost
- Payload limit 512KB

**Anti-abuse:**
- Rate limit: 10 auth попыток/мин с IP
- Rate limit: 60 data запросов/мин с IP

**Данные:**
- `routes` и `agents` удалены из публичного formula-road-data.json (был 307KB → ~5KB)
- DEMO_AGENTS очищен: `const DEMO_AGENTS = {};`

**Приложение:**
- Валидация: agentCode `/^\d{1,10}$/`, managerName charset whitelist, day 1-5
- esc() HTML-escaping в /admin/logs
- 5 HTTP security headers

**Мониторинг:**
- access-log.json: login/logout + GPS saves + planogram saves
- access-log.json в .gitignore
- /admin/logs?key=KEY защищён ADMIN_LOG_KEY

**Отчёт:**
- `SECURITY-REPORT-Formula-Road-2026.html` — clean current-state report

### Остаточные риски

- R-01: Сервер на локальной машине (рекомендована миграция на VPS)
- R-02: Нет BitLocker на диске
- R-03: Старый git history
- R-04: Нет /admin/revoke эндпоинта

### Текущий статус системы

MAINTENANCE_MODE = true в docs/formula-road.html (line 408) — ждёт команды пользователя

---

## Решения и правила

- Security отчёт: только текущее состояние, без языка "было уязвимо / исправлено"
- Агентам не усложнять аутентификацию (текущий мספר סוכן — норма)
- access-log.json не коммитить в git
- SECURITY-REPORT хранить в корне проекта, не в docs/

## Related

- [[formula-road-app]] — состояние PWA до/после hardening
- [[agent-fin-agent]] — аналог по структуре AGENT.md
- [[prd-status]] — обновить таблицу покрытия
