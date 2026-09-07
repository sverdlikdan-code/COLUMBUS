// Event store for access logging + deep behavioral tracking — replaces the
// flat-file access-log.json (2000-entry cap, whole-array rewrite on every
// single event) and events.jsonl (zikuy-only). Same external contract as the
// old writeLog()/readLog(): callers pass/get plain objects, nothing about
// the ~30 existing writeLog() call sites in index.js needs to change.
//
// Named events-db.js, not db.js — server/db.js already exists (mssql pool
// for Priority's 'form' DB, added 2026-06-25) and is unrelated to this.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'events.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL,
    event_type   TEXT NOT NULL,
    agent_code   TEXT,
    is_manager   INTEGER,
    manager_id   TEXT,
    manager_role TEXT,
    cust_id      TEXT,
    props        TEXT NOT NULL   -- full original entry as JSON, for lossless readback
  );
  CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent_code, ts);
  CREATE INDEX IF NOT EXISTS idx_events_type_ts  ON events(event_type, ts);
  CREATE INDEX IF NOT EXISTS idx_events_ts       ON events(ts);
`);

const insertStmt = db.prepare(`
  INSERT INTO events (ts, event_type, agent_code, is_manager, manager_id, manager_role, cust_id, props)
  VALUES (@ts, @event_type, @agent_code, @is_manager, @manager_id, @manager_role, @cust_id, @props)
`);

// entry: whatever plain object the ~30 writeLog() call sites already build
// (shape varies per event type — gate-pbi has pbiUser/path/device, revoke has
// revokedCount, etc.). Everything is preserved verbatim in `props`; a handful
// of frequently-queried fields are duplicated into indexed columns.
function logEvent(entry) {
  try {
    const ts = entry.ts || new Date().toISOString();
    insertStmt.run({
      ts,
      event_type: entry.event || 'unknown',
      agent_code: entry.agentCode ?? null,
      is_manager: entry.isManager ? 1 : 0,
      manager_id: entry.managerId ?? null,
      manager_role: entry.managerRole ?? null,
      cust_id: entry.custId ?? null,
      props: JSON.stringify({ ...entry, ts }),
    });
  } catch (_) { /* best-effort — matches old writeLog()'s try/catch, never throws into a request handler */ }
}

// Bounded LIMIT applied at the SQL level before sorting back to ascending —
// unlike the old readLog() (parsed the whole access-log.json into memory on
// every call), this stays cheap no matter how large the table grows.
const recentStmtCache = new Map();
function readLog(limit = 2000) {
  try {
    let stmt = recentStmtCache.get(limit);
    if (!stmt) {
      stmt = db.prepare(`SELECT props FROM (SELECT id, props FROM events ORDER BY id DESC LIMIT ?) sub ORDER BY sub.id ASC`);
      recentStmtCache.set(limit, stmt);
    }
    return stmt.all(limit).map(r => JSON.parse(r.props));
  } catch (_) { return []; }
}

module.exports = { logEvent, readLog, db };
