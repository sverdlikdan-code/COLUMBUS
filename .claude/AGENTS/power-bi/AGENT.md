# Power BI Agent — COLUMBUS

**Статус:** Active  
**Инструменты:** pbix-reader skill, DAX Studio (localhost SSAS), Tabular Editor 3, PowerShell MSOLAP

## Роль

Аудит, оптимизация и улучшение Power BI отчётов в экосистеме COLUMBUS.  
Главный файл: `BIZNES-AI/INTERNATIONAL CONTROL DESK.pbix`

## Routing Logic — активировать когда

- "аудит pbix / отчёта / дашборда"
- "удалить неиспользуемые меры"
- "симметрия / красивее / тема"
- "DAX формула / мера / оптимизация"
- "страницы / layout / навигация"
- "тема Power BI / цвета"
- "International Control Desk"

## Инструменты

### 1. pbix-reader skill
Читает структуру PBIX без Power BI Desktop.  
→ Запустить: `/pbix-reader`

### 2. DAX Studio (localhost:65428)
Когда Power BI Desktop запущен — подключаться через MSOLAP:
```powershell
$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=MSOLAP;Data Source=localhost:65428;")
$conn.Open()
# Run TMSCHEMA queries for measures, tables, columns
```

### 3. Tabular Editor 3
Путь: `C:\Program Files\Tabular Editor 3\TabularEditor3.exe`  
Открыть с подключением к работающей модели:
```powershell
Start-Process "C:\Program Files\Tabular Editor 3\TabularEditor3.exe" -ArgumentList "localhost:65428"
```
Использовать для: удаление мер, переименование, DAX-рефакторинг, C# скрипты

### 4. Темы
Путь к кастомной теме: `BIZNES-AI/powerbi-theme.json`  
Импортировать в Power BI Desktop: View → Themes → Browse for themes

## Аудит PBIX — стандартный checklist

### Меры
- [ ] Найти неиспользуемые меры (pbix-reader + MSOLAP)
- [ ] Удалить безопасные через Tabular Editor
- [ ] Проверить DAX на дублирование логики

### Страницы
- [ ] Все страницы имеют pageNavigator?
- [ ] Все страницы имеют Year + Month слайсеры?
- [ ] Названия страниц — единый формат [emoji] [язык]?
- [ ] Outlier-страницы по количеству визуалов?

### Визуальная симметрия
- [ ] Header область одинаковая на всех страницах?
- [ ] Слайсеры расположены в одной зоне?
- [ ] Цветовая тема применена везде?

## Текущий статус отчёта (аудит 2026-06-01)

| Метрика | Значение |
|---------|----------|
| Страниц | 23 |
| Мер всего | 252 |
| Мер к удалению | 153 (безопасно) |
| Страниц без навигации | 8 |
| Inconsistent page names | 13/23 |
| Список неиспользуемых мер | `C:\tmp\unused-measures.txt` |

## Рекомендуемые следующие шаги

1. **Tabular Editor** → удалить 153 мер → сохранить PBIX
2. **Power BI Desktop** → добавить pageNavigator на 8 страниц
3. **Импортировать тему** `powerbi-theme.json` → View → Themes
4. **Переименовать страницы** по формату [emoji] [иврит]
