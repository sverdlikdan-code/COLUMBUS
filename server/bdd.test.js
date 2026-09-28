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
