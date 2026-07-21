# Сессия 2026-07-07: MAHSAN EDITOR — STOP SALE combined view

#status/done #agent/mahsan #scope/planogram

**Claude Code:** `5a658fe2` · slug `staged-wandering-rabbit` · custom title «MAHSAN EDITOR 🏠» · ~07:26–15:25

## Старт

Скриншот планограммы — «куда у нас stop sale значок?» Разбор `⛔ STOP SALE` в split vs combined (מאוחד) режимах.

## Фикс — фиолетовая рамка STOP SALE в combined view

**Баг:** карточки STOP SALE не показывали фиолетовую рамку в combined (מאוחד) режиме.

**Причина:** в combined path переменная `cBorder` проверяла только `anySakana` (красный). `cardBorder` с `isStop` вычислялась выше, но применялась только в split view.

**Fix** (`docs/planogram-editor.html`, commit `de2afa8b`):
```js
const cBorder  = isStop ? '2.5px solid #6a1b9a' : anySakana ? '2px solid #c62828' : '1px solid #dde0e8';
const cThBg    = isStop ? '#6a1b9a' : anySakana ? '#c62828' : '#f5f5f5';
const cThTxt   = isStop ? '⛔ STOP SALE — כל המחסנים' : 'כל המחסנים — פק"ע';
```

## isBatchStop — финальная логика

- `cartons=0` → true
- `eff=0` (daysLeft ≤ shelfLife) → true
- `eff>0, sales=0` → false (нет данных)
- иначе: `throwAway = ceil(cartons - (eff/1.4)*sales) ≥ cartons`

**`/1.4`:** `7/5` — рабочие дни → календарные.

**Пример 411001:** daysLeft=1, shelfLife=7 → eff=0 → STOP SALE.

**Маркер:** `build:2026-07-07b` в консоли.

## Open — Excel סטנד

Последний запрос сессии: «V EXEL סטנד TAKI NA POPADAYUT» — ~908 SKU с `haluka: null` сортируются в конец Excel (haluka→printOrder). Не закрыто.

## Файлы

- `docs/planogram-editor.html`
- Детали также в [[mahsan-planogram]]
