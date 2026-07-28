# PRD: priority-sql Skill — Priority ERP SQL Integration

## Роль
Справочник для работы с Priority ERP через прямой SQL и REST API в проекте COLUMBUS: формат дат, ключевые таблицы, JOIN-паттерны, BiDi для иврита, агрегаты.

## Проблема
Priority ERP хранит данные в нестандартном формате (даты как int-минуты с 01.01.1988, количества ×1000, пустые даты = 0 а не NULL). Без единого справочника агент угадывает формулы и допускает ошибки в расчётах.

Дополнительно: חשבונית מרוכזת (consolidated invoice) ставит IVDATE = последнее число месяца — вызывает ложный спайк продаж в конце месяца. Фикс через DOCUMENTS2.CURDATE был найден с трудом.

## Цель
Скилл отвечает на вопрос "как написать SQL-запрос к Priority для этого кейса" за одно обращение, без угадывания форматов.

## Триггер
- SQL к базам 192.168.100.246 (form, diller, icecrea, mmdint, system)
- Power BI M код с источником Priority SQL Server
- Вопросы про IVDATE, CURDATE, QUANT, TOTPRICE
- Интеграция Priority API (OData, webhooks)
- Сумма продаж, количество, даты отгрузок из Priority

## Содержание скилла

### Базы данных
| База | Компания |
|------|----------|
| form | FORMULA |
| diller | DILLER |
| icecrea | ICE CREAM |
| mmdint | MMD |
| system | системные таблицы |

### Критичные форматы
| Поле | Формат | Конвертация |
|------|--------|-------------|
| IVDATE / CURDATE | int (мин с 01.01.1988) | `DATEADD(MINUTE, field, '19880101')` |
| Пустая дата | 0, не NULL | `NULLIF(field, 0)` |
| QUANT / TQUANT | ×1000 | `/1000.000000` |
| Возврат | DEBIT='C' | `×(-1)` |
| Кредит-строка | CREDITFLAG='Y' | `×0` |

### CURDATE фикс (месячный спайк)
```sql
COALESCE(NULLIF(DOCUMENTS2.CURDATE, 0), [db].dbo.INVOICES.IVDATE)
```
Применять в: SELECT ×3 (תאריך_דקות, תאריך, תאריך_נקי) + GROUP BY ×1.

### Фильтр по периоду
```
2023-01-01 = 18408960
2024-01-01 = 18934560
2026-12-31 = 20512799
```

## Ключевые правила
1. Все QUANT-поля делить на 1000
2. CREDITFLAG='Y' → исключить строку из суммы
3. DEBIT='C' → умножить на -1 (возврат)
4. Иврит в SELECT оборачивать в `NCHAR(8237)+REVERSE(field)+NCHAR(8236)`
5. GROUP BY повторять то же выражение что в SELECT (включая NCHAR+REVERSE)
6. FINAL='Y' — обычно обязательный фильтр
7. system.dbo.T$DUMMY — anchor-таблица из 1 строки (Priority-стиль)

## Статус
- SKILL.md создан: 2026-07-28
- PRD создан: 2026-07-28
- Vault note: skill-priority-sql.md
