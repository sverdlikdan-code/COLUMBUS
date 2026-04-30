require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const { getAllManagers, getAgentsForManager, getManagerForAgent } = require('./teams');

const app = express();
app.use(cors());
app.use(express.json());

const dbConfig = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    trustServerCertificate: true,
    encrypt: false,
  },
  connectionTimeout: 10000,
};

let pool;
async function getPool() {
  if (!pool) pool = await sql.connect(dbConfig);
  return pool;
}

// GET /managers — list of managers from TEAMS.xlsx
app.get('/managers', (req, res) => {
  try {
    res.json(getAllManagers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /manager-agents?manager=VLAD — agents for a manager
app.get('/manager-agents', (req, res) => {
  const { manager } = req.query;
  if (!manager) return res.status(400).json({ error: 'manager required' });
  try {
    res.json(getAgentsForManager(manager));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /agents
app.get('/agents', async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT DISTINCT a.AGENTCODE, a.AGENTNAME
      FROM form.dbo.AGENTS a
      INNER JOIN form.dbo.CUSTOMERS c ON c.AGENT = a.AGENT
      INNER JOIN form.dbo.CUSTCALLFREQUENCY ccf ON ccf.CUST = c.CUST
      INNER JOIN form.dbo.CUSTSTATS cs ON c.CUSTSTAT = cs.CUSTSTAT
      WHERE a.AGENTNAME IS NOT NULL
        AND a.AGENTNAME <> N'כללי'
        AND cs.STATDES = N'פעיל'
      ORDER BY a.AGENTNAME
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /customers?agent=CODE&day=1
// day: 1=א 2=ב 3=ג 4=ד 5=ה
app.get('/customers', async (req, res) => {
  const { agent, day } = req.query;
  if (!agent) return res.status(400).json({ error: 'agent required' });

  try {
    const db = await getPool();
    const request = db.request()
      .input('agent', sql.NVarChar, agent);

    let dayFilter = '';
    if (day) {
      request.input('day', sql.Int, parseInt(day));
      dayFilter = 'AND ccf.DAYNUM = @day';
    }

    const result = await request.query(`
      SELECT
        c.CUSTNAME                                                AS custId,
        NCHAR(8237) + REVERSE(c.CUSTDES) + NCHAR(8236)           AS custName,
        c.STATE                                                   AS city,
        c.ADDRESS                                                 AS address,
        LTRIM(RTRIM(ISNULL(c.ADDRESS,'')))
          + CASE WHEN LTRIM(RTRIM(ISNULL(c.STATE,''))) <> ''
                 THEN N', ' + LTRIM(RTRIM(c.STATE))
                 ELSE '' END
          + N', ישראל'                                           AS fullAddress,
        c.GPSX                                                    AS lat,
        c.GPSY                                                    AS lng,
        cs.STATDES                                                AS status,
        csp.SPEC10                                                AS kosher,
        csp.SPEC20                                                AS saleType,
        REVERSE(csp.SPEC7)                                        AS param7,
        a.AGENTCODE                                               AS agentCode,
        a.AGENTNAME                                               AS agentName,
        ub.SNAME                                                  AS schedulerName,
        ccf.DAYNUM                                                AS dayNum,
        CASE ccf.DAYNUM
          WHEN 1 THEN N'א' WHEN 2 THEN N'ב' WHEN 3 THEN N'ג'
          WHEN 4 THEN N'ד' WHEN 5 THEN N'ה' WHEN 6 THEN N'ו'
          WHEN 7 THEN N'ש'
          ELSE CAST(ccf.DAYNUM AS NVARCHAR(2))
        END                                                       AS dayLabel,
        -- Priority manual visit order stored in SPEC1
        CAST(ISNULL(NULLIF(LTRIM(RTRIM(csp.SPEC1)),''), '0') AS INT) AS priorityOrder
      FROM form.dbo.CUSTCALLFREQUENCY ccf
      INNER JOIN form.dbo.CUSTOMERS c   ON ccf.CUST       = c.CUST
      INNER JOIN form.dbo.AGENTS a      ON c.AGENT         = a.AGENT
      INNER JOIN form.dbo.CUSTSTATS cs  ON c.CUSTSTAT      = cs.CUSTSTAT
      LEFT JOIN  form.dbo.CUSTSPEC csp  ON c.CUST          = csp.CUST
      LEFT JOIN  system.dbo.USERSB ub   ON c.YISS_MANAGER  = ub.USERB
      WHERE a.AGENTCODE = @agent
        AND cs.STATDES = N'פעיל'
        AND (csp.SPEC20 <> N'משלם' OR csp.SPEC20 IS NULL)
        ${dayFilter}
      ORDER BY
        CAST(ISNULL(NULLIF(LTRIM(RTRIM(csp.SPEC1)),''), '0') AS INT) ASC,
        c.CUSTNAME ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Columbus server running on port ${PORT}`));
