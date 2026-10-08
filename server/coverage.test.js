const test = require('node:test');
const assert = require('node:assert');
const { routeDayOf, weekIndex, weekNumIL, weekParity, biweeklyLine, coveragePeriod, lineFor, movedAwayFrom, coverageCounts, coverageClients, creditedCustsByAgent, coverageScope, COVERAGE_EXCLUDED_TEAMS } = require('./coverage');

test('routeDayOf: Sun..Thu → 1..5, Fri/Sat → null', () => {
  assert.strictEqual(routeDayOf('2026-09-27'), 1); // Sunday
  assert.strictEqual(routeDayOf('2026-10-01'), 5); // Thursday
  assert.strictEqual(routeDayOf('2026-10-02'), null); // Friday
  assert.strictEqual(routeDayOf('2026-10-03'), null); // Saturday
});

test('coveragePeriod: 3 full months back + current month up to today', () => {
  assert.deepStrictEqual(coveragePeriod('2026-09-30'), { from: '2026-06-01', to: '2026-09-30' });
  assert.deepStrictEqual(coveragePeriod('2026-01-01'), { from: '2025-10-01', to: '2026-01-01' });
  assert.deepStrictEqual(coveragePeriod('2026-03-15'), { from: '2025-12-01', to: '2026-03-15' });
});

test('lineFor: scheduled day minus moved-away plus moved-in', () => {
  const scheduled = [
    { custId: '1', dayNum: 2 }, { custId: '2', dayNum: 2 }, { custId: '3', dayNum: 3 }, { custId: '4', dayNum: 2 },
  ];
  const dayMoves = { '2': { day: 4 }, '3': { day: 2 }, '9': { day: 2 } };
  const line = lineFor({ scheduled, dayMoves, dayNum: 2, movedInOk: id => id !== '9' });
  assert.deepStrictEqual([...line].sort(), ['1', '3', '4']);
});

test('lineFor: 2-day client, move with from keeps the other day (agent pressed "keep")', () => {
  const scheduled = [{ custId: '7', dayNum: 2 }, { custId: '7', dayNum: 4 }];
  const dayMoves = { '7': { day: 5, from: 4 } };
  const on = d => [...lineFor({ scheduled, dayMoves, dayNum: d, movedInOk: () => true })];
  assert.deepStrictEqual([on(2), on(4), on(5)], [['7'], [], ['7']]);
});

test('lineFor: 2-day client, move without from = only the new day (old records, "only one day")', () => {
  const scheduled = [{ custId: '7', dayNum: 2 }, { custId: '7', dayNum: 4 }];
  const dayMoves = { '7': { day: 5 } };
  const on = d => [...lineFor({ scheduled, dayMoves, dayNum: d, movedInOk: () => true })];
  assert.deepStrictEqual([on(2), on(4), on(5)], [[], [], ['7']]);
});

test('movedAwayFrom: no move / move without from / move with from', () => {
  assert.strictEqual(movedAwayFrom(undefined, 2), false);
  assert.strictEqual(movedAwayFrom({ day: 5 }, 2), true);
  assert.strictEqual(movedAwayFrom({ day: 5, from: 4 }, 2), false);
  assert.strictEqual(movedAwayFrom({ day: 5, from: 4 }, 4), true);
});

test('lineFor: no moves = plain scheduled day (negative control vs old denom)', () => {
  const scheduled = [{ custId: '1', dayNum: 2 }, { custId: '2', dayNum: 2 }, { custId: '2', dayNum: 2 }, { custId: '3', dayNum: 3 }];
  const line = lineFor({ scheduled, dayMoves: {}, dayNum: 2, movedInOk: () => true });
  assert.deepStrictEqual([...line].sort(), ['1', '2']);
});

test('coverageCounts: planned / inLine / offLine', () => {
  const r = coverageCounts(new Set(['1', '2', '3']), new Set(['2', '7', '8']));
  assert.deepStrictEqual(r, { planned: 3, inLine: 1, offLine: 2 });
  assert.deepStrictEqual(coverageCounts(new Set(), new Set()), { planned: 0, inLine: 0, offLine: 0 });
});

test('coverageClients: in line / off line / missed, with names (unknown → empty name)', () => {
  const names = new Map([['1', 'אלף'], ['2', 'בית'], ['7', 'זין']]);
  const r = JSON.parse(coverageClients(new Set(['1', '2', '3']), new Set(['2', '7']), id => names.get(id)));
  assert.deepStrictEqual(r, { in: [['2', 'בית']], off: [['7', 'זין']], miss: [['1', 'אלף'], ['3', '']] });
});

