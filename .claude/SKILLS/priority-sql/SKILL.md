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

`CURDATE`, `UDATE`, `LFROMDATE` etc. are **NOT** `bigint YYYYMMDD` — despite looking like it at
a glance (values like `20260101` and real CURDATE values both happen to land in the same ~20
million range, which is a coincidence, not a match). Verified empirically 2026-08-25
(`server/probe-today-orders.js`): it's **whole days since 1988-01-01, times 1440** (the "minutes
since 01.01.1988" convention, but always a multiple of 1440 — no time-of-day component). Filtering
with a literal `YYYYMMDD` number (e.g. `O.CURDATE >= 20260101`) silently returns wrong/empty
results — no error, just quietly incorrect data.

```js
// Convert an Israel-calendar-date to the CURDATE encoding:
const [y, m, d] = '2026-08-25'.split('-').map(Number);
const daysSince1988 = (Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000;
const curdate = daysSince1988 * 1440; // e.g. 20327040 for 2026-08-25
```

```sql
-- Filter to one exact date (pass curdate computed as above):
AND O.CURDATE = @curdate

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
- `ORDERSB.GPSX` = **longitude** (~34.x for Israel), `ORDERSB.GPSY` = **latitude** (~31–33.x) — same for `ADCCONTROLLERLOG.GPSX/GPSY`
- **`CUSTOMERS.GPSX/GPSY` is REVERSED**: `CUSTOMERS.GPSX` = **latitude** (~31–33.x), `CUSTOMERS.GPSY` = **longitude** (~34.x) — opposite axis order from ORDERSB/ADCCONTROLLERLOG. Verified 2026-08-18 against known-city customers (Ashdod, Afula). Swap before using if code elsewhere assumes the ORDERSB convention.
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
| CUST      | bigint  | **Internal auto-ID** (same as CUSTOMERS.CUST) — NOT the 7-digit business code |
| CURDATE   | bigint  | Date YYYYMMDD                |
| CLOSED    | nchar   | Never 'Y' — closed = deleted |
| ORDSTATUS | bigint  | Order status code            |

## CUSTOMERS Table — Two Different IDs (CRITICAL)

**CUSTOMERS.CUST** = internal auto-increment ID (e.g. 5230, 1876, 803)
**CUSTOMERS.CUSTNAME** = 7-digit business code visible to users (e.g. "1111040", "1130020")

`ORDERS.CUST` = **CUSTOMERS.CUST** (the internal ID) — **NOT** the 7-digit code!

To filter orders by 7-digit customer code:
```sql
-- WRONG: WHERE O.CUST = 1111040  (treats business code as internal ID — returns wrong data)

