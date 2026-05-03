---
name: designer-mobile-ux
description: Skill для проектирования React Native мобильного UX для полевых агентов — кнопки, карточки, иерархия, RTL, брендинг, состояния. Включает знание конкурентов: Bringg, RouteOptima, BeatRoute, PepUpSales. Применять при любых задачах по UI, экранам, компонентам, визуальному стилю DILLER FORMULA AGENT APP.
type: skill
---

# Designer Skill — DILLER FORMULA AGENT APP

## Контекст продукта

**DILLER FORMULA AGENT APP** — React Native (Expo) для полевых торговых агентов в Израиле.
- Пользователи: агент в машине, одной рукой, под солнечным светом
- Язык: иврит (RTL) + частично русский
- Брендинг: геральдика "Diler B.M.D International" — Navy + Gold, гербовый стиль
- Конкуренты: Bringg, BeatRoute, RouteOptima, PepUpSales, Rasner, RouteQ, Ascomy

---

## 1. Heraldic Design System

### Цветовая пара — единственная допустимая

```
Navy (primary):  #0F2044  — headers, active states, primary buttons, text primary
Gold (accent):   #C9A84C  — ТОЛЬКО: active indicators, dividers, crest elements, checkmarks
Background:      #F4F6FA  — screen background
Card surface:    #FFFFFF  — elevated cards
Text primary:    #0F2044  — совпадает с Navy, не случайно
Text mid:        #4A5568  — card secondary text, labels
Text light:      #9AA5B4  — timestamps, codes, placeholders
Success:         #2E7D32
Warning/New:     #E65100  — NEW badge только
```

### Правила применения Gold

Gold `#C9A84C` разрешён только в:
- Active state indicator (левая полоска выбранного item, checkmark)
- Разделители секций (`borderBottomColor: '#C9A84C'`, `borderBottomWidth: 1`)
- Элементы герба (crest ring, буква D)
- Декоративные коня — `#A08050` (приглушённый gold-brown, не чистый Gold)

Gold запрещён как:
- Фон любого контейнера или экрана
- Цвет основного текста (кроме буквы D в гербе)
- Fill кнопок

### Правило декоративных элементов

Декоративные элементы (лошади, герб, crest) никогда не перекрывают функциональные элементы. Лошади — `opacity: 0.45–0.9` с depth-эффектом через layering (не поверх кнопок/текста). Герб — центральный элемент header, занимает своё пространство без overlap с nav.

---

## 2. Visual Hierarchy — React Native

### Elevation System (4 уровня)

Используй shadow vs border по контексту: shadow — для elevation/depth, border — для разграничения без depth.

| Уровень | Применение | Shadow | Border |
|---------|-----------|--------|--------|
| 0 — flat | Background sections, dividers | нет | `0.5pt rgba(0,0,0,0.1)` |
| 1 — card | Client cards, info panels | `shadowOpacity: 0.08, shadowRadius: 4, elevation: 2` | нет |
| 2 — raised | Active card, focused input, KM panel | `shadowOpacity: 0.14, shadowRadius: 8, elevation: 4` | нет |
| 3 — overlay | Bottom sheet, modal, drag-active card | `shadowOpacity: 0.25, shadowRadius: 16, elevation: 8` | нет |

Правило выбора:
- Если элемент реально "поднят" над фоном → shadow
- Если элемент отделён логически (секция, таблица) → border
- Никогда не комбинировать shadow + border на одном элементе

### Spacing System

Базовая единица: 4pt. Допустимые значения: 4, 8, 12, 16, 24, 32. Не использовать 5, 6, 10, 15, 20 и т.д.

```
padding внутри карточки:   horizontal 16, vertical 12
gap между карточками:      8
padding секции:            horizontal 16, vertical 24 (top), 8 (bottom)
padding кнопки:            horizontal 24, vertical 16 (даёт 52pt высоту при правильном шрифте)
gap между кнопками:        12
внутренний gap в row:      8
padding header:            top = statusBar + 16, bottom 16, horizontal 16
```

---

## 3. Typography Scale

Все размеры — pt (points). В React Native = `fontSize`. Использовать только эти значения.

