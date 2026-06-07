---
name: annual-report-pptx
description: Создание годового бизнес-отчёта PPTX из PBIX данных — извлечение структуры, pptxgenjs генерация, Brand Palette, Hebrew RTL, Яэль для текста слайдов. Использовать при запросах "годовой отчёт", "annual report", "сделай PPTX из PBIX", "presentation from Power BI".
---

# Annual Report PPTX — Skill

## Overview

Полный workflow создания профессионального PowerPoint из Power BI данных.  
PBIX не содержит реальных значений — только структуру. Данные берутся из скриншотов, PBI embed, или от пользователя.

## When to Use

- "Сделай годовой отчёт / annual report"
- "PPTX из PBIX", "PowerPoint из Power BI"
- "Слайды по данным компании / дистрибутора"
- Нужен профессиональный отчёт с Hebrew/Russian/English контентом

## Workflow

### Шаг 1 — Извлечь структуру PBIX

Используй skill `pbix-reader` для понимания страниц и мер:
```powershell
$pbix = "<path-to-file.pbix>"
$out  = "C:\tmp\pbix-extracted"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $out | Out-Null
Copy-Item $pbix "C:\tmp\_pbix_work.zip"
Expand-Archive "C:\tmp\_pbix_work.zip" -DestinationPath $out -Force
$layout = Get-Content "$out\Report\Layout" -Raw -Encoding Unicode | ConvertFrom-Json
$layout.sections | Select displayName, @{N="Visuals";E={$_.visualContainers.Count}} | Format-Table
```

### Шаг 2 — Собрать реальные данные

PBIX содержит только схему. Реальные данные:
- Из скриншотов страниц Power BI (пользователь присылает)
- Из PBI Export / Embed API
- Из прямых вопросов пользователю

**Обязательно собрать:**
- Продажи по компаниям: 2024 vs 2025 (абсолют + delta + %)
- Разбивка по каналам: כשר/לא כשר, רשתות/שוק פרטי
- Разбивка по регионам: אילת, ערבה, etc.
- Топ брендов (מותג) — генераторы роста
- Семейства продуктов (משפחת מוצר)
- Данные 2026 (YTD Jan–May)

### Шаг 3 — Создать скрипт генерации PPTX

**Локация для запуска:** `C:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS\APP-MAHSAN\portfolio\`  
(здесь установлен `pptxgenjs` в node_modules)

**Обязательная цветовая палитра (NO RED правило):**
```javascript
const NAVY    = '1A3A5C';   // тёмно-синий фон / акценты
const BLUE    = '2E86AB';   // основной цвет
const GOLD    = 'E6A817';   // акценты / заголовки
const GREEN   = '27AE60';   // рост > 0%
const DECLINE = '607080';   // СНИЖЕНИЕ — steel-grey, НИКОГДА не красный
const FLAT    = '8A9BA8';   // ~0% изменение
const AMBER   = 'E67E22';   // предупреждение (данные неполные, частичный год)
const MUTED   = 'B0BEC5';   // неактивные значения

function pctColor(p) {
  if (p == null) return MUTED;
  if (p > 10)   return GREEN;
  if (p > 0)    return BLUE;
  if (p === 0)  return FLAT;
  return DECLINE;  // steel-grey, НЕ RED
}
```

**Hebrew RTL в pptxgenjs:**
```javascript
// Все Hebrew тексты должны иметь rtlMode: true
prs.addSlide().addText('שנת 2025 לעומת 2024', {
  rtlMode: true,
  align: 'right',
  // ...
});
```

**Структура слайдов (стандарт):**
1. Cover — название компании + год + логотип
2. Executive Summary — ключевые KPI с delta-bar chart
3. По каждому PARAMETER-слайду (כשר/לא כשר, רשתות/שוק פרטי, אילת, ערבה)
4. Growth Generators — топ брендов по компаниям
5. Product Families — משפחת מוצר рост/снижение
6. 2026 YTD — с предупреждением о частичном годе
7. Summary Insights — 6 key takeaways
8. Closing — тёмный финальный слайд

### Шаг 4 — Запустить генерацию

```bash
# Запустить из COLUMBUS workspace
node APP-MAHSAN/portfolio/generate-<client>-report.js
```

После генерации — скопировать PPTX в папку клиента:
```powershell
Copy-Item ".\APP-MAHSAN\portfolio\<file>.pptx" "C:\Users\d.sverdlik\Desktop\<CLIENT FOLDER>\"
```

### Шаг 5 — Яэль пишет текст слайдов

Для executive summary, раздельных инсайтов, closing statement — вызвать Яэль.  
Создать файл `Content/mmd-report-copy-draft.md` с ключевыми данными, и попросить Яэль написать:
- Заголовки слайдов (Hebrew, max 7 слов)
- Инсайт-боксы (1–2 предложения, факт + вывод)
- Executive summary (3–4 bullet points)
- Closing statement

**Яэль использует B2B Business Report профиль (см. её AGENT.md)**

### Шаг 6 — Vault + cleanup

```powershell
# Удалить временные файлы
Remove-Item "C:\tmp\pbix-extracted" -Recurse -Force
Remove-Item "C:\tmp\_pbix_work.zip" -Force
```

Создать Vault session note с результатом.

## Common Mistakes

- ❌ Использовать красный цвет для снижения — всегда `DECLINE = '607080'`
- ❌ Запускать скрипт из папки без node_modules pptxgenjs — запускать только из COLUMBUS
- ❌ Показывать -50% для YTD данных без предупреждения — всегда добавлять AMBER note о частичном годе
- ❌ Hebrew текст без `rtlMode: true` — всегда RTL для иврита
- ❌ Брать данные из PBIX напрямую — PBIX не содержит значений, только схему

## Output

```
Annual Report PPTX готов:
📄 Файл: <path>/<name>.pptx
📊 Слайдов: <N>
💰 Данные: <period>
✅ Яэль: текст слайдов написан / не требовался
```
