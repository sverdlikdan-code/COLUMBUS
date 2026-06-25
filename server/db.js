const sql = require('mssql');

const cfg = {
  server:   process.env.DB_SERVER   || '192.168.100.246',
  port:     parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME     || 'form',
  user:     process.env.DB_USER     || '',
  password: process.env.DB_PASSWORD || '',
  options: {
    trustServerCertificate: true,
    connectTimeout: 10000,
    requestTimeout:  15000,
  },
  pool: { min: 1, max: 5 },
};

const pool = new sql.ConnectionPool(cfg);
let _connecting = null;

async function getPool() {
  if (pool.connected) return pool;
  if (_connecting) return _connecting;
  _connecting = pool.connect().then(p => { _connecting = null; return p; }).catch(e => { _connecting = null; throw e; });
  return _connecting;
}

async function query(sqlText, params = {}) {
  const p = await getPool();
  const req = p.request();
  for (const [k, v] of Object.entries(params)) req.input(k, sql.NVarChar, v);
  return req.query(sqlText);
}

module.exports = { query, sql };
