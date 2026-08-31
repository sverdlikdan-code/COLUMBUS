// Check CUSTOMERS table columns for an assigned-agent field (distinct from
// ORDERS.AGENT = entering agent), and see if any of her roster clients had
// TODAY's order entered by a DIFFERENT agent (which dayClosingSummary's
// custIds-roster OR-clause would still count, but a plain O.AGENT filter would miss).
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
const AGENT = 116; // Zoia's internal AGENT id
const AGENTCODE = '257';

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();

  const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'CUSTOMERS' AND COLUMN_NAME LIKE '%AGENT%'
  `);
  console.log('=== CUSTOMERS columns with AGENT in name ===');
  console.table(cols.recordset);

  // Any of her assigned-roster clients (if CUSTOMERS.AGENT exists) with an order TODAY
  // entered by someone else?
  const hasAgentCol = cols.recordset.some(r => r.COLUMN_NAME === 'AGENT');
  if (hasAgentCol) {
    const rosterOthers = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
      SELECT O.ORD, O.CUST, C.CUSTNAME, C.CUSTDES, O.DISPRICE, O.AGENT AS enteringAgent, C.AGENT AS rosterAgent
      FROM ORDERS O
      JOIN CUSTOMERS C ON C.CUST = O.CUST
      WHERE O.CURDATE = @today AND C.AGENT = @agent AND O.AGENT != @agent
    `);
    console.log('\n=== Roster clients (CUSTOMERS.AGENT=116) with order TODAY entered by a DIFFERENT agent ===');
    console.table(rosterOthers.recordset);

    // Full roster-scoped total exactly like dayClosingSummary would compute if custIds
    // were her full CUSTOMERS.AGENT roster (approximation of PBI roster)
    const rosterTotal = await pool.request().input('today', sql.BigInt, CURDATE).input('agent', sql.BigInt, AGENT).query(`
      SELECT COUNT(DISTINCT O.CUST) AS custCount, SUM(O.DISPRICE) AS sumPrice, COUNT(DISTINCT O.ORD) as ordCount
      FROM ORDERS O
      JOIN CUSTOMERS C ON C.CUST = O.CUST
      WHERE O.CURDATE = @today AND (C.AGENT = @agent OR O.AGENT = @agent)
    `);
    console.log('\n=== Roster-OR-entering-agent total (approximates dayClosingSummary OR-clause) ===');
    console.table(rosterTotal.recordset);
  } else {
    console.log('No CUSTOMERS.AGENT column — roster comes purely from PBI cache, not derivable from raw Priority tables directly.');
  }

  await pool.close();
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
