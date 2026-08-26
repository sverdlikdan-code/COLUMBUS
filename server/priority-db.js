// Direct-to-Priority read-only pools (form=FORMULA, icecrea=ICE) — used only by
// GET /api/today-orders. Lazy connect (mirrors server/db.js) so a Priority outage
// at process boot never blocks server startup or crashes pm2.
const sql = require('mssql');

// CURDATE is whole days since 1988-01-01 * 1440 — see .claude/SKILLS/priority-sql/SKILL.md
// (Date Format section) for why this isn't YYYYMMDD despite looking like it.
function curdateFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const daysSince1988 = (Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000;
  return daysSince1988 * 1440;
}

const baseCfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 15000,
  pool: { min: 0, max: 2 },
};

const pools = {}; // dbName -> ConnectionPool

async function getPool(dbName) {
  if (pools[dbName]?.connected) return pools[dbName];
  if (!pools[dbName]) pools[dbName] = new sql.ConnectionPool({ ...baseCfg, database: dbName });
  if (!pools[dbName].connected && !pools[dbName].connecting) await pools[dbName].connect();
  return pools[dbName];
}

const OPEN_ORDERS_QUERY = `
  SELECT DISTINCT C.CUSTNAME
  FROM ORDERS O
  JOIN CUSTOMERS C ON C.CUST = O.CUST
  WHERE O.CURDATE = @today
`;

// ICE only: בודדים (singles) sell van-sale — invoiced directly off the truck, never
// passes through ORDERS as a pending/open order — so any בודדים row that DOES show up
// in ORDERS isn't the "client placed an order, awaiting fulfillment" signal this badge
// means. Verified empirically 2026-08-25 (server/probe-ice-family-filter*.js): 161
// unfiltered -> 151 after excluding בודדים-family lines, zero overlap. מארזים/מאגדת
// (multipack/case families) count as mishpachti-equivalent per user confirmation, so
// this excludes ONLY בודדים rather than maintaining a growing include-list.
const OPEN_ICE_MISH_ORDERS_QUERY = `
  SELECT DISTINCT C.CUSTNAME
  FROM ORDERS O
  JOIN CUSTOMERS C ON C.CUST = O.CUST
  JOIN ORDERITEMS OI ON OI.ORD = O.ORD
  JOIN PART P ON P.PART = OI.PART
  JOIN FAMILY F ON F.FAMILY = P.FAMILY
  WHERE O.CURDATE = @today AND F.FAMILYDES NOT LIKE N'%בודדים%'
`;

// Returns Set<CUSTNAME string> or null on any failure — caller decides what "no data" means.
// Never throws: a Priority outage must degrade the ✔️ feature, not the caller's response.
async function custIdsWithOpenOrderToday(dbName, dateStr) {
  try {
    const pool = await getPool(dbName);
    const result = await pool.request().input('today', sql.BigInt, curdateFor(dateStr)).query(OPEN_ORDERS_QUERY);
    return new Set(result.recordset.map(r => String(r.CUSTNAME)));
  } catch (e) {
    console.error(`[priority-db] ${dbName} query failed: ${e.message}`);
    return null;
  }
}

async function iceMishCustIdsWithOpenOrderToday(dbName, dateStr) {
  try {
    const pool = await getPool(dbName);
    const result = await pool.request().input('today', sql.BigInt, curdateFor(dateStr)).query(OPEN_ICE_MISH_ORDERS_QUERY);
    return new Set(result.recordset.map(r => String(r.CUSTNAME)));
  } catch (e) {
    console.error(`[priority-db] ${dbName} (ice mish) query failed: ${e.message}`);
    return null;
  }
}

