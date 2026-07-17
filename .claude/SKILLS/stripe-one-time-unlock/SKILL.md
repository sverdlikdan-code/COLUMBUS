---
name: stripe-one-time-unlock
description: Интеграция Stripe Checkout для разового платежа ($4.99 или любая сумма) с Pro-разблокировкой через cookie/JWT — Checkout Session, webhook-валидация, Pro-флаг на сервере. Использовать при любой задаче оплаты в JJS или другом веб-проекте с моделью "купи один раз — пользуйся всегда".
---

# Stripe One-Time Unlock — Разовый платёж для Pro-версии

## Overview

Паттерн для gaming/tool продуктов: пользователь платит один раз ($4.99) и получает Pro-доступ навсегда на текущем устройстве. Без аккаунтов, без подписки. Простейший путь к первой монетизации.

**Применяется в:** JJS Moveset Generator (Pro = безлимит генераций + сохранение кодов)

---

## Когда использовать

- Добавляешь монетизацию в веб-инструмент с моделью "разовый unlock"
- Нужна Stripe интеграция без полноценной системы аккаунтов
- Freemium с ограничением бесплатного tier + платный unlock
- Stripe webhook для подтверждения оплаты

---

## Архитектура (без аккаунтов)

```
Пользователь → [Unlock Button] → POST /api/create-checkout
                                        ↓
                               Stripe Checkout Session
                                        ↓
                          Пользователь вводит карту на Stripe
                                        ↓
                    success_url → GET /api/verify-payment?session_id=X
                                        ↓
                           Сервер проверяет session через Stripe API
                                        ↓
                              Set-Cookie: pro_token=<signed JWT>
                                        ↓
                              Пользователь — PRO навсегда (на этом устройстве)
```

Параллельно — webhook для надёжности (payment_intent.succeeded).

---

## Шаги интеграции

### Шаг 1 — Установка и env vars

```bash
npm install stripe
```

```env
STRIPE_SECRET_KEY=sk_live_...       # или sk_test_... для разработки
STRIPE_WEBHOOK_SECRET=whsec_...     # из Stripe Dashboard → Webhooks
PRO_TOKEN_SECRET=any-random-string-32chars  # для подписи JWT cookie
```

### Шаг 2 — Endpoint создания Checkout Session

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');

app.post('/api/create-checkout', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'JJS Generator Pro',
            description: 'Unlimited moveset generations forever',
            images: ['https://yourdomain.com/pro-badge.png'], // опционально
          },
          unit_amount: 499, // $4.99 в центах
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.DOMAIN}/api/verify-payment?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN}/?cancelled=1`,
      // Опционально — промокод поддержка:
      allow_promotion_codes: true,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### Шаг 3 — Verify endpoint (после редиректа с Stripe)

```javascript
app.get('/api/verify-payment', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    if (session.payment_status !== 'paid') {
      return res.redirect('/?error=payment_not_completed');
    }

    // Подписываем JWT cookie на 10 лет (практически навсегда)
    const token = jwt.sign(
      { pro: true, ts: Date.now() },
      process.env.PRO_TOKEN_SECRET,
      { expiresIn: '3650d' }
    );

    res.cookie('pro_token', token, {
      maxAge: 315360000000, // 10 лет в мс
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.redirect('/?pro=1');
  } catch (err) {
    res.redirect('/?error=verification_failed');
  }
});
```

### Шаг 4 — Middleware проверки Pro-статуса

```javascript
function checkPro(req) {
  const token = req.cookies?.pro_token;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, process.env.PRO_TOKEN_SECRET);
    return payload.pro === true;
  } catch {
    return false;
  }
}

// Использование в защищённых endpoints:
app.post('/api/generate', async (req, res) => {
  const isPro = checkPro(req);
  const { moves } = req.body;

  // Rate limit для free tier
  if (!isPro && moves.length > 3) {
    return res.status(403).json({
      error: 'Free tier: max 3 moves. Unlock Pro for unlimited.',
      requiresPro: true
    });
  }
  // ... остальная логика
});
```

Нужен `cookie-parser`:
```bash
npm install cookie-parser jsonwebtoken
```
```javascript
const cookieParser = require('cookie-parser');
app.use(cookieParser());
```

### Шаг 5 — Endpoint статуса Pro (для frontend)

```javascript
app.get('/api/pro-status', (req, res) => {
  res.json({ isPro: checkPro(req) });
});
```

### Шаг 6 — Webhook для надёжности

```javascript
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // Логирование успешных платежей (опционально — в БД или файл)
    console.log(`Payment completed: ${session.id}, email: ${session.customer_details?.email}`);
  }

  res.json({ received: true });
});

// ВАЖНО: webhook должен быть до express.json() middleware или использовать express.raw
```

**Важно:** webhook endpoint должен получать raw body (не JSON parsed). Регистрировать `/api/webhook` ДО `app.use(express.json())`.

---

## Frontend — кнопка Unlock и проверка статуса

```javascript
// Проверить статус при загрузке страницы
async function checkProStatus() {
  const res = await fetch('/api/pro-status');
  const { isPro } = await res.json();

  if (isPro) {
    document.getElementById('unlock-banner').style.display = 'none';
    document.getElementById('pro-badge').style.display = 'flex';
  }
}

// Кнопка покупки
async function startCheckout() {
  const btn = document.getElementById('unlock-btn');
  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/create-checkout', { method: 'POST' });
    const { url } = await res.json();
    window.location.href = url;
  } catch (err) {
    btn.textContent = 'Unlock Pro — $4.99';
    btn.disabled = false;
    alert('Error starting checkout. Please try again.');
  }
}

// После редиректа — проверить URL параметр
const params = new URLSearchParams(location.search);
if (params.get('pro') === '1') {
  showProSuccessToast(); // показать "Welcome to Pro!" анимацию
  history.replaceState({}, '', '/'); // убрать ?pro=1 из URL
}

checkProStatus();
```

---

## Тестирование

```bash
# Тестовые карты Stripe (test mode)
# Успешная оплата:
4242 4242 4242 4242  | любая дата в будущем | любые 3 цифры CVC

# Отклонённая карта:
4000 0000 0000 0002

# Webhook локально:
stripe listen --forward-to localhost:4242/api/webhook
```

---

## Prometheus чеклист перед деплоем

- [ ] `STRIPE_SECRET_KEY` — production ключ (не test)
- [ ] `STRIPE_WEBHOOK_SECRET` — из Stripe Dashboard → Webhooks → live endpoint
- [ ] `PRO_TOKEN_SECRET` — 32+ символов случайных (не "secret123")
- [ ] `DOMAIN` env var установлен на production URL
- [ ] cookie `secure: true` в production
- [ ] webhook URL зарегистрирован в Stripe Dashboard
- [ ] Тест с реальной картой на $1 (Stripe позволяет снизить для теста)

---

## Ограничения

- Без аккаунтов Pro привязан к устройству (cookie). Смена браузера/устройства — потеря Pro статуса.
- Если нужен cross-device доступ — нужна система аккаунтов (Clerk или custom), это отдельная задача.
- Этот скилл не покрывает Stripe Subscriptions (recurring payments).
- Возвраты (refunds) обрабатывать вручную в Stripe Dashboard или через API.
- Affiliate промокоды — в отдельном скилле `affiliate-promo-codes`.
