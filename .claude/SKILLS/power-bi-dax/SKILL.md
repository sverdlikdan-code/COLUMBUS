---
name: power-bi-dax
description: Полная автоматизация Power BI без GUI — pbi-cli, Tabular Editor CLI, XMLA, TMDL, DAX-оптимизация, аудит PBIX, Fabric Git. Для агента power-bi в COLUMBUS.
trigger: Активировать при любой задаче с DAX, аудитом PBIX, мерами, страницами PBI, темой, симметрией, INTERNATIONAL CONTROL DESK.pbix, автоматизацией Power BI
---

# SKILL: power-bi-dax

## Главный файл

`BIZNES-AI/INTERNATIONAL CONTROL DESK.pbix` — 23 страницы, 252 меры, 5 отделов.

---

## Инструменты — иерархия (hands-off приоритет)

### 1. pbi-cli — AI-first, без Desktop (NEW, июнь 2026)

Python-инструмент специально для AI агентов + PBI. Прямой .NET interop через TOM/ADOMD.NET.
Sub-second выполнение. Power BI Desktop НЕ нужен.

```bash
pip install pbi-cli
pbi connect --workspace "COLUMBUS"
pbi measure list
pbi measure add --name "מכר ממוצע ביום" --table "KARTIS PARIT" \
  --expression "DIVIDE([מכר קרטון], [ימים שהיה בהם מכר])"
pbi measure delete --name "Unused Measure 1"
pbi deploy
```

### 2. Tabular Editor CLI (preview 2025-2026)

Кросс-платформа. 50+ команд. Без GUI. XMLA или файл.

```bash
# Подключение к workspace через XMLA
te3 connect --xmla "powerbi://api.powerbi.com/v1.0/myorg/COLUMBUS"

# Аудит — список всех мер
te3 model show measures --format json > measures.json

# Удалить список мер из файла
te3 script run delete-unused.cs

# Деплой изменений
te3 deploy --target "powerbi://api.powerbi.com/v1.0/myorg/COLUMBUS"
```

C# скрипт для удаления 153 мер (`delete-unused.cs`):
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

### 6. Tabular Editor 3 (Desktop — когда PBI открыт)

```powershell
Start-Process "C:\Program Files\Tabular Editor 3\TabularEditor3.exe" -ArgumentList "localhost:65428"
```

Список неиспользуемых мер: `C:\tmp\unused-measures.txt` (153 меры, аудит 2026-06-01)

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
