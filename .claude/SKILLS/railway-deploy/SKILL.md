---
name: railway-deploy
description: Деплой Node.js/Express приложения на Railway — не на Columbus VPS. Настройка env vars, custom domain, auto-deploy из GitHub, health checks, Railway CLI. Использовать для JJS Moveset Generator и любых изолированных пет-проектов на Railway Starter ($5-20/мес).
---

# Railway Deploy — Node.js на Railway

## Overview

Railway — простейший способ задеплоить Node.js приложение без настройки VPS. Автоматически определяет Node.js, деплоит при каждом пуше в GitHub, даёт публичный URL за 2 минуты.

**Важно:** JJS Generator деплоится на Railway, **НЕ** на Columbus VPS (31.154.67.58). VPS — только для Formula Road. Эти проекты изолированы намеренно.

---

## Когда использовать

- Деплоишь JJS Moveset Generator или другой изолированный пет-проект
- Нужен быстрый деплой Node.js без конфигурации сервера
- Настраиваешь env vars (Stripe ключи, домен) для production
- Подключаешь custom domain к Railway проекту

---

## Предварительные требования

```
- Node.js приложение с package.json
- npm start или node server.js как точка запуска
- GitHub репозиторий (Railway деплоит из git)
- process.env.PORT — Railway сам назначает порт (не хардкодить 4242)
```

---

## Шаг 1 — Подготовка приложения

### package.json — обязательные поля

```json
{
  "name": "jjs-generator",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

`scripts.start` — Railway запускает именно его.
`engines.node` — укажи версию которую используешь локально.

### server.js — PORT из env

```javascript
// Правильно:
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Неправильно (Railway не пробросит трафик на фиксированный порт):
// app.listen(4242);
```

### .gitignore — не пушить секреты

```
node_modules/
.env
.env.local
*.log
```

### railway.toml — опционально (обычно не нужен)

Railway сам определяет Node.js и запускает `npm start`. `railway.toml` нужен только для кастомной конфигурации:

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node server.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
```

---

## Шаг 2 — Деплой через Railway Dashboard (рекомендуется для первого раза)

1. Зайти на [railway.app](https://railway.app) → Sign in with GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Выбрать репозиторий с JJS Generator
4. Railway автоматически:
   - Определит Node.js
   - Запустит `npm install`
   - Запустит `npm start`
   - Даст URL вида `https://jjs-generator-production.up.railway.app`

Первый деплой — 2-3 минуты.

---

## Шаг 3 — Настройка env vars

В Railway Dashboard → твой проект → **Variables**:

```
STRIPE_SECRET_KEY      = sk_live_...
STRIPE_WEBHOOK_SECRET  = whsec_...
PRO_TOKEN_SECRET       = random-32-char-string-here
DOMAIN                 = https://jjscodegen.com
NODE_ENV               = production
```

**Никогда** не коммитить `.env` с секретами в git.

После добавления переменных — Railway автоматически перезапустит сервис.

---

## Шаг 4 — Custom Domain

1. Railway Dashboard → твой сервис → **Settings** → **Domains**
2. **Add Custom Domain** → ввести `jjscodegen.com` (или другой домен)
3. Railway покажет CNAME запись которую надо добавить у регистратора:
   ```
   Type:  CNAME
   Name:  @  (или www)
   Value: <railway-provided>.railway.app
   ```
4. Добавить у регистратора (Namecheap, GoDaddy, Cloudflare DNS)
5. SSL сертификат — Railway выпускает автоматически через Let's Encrypt (~5 минут)

**Через Cloudflare:**
- Cloudflare → DNS → Add CNAME запись
- Proxy status: **DNS only** (серая тучка, не оранжевая) — Railway не работает через Cloudflare proxy для custom domains по умолчанию
- Или включить Cloudflare proxy + отключить SSL verification на Railway стороне

---

## Шаг 5 — Railway CLI (для деплоя из командной строки)

```bash
# Установка
npm install -g @railway/cli

# Логин
railway login

# Привязать локальную папку к Railway проекту
railway link

# Задеплоить текущую ветку
railway up

# Посмотреть логи
railway logs

# Открыть сервис в браузере
railway open

# Переменные окружения
railway variables set STRIPE_SECRET_KEY=sk_live_...
railway variables get
```

---

## Шаг 6 — Настройка Stripe Webhook для production

После получения production URL, зарегистрировать webhook в Stripe:

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL: `https://jjscodegen.com/api/webhook`
3. Events to listen: `checkout.session.completed`
4. После создания — скопировать **Signing secret** (whsec_...) → в Railway Variables → `STRIPE_WEBHOOK_SECRET`

---

## Auto-deploy из GitHub

По умолчанию Railway деплоит при каждом пуше в `main` ветку.

Чтобы изменить ветку:
- Railway Dashboard → Settings → **Source** → выбрать ветку

Чтобы отключить auto-deploy:
- Settings → **Deploy Triggers** → Manual deploys

---

## Мониторинг и логи

```bash
# Логи в реальном времени через CLI:
railway logs --follow

# Или в Dashboard:
# Railway Dashboard → твой сервис → Logs
```

**Health check endpoint** (хорошая практика):

```javascript
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime()
  });
});
```

Railway будет проверять `/health` и перезапускать сервис если не отвечает.

---

## Стоимость и лимиты

| Plan | Стоимость | Лимиты |
|------|-----------|--------|
| Hobby (рекомендуется) | $5/мес | 512MB RAM, 1 vCPU, 100GB bandwidth |
| Pro | $20/мес | 8GB RAM, несколько сервисов |
| Free (Trial) | $0 | $5 кредитов, потом платно |

Для JJS Generator — Hobby плана достаточно до ~50K запросов/день.

---

## Типичные проблемы

| Проблема | Решение |
|----------|---------|
| `PORT` не работает | Убедиться что `process.env.PORT` используется, не хардкодить |
| Build fails | Проверить `npm start` в `package.json`, проверить `engines.node` |
| Env vars не применились | Railway перезапускает после изменения vars — проверить логи |
| Custom domain не работает | CNAME запись у регистратора, Railway требует DNS-only у Cloudflare |
| Stripe webhook 400 | `express.raw()` middleware должен быть ДО `express.json()` |
| `node_modules` в репо | Добавить в `.gitignore`, Railway сам запускает `npm install` |

---

## Чеклист перед публичным запуском JJS на Railway

- [ ] `process.env.PORT` используется в server.js
- [ ] `node_modules` в .gitignore
- [ ] Все env vars добавлены в Railway Variables
- [ ] `NODE_ENV=production` установлен
- [ ] `DOMAIN` env var установлен на production URL
- [ ] Stripe webhook зарегистрирован с production URL
- [ ] `STRIPE_WEBHOOK_SECRET` обновлён на production значение
- [ ] Custom domain настроен и SSL работает
- [ ] `/health` endpoint отвечает 200
- [ ] Rate limiting включён (см. `security-audit-web`)

---

## Ограничения

- Railway не подходит для Columbus Formula Road (тот деплоится на VPS через SSH + pm2)
- SQLite в Railway не персистентен между деплоями — данные сбрасываются. Для персистентного хранения использовать Railway PostgreSQL add-on или Supabase.
- Нет SSH доступа к контейнеру (в отличие от VPS).
- Railway не поддерживает WebSockets на Free/Hobby из коробки — нужен Pro и настройка.
