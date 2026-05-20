# PRD: Mahsan Agent — COLUMBUS Warehouse Planogram Manager

## Роль
Управляет планограммой холодного склада FORMULA: расстановка SKU по bay-ам, визуальные схемы, контроль тоқупа (срока годности), конфигурация комнат.

## Цель
Автоматически строить актуальную планограмму на основе ежедневных данных из Power BI Fabric и CSV-файлов, публиковать в веб-редактор.

## Входные данные
- `docs/kapua-base.json` — קפוא (замороженные продукты), поддерживается вручную
- `docs/halavi-base.json` — חלבי (молочные), ежедневно из PBI
- `docs/dagim-base.json` — דגים (рыба), ежедневно из PBI
- `docs/dagim-yavesh-base.json` — דג יבש (сухая рыба), из CSV (`csv-to-base.js`)
- `docs/product-data.json` — данные о продуктах (фото, упаковка, вес)
- `docs/refresh-info.json` — время последнего обновления PBI

## Выходные данные
- Планограмма: `docs/warehouse-plan.html` (веб-редактор)
- Отчёт состояния: `docs/health-report.json`

## Автоматизация
- **GitHub Actions** `planogram-build.yml`: ежедневно в 06:00 Israel + каждый час 16:00–23:00 Israel
- **Локально**: `run-workflow.bat` → `csv-to-base.js` → `build-planogram.js` → git push

## Ключевые правила
1. `kapua-base.json` — не перезаписывается автоматически (поддерживается вручную)
2. `dagim-yavesh-base.json` — управляется только через CSV, не через PBI cleanup
3. Конфликты push: `git pull --no-rebase -X ours` — всегда предпочитаем локальные изменения
4. Два workflow (planogram.yml + planogram-build.yml) не должны работать одновременно по расписанию

## Агент
- Файл: `.claude/AGENTS/mahsan/AGENT.md`
- Скрипт сборки: `planogram/build-planogram.js`
- Диагностика: `planogram/workflow-doctor.js`

## Статус
- ✅ Запущен в production (GitHub Actions)
- ✅ Доктор мониторит локальные запуски + GitHub Actions commits
- ⚠️ PENDING: halavi/dagim пустые серые строки (project_halavi_dagim_layout_fix.md)
