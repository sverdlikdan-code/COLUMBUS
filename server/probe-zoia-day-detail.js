// Drill into CURDATE=20335680 for Zoia Tsigankov (AGENT=116, AGENTCODE=257, icecrea)
// to find the duplicate customer / extra order, and reproduce dayClosingSummary's
// actual iceMishOnly formula line-by-line. Read-only diagnostic.
require('dotenv').config({ path: '../.env' });
const sql = require('mssql');

const baseCfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 30000,
};

const CURDATE = 20335680;
const AGENT = 116;

function dateFromCurdate(cd) {
  const days = cd / 1440;
  const d = new Date(Date.UTC(1988, 0, 1) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();
  console.log('Date for CURDATE', CURDATE, '=', dateFromCurdate(CURDATE));

  // 1. Order-level list: ORD, CUST, CUSTNAME, CUSTDES, DISPRICE, AGENT
  const orders = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
    SELECT O.ORD, O.CUST, C.CUSTNAME, C.CUSTDES, O.DISPRICE, O.AGENT, O.T$PERCENT
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    WHERE O.CURDATE = @today AND O.AGENT = @agent
    ORDER BY O.CUST, O.ORD
  `);
  console.log('\n=== Order-level rows (O.AGENT = 116) ===');
  console.table(orders.recordset);

  // 2. Duplicate CUST check
  const custCounts = {};
  orders.recordset.forEach(r => { custCounts[r.CUST] = (custCounts[r.CUST] || 0) + 1; });
  const dupes = Object.entries(custCounts).filter(([, c]) => c > 1);
  console.log('\n=== Customers with >1 order this day ===', dupes);

  // 4. Reproduce dayClosingSummary's ACTUAL iceMishOnly line-level formula, but scoped
  // by O.AGENT=116 directly (approximation of the real custIds/agentCode OR-clause,
  // since we don't have the live PBI roster cache here) to compare vs order-level DISPRICE.
  const lineLevel = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
    SELECT O.ORD, O.CUST, C.CUSTNAME, F.FAMILYDES, OI.PART, P.PARTDES, OI.QUANT, OI.QPRICE, O.T$PERCENT,
      OI.QPRICE * (1 - O.T$PERCENT/100.0) AS lineNet
    FROM ORDERS O
    JOIN CUSTOMERS C ON C.CUST = O.CUST
    JOIN ORDERITEMS OI ON OI.ORD = O.ORD
    JOIN PART P ON P.PART = OI.PART
    JOIN FAMILY F ON F.FAMILY = P.FAMILY
    WHERE O.CURDATE = @today AND O.AGENT = @agent AND F.FAMILYDES NOT LIKE N'%בודדים%'
    ORDER BY O.ORD
  `);
  const sumLineLevel = lineLevel.recordset.reduce((s, r) => s + (Number(r.lineNet) || 0), 0);
  console.log('\n=== iceMishOnly line-level sum (excl. בודדים family) ===', sumLineLevel);

  // 5. Same but WITHOUT the בודדים filter (all lines) to see full order total via line-sum
  const allLines = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
    SELECT O.ORD, SUM(OI.QPRICE * (1 - O.T$PERCENT/100.0)) AS orderLineNet, MAX(O.DISPRICE) AS orderDisprice
    FROM ORDERS O
    JOIN ORDERITEMS OI ON OI.ORD = O.ORD
    WHERE O.CURDATE = @today AND O.AGENT = @agent
    GROUP BY O.ORD
  `);
  console.log('\n=== Per-order: line-sum (all families) vs O.DISPRICE ===');
  console.table(allLines.recordset);

  // 6. Sum of DISPRICE excluding בודדים-only orders (orders that contain ANY non-בודדים line)
  const sumAllDisprice = orders.recordset.reduce((s, r) => s + (Number(r.DISPRICE) || 0), 0);
  console.log('\nSum ALL O.DISPRICE (order-level, 16 orders):', sumAllDisprice);

  await pool.close();
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
