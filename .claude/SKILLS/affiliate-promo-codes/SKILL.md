---
name: affiliate-promo-codes
description: Система промокодов для аффилиатов через Stripe Discount Codes — создание купонов, трекинг конверсий по партнёрам, 50% модель выплат. Использовать когда нужно добавить реферальную/аффилиатную систему в веб-продукт с Stripe-оплатой (JJS, любой gaming или SaaS инструмент).
---

# Affiliate Promo Codes — Система промокодов для партнёров

## Overview

Аффилиатная система для JJS Moveset Generator: YouTube-партнёры (NATEZO, BAXTH, TECHYOP и другие) получают уникальные промокоды. Когда зрители используют промокод при покупке Pro — аффилиат получает 50% от продажи ($2.50 из $4.99).

**Два подхода:**
- **Stripe-native** (рекомендуется): Stripe Coupon + Promotion Code, скидка для пользователя встроена в Stripe Checkout
- **Custom кастомный**: собственная таблица промокодов в БД, ручной трекинг

Для JJS без аккаунтов — начинать со Stripe-native, без своей БД.

---

## Когда использовать

- Добавляешь промокоды для аффилиатов/партнёров в продукт со Stripe
- Нужно отслеживать конверсии по партнёрам
- Настраиваешь YouTube/Discord / TikTok партнёрскую программу
- Модель: партнёр продвигает → его аудитория покупает → партнёр получает % от продаж

---

## Подход 1 — Stripe-native (рекомендуется для JJS)

### Как работает

```
Аффилиат NATEZO получает промокод "NATEZO"
    ↓
Зритель вводит NATEZO при Checkout ($4.99 → $3.49 или без скидки)
    ↓
Stripe фиксирует promotion_code использование
    ↓
В конце месяца — report из Stripe Dashboard по каждому промокоду
    ↓
Ручная выплата аффилиату 50% × количество использований × $4.99
```

### Шаг 1 — Создать Coupon в Stripe

```javascript
// Один раз — создать базовый купон (например, без скидки для пользователя — просто трекинг)
// Или со скидкой для пользователя (стимул использовать промокод)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function createAffiliateCoupon(affiliateName, discountPercent = 0) {
  // Вариант A: Без скидки для пользователя (чистый трекинг)
  // Вариант B: 10% скидка пользователю как стимул
  
  const coupon = await stripe.coupons.create({
    name: `${affiliateName} Affiliate`,
    percent_off: discountPercent > 0 ? discountPercent : undefined,
    amount_off: discountPercent === 0 ? undefined : undefined,
    currency: discountPercent === 0 ? undefined : 'usd',
    duration: 'once',
    metadata: {
      affiliate: affiliateName.toLowerCase(),
      commission_rate: '0.50' // 50% для аффилиата
    }
  });

  // Создать Promotion Code (публичный код который вводит пользователь)
  const promoCode = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code: affiliateName.toUpperCase(), // NATEZO, BAXTH, TECHYOP
    metadata: {
      affiliate: affiliateName.toLowerCase()
    }
  });

  console.log(`Created promo code: ${promoCode.code} (id: ${promoCode.id})`);
  return promoCode;
}

// Запустить один раз для каждого аффилиата:
// createAffiliateCoupon('NATEZO');
// createAffiliateCoupon('BAXTH');
// createAffiliateCoupon('TECHYOP');
```

### Шаг 2 — Включить промокоды в Checkout

В endpoint `/api/create-checkout` добавить один параметр:

```javascript
const session = await stripe.checkout.sessions.create({
  // ... остальные параметры из stripe-one-time-unlock
  allow_promotion_codes: true, // Stripe покажет поле "Promo code" в UI
});
```

Stripe сам покажет поле для промокода в интерфейсе — никаких дополнительных изменений на фронтенде.

### Шаг 3 — Трекинг через webhook

