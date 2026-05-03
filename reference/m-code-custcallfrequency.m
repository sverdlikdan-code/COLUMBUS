// CUSTCALLFREQUENCY — дни визитов клиентов
// Таблица: CUSTCALLFREQUENCY.DAYNUM → 1=א 2=ב 3=ג 4=ד 5=ה 6=ו 7=ש
// JOIN: ccf.CUST = c.CUST
// Фильтр активных: cs.STATDES = 'פעיל'
let
    Source = Sql.Database("192.168.100.246", "icecrea", [Query="
SELECT
    ccf.[CUST],
    c.[CUSTNAME] AS 'מס.לקוח',
    NCHAR(8237) + REVERSE(c.[CUSTDES]) + NCHAR(8236) AS 'שם לקוח',
    NCHAR(8237) + REVERSE(cs.[STATDES]) + NCHAR(8236) AS 'סטטוס',
    a.[AGENTCODE] AS 'סוכן',
    NCHAR(8237) + REVERSE(a.[AGENTNAME]) + NCHAR(8236) AS 'שם סוכן',
    CASE ccf.[DAYNUM]
        WHEN 1 THEN 'א'
        WHEN 2 THEN 'ב'
        WHEN 3 THEN 'ג'
        WHEN 4 THEN 'ד'
        WHEN 5 THEN 'ה'
        WHEN 6 THEN 'ו'
        WHEN 7 THEN 'ש'
        ELSE CAST(ccf.[DAYNUM] AS VARCHAR(2))
    END AS 'יום'
FROM [icecrea].[dbo].[CUSTCALLFREQUENCY] ccf
LEFT JOIN [icecrea].[dbo].[CUSTOMERS] c ON ccf.[CUST] = c.[CUST]
LEFT JOIN [icecrea].[dbo].[CUSTSTATS] cs ON c.[CUSTSTAT] = cs.[CUSTSTAT
LEFT JOIN [icecrea].[dbo].[AGENTS] a ON c.[AGENT] = a.[AGENT]
WHERE cs.[STATDES] = 'פעיל'
ORDER BY c.[CUSTNAME]
"]),
    #"Removed Blank Rows" = Table.SelectRows(Source, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null}))),
    #"Filtered Rows1" = Table.SelectRows(#"Removed Blank Rows", each ([מס.לקוח] <> "")),
    #"Replaced Value" = Table.ReplaceValue(#"Filtered Rows1"," ","לא מוגדר",Replacer.ReplaceText,{"יום"})
in
    #"Replaced Value"
