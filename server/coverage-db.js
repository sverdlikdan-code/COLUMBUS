// Line-coverage history store (PRD/coverage-history-design.md §3). One row per
// date × channel × agent, written only by the real evening snapshot. Decision
// 2026-09-30 (Dan): real data only — no reconstructed history. Old 'backfill'
// rows (today's lines applied to past dates) stay in the file but are never read.
const Database = require('better-sqlite3');

function openCoverageDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage_daily (
      date TEXT NOT NULL, channel TEXT NOT NULL, agent_code TEXT NOT NULL,
      agent_name TEXT, team TEXT, day_num INTEGER,
      planned INTEGER NOT NULL, in_line INTEGER NOT NULL, off_line INTEGER NOT NULL,
      source TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (date, channel, agent_code)
    );
    CREATE INDEX IF NOT EXISTS idx_cov_channel_date ON coverage_daily(channel, date);
  `);
  // Per-client breakdown (JSON {in, off, miss} of [custId, name]) — added 2026-09-30,
  // NULL on rows written before that.
  if (!db.prepare(`PRAGMA table_info(coverage_daily)`).all().some(c => c.name === 'clients')) {
    db.exec(`ALTER TABLE coverage_daily ADD COLUMN clients TEXT`);
  }
  const ins = db.prepare(`
    INSERT INTO coverage_daily (date, channel, agent_code, agent_name, team, day_num, planned, in_line, off_line, clients, source, created_at)
    VALUES (@date, @channel, @agentCode, @agentName, @team, @dayNum, @planned, @inLine, @offLine, @clients, 'snapshot', @createdAt)
    ON CONFLICT (date, channel, agent_code) DO UPDATE SET
      agent_name = excluded.agent_name, team = excluded.team, day_num = excluded.day_num,
      planned = excluded.planned, in_line = excluded.in_line, off_line = excluded.off_line,
      clients = excluded.clients, source = excluded.source, created_at = excluded.created_at
  `);
  const upsert = db.transaction(rows => {
    const createdAt = new Date().toISOString();
    for (const r of rows) ins.run({ clients: null, ...r, createdAt });
  });
  const snapQ = db.prepare(`SELECT 1 FROM coverage_daily WHERE date = ? AND channel = ? AND source = 'snapshot' LIMIT 1`);
  const rangeQ = db.prepare(`SELECT date, agent_code, agent_name, team, day_num, planned, in_line, off_line, clients IS NOT NULL AS has_clients
    FROM coverage_daily WHERE channel = ? AND source = 'snapshot' AND date BETWEEN ? AND ? ORDER BY date`);
  const dayQ = db.prepare(`SELECT team, clients FROM coverage_daily
    WHERE channel = ? AND agent_code = ? AND date = ? AND source = 'snapshot'`);
  return {
    upsert,
    hasSnapshot: (date, channel) => !!snapQ.get(date, channel),
    readRange: (channel, from, to) => rangeQ.all(channel, from, to),
    readDay: (channel, agentCode, date) => dayQ.get(channel, agentCode, date) || null,
    close: () => db.close(),
  };
}

module.exports = { openCoverageDb };
