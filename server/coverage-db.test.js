const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openCoverageDb } = require('./coverage-db');

const row = (o = {}) => ({ date: '2026-09-29', channel: 'bdd', agentCode: '63', agentName: 'סימחה', team: 'SIMHA',
  dayNum: 3, planned: 22, inLine: 0, offLine: 11, ...o });
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-')), 'c.db');

test('coverage-db: snapshot upsert, range read, clients per day', () => {
  const db = openCoverageDb(tmpFile());
  assert.strictEqual(db.hasSnapshot('2026-09-29', 'bdd'), false);
  db.upsert([row()]);
  assert.strictEqual(db.hasSnapshot('2026-09-29', 'bdd'), true);
  db.upsert([row({ inLine: 4, clients: '{"in":[["1","א"]],"off":[],"miss":[]}' })]); // re-snapshot replaces
  const got = db.readRange('bdd', '2026-09-01', '2026-09-30');
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].in_line, 4);
  assert.strictEqual(got[0].has_clients, 1);
  assert.strictEqual(got[0].clients, undefined); // range read stays light
  assert.deepStrictEqual(JSON.parse(db.readDay('bdd', '63', '2026-09-29').clients).in, [['1', 'א']]);
  assert.strictEqual(db.readDay('bdd', '63', '2026-09-28'), null);
  assert.strictEqual(db.readRange('formula', '2026-09-01', '2026-09-30').length, 0);
  db.close();
});

test('coverage-db: real data only — old backfill rows never read, old file gets clients column', () => {
  const file = tmpFile();
  const raw = new Database(file); // pre-2026-09-30 schema, with a reconstructed row
  raw.exec(`CREATE TABLE coverage_daily (date TEXT NOT NULL, channel TEXT NOT NULL, agent_code TEXT NOT NULL,
    agent_name TEXT, team TEXT, day_num INTEGER, planned INTEGER NOT NULL, in_line INTEGER NOT NULL, off_line INTEGER NOT NULL,
    source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (date, channel, agent_code));
    INSERT INTO coverage_daily VALUES ('2026-09-10','bdd','63','x','SIMHA',5,10,5,0,'backfill','t');`);
  raw.close();
  const db = openCoverageDb(file);
  assert.strictEqual(db.readRange('bdd', '2026-09-01', '2026-09-30').length, 0);
  assert.strictEqual(db.readDay('bdd', '63', '2026-09-10'), null);
  db.upsert([row({ date: '2026-09-30' })]);
  assert.strictEqual(db.readRange('bdd', '2026-09-01', '2026-09-30')[0].has_clients, 0);
  db.close();
});
