---
name: pbi-to-pptx-pipeline
description: Стандарт генерации PPTX-отчётов из Power BI без ручных скриншотов — числа через SQL/REST API, графики через фиксированные скриншоты, сборка через pptxgenjs.
---

# PBI → PPTX Pipeline — стандарт без ручных скриншотов

## Overview

Заменяет ручной workflow (открыл PBI → скриншот → вставил в код → повторил 20 раз) на автоматический:
- **Числа, KPI, таблицы** — SQL Server напрямую или Power BI REST API
- **Графики, визуализации** — скриншоты один раз по фиксированному протоколу
- **Сборка** — Node.js + pptxgenjs → готовый PPTX одной командой

---

## Когда использовать

- Создаёшь новый PPTX-генератор для дашборда (MMD, FORMULA, ICE bdd и т.д.)
- Обновляешь существующий генератор на новый период данных
- Пользователь жалуется на ручные скриншоты или hardcoded числа

---

## Архитектура данных

```
SQL Server ──────────────────────────────► числа, KPI, таблицы
                                              │
Power BI REST API (если нет прямого SQL) ──► DAX результат в JSON
                                              │
Скриншоты (только графики) ──────────────────┤
                                              ▼
                                        pptxgenjs → PPTX
```

---

## Workflow

### Фаза 1 — Классификация данных слайда

Для каждого слайда определить тип данных:

| Тип | Примеры | Источник |
|-----|---------|---------|
| **Числовой KPI** | +24%, ₪1.3M, +248k | SQL или REST API |
| **Сравнительная таблица** | 2025 vs 2024 по компаниям | SQL или REST API |
| **График/визуал** | bar chart, ribbon, waterfall | Скриншот |
| **Drill-down** | топ-10 клиентов, детали SKU | SQL или REST API |

**Правило:** если данные можно выразить числами → SQL. Скриншот только если визуальная форма критична.

---

### Фаза 2А — SQL подключение (быстрый путь)

```js
const sql = require('mssql'); // npm install mssql

const config = {
  server: 'YOUR_SQL_SERVER',
  database: 'YOUR_DB',
  options: { encrypt: false, trustServerCertificate: true },
  authentication: { type: 'default', options: { userName: '...', password: '...' } }
};

async function fetchData() {
  const pool = await sql.connect(config);
  const result = await pool.request().query(`
    SELECT
      Company,
      SUM(CASE WHEN YEAR(Date) = 2025 THEN Amount ELSE 0 END) as Y2025,
      SUM(CASE WHEN YEAR(Date) = 2024 THEN Amount ELSE 0 END) as Y2024
    FROM Sales
    GROUP BY Company
  `);
  return result.recordset; // [{ Company: 'FORMULA', Y2025: 2798119, Y2024: 2784475 }, ...]
}
```

Заменяет hardcoded массивы типа:
```js
// ❌ было:
const DATA = [ { name: 'FORMULA', y2025: 2798119, y2024: 2784475 }, ... ]

// ✅ стало:
const DATA = await fetchData();
```

---

### Фаза 2Б — Power BI REST API (когда нет прямого SQL)

Нужно: Azure AD App Registration (бесплатно) + Pro лицензия.

