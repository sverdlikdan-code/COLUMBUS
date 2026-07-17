---
name: gaming-web-app-ui
description: Дизайн и редизайн веб-приложений для геймерской аудитории (10-17 лет, Roblox, аниме-файтинги, battle royale) — тёмная тема, неоновые акценты, glow-эффекты, игровая типографика, анимации. Использовать при любом UI-задании для JJS Moveset Generator или любого другого игрового веб-инструмента.
---

# Gaming Web App UI — Гейминг-эстетика для веб-инструментов

## Overview

Геймерская аудитория 10-17 лет ожидает UI, который выглядит как игра — не как корпоративный SaaS. Этот скилл описывает паттерны дизайна для веб-приложений в игровом нише: тёмные фоны, неоновые акценты, энергичные анимации, гейм-типографика.

**Целевые проекты COLUMBUS:**
- JJS Moveset Generator (Jujutsu Shenanigans / Roblox)
- Будущие инструменты для других аниме-баттлграундсов (TSB, Project Mugetsu)
- Любой веб-инструмент для gaming сообщества

---

## Когда использовать

- Создаёшь или редизайнишь UI для игрового веб-инструмента
- Пользователь просит сделать "круче", "по-геймерски", "как в игре"
- Нужно добавить анимации, glow, частицы в существующий тёмный UI
- Улучшаешь конверсию через визуальный дизайн для геймеров

---

## Цветовая палитра — стандарт JJS

Текущая рабочая палитра JJS Moveset Generator:

```css
/* Фоны */
--bg-deep:    #0d0d0d;   /* основной фон */
--bg-card:    #111827;   /* карточки */
--bg-input:   #1e293b;   /* поля ввода */
--bg-header:  linear-gradient(135deg, #1a0a2e, #16213e);

/* Акценты — фиолетовый / JJK палитра */
--accent-primary:  #7c3aed;   /* кнопки, активные элементы */
--accent-light:    #c084fc;   /* заголовки, иконки */
--accent-hover:    #6d28d9;   /* hover состояние */

/* Информационные цвета */
--info-blue:    #60a5fa;   /* badge SKILL */
--danger-red:   #f87171;   /* badge MELEE, ошибки */
--special-purple: #c084fc; /* badge SPECIAL */
--success-green:  #4ade80; /* подтверждения */
--code-cyan:    #a5f3fc;   /* вывод кода */

/* Границы */
--border-subtle: #1e2a3a;
--border-mid:    #2a1a4e;
--border-active: #7c3aed;
```

Для других игровых тем (смена акцента):
- **Naruto/Boruto**: оранжевый `#f97316` + тёмно-синий
- **Attack on Titan**: зелёный `#22c55e` + серый
- **Dragon Ball**: жёлтый `#eab308` + оранжевый
- **TSB (Strongest Battlegrounds)**: красный `#ef4444` + чёрный

---

## Типографика для геймеров

```css
/* Заголовки — bold, крупно, без лишнего */
h1 {
  font-size: clamp(1.4rem, 4vw, 2.2rem);
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--accent-light);
}

/* Лейблы полей — uppercase мелко */
label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #64748b;
}

/* Код — моноширинный, цветной */
.code-output {
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  color: var(--code-cyan);
}
```

**Шрифты для усиления геймерского стиля** (Google Fonts, бесплатно):
- `Rajdhani` — технический, компактный, похож на HUD-элементы
- `Orbitron` — sci-fi стиль, хорошо для заголовков
- `Press Start 2P` — пиксельный, только для акцентных элементов (лого)
- `Inter` — нейтральный читаемый body text (безопаснее всего)

---

## Эффекты и анимации

### Glow на кнопках и акцентах

```css
.btn-primary {
  background: var(--accent-primary);
  box-shadow: 0 0 12px rgba(124, 58, 237, 0.4);
  transition: box-shadow 0.2s, transform 0.1s;
}

.btn-primary:hover {
  box-shadow: 0 0 24px rgba(124, 58, 237, 0.7);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
  box-shadow: 0 0 8px rgba(124, 58, 237, 0.3);
}
```

