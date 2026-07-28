---
name: priority-sql
description: Use when writing SQL queries against Priority ERP databases (form/diller/icecrea/mmdint) on 192.168.100.246. Covers table structure, GPS extraction, date format, order lifecycle, and common gotchas.
---

# Priority ERP SQL — Skill

## Server & Databases

| DB name  | Company  | Notes                     |
|----------|----------|---------------------------|
| `form`   | FORMULA  | Main sales company        |
| `diller` | INTER    | Distribution company      |
| `icecrea`| ICE      | Ice cream / frozen        |
| `mmdint` | MMD INT  | International             |

Server: `192.168.100.246` (ReadOnlyUser)

## Date Format

`CURDATE`, `UDATE`, `LFROMDATE` etc. are stored as **bigint YYYYMMDD**:
```sql
-- Filter 2026 only:
AND O.CURDATE >= 20260101

-- All time (no filter):
-- just omit the condition
```

## GPS from Orders — Key Pattern

GPS is captured by the mobile app when an order is created.

**Tables:**
- `ORDERS` — open/active orders only (CUST + ORD + CURDATE + CLOSED + ORDSTATUS)
- `ORDERSB` — extension table, one row per order (ORD + **GPSX** + **GPSY**)
- `CUSTOMERS` — customer master (CUST + GPSX + GPSY) — same source as PBI

**Critical facts:**
- `ORDERSB.GPSX` = **longitude** (~34.x for Israel)
- `ORDERSB.GPSY` = **latitude** (~31–33.x for Israel)
- `CUSTOMERS.GPSX/GPSY` = same data as Power BI — already used as PBI source
- `ORDERS` contains ONLY open orders — closed orders are **deleted** from ORDERS
- Closed-order GPS exists in ORDERSB but the CUST is lost (no archive table)
- `ORDERSB.IVDESTCODE` = always 0, NOT the customer code
- `ORDERSB.ORD` → `ORDERS.ORD` is the join key

**Aggregation query — most frequent GPS per customer:**
```sql
WITH gps_counts AS (
  SELECT O.CUST, OB.GPSX, OB.GPSY, COUNT(*) AS cnt
  FROM ORDERS O
  JOIN ORDERSB OB ON OB.ORD = O.ORD
  WHERE OB.GPSX IS NOT NULL AND OB.GPSX != '' AND OB.GPSX != '0'
    AND OB.GPSY IS NOT NULL AND OB.GPSY != '' AND OB.GPSY != '0'
  GROUP BY O.CUST, OB.GPSX, OB.GPSY
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY CUST ORDER BY cnt DESC) AS rn
  FROM gps_counts
)
SELECT CUST,
       CAST(GPSY AS float) AS lat,
       CAST(GPSX AS float) AS lng,
       cnt AS orders_at_location
FROM ranked WHERE rn = 1
ORDER BY CUST
```

## ORDERSB Column Names (confirmed)

| Column       | Type     | Meaning                        |
|-------------|----------|--------------------------------|
| ORD          | bigint   | Order ID (join key to ORDERS)  |
| GPSX         | nvarchar | Longitude (~34.x)              |
| GPSY         | nvarchar | Latitude (~31-32.x)            |
| IVDESTCODE   | bigint   | Always 0 — NOT customer code  |
| ORDUSERCODE  | bigint   | User/agent code                |
| AGENT2       | bigint   | Secondary agent                |
| SHIPREMARK   | nvarchar | Shipping note                  |

**Columns that do NOT exist in ORDERSB:** CUST, CUSTNAME, ORDNAME, CURDATE, FILENAME

## ORDERS Column Names (confirmed)

| Column    | Type    | Meaning                     |
|-----------|---------|------------------------------|
| ORD       | bigint  | Order ID (PK)                |
| CUST      | bigint  | Customer ID                  |
| CURDATE   | bigint  | Date YYYYMMDD                |
| CLOSED    | nchar   | Never 'Y' — closed = deleted |
| ORDSTATUS | bigint  | Order status code            |

## EXTFILES — NOT GPS

`EXTFILES` stores email/document attachments (paths like `../../system/mail/Docs/...`).
Columns: EXTFILEDES, EXTFILENUM, EXTFILENAME, SUFFIX, CURDATE, LINE, TYPE, USER, SCAN_FILENAME

**Column FILENAME does NOT exist in EXTFILES** — it belongs to linked table FILENAMESTATUS.

## GPS Coverage (2026, cross-company)

From session 2026-07-28:
| Company | Clients with GPS |
|---------|-----------------|
| FORM    | 1,371           |
| ICE     | 1,119           |
| INTER   | 835             |
| Total unique | 2,562     |

Cross-company match (±500m): 219 clients in 2+ companies → high confidence GPS.

## Common Gotchas

1. **USE db; WITH ...** fails — add semicolon: `USE diller;`
2. **GPS columns are nvarchar** — always `CAST(GPSX AS float)` before math
3. **Closed orders** have no CUST — only 57,745 open orders have GPS+CUST via JOIN
4. **ORDERSB has 187,526 GPS records** but only 57,745 match ORDERS (rest are closed/archived)
5. **CUSTOMERS.GPSX** = same as PBI source, already used — not new data
6. **INFORMATION_SCHEMA search** for GPS columns: search LAT/LONG/GPS/GEO/COORD/LOCAT