// "סגירת יום" (day close) button — today's orders for the clients on THIS route,
// not "whatever Priority's ORDERS.AGENT field says". Filtering by AGENT broke for
// a real substitution case (2026-08-26): an agent covering a colleague's route
// while she's on vacation places the orders under their OWN Priority agent code,
// not hers — so filtering by the covered agent's code found zero orders even
// though her clients genuinely ordered today. The route's client list is the one
// thing that's actually true regardless of who's driving it.
// EXISTS instead of a JOIN to FAMILY/ORDERITEMS: a plain JOIN fans an order out to
// one row per matching line item, which would multiply-count TOTPRICE (order-level,
// not line-level) for any order with more than one מארז-family line today.
// Scoped by the currently-viewed agent's full client roster (custIds — every
// client across all their route days, not just today's), never by
// ORDERS.AGENT. Live clarification 2026-08-26: whoever is physically logged
// in doesn't matter — "sitting in Galina" and pressing סגירת יום means every
// open order today from one of GALINA's clients counts, regardless of which
// real Priority agent code ended up on that order. An earlier version of this
// tried to also OR in the viewer's own agent code for off-roster orders — that
// was solving a problem the user didn't actually have; dropped.
async function dayClosingSummary(dbName, dateStr, custIds, { iceMishOnly } = {}) {
  if (!custIds.length) return { custCount: 0, sum: 0 };
  const famClause = iceMishOnly ? `AND EXISTS (
    SELECT 1 FROM ORDERITEMS OI JOIN PART P ON P.PART = OI.PART JOIN FAMILY F ON F.FAMILY = P.FAMILY
    WHERE OI.ORD = O.ORD AND F.FAMILYDES NOT LIKE N'%בודדים%'
  )` : '';
  const pool = await getPool(dbName);
  const req = pool.request().input('today', sql.BigInt, curdateFor(dateStr));
  const custInList = custIds.map((c, i) => { req.input(`cust${i}`, sql.NVarChar, String(c)); return `@cust${i}`; }).join(',');
  const result = await req.query(`
    SELECT COUNT(DISTINCT O.CUST) AS custCount, SUM(O.TOTPRICE) AS sumPrice
    FROM ORDERS O
    WHERE O.CURDATE = @today AND O.CUST IN (${custInList}) ${famClause}
  `);
  const row = result.recordset[0] || {};
  return { custCount: Number(row.custCount) || 0, sum: Math.round((Number(row.sumPrice) || 0) * 100) / 100 };
}

// Sellout table for "סגירת יום פורמולה" — fixed makat list (given by the user, not
// agent-selected), quantity summed from today's ORDERITEMS for the viewed
// agent's full client roster (same custIds scoping as dayClosingSummary).
// QUANT/1000 per the project's Priority-SQL convention (CLAUDE.md).
async function dayClosingSellout(dbName, dateStr, custIds, skuList) {
  if (!skuList.length || !custIds.length) return [];
  const pool = await getPool(dbName);
  const req = pool.request().input('today', sql.BigInt, curdateFor(dateStr));
  const custInList = custIds.map((c, i) => { req.input(`cust${i}`, sql.NVarChar, String(c)); return `@cust${i}`; }).join(',');
  const skuInList = skuList.map((s, i) => { req.input(`sku${i}`, sql.NVarChar, String(s)); return `@sku${i}`; }).join(',');
  const result = await req.query(`
    SELECT P.PARTNAME AS sku, P.PARTDES AS name, SUM(OI.QUANT) AS sumQuant
    FROM ORDERS O
    JOIN ORDERITEMS OI ON OI.ORD = O.ORD
    JOIN PART P ON P.PART = OI.PART
    WHERE O.CURDATE = @today AND O.CUST IN (${custInList}) AND P.PARTNAME IN (${skuInList})
    GROUP BY P.PARTNAME, P.PARTDES
  `);
  const bySku = new Map(result.recordset.map(r => [String(r.sku), { name: String(r.name || ''), qty: Number(r.sumQuant) / 1000 }]));
  // Every requested SKU appears in the report even with 0 sold today — an agent
  // needs to see "0" as much as a number, not have the row silently vanish.
  return skuList.map(sku => ({ sku, name: bySku.get(sku)?.name || '', qty: bySku.get(sku)?.qty || 0 }));
}

module.exports = { custIdsWithOpenOrderToday, iceMishCustIdsWithOpenOrderToday, dayClosingSummary, dayClosingSellout, curdateFor };