test('creditedCustsByAgent: roster owner AND entering agent both credited', () => {
  const rows = [
    { custId: '100', dispPrice: 50, enteringAgentCode: '53' },
    { custId: '100', dispPrice: 10, enteringAgentCode: '53' },
    { custId: '200', dispPrice: 5, enteringAgentCode: null },
  ];
  const roster = new Map([['100', '110'], ['200', '53']]);
  const { custs, sums } = creditedCustsByAgent(rows, roster);
  assert.deepStrictEqual([...custs.get('110')], ['100']);
  assert.deepStrictEqual([...custs.get('53')].sort(), ['100', '200']);
  assert.strictEqual(sums.get('110'), 60);
  assert.strictEqual(sums.get('53'), 65);
});

test('coverageScope: super all, team own, bdd team own groups, readonly none', () => {
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'super' }), { formula: '*', bdd: '*' });
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'team', managerTeam: 'ALEXEY' }), { formula: ['ALEXEY'], bdd: null });
  assert.deepStrictEqual(
    coverageScope({ isManager: true, managerRole: 'readonly', channel: 'ICE_BDD', bddRole: 'team', managerTeams: ['MATVEY', 'ALMOG'] }),
    { formula: null, bdd: ['MATVEY', 'ALMOG'] });
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'readonly', bddAccess: true }), { formula: null, bdd: null });
  assert.deepStrictEqual(coverageScope({ isManager: false, agentCode: '53' }), { formula: null, bdd: null });
  assert.deepStrictEqual(coverageScope(null), { formula: null, bdd: null });
});

test('coverage teams: only teams with a manager — no SADRAN+ (FORMULA), no YOSI (BDD)', () => {
  assert.ok(COVERAGE_EXCLUDED_TEAMS.has('SADRAN+') && COVERAGE_EXCLUDED_TEAMS.has('YOSI'));
  assert.deepStrictEqual(coverageScope({ isManager: true, managerRole: 'team', managerTeam: 'SADRAN+' }), { formula: null, bdd: null });
  assert.deepStrictEqual(
    coverageScope({ isManager: true, managerRole: 'readonly', channel: 'ICE_BDD', bddRole: 'team', managerTeams: ['TIMUR', 'YOSI'] }),
    { formula: null, bdd: ['TIMUR'] });
});

test('weekParity: Israeli week number (Sunday-based, = PBI ALL_PARTS[שבוע]), Sun..Sat share it', () => {
  assert.strictEqual(weekNumIL('2026-10-04'), 41); // PBI week 41
  assert.strictEqual(weekParity('2026-10-04'), 1); // Sun — אי-זוגי
  assert.strictEqual(weekParity('2026-10-10'), 1); // Sat, same week
  assert.strictEqual(weekParity('2026-10-11'), 0); // next Sun, week 42 — זוגי
  assert.strictEqual(weekNumIL('2027-01-01'), 1);  // Fri 1 Jan = week 1 (partial)
  assert.strictEqual(weekNumIL('2027-01-03'), 2);  // first Sunday of 2027 = week 2
  assert.strictEqual(weekIndex('1988-01-03'), 0);  // epoch Sunday
  assert.strictEqual(weekIndex('1988-01-09'), 0);
  assert.strictEqual(weekIndex('1988-01-10'), 1);
});

test('biweeklyLine: off-week client leaves the plan unless he ordered (Dan: 16/17 = 94%)', () => {
  const line = new Set([...Array(16)].map((_, i) => String(i + 1)).concat('odd'));
  const biweekly = { odd: { parity: 1 }, '1': { parity: 0 } };
  // even week, the odd-week client did not order → plan 16
  assert.strictEqual(biweeklyLine(line, biweekly, 0, new Set()).size, 16);
  // even week, 15 of the 16 + the odd-week client ordered → plan 17, served 16 → 94%
  const served = new Set([...Array(15)].map((_, i) => String(i + 1)).concat('odd'));
  const r = coverageCounts(biweeklyLine(line, biweekly, 0, served), served);
  assert.deepStrictEqual(r, { planned: 17, inLine: 16, offLine: 0 });
  assert.strictEqual(Math.round(r.inLine / r.planned * 100), 94);
  // odd week: client '1' (even) leaves, 'odd' stays
  assert.ok(!biweeklyLine(line, biweekly, 1, new Set()).has('1'));
  assert.ok(biweeklyLine(line, biweekly, 1, new Set()).has('odd'));
  // no biweekly entries = line unchanged
  assert.strictEqual(biweeklyLine(line, undefined, 0, served), line);
});
