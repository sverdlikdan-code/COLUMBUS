-- ========================================
-- CUSTOMERS QUERY - form database (MVP)
-- Priority ERP | без מנהל
-- ========================================
SELECT
    c.CUSTNAME                                                  AS [מס. לקוח],
    NCHAR(8237) + REVERSE(c.CUSTDES) + NCHAR(8236)             AS [שם לקוח],
    cs.STATDES                                                  AS [סטטוס],
    csp.SPEC6                                                   AS [סניף],
    c.STATE                                                     AS [עיר],
    c.ADDRESS                                                   AS [כתובת],
    ct.CTYPENAME                                                AS [תאור סוג לקוח],
    a.AGENTCODE                                                 AS [סוכן],
    a.AGENTNAME                                                 AS [שם סוכן],
    ub.SNAME                                                    AS [שם סדרן],
    csp.SPEC10                                                  AS [כשרות],
    REVERSE(csp.SPEC7)                                          AS [פרמטר 7],
    csp.SPEC20                                                  AS [סוג מכירה],
    LTRIM(RTRIM(ISNULL(c.ADDRESS, '')))
        + CASE WHEN LTRIM(RTRIM(ISNULL(c.STATE, ''))) <> ''
               THEN ', ' + LTRIM(RTRIM(c.STATE))
               ELSE '' END
        + ', ישראל'                                             AS [כתובת מלאה],
    c.GPSX                                                      AS [קו רוחב],
    c.GPSY                                                      AS [קו אורך]
FROM form.dbo.CUSTOMERS c
LEFT JOIN form.dbo.CUSTSTATS cs     ON c.CUSTSTAT     = cs.CUSTSTAT
LEFT JOIN form.dbo.CTYPE ct         ON c.CTYPE         = ct.CTYPE
LEFT JOIN form.dbo.AGENTS a         ON c.AGENT         = a.AGENT
LEFT JOIN form.dbo.CUSTSPEC csp     ON c.CUST          = csp.CUST
LEFT JOIN system.dbo.USERSB ub      ON c.YISS_MANAGER  = ub.USERB
WHERE
    (csp.SPEC20 <> N'משלם' OR csp.SPEC20 IS NULL)
    AND (csp.SPEC7 IS NOT NULL AND LTRIM(RTRIM(csp.SPEC7)) <> '')
    AND (a.AGENTNAME IS NOT NULL AND a.AGENTNAME <> N'כללי')
ORDER BY a.AGENTNAME, c.CUSTNAME
