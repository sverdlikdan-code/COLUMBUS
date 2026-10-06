// server/bdd-priority.js
// ICE BDD Priority queries. Separate module + separate pool on purpose (isolation
// rule): FORMULA's ICE MISH V badge polls icecrea through priority-db.js's pool
// (max 2 connections); a slow BDD query must never hold one of those.
const sql = require('mssql');

// ponytail: config duplicated from priority-db.js (8 lines) instead of exporting it,
// so priority-db.js stays untouched; merge if the DB connection settings ever change.
const cfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 15000,
  pool: { min: 0, max: 2 },
};
// Caches the connect() promise (resolves to the pool), so concurrent first callers share
// one connect instead of racing; a failed connect is dropped so the next call retries.
const pools = {};
function getBddPool(dbName) {
  if (!pools[dbName]) {
    const pool = new sql.ConnectionPool({ ...cfg, database: dbName });
    // A pool 'error' event with no listener would throw and take the whole process
    // (FORMULA included) down — log it; the pool replaces broken connections itself.
    pool.on('error', e => console.error(`[bdd-priority] pool error (${dbName}): ${e.message}`));
    pools[dbName] = pool.connect().catch(e => { delete pools[dbName]; throw e; });
  }
  return pools[dbName];
}

// Priority dates: int minutes since 1988-01-01.
function curdateFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000 * 1440;
}

// Van-sale documents for one day — V badge, סגירת יום and line coverage all read this
// one result (bdd.js summarizeBddDocs). Two branches, same as ALL_PARTS' ICE part:
// INV = final customer invoices (DEBIT='C' → negative = זיכוי), DOCS = delivery notes (D)
// and returns (N, negative) not yet invoiced (TRANSORDER.IV=0, so nothing counts twice).
// Agent = executing agent on the line.
// ponytail: ILS only (CURRENCY=-1) — BDD invoices are shekel; non-ILS lines come back with
// NULL amount and are logged; upgrade to the M code's FNCTRANS/CURREGITEMS rate chain if that log ever fires.
async function bddDocLinesToday(dbName, dateStr) {
  const pool = await getBddPool(dbName);
  const today = curdateFor(dateStr);
  const inv = await pool.request().input('today', sql.BigInt, today).query(`
    SELECT N'INV' AS src, I.IVNUM AS docNo,
      COALESCE(NULLIF(CD.CUSTNAME, ''), C.CUSTNAME) AS custId,
      A.AGENTCODE AS agentCode, A.AGENTNAME AS agentName, F.FAMILYDES AS familyDes,
      SUM(IIT.IVCOST * CASE WHEN I.DEBIT = N'C' THEN -1 ELSE 1 END
                     * CASE WHEN IIT.CREDITFLAG = N'Y' THEN 0 ELSE 1 END
                     * CASE WHEN I.CURRENCY = -1 THEN 1 ELSE NULL END) AS amount
    FROM INVOICES I
    JOIN INVOICEITEMS IIT ON IIT.IV = I.IV
    JOIN ORDERITEMS OI ON OI.ORDI = IIT.ORDI
    JOIN IVTYPES T ON T.TYPE = I.TYPE AND T.DEBIT = I.DEBIT
    JOIN CUSTOMERS C ON C.CUST = I.CUST
    JOIN TRANSORDER TR ON TR.TRANS = IIT.TRANS
    JOIN PART P ON P.PART = IIT.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    JOIN AGENTS A ON A.AGENT = IIT.AGENT
    LEFT JOIN DOCUMENTS D2 ON D2.DOC = TR.DOC
    LEFT JOIN CUSTOMERS CD ON CD.CUST = D2.CUST
    WHERE I.FINAL = N'Y' AND I.TYPE <> N'R' AND T.OTYPE = N'C'
      AND COALESCE(NULLIF(D2.CURDATE, 0), I.IVDATE) = @today
      -- Prefilter: an invoice is never dated before its delivery note, so IVDATE >= the
      -- business day; 30 days (43200 Priority minutes) of slack keeps it safe while letting
      -- SQL Server seek on IVDATE instead of scanning every invoice line (COALESCE isn't sargable).
      AND I.IVDATE >= @today - 43200
    GROUP BY I.IVNUM, COALESCE(NULLIF(CD.CUSTNAME, ''), C.CUSTNAME), A.AGENTCODE, A.AGENTNAME, F.FAMILYDES
  `);
  const docs = await pool.request().input('today', sql.BigInt, today).query(`
    SELECT TR.TYPE AS src, D.DOCNO AS docNo, C.CUSTNAME AS custId,
      A.AGENTCODE AS agentCode, A.AGENTNAME AS agentName, F.FAMILYDES AS familyDes,
      SUM(TR.PRICE * TR.TQUANT / 1000.0 * (100 - TR.T$PERCENT) / 100.0
          * (100 - CASE WHEN F.RECYCLINGFLAG = N'Y' THEN 0 ELSE D.T$PERCENT END) / 100.0
          * TR.IEXCHANGE * CASE WHEN TR.TYPE = N'N' THEN -1 ELSE 1 END) AS amount
    FROM TRANSORDER TR
    JOIN DOCUMENTS D ON D.DOC = TR.DOC
    JOIN CUSTOMERS C ON C.CUST = D.CUST
    JOIN ORDERITEMS OI ON OI.ORDI = TR.ORDI
    JOIN ORDERS O ON O.ORD = OI.ORD
    JOIN PART P ON P.PART = TR.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    JOIN AGENTS A ON A.AGENT = CASE WHEN O.AGENT <> 0 THEN O.AGENT ELSE D.AGENT END
    WHERE TR.TYPE IN (N'D', N'N') AND TR.IV = 0 AND TR.FLAG = N'Y'
      AND D.FINAL = N'Y' AND D.FLAG = N'Y' AND TR.CURDATE = @today
    GROUP BY TR.TYPE, D.DOCNO, C.CUSTNAME, A.AGENTCODE, A.AGENTNAME, F.FAMILYDES
  `);
  const rows = [...inv.recordset, ...docs.recordset].map(r => ({
    src: String(r.src).trim(), docNo: String(r.docNo || '').trim(), custId: String(r.custId),
    agentCode: String(r.agentCode || '').trim(), agentName: String(r.agentName || '').trim(),
    familyDes: String(r.familyDes || '').trim(), amount: r.amount === null ? null : Number(r.amount),
  }));
  const nonIls = rows.filter(r => r.amount === null).length;
  if (nonIls) console.warn(`[bdd-priority] ${nonIls} non-ILS line(s) skipped — see ponytail note`);
  return rows.filter(r => r.amount !== null);
}

