const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openCoverageDb } = require('./coverage-db');

const row = (o = {}) => ({ date: '2026-09-29', channel: 'bdd', agentCode: '63', agentName: 'סימחה', team: 'SIMHA',
  dayNum: 3, planned: 22, inLine: 0, offLine: 11, source: 'snapshot', ...o });

test('coverage-db: upsert, snapshot beats backfill, range read', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-')), 'c.db');
  const db = openCoverageDb(file);
  assert.strictEqual(db.hasAnyBackfill(), false);
  db.upsert([row({ source: 'backfill', inLine: 5 })]);
  assert.strictEqual(db.hasAnyBackfill(), true);
  assert.strictEqual(db.hasSnapshot('2026-09-29', 'bdd'), false);
  db.upsert([row()]); // snapshot replaces backfill row
  assert.strictEqual(db.hasSnapshot('2026-09-29', 'bdd'), true);
  db.upsert([row({ source: 'backfill', inLine: 9 })]); // backfill never overwrites a snapshot
  const got = db.readRange('bdd', '2026-09-01', '2026-09-30');
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].in_line, 0);
  assert.strictEqual(got[0].source, 'snapshot');
  assert.deepStrictEqual([...db.datesWithRows('bdd')], ['2026-09-29']);
  assert.strictEqual(db.readRange('formula', '2026-09-01', '2026-09-30').length, 0);
  db.close();
});
