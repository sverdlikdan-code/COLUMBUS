require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

// Try SQL Server directly for customer data
const sql = require('mssql');

const dbConfig = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }
};

(async () => {
  const pool = await sql.connect(dbConfig);
  // Find customer tables
  const res = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE='BASE TABLE'
    AND (TABLE_NAME LIKE '%lekoh%' OR TABLE_NAME LIKE '%cust%' OR TABLE_NAME LIKE '%client%'
      OR TABLE_NAME LIKE '%MASTER%' OR TABLE_NAME LIKE '%ADDRESS%' OR TABLE_NAME LIKE '%ADDR%'
      OR TABLE_NAME LIKE '%LCUST%' OR TABLE_NAME LIKE '%OCRD%')
    ORDER BY TABLE_NAME
  `);
  console.log('Matching tables:');
  res.recordset.forEach(r => console.log(' ', r.TABLE_NAME));
  await pool.close();
})().catch(console.error);
