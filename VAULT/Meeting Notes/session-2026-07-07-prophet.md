# Сессия 2026-07-07: MMD ORDERS — Prophet stale + cap ordV

#status/done #agent/ceo #scope/mmd-orders #scope/prophet

**Claude Code:** `6fc370df` · slug `shiny-sparking-platypus` · ~07:24–15:24

## Контекст

Продолжение пилота Prophet в MMD ORDERS. Между ребилдами `prophet.json` (07:00/15:00) и `mmd-orders.json` (13:16) остаток `mmd_k` меняется — UI показывал устаревшие рекомендации.

## Фикс 1 — stale `eilat_k` в панели Prophet

**Симптом:** панель `hamilton=7`, `prophet_order=0` при актуальном `mmd_k=4`.

**Причина:** панель читала `eilat_k` из `prophet.json`; между ребилдами продали 8 картонов.

**Fix (`openProphetPanel`):**
- Аргумент `currentMmdK` из onclick строки
- `ek = currentMmdK ?? p.eilat_k`
- `po = max(0, round(p4 × weeks_nf − ek))`

**Коммит:** `30d8e6f5`

## Фикс 2 — stale `prophet_order` в колонке таблицы

**Симптом:** колонка Prophet показывала 0 вместо 5.

**Fix:**
```javascript
const ek = (r.mmd_k != null && r.mmd_k >= 0) ? r.mmd_k : (p.eilat_k ?? 0);
const po = (p4f != null && wn != null)
  ? Math.max(0, Math.round(p4f * wn - ek))
  : Math.round(p.prophet_order ?? 0);
```

**Коммит:** `c2783cda`

## Фикс 3 — заказ > מלאי אשדוד при загрузке

**Симптом:** инпут показывал 6 при `ash=1` (localStorage между сессиями).

**Причина:** cap-check в `inp()` только на `oninput`, не на initial render.

**Fix (~строка 1490):**
```javascript
const _cap    = maavarMode ? mav : ash;
const _rawOrd = s.k != null ? s.k : hamlRnd;
const ordV    = (_rawOrd !== '' && _cap > 0 && Number(_rawOrd) > _cap) ? _cap : (_rawOrd || '');
```

**Коммит:** `c261a472`

## Ответ «PROPHET SEICHAS SVEJIY V APP?»

Да — `p4`/`weeks_nf` из prophet.json (стабильны между ребилдами), остаток `mmd_k` из mmd-orders.json (свежее).

## Vault / git

- Обновлён `mmd-orders-app.md`, добавлена строка в `_index.md`
- Push vault-коммита прерван (permission stream closed) — восстановить вручную при необходимости

## Файлы

- `MMD ORDERS/index.html`
