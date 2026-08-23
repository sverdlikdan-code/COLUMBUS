---
name: power-bi-dax
description: Полная автоматизация Power BI без GUI — Tabular Editor 2 (реально установлен), XMLA (только dedicated capacity, см. таблицу workspace), TMDL, DAX-оптимизация, аудит PBIX, Fabric Git. Для агента power-bi в COLUMBUS.
trigger: Активировать при любой задаче с DAX, аудитом PBIX, мерами, страницами PBI, темой, симметрией, INTERNATIONAL CONTROL DESK.pbix, автоматизацией Power BI
---

# SKILL: power-bi-dax

## Главный файл

`BIZNES-AI/INTERNATIONAL CONTROL DESK.pbix` — 23 страницы, 252 меры, 5 отделов.

---

## Инструменты — иерархия (hands-off приоритет)

**⚠️ Проверено 2026-08-23:** `pbi-cli` и `te3` CLI ниже — НЕ существующие/не подтверждённые инструменты. На машине не установлен pip-пакет `pbi-cli` (в PyPI такого нет), команда `te3` нигде не найдена. Разделы оставлены зачёркнутыми как антипаттерн — не пытаться ставить.

### ~~1. pbi-cli~~ — ФИКЦИЯ, не устанавливать

~~Python-инструмент специально для AI агентов + PBI...~~ — не существует. Не тратить время на `pip install pbi-cli`.

### ~~2. Tabular Editor CLI (`te3 connect` / `te3 script`)~~ — ФИКЦИЯ, не устанавливать

Такой команды `te3` не существует. Реальный CLI — это сам `TabularEditor.exe` (см. п.6 ниже), а не отдельная утилита `te3`.

Реальный C# скрипт для удаления 153 мер (`delete-unused.cs`) — синтаксис ниже актуален для запуска через `TabularEditor.exe модель.bim -S delete-unused.cs`:
```csharp
var list = System.IO.File.ReadAllLines(@"C:\tmp\unused-measures.txt");
foreach (var name in list)
  if (Model.AllMeasures.Any(m => m.Name == name.Trim()))
    Model.AllMeasures.First(m => m.Name == name.Trim()).Delete();
```

### 3. XMLA endpoint — Read/Write (доступен всем с июня 2025)

Раньше только Premium. Теперь все Fabric/PBI capacities RW по умолчанию.

```powershell
# PowerShell — прямой доступ к модели
$conn = New-Object System.Data.OleDb.OleDbConnection(
  "Provider=MSOLAP;Data Source=powerbi://api.powerbi.com/v1.0/myorg/COLUMBUS;"
)
$conn.Open()
$cmd = $conn.CreateCommand()

# Список всех мер
$cmd.CommandText = "SELECT [MEASURE_NAME],[EXPRESSION] FROM `$SYSTEM.TMSCHEMA_MEASURES"
$reader = $cmd.ExecuteReader()
while ($reader.Read()) { Write-Output "$($reader[0]): $($reader[1])" }
$conn.Close()
```

### 4. TMDL — модель как код (GA сентябрь 2025)

Человекочитаемый формат семантической модели. В браузере и Desktop.
Меры, таблицы, связи — как текст в git.

```tmdl
/// Добавить новую меру
measure 'מכר ממוצע ביום' =
    DIVIDE([מכר קרטון], [ימים שהיה בהם מכר])
    displayFolder: "מכר"
    formatString: "0.0"
```

Редактировать прямо в Fabric portal → TMDL View → Save → git commit автоматом.

### 5. pbi-tools CLI — source control без Desktop

```bash
# Разобрать PBIX на папку (source control)
pbi-tools extract "BIZNES-AI/INTERNATIONAL CONTROL DESK.pbix"

# Собрать PBIX из папки
pbi-tools compile "INTERNATIONAL CONTROL DESK"

# Деплой через manifest
pbi-tools deploy manifest.json
```

### 6. Tabular Editor 2 (реально установлен 2026-08-23, бесплатный, MIT)

**⚠️ Tabular Editor 3 НЕ установлен** (AGENT.md/PRD от 01.06 утверждали обратное — не проверено на тот момент, ошибка). Вместо него поставлен **Tabular Editor 2** через winget (`TabularEditor.TabularEditor.2`) — бесплатный навсегда, полный C#-скриптинг, свои AMO/TOM-библиотеки в комплекте (системный ADOMD.NET/.NET SDK не нужен).

Путь: `C:\Users\d.sverdlik\AppData\Local\Microsoft\WinGet\Packages\TabularEditor.TabularEditor.2_Microsoft.Winget.Source_8wekyb3d8bbwe\TabularEditor.exe`

```powershell
# Вариант A — PBI Desktop открыт локально (localhost SSAS)
& "...\TabularEditor.exe" "localhost:65428" "INTERNATIONAL CONTROL DESK" -S script.cs

# Вариант B — напрямую в Fabric/Premium workspace через XMLA, app-only auth (без Desktop)
# Работает ТОЛЬКО если workspace на dedicated capacity — см. таблицу ниже
& "...\TabularEditor.exe" `
  "Provider=MSOLAP;Data Source=powerbi://api.powerbi.com/v1.0/myorg/CONTROL;User ID=app:$AZURE_CLIENT_ID@$AZURE_TENANT_ID;Password=$AZURE_CLIENT_SECRET;" `
  "INTERNATIONAL CONTROL DESK" -S script.cs
