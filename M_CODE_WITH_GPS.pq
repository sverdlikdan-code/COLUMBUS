let
// ЭТАП 1: Подключение к базе данных и выполнение SQL запроса
Source = Sql.Database("192.168.100.246", "form", [Query="
SELECT c.CUSTNAME AS 'מס. לקוח',
NCHAR(8237) + REVERSE(c.CUSTDES) + NCHAR(8236) AS [שם לקוח],
cs.STATDES AS 'סטטוס',
csp.SPEC6 AS [סניף],
c.STATE AS 'עיר',
c.ADDRESS AS 'כתובת',
ct.CTYPENAME AS 'תאור סוג לקוח',
a.AGENTCODE AS 'סוכן',
a.AGENTNAME AS 'שם סוכן',
ub.SNAME AS 'שם סדרן',
pc.CUSTNAME AS 'מס לקוח משלם',
pc.CUSTDES AS 'שם לקוח משלם',
mc.CUSTNAME AS 'לקוח מרכז',
c.WTAXNUM AS 'מס חברה',
c.PARTFLAG AS 'מוצרים ללקוח בלבד?',
csp.SPEC10 AS N'כשרות',
REVERSE(csp.SPEC7) AS 'פרמטר 7',
REVERSE(csp.SPEC5) AS 'מספר לקוח קודם',
csp.SPEC20 AS 'סוג מכירה',
DATEADD(MINUTE, c.CREATEDDATE, '01/01/1988') AS 'תאריך פתיחה',
c.GPSX AS 'קו רוחב',
c.GPSY AS 'קו אורך'
FROM form.dbo.CUSTOMERS c
LEFT JOIN form.dbo.CUSTSTATS cs ON c.CUSTSTAT = cs.CUSTSTAT
LEFT JOIN form.dbo.BRANCHES b ON c.BRANCH = b.BRANCH
LEFT JOIN form.dbo.CTYPE ct ON c.CTYPE = ct.CTYPE
LEFT JOIN form.dbo.AGENTS a ON c.AGENT = a.AGENT
LEFT JOIN form.dbo.CUSTOMERS pc ON c.PAYCUST = pc.CUST
LEFT JOIN form.dbo.CUSTOMERS mc ON c.MCUST = mc.CUST
LEFT JOIN form.dbo.CUSTSPEC csp ON c.CUST = csp.CUST
LEFT JOIN system.dbo.USERSB ub ON c.YISS_MANAGER = ub.USERB
ORDER BY c.CUSTNAME
"]),
// ЭТАП 2: Очистка данных
CleanEmptyStrings = Table.TransformColumns(Source, {
{"מס. לקוח", each if Text.Length(Text.From(_)) = 0 then null else _},
{"שם לקוח", each if Text.Length(Text.From(_)) = 0 then null else _},
{"סטטוס", each if Text.Length(Text.From(_)) = 0 then null else _},
{"סניף", each if Text.Length(Text.From(_)) = 0 then null else _},
{"עיר", each if Text.Length(Text.From(_)) = 0 then null else _},
{"כתובת", each if Text.Length(Text.From(_)) = 0 then null else _},
{"תאור סוג לקוח", each if Text.Length(Text.From(_)) = 0 then null else _},
{"סוכן", each if Text.Length(Text.From(_)) = 0 then null else _},
{"שם סוכן", each if Text.Length(Text.From(_)) = 0 then null else _},
{"שם סדרן", each if Text.Length(Text.From(_)) = 0 then null else _},
{"מס לקוח משלם", each if Text.Length(Text.From(_)) = 0 then null else _},
{"שם לקוח משלם", each if Text.Length(Text.From(_)) = 0 then null else _},
{"לקוח מרכז", each if Text.Length(Text.From(_)) = 0 then null else _},
{"מס חברה", each if Text.Length(Text.From(_)) = 0 then null else _},
{"מוצרים ללקוח בלבד?", each if Text.Length(Text.From(_)) = 0 then null else _},
{"כשרות", each if Text.Length(Text.From(_)) = 0 then null else _},
{"פרמטר 7", each if Text.Length(Text.From(_)) = 0 then null else _},
{"מספר לקוח קודם", each if Text.Length(Text.From(_)) = 0 then null else _},
{"סוג מכירה", each if Text.Length(Text.From(_)) = 0 then null else _}
}),
#"Changed Type" = Table.TransformColumnTypes(CleanEmptyStrings,{{"סוג מכירה", type text}}),
// ЭТАП 3: Типы данных
SetDataTypes = Table.TransformColumnTypes(#"Changed Type", {
{"מס. לקוח", type text},
{"שם לקוח", type text},
{"סטטוס", type text},
{"סניף", type text},
{"עיר", type text},
{"כתובת", type text},
{"תאור סוג לקוח", type text},
{"סוכן", type text},
{"שם סוכן", type text},
{"שם סדרן", type text},
{"מס לקוח משלם", type text},
{"שם לקוח משלם", type text},
{"לקוח מרכז", type text},
{"מס חברה", type text},
{"מוצרים ללקוח בלבד?", type text},
{"כשרות", type text},
{"פרמטר 7", type text},
{"מספר לקוח קודם", type text},
{"סוג מכירה", type text},
{"תאריך פתיחה", type datetime},
{"קו רוחב", type number},
{"קו אורך", type number}
}),
RemoveBlankRows = Table.SelectRows(SetDataTypes, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null}))),
#"Removed Duplicates" = Table.Distinct(RemoveBlankRows, {"מס. לקוח"}),
#"Filtered Rows1" = Table.SelectRows(#"Removed Duplicates", each [#"מס. לקוח"] <> null and [#"מס. לקוח"] <> ""),
FilteredRows = Table.SelectRows(#"Filtered Rows1", each ([#"מס. לקוח"] <> "")),
FinalCleanup = Table.SelectRows(FilteredRows, each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null}))),
#"Filtered Rows" = Table.SelectRows(FinalCleanup, each ([#"מס. לקוח"] <> null)),
#"Removed Blank Rows" = Table.SelectRows(#"Filtered Rows", each not List.IsEmpty(List.RemoveMatchingItems(Record.FieldValues(_), {"", null}))),
#"Added Custom" = Table.AddColumn(#"Removed Blank Rows", "HEVRA", each "FORMULA")
in
#"Added Custom"
