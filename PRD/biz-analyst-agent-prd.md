# PRD: Biz Analyst Agent — COLUMBUS Commercial Evaluator

## Роль
Оценивает коммерческий потенциал системы COLUMBUS: рыночное позиционирование, стоимость разработки, масштабируемость, безопасность данных, ROI для инвестора.

## Цель
Предоставить профессиональную оценку для питчинга инвесторам и клиентам.

## Выходные данные
- `COLUMBUS — מסמך מסירת פרויקט.xlsx` (иврит) — `node generate-delivery-doc.js`
- `COLUMBUS — Сдача проекта.xlsx` (русский) — `node generate-delivery-doc-ru.js`
- `COLUMBUS — Время по проекту.xlsx` — `node generate-time-report.js`

## Excel-документ (5 листов)
1. **Титул** — название, версия, клиент, дата
2. **Что сдано** — 12 модулей с описанием и статусом
3. **Коммерческий потенциал** — рыночная стоимость, конкуренты
4. **Безопасность данных** — хранение, изоляция, токены, GDPR
5. **Инвестиции и ROI** — 3 сценария: Conservative ×2.5 / Realistic ×6.5 / Optimistic ×16

## Рыночный контекст Израиль 2026
- Field sales SaaS: $300–3,000/мес
- Planogram software: $2,000–8,000/мес
- WMS warehouse: $5,000–20,000/мес
- AI-augmented: premium ×1.5–2x

## Конкурентные преимущества COLUMBUS
1. All-in-one: field app + planogram + analytics + AI agents
2. Hebrew-first + знание израильского рынка
3. Direct Fabric/PBI интеграция (без middleware)
4. Zero-server SaaS (GitHub Actions CI/CD)
5. Built-in AI agents для маршрутизации, склада, финансов

## Агент
- Файл: `.claude/AGENTS/biz-analyst/AGENT.md`
- Скрипты: `generate-delivery-doc.js`, `generate-delivery-doc-ru.js`, `generate-time-report.js`

## Статус
- ✅ Excel-документы созданы (иврит + русский)
- ✅ Время-отчёт создан
