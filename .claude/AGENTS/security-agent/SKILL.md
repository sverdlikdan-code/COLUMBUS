---
name: security-audit-web
description: Аудит безопасности веб-приложений и API на Node.js/Express. Включает OWASP Top 10, session management, CORS, rate limiting, security headers, XSS/injection prevention, Cloudflare WAF, audit logging. Применять при любых задачах по безопасности Formula Road или любого нового веб-проекта COLUMBUS.
trigger: ["security audit", "security report", "безопасность", "аудит безопасности", "уязвимость", "XSS", "CORS", "rate limit", "session token", "requireAuth", "hardening", "WAF"]
---

# SKILL: Web Security Audit & Hardening

## Область применения

Этот скилл покрывает полный цикл безопасности для веб-приложений COLUMBUS:
- Node.js/Express API-сервер
- Vanilla JS PWA (HTML/CSS/JS)
- Cloudflare (WAF, Tunnel, DNS)
- Статические файлы на GitHub Pages

---

## Чеклист аудита (OWASP Top 10 + Infrastructure)

### 1. Аутентификация и авторизация

- [ ] Все API-эндпоинты требуют аутентификацию (requireAuth middleware)
- [ ] Сессионные токены: UUID v4, достаточная энтропия
- [ ] TTL токена ограничен (≤8 часов для field agents)
- [ ] Пароли/ключи хранятся в `.env`, не в исходном коде
- [ ] `.env` в `.gitignore`
- [ ] Разные права для manager vs agent (isManager check)
- [ ] Rate limiting на /auth эндпоинте (≤10 попыток/мин с IP)

### 2. Управление данными

- [ ] Чувствительные данные (маршруты, коды агентов) не в публичных JSON
- [ ] Реальные имена/коды не в клиентском JavaScript (DEMO_AGENTS пустой)
- [ ] API-ответы не раскрывают стек, пути, внутренние ошибки
- [ ] Payload limit установлен (512KB для JSON)

### 3. Сетевая защита

- [ ] CORS whitelist: только известные домены (не `*`)
- [ ] Cloudflare WAF: geo-block для ограничения по стране
- [ ] HTTPS принудительный (Cloudflare Full SSL или выше)
- [ ] Нет открытых портов кроме 80/443 (через туннель)

### 4. HTTP Security Headers

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-XSS-Protection: 1; mode=block
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

- [ ] Все заголовки установлены на сервере (не на клиенте)

### 5. Валидация входных данных

- [ ] Agent code: regex `/^\d{1,10}$/` (только цифры, не более 10 символов)
- [ ] Manager name: charset whitelist `/^[\wא-ת\s+\-]{1,60}$/`
- [ ] Day parameter: `Number.isInteger(d) && d >= 1 && d <= 5`
- [ ] Нет прямой подстановки параметров в DAX-запросы без валидации
- [ ] HTML-escaping для всего что выводится в HTML (`esc()` функция)

### 6. Логирование и мониторинг

- [ ] Все входы (login/logout) логируются с IP, timestamp
- [ ] Критические операции (save-gps, save-kapua) логируются с агентом
- [ ] Лог ограничен по размеру (не растёт бесконечно)
- [ ] Лог доступен только через защищённый эндпоинт (ADMIN_LOG_KEY)
- [ ] Лог исключён из git (`.gitignore`)

### 7. Управление сессиями (клиент)

- [ ] Token хранится в localStorage (не в URL, не в cookies без secure flag)
- [ ] При 401 → автоматический logout и редирект на login
- [ ] Logout очищает token из localStorage
- [ ] apiFetch() добавляет X-Session header ко всем запросам

---

## Реализация: Express Security Template

### Основные компоненты

