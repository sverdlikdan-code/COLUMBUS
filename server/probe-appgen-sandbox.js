require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sql = require('mssql');

const baseCfg = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectTimeout: 10000,
  requestTimeout: 20000,
};

async function main() {
  // 1) Any databases beyond the 4 known ones? (would reveal a TEST/DEMO company)
  const masterPool = new sql.ConnectionPool({ ...baseCfg, database: 'master' });
  await masterPool.connect();
  const dbs = await masterPool.request().query(`SELECT name FROM sys.databases ORDER BY name`);
  console.log('=== ALL DATABASES ON SERVER ===');
  console.log(dbs.recordset.map(r => r.name).join(', '));
  await masterPool.close();

  // 2) In each known company DB, search for App Generator metadata tables
  const knownDbs = ['form', 'diller', 'icecrea', 'mmdint'];
  const patterns = ['%SCREEN%', '%APPGEN%', '%TABULA%', '%MOBAPP%', '%MOBILEAPP%', '%YISHUM%', '%PARTMENU%'];
  for (const dbName of knownDbs) {
    console.log(`\n=== ${dbName}: tables matching App Generator patterns ===`);
    try {
      const pool = new sql.ConnectionPool({ ...baseCfg, database: dbName });
      await pool.connect();
      const where = patterns.map((p, i) => `name LIKE @p${i}`).join(' OR ');
      const req = pool.request();
      patterns.forEach((p, i) => req.input(`p${i}`, sql.NVarChar, p));
      const r = await req.query(`SELECT name FROM sys.tables WHERE ${where} ORDER BY name`);
      console.log(r.recordset.length ? r.recordset.map(x => x.name).join(', ') : '(none found)');
      await pool.close();
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
