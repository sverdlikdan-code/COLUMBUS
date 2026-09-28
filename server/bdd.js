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

// One Priority result (bddDocLinesToday) feeds V, סגירת יום and line coverage.
// Families are filtered here, not in SQL, so the SQL stays the ICE M code's own shape.
// Sign split: src 'N' = החזרה (DOCS), negative INV = זיכוי, everything else = sale.
function summarizeBddDocs(rows, families) {
  const custIds = new Set();
  const byAgent = new Map();
  for (const r of rows) {
    if (!families.has(r.familyDes)) continue;
    custIds.add(r.custId);
    if (!byAgent.has(r.agentCode)) byAgent.set(r.agentCode, { agentName: r.agentName, custSet: new Set(), sales: 0, returns: 0, credits: 0 });
    const a = byAgent.get(r.agentCode);
    a.custSet.add(r.custId);
    if (r.src === 'N') a.returns += r.amount;
    else if (r.src === 'INV' && r.amount < 0) a.credits += r.amount;
    else a.sales += r.amount;
  }
  const round = n => Math.round(n * 100) / 100;
  for (const a of byAgent.values()) {
    a.custCount = a.custSet.size;
    a.sales = round(a.sales); a.returns = round(a.returns); a.credits = round(a.credits);
    a.sum = round(a.sales + a.returns + a.credits);
  }
  return { custIds, byAgent };
}

function bddCanWrite(session, agentCode, cache) {
  if (!session?.isManager) return false;
  if (session.managerRole === 'super') return true;
  if (session.channel !== 'ICE_BDD' || session.managerRole !== 'team' || !cache) return false;
  const group = cache.agentGroup.get(String(agentCode));
  return !!group && (session.managerTeams || []).includes(group);
}

// GPS cascade (user-approved 2026-09-28), first hit wins. Pure: every source is
// passed in; FORMULA sources are read-only views, nothing here writes anything.
function resolveBddGps(c, s) {
  const id = String(c.custId);
  const pick = (p, gpsSource) => (p && s.isValid(p.lat, p.lng) ? { lat: p.lat, lng: p.lng, gpsSource } : null);
  return pick(s.bddCorr[id], 'correction')
    || pick(s.formulaCorr[id], 'formula-correction')
    || pick(s.tablet.get(id), 'tablet-order')
    || pick(s.formulaKnown.get(id), 'formula')
    || pick(c, 'pbi')
    || pick(s.bddResolved[id], 'geocoded')
    || { lat: null, lng: null, gpsSource: undefined };
}

module.exports = { BDD_GROUPS, unreversePbi, buildBddCache, summarizeBddDocs, bddCanWrite, resolveBddGps };
