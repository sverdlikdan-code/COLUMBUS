require('dotenv').config({ path: '../.env' });
const sql = require('mssql');
const baseCfg = {
  server: process.env.DB_SERVER, port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }, connectTimeout: 10000, requestTimeout: 30000,
};
const ORD_IDS = ['121121','121145','121189','121137','121116','121133','121171','121184','121185','121176','121177','121188','121099','121069','121079','121153'];

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ORDERS'
    AND (COLUMN_NAME LIKE '%DATE%' OR COLUMN_NAME LIKE '%TIME%' OR COLUMN_NAME LIKE 'UDATE%' OR COLUMN_NAME LIKE '%STATUS%')
  `);
  console.log('=== ORDERS date/time/status columns ===');
  console.table(cols.recordset);

  const orIn = ORD_IDS.map(o => `'${o}'`).join(',');
  const cols2 = cols.recordset.map(r => r.COLUMN_NAME).filter(c => c !== 'CURDATE');
  if (cols2.length) {
    const sel = cols2.join(', ');
    const rows = await pool.request().query(`SELECT ORD, DISPRICE, ${sel} FROM ORDERS WHERE ORD IN (${orIn}) ORDER BY ORD`);
    console.log('\n=== Timestamps per order ===');
    console.table(rows.recordset);
  }
  await pool.close();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