### Анимация появления карточек

```css
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card {
  animation: fadeSlideIn 0.2s ease forwards;
}
```

### Пульсирующий glow для активного состояния

```css
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(124, 58, 237, 0.3); }
  50%       { box-shadow: 0 0 20px rgba(124, 58, 237, 0.8); }
}

.result-box.has-code {
  animation: pulse-glow 2s ease-in-out infinite;
}
```

### Частицы / эффект энергии (лёгкий вариант без библиотек)

```css
/* Используй CSS-only "сканлайны" для tech-feel */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.03) 2px,
    rgba(0,0,0,0.03) 4px
  );
  pointer-events: none;
  z-index: 0;
}
```

---

## Компоненты — паттерны для геймеров

### Badge / Тип атаки

Цвет badge должен визуально передавать тип:
```html
<span class="badge badge-skill">SKILL</span>    <!-- синий: технический -->
<span class="badge badge-melee">MELEE</span>    <!-- красный: агрессивный -->
<span class="badge badge-special">SPECIAL</span> <!-- фиолетовый: магический -->
```

### Copy Code кнопка с анимацией

Фидбек "Copied!" — обязательно с зелёным цветом и иконкой. Геймеры замечают когда что-то "ощущается" правильно.

### Счётчик / Progress bar для rate limiting

При ограничении 5 генераций/день — показывай визуальный прогресс:
```html
<div class="usage-bar">
  <div class="usage-fill" style="width: 60%"></div>
  <span>3 / 5 uses today</span>
</div>
```

### Pro Lock Overlay

При попытке Pro-функции — красивый overlay, не банальный alert:
```html
<div class="pro-lock">
  <div class="pro-lock-icon">⚡</div>
  <div class="pro-lock-title">Pro Feature</div>
  <div class="pro-lock-desc">Unlock unlimited generations for $4.99</div>
  <button class="btn-unlock">Unlock Now →</button>
</div>
```

---

## Mobile-first для геймеров

**Важно:** аудитория 10-17 лет работает с мобильных телефонов и планшетов. Grid должен collapse на мобильных:

```css
.grid2, .grid3 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 600px) {
  .grid2, .grid3 { grid-template-columns: 1fr; }
  header h1 { font-size: 1.2rem; }
  .container { padding: 16px 12px; }
}
```

Кнопки — минимум 44px высота на мобильном (touch target):
```css
.btn { min-height: 44px; }
```

---

## Чего избегать

- **Белый фон** — сразу не геймерский вид
- **Sans-serif мелкий текст на тёмном** без достаточного контраста (WCAG 4.5:1 минимум)
- **Много анимаций одновременно** — одна-две деталь, не всё сразу
- **Корпоративные зелёно-синие цвета** — не передают энергию игры
- **Alert()** и confirm() браузера — заменять на inline feedback
- **Блокирующие загрузки без спиннера** — показывай состояние

---

## Примеры применения в JJS

### Редизайн шапки

```html
<header>
  <div class="header-content">
    <div class="logo">
      <span class="logo-icon">⚡</span>
      <div>
        <h1>JJS Moveset Generator</h1>
        <p class="tagline">Custom Skill Builder — Jujutsu Shenanigans</p>
      </div>
    </div>
    <div class="header-badge">
      <span class="badge-pro">PRO</span>
    </div>
  </div>
</header>
```

### Улучшение кнопки Generate

```css
.btn-generate {
  background: linear-gradient(135deg, #7c3aed, #9333ea);
  padding: 14px 32px;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 1px;
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.4);
  text-transform: uppercase;
}
```

---

## Ограничения

- Этот скилл — про визуальный стиль, не про архитектуру
- Stripe, деплой, rate limiting — в отдельных скиллах
- Для создания изображений/иконок использовать `nano-banana-2` скилл
- Для сложного UX-аудита (accessibility, cognitive load) — скилл `impeccable`
