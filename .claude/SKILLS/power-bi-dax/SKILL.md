---
name: power-bi-dax
description: Аудит PBIX, DAX-оптимизация, MSOLAP подключение, Tabular Editor, темы, симметрия layout. Для агента power-bi в COLUMBUS.
trigger: Активировать при любой задаче с DAX, аудитом PBIX, мерами, страницами PBI, темой, симметрией, INTERNATIONAL CONTROL DESK.pbix
---

# SKILL: power-bi-dax

## Главный файл

`BIZNES-AI/INTERNATIONAL CONTROL DESK.pbix` — 23 страницы, 252 меры, 5 отделов.

---

## Инструменты и подключение

### MSOLAP (DAX Studio / PowerShell) — когда PBI Desktop открыт

```powershell
$conn = New-Object System.Data.OleDb.OleDbConnection(
  "Provider=MSOLAP;Data Source=localhost:65428;"
)
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT [MEASURE_NAME],[EXPRESSION] FROM $SYSTEM.TMSCHEMA_MEASURES"
$reader = $cmd.ExecuteReader()
while ($reader.Read()) { Write-Output "$($reader[0]): $($reader[1])" }
$conn.Close()
```

### Tabular Editor 3

```powershell
Start-Process "C:\Program Files\Tabular Editor 3\TabularEditor3.exe" -ArgumentList "localhost:65428"
```

Удалить список мер через C# скрипт в TE3:
```csharp
var toDelete = new[] { "Measure1", "Measure2" };
foreach (var name in toDelete)
  if (Model.AllMeasures.Any(m => m.Name == name))
    Model.AllMeasures.First(m => m.Name == name).Delete();
```

Список неиспользуемых мер: `C:\tmp\unused-measures.txt` (153 меры, аудит 2026-06-01)

### Тема

Путь: `BIZNES-AI/powerbi-theme.json`  
Импорт: Power BI Desktop → View → Themes → Browse for themes

---

## DAX — Известные паттерны и ловушки

### Граничные недели — занижение средней

**Проблема:** `[מכר ממוצע בשבוע קרטון]` считает distinct недели с продажами.
При выборе отдельных месяцев — частичные недели на границах считаются как полные → среднее занижено.

```
May (yamim=6, total=27):  27 / 2 нед = 13.5
Jun (yamim=12, total=51): 51 / 4 нед = 12.8
May+Jun combined:         78 / 5 нед = 15.6  ← выше обоих (граничная неделя считается 1 раз)
```

**Надёжный показатель:** `[מכר קרטון]` (total) — всегда точен, складывается правильно.  
**Рекомендация:** добавить меру `[מכר ממוצע ביום]` = `DIVIDE([מכר קרטון], [ימים שהיה בהם מכר])` — не зависит от недельных границ.

### LOOKUPVALUE вместо RELATED (нет связи)

Если таблицы не связаны в модели PBI, использовать:
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
-- ПРАВИЛЬНО: использовать DIMCALENDAR
DATESBETWEEN(DIMCALENDAR[Date], DATE(2026,5,1), DATE(2026,5,31))

-- НЕПРАВИЛЬНО: 'KARTIS PARIT'[תאריך] — столбец может не существовать
```

### REST API запрос к датасету

```js
// POST https://api.powerbi.com/v1.0/myorg/datasets/{datasetId}/executeQueries
const body = {
  queries: [{ query: `EVALUATE SUMMARIZECOLUMNS(...)` }],
  serializerSettings: { includeNulls: true }
};
```

---

## Аудит PBIX — чеклист

### Меры
- [ ] Найти неиспользуемые: `C:\tmp\unused-measures.txt`
- [ ] Удалить 153 безопасных через Tabular Editor 3
- [ ] Проверить DAX на дублирование логики
- [ ] Добавить отсутствующие: `[מכר ממוצע ביום]`

### Страницы
- [ ] 8 страниц без pageNavigator → добавить в PBI Desktop
- [ ] 13/23 названий страниц non-standard → формат: `[emoji] [иврит]`
- [ ] Все страницы: Year + Month слайсеры в одной зоне

### Визуальная симметрия
- [ ] Header одинаковый на всех страницах
- [ ] Тема `powerbi-theme.json` применена
- [ ] Цвета статусов: зелёный OK, красный проблема, жёлтый внимание

---

## Статус (аудит 2026-06-01)

| Пункт | Статус |
|-------|--------|
| 153 меры к удалению | ⏳ ожидает Tabular Editor |
| 8 страниц без nav | ❌ нужен PBI Desktop |
| 13 названий страниц | ❌ нужен PBI Desktop |
| Тема создана | ✅ `powerbi-theme.json` |
| Мера `[מכר ממוצע ביום]` | ❌ не создана |

---

## Ограничения

- Visual layout — только через Power BI Desktop GUI (не автоматизировать)
- DataModel в PBIX бинарный — только Tabular Editor читает меры/формулы напрямую
- Реальные данные в PBIX не хранятся — только схема. Данные живут в dataset (PBI Service)
