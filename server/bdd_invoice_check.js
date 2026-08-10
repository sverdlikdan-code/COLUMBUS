require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const sql = require('mssql');

const baseCfg = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 3, min: 0, idleTimeoutMillis: 10000 }
};

async function queryDB(db, q) {
  const pool = await new sql.ConnectionPool({...baseCfg, database: db}).connect();
  try { return (await pool.request().query(q)).recordset; }
  finally { await pool.close(); }
}

async function main() {
  // 1. Does INVOICESB have GPS columns?
  const invsbCols = await queryDB('icecrea', `
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'INVOICESB'
      AND (COLUMN_NAME LIKE '%GPS%' OR COLUMN_NAME LIKE '%LAT%' OR COLUMN_NAME LIKE '%LON%'
           OR COLUMN_NAME LIKE '%GEO%' OR COLUMN_NAME LIKE '%COORD%')
    ORDER BY COLUMN_NAME
  `);
  console.log('[icecrea] INVOICESB GPS-like columns:', invsbCols.length ? invsbCols.map(r=>r.COLUMN_NAME).join(', ') : 'NONE');

  // 2. Check ALL INVOICESB columns
  const allInvsbCols = await queryDB('icecrea', `
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'INVOICESB' ORDER BY ORDINAL_POSITION
  `);
  console.log('All INVOICESB cols:', allInvsbCols.map(r=>r.COLUMN_NAME).join(', '));

  // 3. Does INVOICES table itself have GPS?
  const invCols = await queryDB('icecrea', `
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'INVOICES'
      AND (COLUMN_NAME LIKE '%GPS%' OR COLUMN_NAME LIKE '%LAT%' OR COLUMN_NAME LIKE '%LON%'
           OR COLUMN_NAME LIKE '%GEO%' OR COLUMN_NAME LIKE '%COORD%' OR COLUMN_NAME LIKE '%ORD%')
    ORDER BY COLUMN_NAME
  `);
  console.log('\n[icecrea] INVOICES GPS/ORD columns:', invCols.map(r=>`${r.COLUMN_NAME}(${r.DATA_TYPE})`).join(', '));

  // 4. BDD via INVOICEITEMS — how many invoices? Do they have ORD link?
  const bddInvStats = await queryDB('icecrea', `
    WITH bdd_inv AS (
      SELECT II.IV, COUNT(DISTINCT II.KLINE) AS bdd_lines
      FROM INVOICEITEMS II
      WHERE II.PART IN (
        SELECT PART FROM PART WHERE FAMILY IN (4,15,27,97)
      )
      GROUP BY II.IV
      HAVING COUNT(DISTINCT II.KLINE) >= 4
    )
    SELECT
      COUNT(*) AS total_invoices,
      SUM(CASE WHEN I.ORD IS NOT NULL AND I.ORD > 0 THEN 1 ELSE 0 END) AS with_ord_link,
      SUM(CASE WHEN I.ORD IS NULL OR I.ORD = 0 THEN 1 ELSE 0 END) AS no_ord_link
    FROM bdd_inv BI
    JOIN INVOICES I ON I.IV = BI.IV
  `);
  console.log('\nBDD invoices (4+ lines):', JSON.stringify(bddInvStats[0]));

  // 5. GPS via INVOICES.ORD → ORDERSB
  const bddGpsSample = await queryDB('icecrea', `
    WITH bdd_inv AS (
      SELECT II.IV, COUNT(DISTINCT II.KLINE) AS bdd_lines
      FROM INVOICEITEMS II
      WHERE II.PART IN (
        SELECT PART FROM PART WHERE FAMILY IN (4,15,27,97)
      )
      GROUP BY II.IV
      HAVING COUNT(DISTINCT II.KLINE) >= 4
    )
    SELECT TOP 10 I.CUST, I.ORD, OB.GPSX, OB.GPSY
    FROM bdd_inv BI
    JOIN INVOICES I ON I.IV = BI.IV
    LEFT JOIN ORDERSB OB ON OB.ORD = I.ORD
    WHERE OB.GPSX IS NOT NULL AND OB.GPSX NOT IN ('','0')
    ORDER BY I.CUST
  `);
  console.log('\nBDD GPS via INVOICES.ORD → ORDERSB (sample):');
  bddGpsSample.forEach(r => console.log(`  CUST=${r.CUST} ORD=${r.ORD} lat=${r.GPSY} lng=${r.GPSX}`));

  // 6. Count total clients reachable via INVOICES.ORD → ORDERSB
  const bddGpsCount = await queryDB('icecrea', `
    WITH bdd_inv AS (
      SELECT II.IV, COUNT(DISTINCT II.KLINE) AS bdd_lines
      FROM INVOICEITEMS II
      WHERE II.PART IN (
        SELECT PART FROM PART WHERE FAMILY IN (4,15,27,97)
      )
      GROUP BY II.IV
      HAVING COUNT(DISTINCT II.KLINE) >= 4
    ),
    gps_raw AS (
      SELECT I.CUST, OB.GPSX, OB.GPSY
      FROM bdd_inv BI
      JOIN INVOICES I ON I.IV = BI.IV
      JOIN ORDERSB OB ON OB.ORD = I.ORD
      WHERE OB.GPSX IS NOT NULL AND OB.GPSX NOT IN ('','0')
        AND OB.GPSY IS NOT NULL AND OB.GPSY NOT IN ('','0')
        AND TRY_CAST(OB.GPSY AS float) BETWEEN 29.5 AND 33.5
        AND TRY_CAST(OB.GPSX AS float) BETWEEN 34.0 AND 36.2
    )
    SELECT COUNT(DISTINCT CUST) AS unique_clients, COUNT(*) AS total_gps_rows
    FROM gps_raw
  `);
  console.log('\nBDD GPS via INVOICES (Israel only):', JSON.stringify(bddGpsCount[0]));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
