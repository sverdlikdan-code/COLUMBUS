# skill-priority-sql

Скилл для работы с Priority ERP через прямой SQL Server и REST API.

## Контекст

Priority ERP на сервере 192.168.100.246. Четыре производственные базы: form (FORMULA), diller, icecrea, mmdint. Данные используются в Power BI M кодах (INTER, MMD, ICE, FORMULA датасеты).

## Ключевые решения

**Формат дат** — все даты хранятся как `int` = минуты с 01.01.1988. Пустая дата = 0 (не NULL). Фильтр 2023–2026: `IVDATE >= 18408960 AND IVDATE <= 20512799`.

**CURDATE фикс** — חשבונית מרוכזת ставит IVDATE = конец месяца → ложный спайк. Фикс:
```sql
COALESCE(NULLIF(DOCUMENTS2.CURDATE, 0), [db].dbo.INVOICES.IVDATE)
```
Применён во все M коды (form/diller/icecrea/mmdint) в сессии 2026-07-28.

**mmdint** — дата фильтра начинается с 2024 (18934560) — намеренно.

## Сессии

### 2026-07-28 #priority-sql-skill-created
- Создан SKILL.md по архитектуре Priority SQL Server
- Покрыты: формат дат, IVDATE vs CURDATE, JOIN-паттерны, BiDi иврит, курсы валют, REST API OData
- Применён CURDATE фикс во M коды: diller, icecrea (×2 версии), form (с PIT_FISHWEIGHT)
- Созданы PRD + Vault note + добавлен триггер в CLAUDE.md