| Роль | Size | Weight | LetterSpacing | Transform | Color |
|------|------|--------|---------------|-----------|-------|
| Header title (DILLER FORMULA) | 18–22pt | 900 | 4–6 | uppercase | white |
| Header subtitle (INTERNATIONAL) | 11pt | 600 | 2 | uppercase | rgba(255,255,255,0.75) |
| Section label | 13pt | 700 | 1 | uppercase | Text mid `#4A5568` |
| Card primary text (имя клиента) | 14–15pt | 600 | 0 | — | Text primary `#0F2044` |
| Card secondary (адрес, город) | 11–12pt | 400 | 0 | — | Text mid `#4A5568` |
| Badge / code / номер агента | 9–11pt | 800 | 0.5 | — | контрастный к bg |
| Agent name в header | 17pt | 800 | 0 | — | white |
| Day badge letter | 26pt | 900 | 0 | — | white |
| KM value (числа) | 20–22pt | 700 | 0 | — | navy или success/error |
| KM label | 11pt | 500 | 0 | — | Text mid |
| Primary button text | 16pt | 800 | 1 | — | white |
| Ghost button text | 15pt | 700 | 0.5 | — | Navy `#0F2044` |

Section labels всегда uppercase + letterSpacing 1 + weight 700. Это отличает их от card text визуально без изменения цвета.

---

## 4. Chip vs Row — когда что использовать

### Chips — применять для

- Короткие labels ≤ 15 символов: менеджеры, города, дни недели
- Агенты: даже если Hebrew имена длинные — chips с wrap (не обрезать)
- Выбор фильтра (один из нескольких вариантов)
- Статус-маркеры в компактном пространстве

```
Chip: borderRadius 20, paddingHorizontal 12, paddingVertical 6
Active chip: bg Navy #0F2044, text white, no border
Inactive chip: bg transparent, border 1pt #0F2044, text Navy
```

### Rows — применять для

- Нужно 2+ полей в строке (имя + метаданные, адрес + статус)
- Контент с иконкой слева + текст + action справа
- Навигационные пункты (Settings, меню)
- Client cards в маршруте (номер + имя + адрес + кнопки)

### Правило

Если в UI появилось желание положить chips для агентов горизонтально — использовать `flexWrap: 'wrap'`, не переходить на rows только из-за длины Hebrew имён. Hebrew имена wrap нормально.

---

## 5. Button Design Rules

### Primary Button

```
width: '100%' (full-width)
height: 52pt
backgroundColor: '#0F2044'
borderRadius: 10
text: 16pt, weight 800, white, letterSpacing 1
paddingHorizontal: 24
states:
  default:  bg #0F2044
  pressed:  bg #1A3366 (чуть светлее)
  disabled: bg #8A9BB5, text rgba(255,255,255,0.6)
  loading:  disabled + ActivityIndicator white внутри кнопки
```

### Ghost Button

```
width: '100%' (full-width) или auto
height: 52pt (тот же, что primary — единая строка)
backgroundColor: 'transparent'
borderWidth: 1.5
borderColor: '#0F2044'
borderRadius: 10
text: 15pt, weight 700, Navy #0F2044, letterSpacing 0.5
states:
  pressed: backgroundColor rgba(15,32,68,0.06)
  disabled: borderColor #8A9BB5, text #8A9BB5
```

### Icon-only Button (Ghost / utility)

```
size: 40×40pt минимум (touch target)
borderRadius: 8 или 20 (круглый)
Excel/Share/Export: ghost border, icon size 20pt
```

### Никогда

- Не делать кнопку менее 52pt высотой (кроме chips)
- Не давать primary button автоширину — только full-width
- Не добавлять gold как bg кнопки

---

## 6. Header Composition Rules

### Структура SetupScreen Header (геральдический)

```
┌─────────────────────────────────────────┐  minHeight: 140pt + paddingTop statusBar
│  [лошадь левая]  [ГЕРБ]  [лошадь правая]│  paddingTop: statusBarHeight + 16
│                 DILLER FORMULA          │  paddingBottom: 16
│                 AGENT APP               │  paddingHorizontal: 16
└─────────────────────────────────────────┘
```

- Декоративный элемент (лошадь/emblem): max 20% ширины экрана, `opacity: 0.45–0.9`
  - Depth эффект: левая лошадь opacity 0.55, правая 0.75 (или наоборот) — создаёт псевдо-depth
  - `fontSize: 22` если emoji/символ, абсолютное позиционирование с боков
- Центр: герб (crest) + текст — `alignItems: 'center'`, никогда не смещается
- Если нет правого декоративного элемента: добавить `<View style={{width: leftElementWidth}} />` как balance spacer

### Crest (герб)

```
outer ring: 68×68pt, borderRadius 34, borderColor '#C9A84C', borderWidth 2
inner ring: 52×52pt, borderRadius 26, borderColor rgba(201,168,76,0.5), borderWidth 1.5
center letter: fontSize 26, fontWeight 900, color '#C9A84C'
```

### RouteScreen Header (навигационный)

