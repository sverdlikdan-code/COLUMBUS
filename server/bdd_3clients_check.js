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

const CUSTS = [1140021, 1130020, 1111040];

async function main() {
  // 1. BDD invoices for 3 clients (any size, no 4-line filter)
  const invCount = await queryDB('icecrea', `
    SELECT I.CUST,
           COUNT(DISTINCT I.IV) AS bdd_invoices,
           SUM(CASE WHEN I.ORD > 0 THEN 1 ELSE 0 END) AS with_ord,
           SUM(CASE WHEN I.ORD = 0 OR I.ORD IS NULL THEN 1 ELSE 0 END) AS no_ord
    FROM INVOICES I
    WHERE I.CUST IN (${CUSTS.join(',')})
      AND EXISTS (
        SELECT 1 FROM INVOICEITEMS II
        WHERE II.IV = I.IV
          AND II.PART IN (SELECT PART FROM PART WHERE FAMILY IN (4,15,27,97))
      )
    GROUP BY I.CUST
  `);
  console.log('BDD invoices per client:');
  if (!invCount.length) console.log('  NONE found for any of the 3 clients');
  invCount.forEach(r => console.log(`  CUST=${r.CUST}: ${r.bdd_invoices} invoices, with_ord=${r.with_ord}, no_ord=${r.no_ord}`));

  // 2. GPS via ORD link (if any)
  const gpsViaOrd = await queryDB('icecrea', `
    SELECT I.CUST, I.ORD, OB.GPSX, OB.GPSY
    FROM INVOICES I
    JOIN ORDERSB OB ON OB.ORD = I.ORD
    WHERE I.CUST IN (${CUSTS.join(',')})
      AND I.ORD > 0
      AND OB.GPSX IS NOT NULL AND OB.GPSX NOT IN ('','0')
      AND TRY_CAST(OB.GPSY AS float) BETWEEN 29.5 AND 33.5
      AND TRY_CAST(OB.GPSX AS float) BETWEEN 34.0 AND 36.2
  `);
  console.log('\nGPS via INVOICES.ORD -> ORDERSB (Israel only):');
  if (!gpsViaOrd.length) console.log('  NONE');
  gpsViaOrd.forEach(r => console.log(`  CUST=${r.CUST} ORD=${r.ORD} lat=${r.GPSY} lng=${r.GPSX}`));

  // 3. Regular ORDERSB GPS for 3 clients (for comparison)
  const ordGps = await queryDB('icecrea', `
    WITH gps_counts AS (
      SELECT O.CUST, OB.GPSX, OB.GPSY, COUNT(*) AS cnt
      FROM ORDERS O
      JOIN ORDERSB OB ON OB.ORD = O.ORD
      WHERE O.CUST IN (${CUSTS.join(',')})
        AND OB.GPSX NOT IN ('','0') AND OB.GPSY NOT IN ('','0')
      GROUP BY O.CUST, OB.GPSX, OB.GPSY
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY CUST ORDER BY cnt DESC) rn,
             SUM(cnt) OVER (PARTITION BY CUST) total
      FROM gps_counts
    )
    SELECT CUST, CAST(GPSY AS float) lat, CAST(GPSX AS float) lng, cnt, total,
           CAST(cnt*100/total AS int) pct
    FROM ranked WHERE rn=1
  `);
  console.log('\nRegular ORDERSB GPS for 3 clients (current source):');
  ordGps.forEach(r => console.log(`  CUST=${r.CUST}: lat=${r.lat.toFixed(5)} lng=${r.lng.toFixed(5)} top=${r.cnt}/${r.total} (${r.pct}%)`));

  // 4. What's in ADCCONTROLLERLOG for these 3?
  const adcCheck = await queryDB('icecrea', `
    SELECT CUST, COUNT(*) AS entries,
           SUM(CASE WHEN GPSX IS NOT NULL AND GPSX != '' AND GPSX != '0' THEN 1 ELSE 0 END) AS with_gps
    FROM ADCCONTROLLERLOG
    WHERE CUST IN (${CUSTS.join(',')})
    GROUP BY CUST
  `);
  console.log('\nADCCONTROLLERLOG for 3 clients:');
  if (!adcCheck.length) console.log('  NONE found');
  adcCheck.forEach(r => console.log(`  CUST=${r.CUST}: ${r.entries} entries, ${r.with_gps} with GPS`));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