```js
const msal = require('@azure/msal-node');
const axios = require('axios');

// 1. Получить токен
const msalConfig = {
  auth: { clientId: 'YOUR_APP_ID', authority: 'https://login.microsoftonline.com/YOUR_TENANT' }
};
const pca = new msal.PublicClientApplication(msalConfig);
const { accessToken } = await pca.acquireTokenByUsernamePassword({
  scopes: ['https://analysis.windows.net/powerbi/api/.default'],
  username: 'user@domain.com', password: 'PASSWORD'
});

// 2. Слать DAX запрос
const datasetId = 'YOUR_DATASET_ID'; // из RemoteArtifacts в .pbix
const response = await axios.post(
  `https://api.powerbi.com/v1.0/myorg/datasets/${datasetId}/executeQueries`,
  { queries: [{ query: "EVALUATE SUMMARIZE('Sales', 'Company'[Name], \"Total\", SUM('Sales'[Amount]))" }] },
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const rows = response.data.results[0].tables[0].rows;
```

**DatasetId известны для COLUMBUS:**
- MMD.pbix → `77f218a5-...` (из RemoteArtifacts)
- FORMULA DASHBORD.pbix → `457ddbf6-...` (из RemoteArtifacts)

---

### Фаза 3 — Протокол скриншотов (только для графиков)

Когда скриншот неизбежен — делать по стандарту:

1. **Фиксированное разрешение**: 1920×1080, zoom 100%
2. **Фиксированные фильтры**: записать в комментарий к слайду какие фильтры активны
3. **Имя файла**: `Screenshot YYYY-MM-DD HHMMSS.jpg` (Windows Snipping Tool сохраняет автоматически)
4. **Папка**: `C:\Users\...\Desktop\MMD REPORT\screenshots\` — одна папка на отчёт
5. **Порядок**: делать скриншоты последовательно по порядку слайдов
6. **Метаданные**: в генераторе комментарий рядом с imgTs — что именно на скриншоте

```js
// ✅ хорошо — понятно что на скриншоте
const IMG = (ts) => `${IMGDIR}Screenshot 2026-06-07 ${ts}.jpg`;
// Слайд 8: ICE bdd — каналы 2025, фильтр: все клиенты, период Jan-Dec 2025
dataSlide({ imgTs: '181837', ... });
```

---

### Фаза 4 — Структура генератора

```js
// generate-[REPORT]-report.js — стандартная структура
const pptxgenjs = require('pptxgenjs');
const sql = require('mssql');

// 1. Константы и брендинг
const NAVY = '1C3D6B', BLUE = '2E77B8', GREEN = '1A9E5C';
const DECLINE = '607080'; // NO RED rule
const FLAT = '8A9BA8';

// 2. Загрузить данные
async function loadData() {
  // SQL или REST API
}

// 3. Слайды
function buildSlides(pptx, data) {
  // dataSlide() для каждого слайда
}

// 4. Main
async function main() {
  const data = await loadData();
  const pptx = new pptxgenjs();
  buildSlides(pptx, data);
  await pptx.writeFile({ fileName: OUTPUT_PATH });
  console.log('✅ PPTX saved:', OUTPUT_PATH);
}

main().catch(console.error);
```

---

## Правила бренда (NO RED)

- Снижение = `DECLINE = '607080'` (steel-grey) — **никогда красный**
- Рост = `GREEN = '1A9E5C'`
- Flat/0% = `FLAT = '8A9BA8'`
- Предупреждение (частичный год, аномалия) = `AMBER = 'E67E22'`
- Основной = `NAVY = '1C3D6B'`, акцент = `BLUE = '2E77B8'`

---

## Антипаттерны

- ❌ Hardcode числа в массивах — следующий месяц придётся менять руками
- ❌ Скриншоты для KPI и таблиц — это числа, бери из SQL
- ❌ Технические термины в тексте слайдов: "Sankey", "бенчмарк", "XMLA", аббревиатуры без расшифровки
- ❌ Делать скриншоты без записи фильтров — через 3 месяца непонятно что было активно
- ❌ Разные разрешения скриншотов на разных слайдах — выглядит непрофессионально

---

## Checklist перед запуском генератора

- [ ] SQL подключение протестировано (`SELECT 1` возвращает результат)
- [ ] Все скриншоты в одной папке с правильными именами
- [ ] Период данных проверен (Jan-Dec vs YTD — записано в комментарии)
- [ ] NO RED rule соблюдена (нет `FF0000`, `DC3545` и подобных)
- [ ] PPTX открыт? → закрыть перед запуском (EBUSY)
- [ ] `node generate-report.js` → `✅ PPTX saved`