```javascript
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = stripe.webhooks.constructEvent(
    req.body,
    req.headers['stripe-signature'],
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // Если использован промокод — зафиксировать
    if (session.total_details?.breakdown?.discounts?.length > 0) {
      const discount = session.total_details.breakdown.discounts[0];
      const promoCodeId = discount.discount?.promotion_code;
      
      // Опционально: логировать в файл или БД
      logAffiliateConversion({
        promoCodeId,
        sessionId: session.id,
        amount: session.amount_total,
        timestamp: new Date().toISOString()
      });
    }
  }

  res.json({ received: true });
});

function logAffiliateConversion(data) {
  const fs = require('fs');
  const log = JSON.stringify(data) + '\n';
  fs.appendFileSync('./affiliate-log.jsonl', log);
  console.log('Affiliate conversion:', data);
}
```

### Шаг 4 — Ежемесячный отчёт из Stripe Dashboard

В Stripe Dashboard → Reports → Promotion codes:
- Видно сколько раз использован каждый промокод
- Сколько дохода принёс каждый аффилиат
- Экспорт в CSV

Формула выплаты аффилиату:
```
Выплата = Количество использований × $4.99 × 50%

NATEZO: 20 использований × $4.99 × 50% = $49.90
BAXTH:  12 использований × $4.99 × 50% = $29.94
```

---

## Подход 2 — Custom кастомный (если нужен больший контроль)

Использовать только если нужно:
- Скидки разного размера для разных аффилиатов
- Лимит на количество использований промокода
- Своя аналитика без Stripe Dashboard

### Структура таблицы промокодов

```javascript
// Если используется SQLite (better-sqlite3):
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    affiliate TEXT NOT NULL,
    discount_percent INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 1000,
    uses_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    session_id TEXT UNIQUE,
    amount_cents INTEGER,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Начальные данные
const codes = [
  { code: 'NATEZO',  affiliate: 'natezo',  discount: 0 },
  { code: 'BAXTH',   affiliate: 'baxth',   discount: 0 },
  { code: 'TECHYOP', affiliate: 'techyop', discount: 0 },
];
codes.forEach(c => {
  db.prepare('INSERT OR IGNORE INTO promo_codes (code, affiliate, discount_percent) VALUES (?, ?, ?)')
    .run(c.code, c.affiliate, c.discount);
});
```

### Валидация промокода перед Checkout

```javascript
app.post('/api/validate-promo', (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });

  const promo = db.prepare(
    'SELECT * FROM promo_codes WHERE code = ? AND active = 1 AND uses_count < max_uses'
  ).get(code.toUpperCase());

  if (!promo) return res.json({ valid: false, message: 'Invalid or expired code' });

  res.json({
    valid: true,
    affiliate: promo.affiliate,
    discount: promo.discount_percent,
    message: `Code applied! (${promo.affiliate} affiliate)`
  });
});
```

---

## Стратегия промокодов для JJS

### Модель без скидки для пользователя

```
NATEZO → $4.99 полная цена
Аффилиат получает: $4.99 × 50% = $2.49/конверсию
```

Мотивация для аффилиата: деньги. Мотивация для зрителя: поддержать любимого ютубера.

### Модель со скидкой для пользователя

```
NATEZO → $4.49 (10% скидка)
Аффилиат получает: $4.49 × 50% = $2.24/конверсию
Зритель: сэкономил $0.50 + помог каналу
```

Конверсия выше, выплата чуть меньше. Рекомендуется для первых аффилиатов.

### Онбординг нового аффилиата (письмо/DM)

```
Hey [Affiliate Name]!

I'm launching JJS Moveset Generator — the only working moveset code 
builder for Jujutsu Shenanigans.

Your promo code: [CODE]

How it works:
- Mention your code in videos/streams
- Viewers use it when buying Pro ($4.99)
- You get 50% = $2.49 per sale, paid monthly via PayPal

No signup needed. I track everything through Stripe.
First payout when you reach $20.

Interested?
```

---

## Ограничения

- Stripe-native трекинг требует Stripe Dashboard для отчётов — нет своего дашборда
- Выплаты аффилиатам — ручные (PayPal/Wise), нет автоматизации
- Для автоматических выплат нужен Stripe Connect (сложнее, не нужно для старта)
- Этот скилл предполагает уже настроенный Stripe Checkout (см. `stripe-one-time-unlock`)
