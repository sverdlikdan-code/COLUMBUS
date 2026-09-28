// server/bdd.js
// ICE BDD channel (van-sale) inside Formula Road — see PRD/ice-bdd-channel-design.md.
// Pure builders here; loadBddCache at the bottom is the only I/O (PBI, read-only).
const BDD_GROUPS = ['TIMUR', 'ALMOG', 'MATVEY', 'SIMHA', 'YOSI'];
const DAY_LETTER_TO_NUM = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5 };

// PBI keeps Priority Hebrew as NCHAR(8237)+REVERSE(x)+NCHAR(8236) (see the ICE M code).
// Stripping the marks and reversing restores the exact Priority string, digits included.
function unreversePbi(s) {
  return [...String(s || '').replace(/[‪-‮]/g, '')].reverse().join('');
}

function buildBddCache({ teamRows, clientRows, gpsRows, schedRows, familyRows }, fix) {
  const agentGroup = new Map();
  const agentsByGroup = new Map(BDD_GROUPS.map(g => [g, []]));
  for (const r of teamRows) {
    const agentCode = String(r['[agentCode]'] || '').trim();
    const group = String(r['[group]'] || '').trim();
    if (!agentCode || !agentsByGroup.has(group) || agentGroup.has(agentCode)) continue;
    agentGroup.set(agentCode, group);
    agentsByGroup.get(group).push({ agentCode, agentName: String(r['[agentName]'] || '').trim() });
  }

  const gps = new Map();
  for (const r of gpsRows) {
    const lat = Number(r['[lat]']), lng = Number(r['[lng]']);
    if (lat && lng) gps.set(String(r['[custId]']), { lat, lng });
  }

  const days = new Map(); // custId -> [dayNum...]
  for (const r of schedRows) {
    if (unreversePbi(r['[status]']) !== 'פעיל') continue;
    const dayNum = DAY_LETTER_TO_NUM[String(r['[day]'] || '').trim()];
    if (!dayNum) continue; // ש and blanks fall through to "לא מוגדר"
    const custId = String(r['[custId]'] || '');
    if (!days.has(custId)) days.set(custId, []);
    if (!days.get(custId).includes(dayNum)) days.get(custId).push(dayNum);
  }

  const clientById = new Map();
  const byAgent = new Map();
  for (const r of clientRows) {
    const custId = String(r['[custId]'] || '');
    const agentCode = String(r['[agentCode]'] || '').trim();
    const group = agentGroup.get(agentCode);
    if (!custId || !group) continue;
    const address = fix.expandCityAbbrev(fix.fixBiDiAddress(r['[address]'] || ''));
    const city = fix.expandCityAbbrev(String(r['[city]'] || ''));
    const g = gps.get(custId);
    const base = {
      custId,
      custName: fix.fixBiDi(r['[custName]'] || ''),
      city, address,
      fullAddress: [address, city, 'ישראל'].filter(Boolean).join(', '),
      lat: g ? g.lat : null, lng: g ? g.lng : null,
      agentCode, agentName: String(r['[agentName]'] || '').trim(),
      manager: group, clientType: String(r['[clientType]'] || ''),
      hevra: 'ICE_BDD', iceOnly: false, target: 0, pct: 0,
      monthlySales: 0, avg6Sales: 0, avg6Orders: 0, avg6IceSales: 0, lastOrderDate: null,
    };
    clientById.set(custId, base);
    if (!byAgent.has(agentCode)) byAgent.set(agentCode, []);
    const list = byAgent.get(agentCode);
    const ds = days.get(custId) || [];
    if (ds.length) for (const d of ds) list.push({ ...base, dayNum: d, dayLabel: Object.keys(DAY_LETTER_TO_NUM)[d - 1], priorityOrder: 9000 });
    else list.push({ ...base, dayNum: null, dayLabel: '', priorityOrder: 9500 });
  }

  const familiesRaw = familyRows.map(r => r['[fam]']).filter(Boolean);
  const families = new Set(familiesRaw.map(unreversePbi));
  return { agentGroup, agentsByGroup, byAgent, clientById, families, familiesRaw, loadedAt: new Date() };
}

module.exports = { BDD_GROUPS, unreversePbi, buildBddCache };
