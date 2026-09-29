// server/bdd.test.js
const test = require('node:test');
const assert = require('node:assert');
const { unreversePbi, buildBddCache } = require('./bdd');

const fix = { fixBiDi: s => s, fixBiDiAddress: s => s, expandCityAbbrev: s => s };

test('unreversePbi strips LRO/PDF marks and reverses', () => {
  assert.strictEqual(unreversePbi('‭ליעפ‬'), 'פעיל');
  assert.strictEqual(unreversePbi(''), '');
});

test('buildBddCache groups agents, schedules days, drops unknown agents', () => {
  const cache = buildBddCache({
    teamRows: [
      { '[agentCode]': '98', '[group]': 'MATVEY', '[agentName]': 'אולג ליפייקו' },
      { '[agentCode]': '243', '[group]': 'TIMUR', '[agentName]': 'ולרי קושניר' },
    ],
    clientRows: [
      { '[custId]': '1151126', '[custName]': 'מינימרקט', '[city]': 'ירושלים', '[address]': 'א 1', '[agentCode]': '98', '[agentName]': 'אולג ליפייקו', '[clientType]': 'חנויות' },
      { '[custId]': '1150004', '[custName]': 'בלי יום', '[city]': 'בת ים', '[address]': '', '[agentCode]': '98', '[agentName]': 'אולג ליפייקו', '[clientType]': '' },
      { '[custId]': '9999999', '[custName]': 'פול', '[city]': '', '[address]': '', '[agentCode]': '932', '[agentName]': 'כללי', '[clientType]': '' },
    ],
    gpsRows: [{ '[custId]': '1151126', '[lat]': 31.78, '[lng]': 35.21 }],
    schedRows: [
      { '[custId]': '1151126', '[day]': 'ב', '[status]': '‭ליעפ‬' },
      { '[custId]': '1151126', '[day]': 'ה', '[status]': '‭ליעפ‬' },
      { '[custId]': '1150004', '[day]': 'ש', '[status]': '‭ליעפ‬' },
    ],
    familyRows: [{ '[fam]': '‭םידדוב הדילג‬' }],
  }, fix);

  assert.deepStrictEqual(cache.agentsByGroup.get('MATVEY'), [{ agentCode: '98', agentName: 'אולג ליפייקו' }]);
  assert.strictEqual(cache.agentGroup.get('243'), 'TIMUR');
  const list = cache.byAgent.get('98');
  assert.deepStrictEqual(list.map(c => [c.custId, c.dayNum]), [['1151126', 2], ['1151126', 5], ['1150004', null]]);
  assert.strictEqual(list[0].lat, 31.78);
  assert.strictEqual(list[0].hevra, 'ICE_BDD');
  assert.strictEqual(list[0].manager, 'MATVEY');
  assert.ok(!cache.byAgent.has('932'), 'agent outside TEAMS is dropped');
  assert.ok(cache.families.has('גלידה בודדים'));
  assert.strictEqual(cache.clientById.get('1151126').agentCode, '98');
});

const { summarizeBddDocs, bddCanWrite, resolveBddGps } = require('./bdd');

