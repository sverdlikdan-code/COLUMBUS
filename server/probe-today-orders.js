// Probe: validate direct-Priority "open order today" query before wiring into server/index.js.
// Checks both DBs (form=FORMULA, icecrea=ICE) with the same credentials, per priority-sql skill.
require('dotenv').config({ path: '../.env' });
const sql = require('mssql');

// CURDATE is NOT YYYYMMDD despite the priority-sql skill's claim — verified empirically
// (probe-today-orders-sanity.js): it's whole days since 1988-01-01 * 1440 (CLAUDE.md's
// "минуты с 01.01.1988" convention, no time-of-day component — always a multiple of 1440).
const todayILStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
const [y, m, d] = todayILStr.split('-').map(Number);
const daysSince1988 = (Date.UTC(y, m - 1, d) - Date.UTC(1988, 0, 1)) / 86400000;
const todayIL = daysSince1988 * 1440;

const baseCfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 15000,
};

const QUERY = `
  SELECT C.CUSTNAME, C.CUSTDES, O.ORD, O.CURDATE
  FROM ORDERS O
  JOIN CUSTOMERS C ON C.CUST = O.CUST
  WHERE O.CURDATE = @today
`;

async function probeDb(label, dbName) {
  console.log(`\n=== ${label} (db=${dbName}) — CURDATE=${todayIL} ===`);
  let pool;
  try {
    pool = await sql.connect({ ...baseCfg, database: dbName });
    const result = await pool.request().input('today', sql.BigInt, todayIL).query(QUERY);
    console.log(`Rows: ${result.recordset.length}`);
    for (const r of result.recordset.slice(0, 5)) {
      console.log(`  ORD=${r.ORD} CUSTNAME=${r.CUSTNAME} CUSTDES=${r.CUSTDES}`);
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  } finally {
    if (pool) await pool.close();
  }
}

(async () => {
  await probeDb('FORMULA', process.env.DB_NAME || 'form');
  await probeDb('ICE', process.env.DB_ICECREA || 'icecrea');
  process.exit(0);
})();
