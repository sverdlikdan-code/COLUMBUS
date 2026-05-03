// ========================================
// POWER BI M CODE - CUSTOMERS (ICECREAM) V3
// ========================================
let

Source = Sql.Database("192.168.100.246", "icecrea", [Query="

SELECT
    c.CUSTNAME                                              AS [מס. לקוח],
    NCHAR(8237) + REVERSE(c.CUSTDES) + NCHAR(8236)         AS [שם לקוח],
    cs.STATDES                                              AS [סטטוס],
    csp.SPEC6                                               AS [סניף],
    c.STATE                                                 AS [עיר],
    c.ADDRESS                                               AS [כתובת],
    ct.CTYPENAME                                            AS [תאור סוג לקוח],
    a.AGENTCODE                                             AS [סוכן],
    a.AGENTNAME                                             AS [שם סוכן],
    ub.SNAME                                                AS [שם סדרן],
    pc.CUSTNAME                                             AS [מס לקוח משלם],
    pc.CUSTDES                                              AS [שם לקוח משלם],
    mc.CUSTNAME                                             AS [לקוח מרכז],
    c.WTAXNUM                                               AS [מס חברה],
    c.PARTFLAG                                              AS [מוצרים ללקוח בלבד?],
    csp.SPEC10                                              AS [כשרות],
    REVERSE(csp.SPEC7)                                      AS [פרמטר 7],
    REVERSE(csp.SPEC5)                                      AS [מספר לקוח קודם],
    csp.SPEC20                                              AS [סוג מכירה],
    DATEADD(MINUTE, c.CREATEDDATE, '01/01/1988')            AS [תאריך פתיחה],
    LTRIM(RTRIM(ISNULL(c.ADDRESS, '')))
        + CASE WHEN LTRIM(RTRIM(ISNULL(c.STATE, ''))) <> ''
               THEN ', ' + LTRIM(RTRIM(c.STATE))
               ELSE '' END
        + ', ישראל'                                         AS [כתובת מלאה],
    c.GPSX                                                  AS [קו רוחב],
    c.GPSY                                                  AS [קו אורך]
FROM icecrea.dbo.CUSTOMERS c
LEFT JOIN icecrea.dbo.CUSTSTATS cs      ON c.CUSTSTAT   = cs.CUSTSTAT
LEFT JOIN icecrea.dbo.BRANCHES b        ON c.BRANCH     = b.BRANCH
LEFT JOIN icecrea.dbo.CTYPE ct          ON c.CTYPE      = ct.CTYPE
LEFT JOIN icecrea.dbo.AGENTS a          ON c.AGENT      = a.AGENT
LEFT JOIN icecrea.dbo.CUSTOMERS pc      ON c.PAYCUST    = pc.CUST
LEFT JOIN icecrea.dbo.CUSTOMERS mc      ON c.MCUST      = mc.CUST
LEFT JOIN icecrea.dbo.CUSTSPEC csp      ON c.CUST       = csp.CUST
LEFT JOIN system.dbo.USERSB ub          ON c.YISS_MANAGER = ub.USERB
ORDER BY c.CUSTNAME
"]),

CleanEmptyStrings = Table.TransformColumns(Source, {
    {"מס. לקוח", each if Text.Length(Text.From(_)) = 0 then null else _},
    {"שם לקוח",  each if Text.Length(Text.From(_)) = 0 then null else _}
}),

// ... (full M code stored for reference)

#"Merged Columns" = Table.CombineColumns(Source, {"עיר - Copy", "כתובת - Copy"}, Combiner.CombineTextByDelimiter(",", QuoteStyle.None), "ADRESS CITY")

in
#"Merged Columns"