const PROMO_WINDOW = `
  YEAR(CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date)) = YEAR(GETDATE())
  AND ((CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) <= CAST(GETDATE() AS date)
        AND CAST(DATEADD(MINUTE, SP.TODATE, '19880101') AS date) >= CAST(GETDATE() AS date))
    OR (CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) > CAST(GETDATE() AS date)
        AND CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) <= DATEADD(DAY, 18, CAST(GETDATE() AS date))))`;

async function bddClientPromos(dbName, custId) {
  try {
    const pool = await getBddPool(dbName);
    const result = await pool.request().input('custId', sql.NVarChar, String(custId)).query(`
      SELECT P.PARTNAME AS sku, P.PARTDES AS name, SP.PRICEREC AS price, SP.QUANTPRICE / 1000.0 AS qty,
        CAST(DATEADD(MINUTE, SP.FROMDATE, '19880101') AS date) AS fromDate,
        CAST(DATEADD(MINUTE, SP.TODATE,   '19880101') AS date) AS toDate,
        PD.PRICEDESCDESC AS promoType, F.FAMILYDES AS familyDes
      FROM SOF_PRICEREC SP
      JOIN PART P ON P.PART = SP.PART
      JOIN FAMILY F ON F.FAMILY = P.FAMILY
      LEFT JOIN SOF_PRICEDESC PD ON PD.PRICEDESID = SP.PRICEDESID
      WHERE SP.CUST IN (
          SELECT CUST FROM CUSTOMERS WHERE CUSTNAME = @custId
          UNION
          SELECT MCUST FROM CUSTOMERS WHERE CUSTNAME = @custId AND MCUST IS NOT NULL AND MCUST <> 0)
        AND ${PROMO_WINDOW}
      ORDER BY P.PARTDES
    `);
    return result.recordset.map(r => ({
      company: 'ICE_BDD', sku: String(r.sku), name: String(r.name || ''),
      price: Number(r.price) || 0, qty: Number(r.qty) || 0,
      fromDate: r.fromDate ? new Date(r.fromDate).toISOString().slice(0, 10) : '',
      toDate: r.toDate ? new Date(r.toDate).toISOString().slice(0, 10) : '',
      promoType: String(r.promoType || ''), familyDes: String(r.familyDes || '').trim(),
    }));
  } catch (e) {
    console.error(`[bdd-priority] promo lookup failed (cust=${custId}): ${e.message}`);
    return [];
  }
}