```javascript
// 1. CORS
app.use(cors({
  origin: ['https://sverdlikdan-code.github.io', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Session'],
}));

// 2. Payload limit
app.use(express.json({ limit: '512kb' }));

// 3. Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// 4. Session Management
const crypto = require('crypto');
const sessions = new Map();

function createSession(agentCode, isManager) {
  const token = crypto.randomUUID();
  sessions.set(token, {
    agentCode,
    isManager,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  });
  if (sessions.size > 500) {
    for (const [k, v] of sessions) {
      if (Date.now() > v.expiresAt) sessions.delete(k);
    }
  }
  return token;
}

function requireAuth(req, res, next) {
  const token = (req.headers['x-session'] || '').trim();
  const sess = sessions.get(token);
  if (!sess || Date.now() > sess.expiresAt) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.session = sess;
  next();
}

// 5. Rate Limiting
const loginAttempts = new Map();
const generalRequests = new Map();

function checkRateLimit(ip, map, maxCount, windowMs) {
  const now = Date.now();
  const entry = map.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  map.set(ip, entry);
  return entry.count > maxCount;
}

// 6. Input Validation
function validateAgentCode(code) { return /^\d{1,10}$/.test(String(code || '')); }
function validateManagerName(name) { return /^[\wא-ת\s+\-]{1,60}$/.test(String(name || '')); }

// 7. XSS Prevention
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 8. Real IP (через Cloudflare)
function getRealIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip || 'unknown';
}
```

### Защищённый эндпоинт: шаблон

```javascript
app.get('/protected-endpoint', requireAuth, dataRateLimit, async (req, res) => {
  const { agentCode } = req.session;
  const param = req.query.myParam;
  
  // 1. Валидация
  if (!validateAgentCode(param)) return res.status(400).json({ error: 'invalid_param' });
  
  // 2. Логика
  const data = await getData(agentCode, param);
  
  // 3. Ответ (без раскрытия внутренней структуры)
  res.json({ ok: true, data });
});
```

---

## Cloudflare WAF: правило geo-block

```
Expression: (ip.geoip.country ne "IL")
Action: Block
```

Активировать в: Security → WAF → Custom Rules → Create Rule

---

## Client-side: apiFetch шаблон

```javascript
function _getToken() { return localStorage.getItem('frToken') || ''; }
function _saveToken(t) { if (t) localStorage.setItem('frToken', t); }

async function apiFetch(url, opts = {}) {
  const token = _getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['X-Session'] = token;
  const r = await fetch(url, { ...opts, headers });
  if (r.status === 401) {
    localStorage.removeItem('frToken');
    alert('פג תוקף הסשן — נא להתחבר מחדש');
    window.location.reload();
    throw new Error('session_expired');
  }
  return r;
}
```

---

## Оценка уровней риска

| Уровень | Критерий | Действие |
|---------|----------|---------|
| Критический | Аутентификация обходима / данные публичны | Немедленно закрыть |
| Высокий | Инъекция возможна / нет rate limit | В течение 24ч |
| Средний | Инфраструктурный риск (локальный сервер) | Планировать миграцию |
| Низкий | Улучшение процессов (ротация сессий) | Следующий спринт |

---

## Модель угроз Formula Road

| Угроза | Вектор | Мера | Статус |
|--------|--------|------|--------|
| Брутфорс пароля | /auth POST | Rate limit 10/min + IP | ✅ Закрыт |
| Несанкционированный доступ к маршрутам | GET /customers | requireAuth | ✅ Закрыт |
| Доступ к данным из другой страны | Прямой URL | Cloudflare geo-block IL | ✅ Закрыт |
| Кража токена из localStorage | XSS | CSP headers, esc() | ✅ Закрыт |
| Injection в DAX-запрос | API параметр | Regex whitelist | ✅ Закрыт |
| XSS в admin логах | /admin/logs | esc() HTML-escaping | ✅ Закрыт |
| CSRF | Cross-site request | CORS whitelist | ✅ Закрыт |
| DoS через большой payload | POST body | 512KB limit | ✅ Закрыт |
| Перехват данных (MitM) | HTTP | Cloudflare HTTPS | ✅ Закрыт |
| Кража .env с диска | Физический доступ | BitLocker (R-02) | ⚠️ Открыт |
| Сервер недоступен (авария машины) | Локальный сервер | VPS (R-01) | ⚠️ Открыт |
