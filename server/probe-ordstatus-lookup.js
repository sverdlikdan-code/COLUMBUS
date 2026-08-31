require('dotenv').config({ path: '../.env' });
const sql = require('mssql');
const baseCfg = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }, connectTimeout: 10000, requestTimeout: 30000,
};

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();

  // 1. ORDSTATUS lookup table columns + full contents (small table presumably)
  try {
    const cols = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ORDSTATUS'`);
    console.log('=== ORDSTATUS lookup table columns ===');
    console.table(cols.recordset);
    const colNames = cols.recordset.map(r => r.COLUMN_NAME).join(', ');
    const rows = await pool.request().query(`SELECT ${colNames} FROM ORDSTATUS`);
    console.log('\n=== ORDSTATUS lookup table full contents ===');
    console.table(rows.recordset);
  } catch (e) { console.log('ORDSTATUS lookup query failed:', e.message); }

  // 2. ORDSTATUSLOG history for ORD=121153
  try {
    const logCols = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ORDSTATUSLOG'`);
    console.log('\n=== ORDSTATUSLOG columns ===');
    console.table(logCols.recordset);
    const logRows = await pool.request().query(`SELECT * FROM ORDSTATUSLOG WHERE ORD = '121153'`);
    console.log('\n=== ORDSTATUSLOG rows for ORD=121153 ===');
    console.table(logRows.recordset);
  } catch (e) { console.log('ORDSTATUSLOG query failed:', e.message); }

  await pool.close();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
