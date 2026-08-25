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

module.exports = { custIdsWithOpenOrderToday, iceMishCustIdsWithOpenOrderToday, curdateFor };
