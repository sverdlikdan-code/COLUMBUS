// Diagnostic: ORD 121153 was reportedly deleted from the office side in Priority.
// Check: (1) does the ORDERS row still physically exist right now, (2) what do its
// status fields say, (3) is there an ORDSTATUS lookup/text table, (4) compare
// ORDSTATUS across ALL of Zoia's orders today to see if -6 is the outlier,
// (5) check ORDERITEMS for 121153 still present too.
require('dotenv').config({ path: '../.env' });
const sql = require('mssql');
const baseCfg = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }, connectTimeout: 10000, requestTimeout: 30000,
};
const CURDATE = 20335680;
const AGENT = 116;

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();

  // 1. Does ORD 121153 still exist in ORDERS right now?
  const ord = await pool.request().query(`
    SELECT ORD, CUST, CURDATE, UDATE, ORDSTATUS, DISPRICE, AGENT
    FROM ORDERS WHERE ORD = '121153'
  `);
  console.log('=== ORDERS row for ORD=121153 (right now) ===');
  console.table(ord.recordset);

  // 2. Full ORDERS column list to spot any other status-ish column we haven't checked
  const allCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ORDERS' ORDER BY ORDINAL_POSITION
  `);
  console.log('\n=== ALL ORDERS columns ===');
  console.table(allCols.recordset);

  // 3. Is there a status lookup/text table for ORDSTATUS?
  const statusTables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%ORDSTATUS%' OR TABLE_NAME LIKE '%STATUS%'
  `);
  console.log('\n=== Tables matching STATUS ===');
  console.table(statusTables.recordset);

  // 4. Distribution of ORDSTATUS across ALL her orders today + a broader recent sample
  const statusDist = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
    SELECT ORDSTATUS, COUNT(*) AS cnt, SUM(DISPRICE) AS sumDisprice
    FROM ORDERS WHERE CURDATE = @today AND AGENT = @agent
    GROUP BY ORDSTATUS
  `);
  console.log('\n=== ORDSTATUS distribution for her orders today ===');
  console.table(statusDist.recordset);

  // 5. Broader: ORDSTATUS distribution across ALL agents/orders recently (last 7 days) to learn what values exist and how common -6 is
  const broadDist = await pool.request().input('today', sql.BigInt, CURDATE).query(`
    SELECT ORDSTATUS, COUNT(*) AS cnt
    FROM ORDERS WHERE CURDATE >= @today - 7*1440
    GROUP BY ORDSTATUS
    ORDER BY cnt DESC
  `);
  console.log('\n=== ORDSTATUS distribution, all agents, last 7 days ===');
  console.table(broadDist.recordset);

  // 6. ORDERITEMS for 121153 still present?
  const items = await pool.request().query(`SELECT ORD, PART, QUANT, QPRICE FROM ORDERITEMS WHERE ORD = '121153'`);
  console.log('\n=== ORDERITEMS rows for ORD=121153 (right now) ===');
  console.table(items.recordset);

  await pool.close();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