test('summarizeBddDocs keeps BDD families, nets by executing agent', () => {
  const families = new Set(['גלידה בודדים']);
  const rows = [
    { src: 'INV', docNo: 'IV1', custId: 'A', agentCode: '43', agentName: 'קרבצוב', familyDes: 'גלידה בודדים', amount: 1000 },
    { src: 'INV', docNo: 'IV1', custId: 'A', agentCode: '43', agentName: 'קרבצוב', familyDes: 'משפחתי', amount: 500 },
    { src: 'D',   docNo: 'D7',  custId: 'B', agentCode: '43', agentName: 'קרבצוב', familyDes: 'גלידה בודדים', amount: 300 },
    { src: 'N',   docNo: 'N2',  custId: 'B', agentCode: '43', agentName: 'קרבצוב', familyDes: 'גלידה בודדים', amount: -100 },
    { src: 'INV', docNo: 'CR1', custId: 'C', agentCode: '17', agentName: 'לוחמטוב', familyDes: 'גלידה בודדים', amount: -50 },
    { src: 'N',   docNo: 'N9',  custId: 'D', agentCode: '17', agentName: 'לוחמטוב', familyDes: 'גלידה בודדים', amount: -80 },
  ];
  const s = summarizeBddDocs(rows, families);
  // C = credit only, D = return only → no V, not counted (sales > 0 rule)
  assert.deepStrictEqual([...s.custIds].sort(), ['A', 'B']);
  const a43 = s.byAgent.get('43');
  assert.strictEqual(a43.custCount, 2);
  assert.strictEqual(a43.sales, 1300);
  assert.strictEqual(a43.returns, -100);
  assert.strictEqual(a43.credits, 0);
  assert.strictEqual(a43.sum, 1200);
  assert.strictEqual(s.byAgent.get('17').credits, -50);
  assert.strictEqual(s.byAgent.get('17').custCount, 0);
  assert.strictEqual(s.byAgent.get('17').sum, -130);
});

test('bddCanWrite: own groups only, super always', () => {
  const cache = { agentGroup: new Map([['98', 'MATVEY'], ['21', 'ALMOG'], ['243', 'TIMUR']]) };
  const matvey = { isManager: true, channel: 'ICE_BDD', managerRole: 'readonly', bddRole: 'team', managerTeams: ['MATVEY', 'ALMOG'] };
  assert.strictEqual(bddCanWrite(matvey, '98', cache), true);
  assert.strictEqual(bddCanWrite(matvey, '21', cache), true);
  assert.strictEqual(bddCanWrite(matvey, '243', cache), false);
  assert.strictEqual(bddCanWrite({ isManager: true, managerRole: 'super' }, '243', cache), true);
  assert.strictEqual(bddCanWrite({ isManager: true, channel: 'ICE_BDD', managerRole: 'readonly', managerTeams: ['TIMUR'] }, '243', cache), false);
  assert.strictEqual(bddCanWrite({ isManager: true, channel: 'ICE_BDD', managerRole: 'team', managerTeams: ['TIMUR'] }, '243', cache), false, 'FORMULA team role alone grants no BDD write');
  assert.strictEqual(bddCanWrite(matvey, '98', null), false);
});

test('resolveBddGps: BDD fix > FORMULA knowledge > ICE card > night geocode', () => {
  const ok = (la, lo) => ({ lat: la, lng: lo });
  const src = {
    bddCorr: { A: ok(32.1, 34.8) },
    formulaCorr: { A: ok(1, 1), B: ok(32.2, 34.9) },
    tablet: new Map([['C', ok(32.3, 35.0)]]),
    formulaKnown: new Map([['D', ok(32.4, 35.1)]]),
    bddResolved: { F: ok(32.6, 35.3) },
    isValid: (la, lo) => la > 29 && la < 34 && lo > 34 && lo < 36,
  };
  assert.deepStrictEqual(resolveBddGps({ custId: 'A', lat: 31, lng: 35 }, src), { lat: 32.1, lng: 34.8, gpsSource: 'correction' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'B', lat: 31, lng: 35 }, src), { lat: 32.2, lng: 34.9, gpsSource: 'formula-correction' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'C', lat: null, lng: null }, src), { lat: 32.3, lng: 35.0, gpsSource: 'tablet-order' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'D', lat: null, lng: null }, src), { lat: 32.4, lng: 35.1, gpsSource: 'formula' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'E', lat: 32.5, lng: 35.2 }, src), { lat: 32.5, lng: 35.2, gpsSource: 'pbi' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'F', lat: null, lng: null }, src), { lat: 32.6, lng: 35.3, gpsSource: 'geocoded' });
  assert.deepStrictEqual(resolveBddGps({ custId: 'G', lat: null, lng: null }, src), { lat: null, lng: null, gpsSource: undefined });
});
