// Diagnostic probe for bug-agent: find Zoia Tsigankov's agent code in icecrea,
// then find the day-closing day matching ~15 orders / ~14,311 vs 13,905.18,
// then dump per-order/per-customer breakdown to find a duplicate/mismatched
// customer. Read-only. Not part of the app.
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

async function main() {
  const pool = await new sql.ConnectionPool({ ...baseCfg, database: process.env.DB_ICECREA || 'icecrea' }).connect();

  // 1. Find agent code for Zoia Tsigankov
  const agentsRes = await pool.request().query(`
    SELECT AGENT, AGENTCODE, AGENTNAME FROM AGENTS
    WHERE AGENTNAME LIKE N'%ציגנקוב%' OR AGENTNAME LIKE N'%זויה%' OR AGENTNAME LIKE '%Zoia%' OR AGENTNAME LIKE '%Tsigankov%'
  `);
  console.log('=== AGENTS matching Zoia ===');
  console.table(agentsRes.recordset);

  if (!agentsRes.recordset.length) {
    console.log('No agent found by name, dumping all AGENTS for manual inspection...');
    const all = await pool.request().query(`SELECT AGENT, AGENTCODE, AGENTNAME FROM AGENTS`);
    console.log(all.recordset.filter(r => /z/i.test(r.AGENTNAME || '')));
    await pool.close();
    return;
  }

  for (const agentRow of agentsRes.recordset) {
    const AGENT = agentRow.AGENT;
    console.log(`\n=== Scanning recent days for internal AGENT=${AGENT} (code=${agentRow.AGENTCODE}) ===`);

    // 2. Find recent days where this agent (as entering agent, O.AGENT) has ~15 distinct orders
    const daysRes = await pool.request().input('agent', sql.BigInt, AGENT).query(`
      SELECT O.CURDATE, COUNT(DISTINCT O.ORD) AS ordCount, COUNT(DISTINCT O.CUST) AS custCount, SUM(O.DISPRICE) AS sumDisprice
      FROM ORDERS O
      WHERE O.AGENT = @agent
      GROUP BY O.CURDATE
      ORDER BY O.CURDATE DESC
    `);
    console.table(daysRes.recordset.map(r => ({ ...r, sumDisprice: r.sumDisprice })));
  }

  await pool.close();
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
