// Check if there's an INVOICES table reflecting ACTUAL shipped/invoiced amounts
// for these same 16 orders today, which could differ from ORDERS.DISPRICE
// (ordered amount) if the warehouse short-shipped any line. Also check
// ORDERITEMS for a shipped-quantity column distinct from QUANT.
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
const ORD_IDS = ['121121','121145','121189','121137','121116','121133','121171','121184','121185','121176','121177','121188','121099','121069','121079','121153'];

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();

  // 1. ORDERITEMS columns for shipped/pick quantity fields
  const oiCols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ORDERITEMS'
    AND (COLUMN_NAME LIKE '%QUANT%' OR COLUMN_NAME LIKE '%SHIP%' OR COLUMN_NAME LIKE '%PICK%' OR COLUMN_NAME LIKE '%STATUS%')
  `);
  console.log('=== ORDERITEMS relevant columns ===');
  console.table(oiCols.recordset);

  // 2. Does INVOICES table exist? what columns?
  const invTables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%INVOICE%' OR TABLE_NAME LIKE 'IV%'
  `);
  console.log('\n=== Tables matching INVOICE/IV ===');
  console.table(invTables.recordset);

  // 3. Look for these specific ORDs in an invoices table if one exists commonly named INVOICES/DOCUMENTS
  try {
    const invCols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'INVOICES'
    `);
    console.log('\n=== INVOICES columns ===');
    console.table(invCols.recordset);
  } catch (e) { console.log('No INVOICES table or error:', e.message); }

  // 4. Full ORDERITEMS rows for these orders, to eyeball QUANT vs TQUANT
  const orIn = ORD_IDS.map((o, i) => { return `'${o}'`; }).join(',');
  const items = await pool.request().query(`
    SELECT OI.ORD, OI.PART, P.PARTDES, OI.QUANT, OI.TQUANT, OI.PRICE, OI.QPRICE
    FROM ORDERITEMS OI
    JOIN PART P ON P.PART = OI.PART
    WHERE OI.ORD IN (${orIn})
    ORDER BY OI.ORD
  `);
  console.log('\n=== ORDERITEMS detail (all lines, all 16 orders) ===');
  console.table(items.recordset);

  // 5. Have any of these orders already been invoiced? Compare INVOICES.DISPRICE/TOTPRICE to ORDERS.DISPRICE
  const invRows = await pool.request().query(`
    SELECT IV.ORD, IV.IVNUM, IV.CUST, IV.DISPRICE AS ivDisprice, IV.TOTPRICE, IV.VATPRICE, IV.NOVATPRICE, IV.STORNOFLAG, IV.IVDATE
    FROM INVOICES IV
    WHERE IV.ORD IN (${orIn})
  `);
  console.log('\n=== INVOICES rows matching these ORDs (if already invoiced) ===');
  console.table(invRows.recordset);

  // 6. Broader: ALL of today's INVOICES for AGENT=116, regardless of ORD match — maybe
  // some client's order isn't in ORDERS anymore (already closed/invoiced/deleted) and
  // the tablet total comes from INVOICES for today's IVDATE instead.
  const todayInv = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
    SELECT IV.ORD, IV.IVNUM, IV.CUST, IV.DISPRICE, IV.TOTPRICE, IV.STORNOFLAG, IV.IVDATE, IV.AGENT
    FROM INVOICES IV
    WHERE IV.IVDATE = @today AND IV.AGENT = @agent
  `);
  console.log('\n=== ALL INVOICES today for AGENT=116 (by IVDATE, regardless of ORD) ===');
  console.table(todayInv.recordset);
  const sumTodayInv = todayInv.recordset.reduce((s, r) => s + (Number(r.DISPRICE) || 0), 0);
  console.log('Sum of INVOICES.DISPRICE today for AGENT=116:', sumTodayInv);

  await pool.close();
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