// Clients with an active promo, with the family, so the route keeps BDD families only.
async function bddCustFamiliesWithActivePromo(dbName) {
  try {
    const pool = await getBddPool(dbName);
    const result = await pool.request().query(`
      WITH ACTIVE AS (
        SELECT SP.CUST, F.FAMILYDES FROM SOF_PRICEREC SP
        JOIN PART P ON P.PART = SP.PART JOIN FAMILY F ON F.FAMILY = P.FAMILY
        WHERE ${PROMO_WINDOW}
      )
      SELECT DISTINCT C.CUSTNAME, A.FAMILYDES FROM CUSTOMERS C
      JOIN ACTIVE A ON A.CUST = C.CUST OR (C.MCUST <> 0 AND A.CUST = C.MCUST)
    `);
    return result.recordset.map(r => ({ custId: String(r.CUSTNAME), familyDes: String(r.FAMILYDES || '').trim() }));
  } catch (e) {
    console.error(`[bdd-priority] promo list failed: ${e.message}`);
    return null;
  }
}

// Visit order per client-day — same table/field FORMULA's PBI "סדר ביקור" uses
// (form.CUSTCALLFREQUENCY.TOPP_NUM1); the ICE dataset's משטח_ICE is this query without it.
// Filled unevenly per agent (checked 2026-09-29: 243/43/17 ~all, 21/41/85/98 ~none) — 0 = no order.
async function bddVisitOrder(dbName) {
  const pool = await getBddPool(dbName);
  const r = await pool.request().query(`
    SELECT C.CUSTNAME AS custId, CCF.DAYNUM AS dayNum, CCF.TOPP_NUM1 AS visitOrder
    FROM CUSTCALLFREQUENCY CCF JOIN CUSTOMERS C ON C.CUST = CCF.CUST
    WHERE CCF.TOPP_NUM1 > 0
  `);
  return r.recordset.map(x => ({ custId: String(x.custId), dayNum: Number(x.dayNum), visitOrder: Number(x.visitOrder) }));
}

// Hebrew text straight from Priority SQL: letters already in logical order, but digit
// runs come reversed and parentheses mirrored (checked 2026-10-06 against the PBI name:
// "-סניף-16" vs "-סניף-61", ")א.א.ל(" vs "(א.א.ל)"). Hebrew-free strings left as is.
function fixSqlHeb(v) {
  const s = String(v || '').trim();
  if (!/[א-ת]/.test(s)) return s;
  return s.replace(/\d+/g, m => [...m].reverse().join('')).replace(/[()]/g, c => c === '(' ? ')' : '(');
}

// Name + main agent (CUSTOMERS.AGENT, not AGENT2) for clients a BDD agent sold to that
// aren't on the ICE BDD roster — the roster is the only other name source. Dan 2026-10-06.
async function bddCustMainAgents(dbName, custIds) {
  if (!custIds.length) return new Map();
  const pool = await getBddPool(dbName);
  const req = pool.request();
  custIds.forEach((id, i) => req.input(`c${i}`, sql.NVarChar, String(id)));
  const r = await req.query(`
    SELECT C.CUSTNAME AS custId, C.CUSTDES AS custName, A.AGENTCODE AS agentCode, A.AGENTNAME AS agentName
    FROM CUSTOMERS C LEFT JOIN AGENTS A ON A.AGENT = C.AGENT
    WHERE C.CUSTNAME IN (${custIds.map((_, i) => `@c${i}`).join(',')})
  `);
  return new Map(r.recordset.map(x => [String(x.custId), {
    custName: fixSqlHeb(x.custName), agentCode: String(x.agentCode || '').trim(), agentName: fixSqlHeb(x.agentName) }]));
}

module.exports = { getBddPool, bddDocLinesToday, bddClientPromos, bddCustFamiliesWithActivePromo, bddVisitOrder, bddCustMainAgents };
