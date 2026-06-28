---
name: session-2026-06-28-print
description: תוקף print layout — A4 landscape, per-row zoom, width 100%, overflow fix
metadata:
  type: project
---

# Сессия 2026-06-28 — תוקף Print Layout #done

## Итог

Полный fixing цикл print layout для הדפסה → סכנה בלבד (3×3 grid, A4 landscape).

## Финальные параметры CSS

```css
@page { size: A4 landscape; margin: 6mm; }

body.printing-expiry .expiry-page-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  height: 190mm;
  overflow: hidden;        /* clips cards that overflow grid rows */
  break-after: page;
}
body.printing-expiry .expiry-page-group:last-child {
  break-after: auto;       /* no blank trailing page */
}
body.printing-expiry .expiry-page-group > div {
  overflow: hidden;
  width: 100% !important;  /* override inline width:300px → fills cell */
  transform-origin: top left;
}
```

## Финальный JS zoom (beforeprint)

```js
// Measure each card BEFORE print class (Map per-element)
const _cardNatH = new Map();
document.querySelectorAll('#expiry-grid > div:not(.expiry-sec-hdr):not(.grid-page-break)')
  .forEach(c => { _cardNatH.set(c, c.offsetHeight || 200); ... });

// Build groups of 9, pad to 9 with empty divs

// Per-ROW zoom: 3 cards per row same scale → symmetry
// width=100% fills cellW → constrain zoom only by HEIGHT, cap at 1.0
for (let i = 0; i < allCells.length; i += 3) {
  const rowMaxH = max(_cardNatH.get(c) for c in row);
  const s = Math.min(1.0, cellH / rowMaxH) * 0.93;
  row.forEach(c => c.style.zoom = clamp(s, 0.4, 1.0));
}
```

## Проблемы которые были и как фиксились

| Проблема | Причина | Фикс |
|---|---|---|
| Карточки крошечные | zoom from max height (350px) → all cards at 0.6x | per-row zoom |
| Нет симметрии | per-card zoom → разные размеры в строке | per-row zoom (tallest in row) |
| Content ниже рамки | `display:block !important` ломал `display:flex` карточки | убрали display:block |
| 3 листа вместо 2 | `height:calc(100vh-28px)` = 900px > 748px (A4) | `height:190mm` |
| Пустая 4-я страница | `break-after:page` на последней группе | `:last-child { break-after:auto }` |
| Пустое место под карточками | фиксированный width:300px ограничивал zoom | `width:100%` → zoom только по высоте |

## Коммиты (2026-06-28)
- `fix: expiry print - remove display:block override`
- `fix: expiry print - per-card zoom`
- `fix: expiry print - per-row zoom for symmetry`
- `fix: expiry print - cards 100% cell width, zoom by height only`
