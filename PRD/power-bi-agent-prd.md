# PRD — Power BI Agent
**Версия:** 1.0  
**Дата:** 2026-06-01  
**Статус:** 🟢 Active

## Проблема

В COLUMBUS нет специализированного агента для работы с Power BI отчётами.  
Задачи по аудиту PBIX, DAX-оптимизации, симметрии layout, темам — решались ad hoc без системного подхода.

## Решение

Агент `power-bi` — специалист по Power BI внутри COLUMBUS.  
Умеет читать PBIX-файлы, аудировать меры, удалять мусор, создавать темы и давать конкретные рекомендации по layout.

## Основные функции

| Функция | Инструмент |
|---------|-----------|
| Читать структуру PBIX | `pbix-reader` skill |
| Извлекать меры с DAX | MSOLAP OLE DB → localhost SSAS |
| Удалять неиспользуемые меры | Tabular Editor 3 |
| Аудит симметрии страниц | Layout JSON анализ |
| Создавать темы | JSON → `powerbi-theme.json` |
| DAX-рефакторинг | Tabular Editor C# скрипты |

## Главный файл

`BIZNES-AI/INTERNATIONAL CONTROL DESK.pbix`  
23 страницы, 252 меры, 27 пользователей ежедневно, 5 отделов

## Текущий статус

- ✅ 153 меры идентифицированы к удалению (`C:\tmp\unused-measures.txt`)
- ✅ Тема создана (`BIZNES-AI/powerbi-theme.json`)
- ⏳ Удаление мер через Tabular Editor 3 — ожидает
- ❌ 8 страниц без pageNavigator — нужно в Power BI Desktop
- ❌ 13/23 названий страниц inconsistent — нужно в Power BI Desktop

## Ограничения

- Изменение visual layout возможно только через Power BI Desktop (GUI)
- DataModel в PBIX бинарный — только Tabular Editor читает меры/формулы
- Данные (реальные числа) в PBIX не хранятся — только схема