```

Список неиспользуемых мер: `C:\tmp\unused-measures.txt` (153 меры, аудит 2026-06-01)

### Workspace capacity — проверено 2026-08-23 через REST API (важно для XMLA)

XMLA read/write работает только на dedicated (Premium/Fabric/PPU) capacity. На Pro workspace — только `executeQueries` (read-only DAX через REST), никакого XMLA.

| Workspace | ID | isOnDedicatedCapacity | Что там | Вывод |
|---|---|---|---|---|
| `DASHBORDS -ICE-INTER-FORMULA` | `fa961d5f-21c6-4faa-aab6-12964ab3bf5b` | ❌ false (Pro) | FORMULA/ICE/INTER датасеты (analytics-агент) | Только read через `executeQueries` (уже работает). Hands-free запись мер невозможна без апгрейда capacity |
| `CONTROL` | `ee9e5fc6-bc10-4e7d-a8f3-b23c08d150ed` | ✅ true, `capacityId: EF543920-8F20-4843-B5E6-405205385E3D` | `INTERNATIONAL CONTROL DESK` (id `fb6691a0-9b2f-413b-b438-78d2982c4e70`), `isOnPremGatewayRequired: true` | XMLA read/write в принципе доступен — не проверялся живым коннектом (риск для прод-отчёта 27 пользователей/день, нужно подтверждение перед первым тестовым write) |

Сервис-принципал (`AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_CLIENT_SECRET` в корневом `.env`, НЕ в `server/.env`) — токен реально получается и REST API отвечает 200. Права на XMLA endpoint конкретно для этого SP не подтверждены (нужен live-тест).

### 7. Power BI REST API — датасеты, рефреш, запросы

```js
// DAX запрос к датасету напрямую
const res = await fetch(
  `https://api.powerbi.com/v1.0/myorg/datasets/${datasetId}/executeQueries`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queries: [{ query: `EVALUATE SUMMARIZECOLUMNS(...)` }],
      serializerSettings: { includeNulls: true }
    })
  }
);
```

### 8. Тема

Путь: `BIZNES-AI/powerbi-theme.json`
Импорт GUI: View → Themes → Browse / через REST API programmatically

---

## DAX — Известные паттерны и ловушки

### Граничные недели — занижение средней (COLUMBUS-специфика)

**Проблема:** `[מכר ממוצע בשבוע קרטון]` считает distinct недели с продажами.
Частичные недели на границах месяцев считаются как полные → среднее занижено для отдельных месяцев.

```
May (yamim=6, total=27):  27 / 2 нед = 13.5
Jun (yamim=12, total=51): 51 / 4 нед = 12.8
May+Jun combined:         78 / 5 нед = 15.6  ← выше (граничная неделя считается 1 раз)
```

**Решение — добавить меру без этого бага:**
```dax
[מכר ממוצע ביום] = DIVIDE([מכר קרטון], [ימים שהיה בהם מכר])
```

**Надёжный показатель:** `[מכר קרטון]` (total cartons) — всегда точен.

### LOOKUPVALUE вместо RELATED (нет связи в модели)

```dax
[מחלקה] = LOOKUPVALUE(
  ADIFUT[מחלקה],
  ADIFUT[מק"ט], 'mekarer-order'[מק"ט]
)
```

### CALCULATETABLE/SUMMARIZECOLUMNS — ошибка одного значения

`SUMMARIZECOLUMNS` в мере бросает ошибку если фильтр-контекст сужает до одной строки.
Обход: разбить на 2 запроса — stable + branchy (`.catch` на второй).

### DATESBETWEEN — правильный столбец

```dax
-- ПРАВИЛЬНО
DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,5,1), DATE(2026,5,31))

-- НЕПРАВИЛЬНО: 'KARTIS PARIT'[תאריך] — может не существовать
```

---

## Аудит PBIX — чеклист

### Меры
- [ ] Удалить 153 неиспользуемых → `te3 script run delete-unused.cs` или `pbi-cli`
- [ ] Добавить `[מכר ממוצע ביום]` = DIVIDE(מכר קרטון, ימים שהיה בהם מכר)
- [ ] Проверить DAX на дублирование

### Страницы
- [ ] 8 страниц без pageNavigator → добавить в TMDL или PBI Desktop
- [ ] 13/23 названий страниц → формат: `[emoji] [иврит]`
- [ ] Все страницы: Year + Month слайсеры

### Визуальная симметрия
- [ ] Header одинаковый на всех страницах
- [ ] Тема `powerbi-theme.json` применена
- [ ] Цвета: зелёный OK, красный проблема, жёлтый внимание

---

## Статус (последний аудит 2026-06-01)

| Пункт | Статус |
|-------|--------|
| 153 меры к удалению | ⏳ → запустить `te3 script` или `pbi-cli` |
| 8 страниц без nav | ❌ нужен PBI Desktop или TMDL |
| 13 названий страниц | ❌ нужен PBI Desktop или TMDL |
| Тема создана | ✅ `powerbi-theme.json` |
| `[מכר ממוצע ביום]` | ❌ не создана → `pbi-cli measure add` |
| XMLA RW доступ | ✅ доступен всем с июня 2025 |
| pbi-cli установлен | ❓ проверить: `pip show pbi-cli` |

---

## Ограничения (остаются)

- Visual layout (позиции кнопок, визуалов) — только GUI PBI Desktop
- Данные в PBIX не хранятся — только схема. Данные в PBI Service/Fabric
