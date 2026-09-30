// Line-coverage history store (PRD/coverage-history-design.md §3). One row per
// date × channel × agent. A snapshot row replaces a backfill row; a backfill row
// never replaces a snapshot.
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
  const ins = db.prepare(`
    INSERT INTO coverage_daily (date, channel, agent_code, agent_name, team, day_num, planned, in_line, off_line, source, created_at)
    VALUES (@date, @channel, @agentCode, @agentName, @team, @dayNum, @planned, @inLine, @offLine, @source, @createdAt)
    ON CONFLICT (date, channel, agent_code) DO UPDATE SET
      agent_name = excluded.agent_name, team = excluded.team, day_num = excluded.day_num,
      planned = excluded.planned, in_line = excluded.in_line, off_line = excluded.off_line,
      source = excluded.source, created_at = excluded.created_at
    WHERE coverage_daily.source <> 'snapshot' OR excluded.source = 'snapshot'
  `);
  const upsert = db.transaction(rows => {
    const createdAt = new Date().toISOString();
    for (const r of rows) ins.run({ ...r, createdAt });
  });
  const snapQ = db.prepare(`SELECT 1 FROM coverage_daily WHERE date = ? AND channel = ? AND source = 'snapshot' LIMIT 1`);
  const bfQ = db.prepare(`SELECT 1 FROM coverage_daily WHERE source = 'backfill' LIMIT 1`);
  const datesQ = db.prepare(`SELECT DISTINCT date FROM coverage_daily WHERE channel = ?`);
  const rangeQ = db.prepare(`SELECT date, agent_code, agent_name, team, day_num, planned, in_line, off_line, source
    FROM coverage_daily WHERE channel = ? AND date BETWEEN ? AND ? ORDER BY date`);
  return {
    upsert,
    hasSnapshot: (date, channel) => !!snapQ.get(date, channel),
    hasAnyBackfill: () => !!bfQ.get(),
    datesWithRows: channel => new Set(datesQ.all(channel).map(r => r.date)),
    readRange: (channel, from, to) => rangeQ.all(channel, from, to),
    close: () => db.close(),
  };
}

module.exports = { openCoverageDb };
