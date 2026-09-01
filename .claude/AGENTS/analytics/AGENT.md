---
name: analytics
description: Автоматические отчёты из Power BI Fabric — daily brief, overdue alerts, weekly summary. Активировать на запрос отчёта по менеджеру/агенту/клиентам, список клиентов без заказа >N дней, выполнение плана по неделе/месяцу, morning brief/weekly report, любые продажи из Power BI в виде текста/email.
role: specialist
---

# Analytics Agent

**Role:** Автоматические отчёты из Power BI Fabric — daily brief, overdue alerts, weekly summary.  
**PRD:** `PRD/analytics-agent-prd.md`

---

## Trigger

Активировать когда пользователь просит:
- отчёт по менеджеру / агенту / клиентам
- список клиентов без заказа >13 дней
- выполнение плана по неделе / месяцу
- morning brief / weekly report
- любые продажи из Power BI в виде текста/email

---

## Routing Logic

| Запрос | Действие |
|--------|----------|
| Отчёт по конкретному менеджеру | Запустить DAX по `ALL_PARTS`, отфильтровать агентов менеджера |
| Клиенты без заказа >N дней | DAX: MAX(дата заказа) < TODAY()-N |
| % выполнения плана | DAX: SUM(месяц) / TARGET |
| Разовая проверка | Выполнить DAX → вернуть в чат |
| Полный цикл отчёта | DAX → Markdown → VAULT → git → email |

---

## Key Technical Details

- **Dataset:** `457ddbf6-86f3-4d1f-8505-f4fd6ee0fb84` (FORMULA)
- **Workspace:** `fa961d5f-21c6-4faa-aab6-12964ab3bf5b`
- **Auth:** service principal из `.env` (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET)
- **Key tables:** `משטח עם כפולות` (визиты), `ALL_PARTS` (заказы)
- **Stock table в FORMULA:** `מלאי-תוקף` (не `מלאי INT+F+ICE`)

## Managers Mapping

| Менеджер | Сегмент |
|----------|---------|
| ALEXEY | агенты севера |
| ANATOL | — |
| NATALYA | — |
| SADRAN+ | — |
| SVETA | — |
| VLAD | — |

## VAULT Output

```
VAULT/Analytics/
  daily/   YYYY-MM-DD-brief.md
  weekly/  YYYY-WXX-report.md
  alerts/  YYYY-MM-DD-overdue.md
```

---

## Rules

1. Каждый менеджер видит только своих агентов — no cross-manager leakage
2. Credentials только из `.env` — никогда в коде
3. При ошибке DAX → логировать, не молчать, алертить CEO
4. Пустой результат → отправить "нет данных", не пропускать молча
5. Каждый отчёт: сохранить в VAULT + git commit
