// ========================================
// POWER BI M CODE - АКЦИИ ПО СЕТИ (SOF_PRICEREC) - FORMULA
// ========================================
// Источник: SOF_PRICEREC (кастомная таблица Priority, экспорт экрана PITR_SOF_PRICEREC
// из MIVCAIIM TABLET.xlsx). Проверено вживую 2026-09-06 (см. VAULT/Meeting Notes/formula-road-app.md).
// "Сеть" = CUSTOMERS.CUSTDES — отдельного поля с брендом сети в Priority нет.
// Есть также в diller/icecrea/mmdint — заменить "form" на нужную БД для другой компании.
// Окно акций: текущий месяц + месяц вперёд от сегодня (rolling, не конец календарного месяца).
// PRICEREC=0/NULL — акция реальна, цену ставит сама сеть на кассе, не фильтровать (2026-09-06).
// ВАЖНО: акция часто заведена один раз на CUSTOMERS.MCUST ("לקוח מרכז" — головной клиент
// сети), не на каждый филиал. Эта таблица показывает CUST напрямую — филиал с акцией на
// его MCUST здесь не найдётся под своим именем, только под именем хаба. Per-client резолв
// CUST+MCUST — см. clientPromosByCustId в server/priority-db.js.
let
    Source = Sql.Database("192.168.100.246", "form", [Query="

SELECT
    c.CUSTNAME                                                          AS [מס. לקוח],
    NCHAR(8237) + REVERSE(c.CUSTDES) + NCHAR(8236)                     AS [שם רשת],
    NCHAR(8237) + REVERSE(ISNULL(pd.PRICEDESCDESC, '')) + NCHAR(8236)  AS [סוג מבצע],
    p.PARTNAME                                                          AS [מק''ט],
    NCHAR(8237) + REVERSE(p.PARTDES) + NCHAR(8236)                     AS [תאור מוצר],
    sp.PRICEREC                                                         AS [מחיר מבצע],
    sp.QUANTPRICE / 1000.0                                              AS [כמות למבצע],
    CAST(DATEADD(MINUTE, sp.FROMDATE, '19880101') AS date)              AS [תוקף מתאריך],
    CAST(DATEADD(MINUTE, sp.TODATE,   '19880101') AS date)              AS [תוקף עד תאריך]
FROM form.dbo.SOF_PRICEREC sp
JOIN form.dbo.CUSTOMERS c          ON c.CUST = sp.CUST
JOIN form.dbo.PART p               ON p.PART = sp.PART
LEFT JOIN form.dbo.SOF_PRICEDESC pd ON pd.PRICEDESID = sp.PRICEDESID
WHERE CAST(DATEADD(MINUTE, sp.FROMDATE, '19880101') AS date) <= DATEADD(MONTH, 1, CAST(GETDATE() AS date))
  AND CAST(DATEADD(MINUTE, sp.TODATE,   '19880101') AS date) >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
ORDER BY c.CUSTDES, p.PARTDES

"])
in
    Source
