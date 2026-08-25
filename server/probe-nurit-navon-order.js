require('dotenv').config({ path: '../.env' });
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

  const cust = await pool.request().query(`
    SELECT CUST, CUSTNAME, CUSTDES
    FROM CUSTOMERS
    WHERE CUSTDES LIKE N'%נורית נבון%'
  `);
  console.log('CUSTOMERS match:');
  console.table(cust.recordset);

  for (const row of cust.recordset) {
    const orders = await pool.request().query(`
      SELECT TOP 10 O.ORD, O.CURDATE, O.CLOSED, O.ORDSTATUS
      FROM ORDERS O
      WHERE O.CUST = ${row.CUST}
      ORDER BY O.CURDATE DESC
    `);
    console.log(`\nOpen ORDERS for CUST=${row.CUST} (${row.CUSTNAME}):`);
    console.table(orders.recordset);

    const inv = await pool.request().query(`
      SELECT TOP 10 IVNUM, IVDATE, CURDATE, ASHMADOT, FINAL, OTYPE
      FROM INVOICES
      WHERE CUST = ${row.CUST}
      ORDER BY IVDATE DESC
    `);
    console.log(`\nLast INVOICES for CUST=${row.CUST}:`);
    console.table(inv.recordset);
  }

  await pool.close();
})().catch(e => { console.error(e); process.exit(1); });