```
minHeight: 72pt + statusBar
layout: row — [back arrow] [agent name + city] [day badge]
back arrow: fontSize 22, paddingHorizontal 12, paddingVertical 8
day badge: Navy bg, white letter, fontSize 26, weight 900, 40×40pt circle
```

---

## 7. Card Design — Client Card

```
┌─────────────────────────────────────────┐
│ [drag ⠿] [№circle] שם לקוח    [↑] [↓]  │
│           עיר · כתובת    [NEW badge]   │
│           סטטוס · כשרות               │
└─────────────────────────────────────────┘
```

- `minHeight: 64pt` — агент нажимает в движении
- `paddingHorizontal: 16, paddingVertical: 12`
- Elevation level 1 (card shadow)
- Drag active → elevation level 3, `transform: scale(1.03)` (Reanimated)

Элементы:
- Drag handle: левая сторона, `opacity: 0.3`, touch zone 44pt × card height
- Номер: синий кружок (`#0F2044`), белый текст, `fontSize: 13, fontWeight: 800`, размер 28×28pt
- Имя: 14–15pt, weight 600, Navy
- Адрес/город: 11–12pt, weight 400, Text mid
- NEW badge: bg `#E65100`, white, `fontSize: 9pt, weight: 800`, borderRadius 4, paddingHorizontal 5
- ↑↓ кнопки: 40×40pt, ghost, правая сторона вертикально

---

## 8. KM Panel — 3 окна

```
┌──────────────┬──────────────┬──────────────┐
│  KM Priority │    KM AI     │  הפרש (экон) │
│   [число]    │   [число]    │   [±число]   │
│  לפי סדר     │   סדר AI     │   ↓ X ק"מ   │
└──────────────┴──────────────┴──────────────┘
```

- Все три: `flex: 1`, равная ширина
- Фон тонированный: Priority `#EEF0F8`, AI `#EDF6FF`, Savings `#EDF7EE`
- Value: 20–22pt, weight 700
- Label: 11pt, weight 500, Text mid
- Savings positive (Priority > AI): green `#2E7D32`, стрелка ↓
- Savings negative: red `#C62828`, стрелка ↑
- Не рассчитано: `—`, Text light

---

## 9. RTL Hebrew Rules

- `writingDirection: 'rtl'` на ScrollView/FlatList
- `textAlign: 'right'` по умолчанию для Hebrew текста
- Кнопки: текст справа, стрелка слева (←)
- Номер клиента (LTR counter): в левом кружке — counter-intuitive but correct для RTL layout
- Gold border-divider: `borderLeftWidth: 3, borderLeftColor: '#C9A84C'` — создаёт RTL-indent
- Chips с Hebrew: `flexWrap: 'wrap'`, не ограничивать width

---

## 10. Loading & Feedback States

- Loading clients: `ActivityIndicator` по центру, Navy цвет
- Recalc KM: кнопка disabled + brief spinner внутри кнопки (не отдельный overlay)
- Drag active: elevation level 3, `scale(1.03)`, duration ≤ 200ms
- Анимации ≤ 300ms — полевой агент не ждёт
- Empty state: тихий текст `panelEmptyText`, не кричащий placeholder
- Error: inline message под полем/компонентом, не modal alert

---

## 11. Competitive Signals

### Bringg (лидер рынка)
- **Adopt**: большие карточки, чёткий stop#, status badges
- **Adopt**: bottom tab bar для List/Map (рассмотреть vs top tabs)
- **Adapt**: цвет статуса → badge, не перекрашивать всю карточку
- **Avoid**: sidebar nav — тяжело для 1-рукового

### BeatRoute
- **Adopt**: вертикальный список агентов → chips с wrap если коротко
- **Adapt**: dashboard summary → KM panel, достаточно
- **Avoid**: много категориальных цветов

### RouteOptima
- **Adopt**: явный Optimized vs Current KM comparison — наш KM panel
- **Adopt**: drag-and-drop с visual ghosting
- **Avoid**: требование GPS real-time

### PepUpSales
- **Adopt**: секционные формы, одна секция → следующая
- **Adapt**: progress indicator → ✓ галочки

---

## 12. Anti-Patterns

- Gold как фон контейнера или кнопки
- Rainbow per-manager colors меняющие весь header/UI
- Chips горизонтальный scroll для Hebrew agent names — использовать wrap
- Touch targets < 44pt в полевом контексте
- Анимации > 300ms
- Modal alerts вместо inline feedback
- Shadow + border на одном элементе одновременно
- Spacing значения вне системы (5, 6, 10, 15, 20pt)
- Декоративные элементы поверх функциональных (лошади поверх кнопок/текста)
- Typography вне шкалы (например fontSize 16 для card primary text вместо 14–15)