-- CORRECT: join to CUSTOMERS
SELECT C.CUSTNAME, C.CUSTDES, OB.GPSY, OB.GPSX
FROM ORDERS O
JOIN CUSTOMERS C ON C.CUST = O.CUST
JOIN ORDERSB OB ON OB.ORD = O.ORD
WHERE C.CUSTNAME = '1111040'
```

CUSTOMERS also has `CUSTDES` = Hebrew name of customer.

## EXTFILES — NOT GPS

`EXTFILES` stores email/document attachments (paths like `../../system/mail/Docs/...`).
Columns: EXTFILEDES, EXTFILENUM, EXTFILENAME, SUFFIX, CURDATE, LINE, TYPE, USER, SCAN_FILENAME

**Column FILENAME does NOT exist in EXTFILES** — it belongs to linked table FILENAMESTATUS.

## GPS Coverage (all-time, no year filter)

From session 2026-07-28:
| Company | Clients with GPS |
|---------|-----------------|
| FORM    | 3,295           |
| ICE     | 2,451           |
| INTER   | 3,079           |
| Total unique | 4,985     |

Cross-company match (±1000m): 498 clients 2/3, 4 clients 3/3 = high confidence GPS.
Output: `ATA GPS FROM ORDERS/gps-cross-company.xlsx` + `docs/priority-gps-cross.json`
Map page: `/priority-gps.html`

**Note:** Removing the year filter (`AND O.CURDATE >= 20260101`) nearly doubled client count (2,562 → 4,985) because open orders rotate in/out on a 24-hour cycle.

## Financial Statements / Chart of Accounts (P&L, Balance Sheet)

Explored 2026-09-02 while trying to build a full P&L from FNCTRANS. The structure is real and
documented below — but the naive query built from it produced **numbers that fail basic sanity
checks**, and that failure is the most important thing to carry forward, not the structure itself.

**The real classification tables:**

- `TRIALBAL` — master P&L/Balance-Sheet categories. Top-level single-digit codes: `1`=Assets,
  `2`=Liabilities & Equity, `3`=Equity Capital, `4`=Income (Revenue), `5`=Cost of Goods Sold,
  `6`=Expenses. Two-digit sub-codes refine these (seen: `60`=Operating Costs/Payroll,
  `61`=General & Administrative Expenses). `TRIALBALDES`/`ETRIALBALDES` give Hebrew/English labels.
- `SECTIONS` — finer-grained account grouping (`SECNAME`/`ESECNAME`), e.g. `-300`=Accounts
  Receivable, `-1`=Accounts Payable, `100`=Primary Cashier, `154`=Equipment. More granular than
  TRIALBAL, same idea.
- `ACCOUNTS.TRIALBAL` — **every account row carries its own TRIALBAL code**, so joining
  `FNCTRANS.ACCOUNT1`/`ACCOUNT2` → `ACCOUNTS.ACCOUNT` → `ACCOUNTS.TRIALBAL` looks like the
  obvious way to bucket every transaction into Revenue/COGS/Expenses.

**Why the obvious query is wrong — verified, unsolved:**

A query that classifies each `FNCTRANS` row by `LEFT(TRIALBAL,1)` on whichever leg
(`ACCOUNT1`/`ACCOUNT2`) matches `4`/`5`/`6`, summed by year, produces for every company:
- **COGS near-zero or literally absent** in most years (a food distributor's cost of goods should
  be one of the *largest* lines, not near-zero) — cost recognition for this business apparently
  does **not** flow through simple `TRIALBAL='5'` FNCTRANS postings the way the chart implies.
- **"Expenses" (TRIALBAL 6) exceeding Revenue (TRIALBAL 4) by 30–50%** most years — would mean the
  business is chronically deeply unprofitable at the operating line, which contradicts it being a
  live, growing business.

Do **not** trust or present a P&L/Revenue/COGS number built this way without first resolving why —
candidate causes, none yet confirmed: double-counting when both legs of a row happen to match
different P&L buckets; COGS being recognized via `INVOICEITEMS.IVCOST` at time of sale rather than
via a GL posting at all (this table has `IVCOST`/`PRICE`/`QPRICE`/`QUANT`/`VPRICE` — worth trying as
an independent Revenue/COGS source and cross-checking against the TRIALBAL-based number before
trusting either); a customization of this specific chart of accounts that doesn't follow the
standard `4=Income/5=COGS/6=Expenses` convention as cleanly as `TRIALBAL` suggests.

**Before ever presenting a full P&L externally:** get it validated against a controller/accountant
who knows this Priority instance's actual setup, or reconcile the computed Revenue number against
a number Priority's own standard reports would show for the same period — don't publish a
self-built P&L on SQL-inference alone the way the GPS/scale/vendor-cost numbers elsewhere in this
skill can be (those are lower-stakes and were cross-checked against real observed behavior).

What *is* safe and already validated (see COLUMBUS session 2026-09-02): categorizing a *narrow,
named* set of `ACCOUNTS` by keyword in `ACCDES` (e.g. "IT", "Rent") and summing `FNCTRANS.SUM1`
for just those specific accounts — filtering out `AR_FLAG='Y'` (customer sub-ledger accounts) is
essential, since dozens of real customers/suppliers have category-like words in their own trade
name (e.g. many Israeli food distributors literally have "שיווק"=marketing/distribution in their
company name — a naive keyword match without the AR_FLAG filter pulls in hundreds of unrelated
customer accounts). This narrow-category approach is reliable; the full-P&L rollup is not, yet.

**Revenue & COGS — a second, independent, VALIDATED path that actually works:**
`INVOICEITEMS.QPRICE` summed by year = sane Revenue; `INVOICEITEMS.IVCOST` summed by year (raw,
**do not** multiply by `QUANT` — both `QPRICE` and `IVCOST` are already extended/line-total values,
not per-unit — multiplying by `QUANT` again inflates them by orders of magnitude, easy to catch by
eyeballing a few sample rows first) = sane COGS. Cross-checked 2026-09-02 across all 4 companies,
3 years: gives a believable, positive, thin gross margin (1–10%, consistent with a low-margin food
distributor) every year in every company — unlike the TRIALBAL-based Revenue/COGS above, which
disagreed with this and with itself. **Use this INVOICEITEMS path for Revenue/COGS, not FNCTRANS.**

**Expenses (TRIALBAL=6) — ruled OUT one theory, root cause still unknown, don't reuse the ruled-out one:**
Tested the obvious theory that summing both legs of FNCTRANS double-counts each expense (one row
for the vendor invoice, `IVNUM LIKE 'GI%'`, one for its payment, `IVNUM LIKE 'BT%'`/`'CH%'` — this
pairing is real and confirmed elsewhere, see the Soft Solutions vendor-cost pattern below). Excluding
BT/CH legs from the TRIALBAL=6 sum barely moved the total (a few % at most, not the ~2x a real
duplicate-counting theory would predict) — **so that is NOT the explanation, don't retest it.**
The real picture: TRIALBAL=6 rows carry dozens of distinct `IVNUM` prefixes (`VI`, `99`, `GI`, and
~80 others, varying by company) — far more transaction types than plain vendor expense invoices,
likely including COGS-adjacent or inter-company postings that this specific chart-of-accounts
customization routes through "expense" rather than the "5" COGS bucket. Interpreting those prefixes
needs either Priority's own document-type reference or an accountant familiar with this instance —
not something to keep guessing at via SQL alone.

**Confirmed real pattern — invoice+payment as two linked FNCTRANS rows sharing one SUM1 amount:**
When tracing a single vendor's cost (Soft Solutions/Priority licensing, session 2026-09-02), every
real invoice event produced *two* `FNCTRANS` rows with the *same* `SUM1`: one `IVNUM LIKE 'GI%'`
(the invoice/recognition) and one `IVNUM LIKE 'BT%'` or `'CH%'` (bank transfer / check — the
payment settling it). **Filter to `IVNUM LIKE 'GI%'` only** when tallying what was actually billed
by one named supplier over time — summing all rows for that `SUP` without this filter double-counts.
This pattern is confirmed for vendor-level cost tracing; it is a distinct, narrower case from the
account-level TRIALBAL=6 rollup above, where excluding BT/CH did *not* fix the sanity-check failure.

## Common Gotchas

1. **USE db; WITH ...** fails — add semicolon: `USE diller;`
2. **GPS columns are nvarchar** — always `CAST(GPSX AS float)` before math
3. **Closed orders** have no CUST — only 57,745 open orders have GPS+CUST via JOIN
4. **ORDERSB has 187,526 GPS records** but only 57,745 match ORDERS (rest are closed/archived)
5. **CUSTOMERS.GPSX/GPSY axis order is reversed** vs ORDERSB/ADCCONTROLLERLOG — GPSX=lat, GPSY=lng here (see GPS section above)
7. **ADCCONTROLLERLOG spoofed GPS**: rows dated ~Oct 2023–Nov 2024 for northern-Israel customers may contain IDF defensive GPS-spoofing artifacts (fake coords near Beirut airport 33.82,35.49 or a second cluster ~31.72,35.999 shared identically across dozens of unrelated CUST). Detect via: exact-rounded coordinate shared by >3 distinct CUST = spoofing/junk signature, exclude before aggregating.
6. **INFORMATION_SCHEMA search** for GPS columns: search LAT/LONG/GPS/GEO/COORD/LOCAT
