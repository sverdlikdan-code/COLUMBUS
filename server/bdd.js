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
// A client counts as served (V badge, coverage numerator, סגירת יום client count) only
// with sales > 0 today — a credit-only or return-only client is not (user 2026-09-29).
function summarizeBddDocs(rows, families) {
  const custIds = new Set();
  const byAgent = new Map();
  for (const r of rows) {
    if (!families.has(r.familyDes)) continue;
    if (!byAgent.has(r.agentCode)) byAgent.set(r.agentCode, { agentName: r.agentName, custSales: new Map(), sales: 0, returns: 0, credits: 0 });
    const a = byAgent.get(r.agentCode);
    if (r.src === 'N') a.returns += r.amount;
    else if (r.src === 'INV' && r.amount < 0) a.credits += r.amount;
    else {
      a.sales += r.amount;
      a.custSales.set(r.custId, (a.custSales.get(r.custId) || 0) + r.amount);
    }
  }
  const round = n => Math.round(n * 100) / 100;
  for (const a of byAgent.values()) {
    const served = [...a.custSales].filter(([, s]) => s > 0).map(([id]) => id);
    served.forEach(id => custIds.add(id));
    a.custCount = served.length;
    delete a.custSales;
    a.sales = round(a.sales); a.returns = round(a.returns); a.credits = round(a.credits);
    a.sum = round(a.sales + a.returns + a.credits);
  }
  return { custIds, byAgent };
}

function bddCanWrite(session, agentCode, cache) {
  if (!session?.isManager) return false;
  if (session.managerRole === 'super') return true;
  // BDD write rights come from bddRole only — managerRole stays the person's FORMULA role
  // (readonly for BDD managers), so FORMULA write/admin routes never see them as 'team'.
  if (session.channel !== 'ICE_BDD' || session.bddRole !== 'team' || !cache) return false;
  const group = cache.agentGroup.get(String(agentCode));
  return !!group && (session.managerTeams || []).includes(group);
}

// Who may use /api/bdd/* (read) and see the FORMULA/BDD toggle: BDD channel managers,
// managers flagged bddAccess (Yosi, Dima), and super.
function canUseBdd(session) {
  return !!(session?.isManager && (session.channel === 'ICE_BDD' || session.bddAccess === true || session.managerRole === 'super'));
}

// GPS cascade (user-approved 2026-09-28), first hit wins. Pure: every source is
// passed in; FORMULA sources are read-only views, nothing here writes anything.
function resolveBddGps(c, s) {
  const id = String(c.custId);
  const pick = (p, gpsSource) => (p && s.isValid(p.lat, p.lng) ? { lat: p.lat, lng: p.lng, gpsSource } : null);
  // Automatic sources must fall inside the client's city (+~2 km): a BDD van-seller prints
  // documents on the road, so tablet GPS can be another city (1153040 Netanya → Hadera,
  // 2026-09-29). Manual 📍 corrections are trusted as-is.
  const inCity = s.inCity || (() => true);
  const pickIn = (p, gpsSource) => (p && inCity(c.city, p.lat, p.lng) ? pick(p, gpsSource) : null);
  return pick(s.bddCorr[id], 'correction')
    || pick(s.formulaCorr[id], 'formula-correction')
    || pickIn(s.tablet.get(id), 'tablet-order')
    || pickIn(s.formulaKnown.get(id), 'formula')
    || pickIn(c, 'pbi')
    || pickIn(s.bddResolved[id], 'geocoded')
    || { lat: null, lng: null, gpsSource: undefined };
}

// Datasets: FORMULA = default (clients, families, ALL_PARTS sales); ICE = TEAMS, GPS, schedule.
// Pause between consecutive BDD DAX queries: 7 back-to-back queries after a deploy
// likely pushed a live FORMULA user into PBI 429 (shared quota).
const BDD_DAX_GAP_MS = 5000;

async function loadBddCache(rawExecuteDax, iceDatasetId, fix, gapMs = BDD_DAX_GAP_MS) {
  const T = `'לקוחות FORM+I+INT'`;
  // Sequential on purpose (isolation rule): FORMULA shares the same PBI query quota,
  // a burst of parallel queries is what caused the 429s before. Gap before every query but the first.
  let first = true;
  const executeDax = async (...a) => {
    if (!first && gapMs > 0) await new Promise(r => setTimeout(r, gapMs));
    first = false;
    return rawExecuteDax(...a);
  };
  const teamRows = await executeDax(`EVALUATE SELECTCOLUMNS('TEAMS', "agentCode", 'TEAMS'[SOHEN NUMBER], "group", 'TEAMS'[מנהל], "agentName", 'TEAMS'[סוכן])`, iceDatasetId);
  const clientRows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER(${T}, ${T}[HEVRA] = "ICE" && ${T}[סטטוס] = "פעיל"),
      "custId", ${T}[מס. לקוח], "custName", ${T}[שם לקוח], "city", ${T}[עיר], "address", ${T}[כתובת],
      "agentCode", ${T}[סוכן], "agentName", ${T}[שם סוכן], "clientType", ${T}[תאור סוג לקוח])`);
  const gpsRows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER('משטח_UNICKS', NOT ISBLANK('משטח_UNICKS'[קו רוחב]) && 'משטח_UNICKS'[קו רוחב] <> 0),
      "custId", 'משטח_UNICKS'[מס. לקוח], "lat", 'משטח_UNICKS'[קו רוחב], "lng", 'משטח_UNICKS'[קו אורך])`, iceDatasetId);
  const schedRows = await executeDax(`EVALUATE SELECTCOLUMNS('משטח_ICE', "custId", 'משטח_ICE'[מס.לקוח], "day", 'משטח_ICE'[יום], "status", 'משטח_ICE'[סטטוס])`, iceDatasetId);
  const familyRows = await executeDax(`EVALUATE SELECTCOLUMNS(FILTER(ADIFUT, SEARCH("bdd", ADIFUT[מחלקה], 1, 0) > 0), "fam", ADIFUT[תאור משפחה])`);
  const cache = buildBddCache({ teamRows, clientRows, gpsRows, schedRows, familyRows }, fix);

  // Month + 6-month BDD sales per client (ALL_PARTS, BDD families only).
  if (cache.familiesRaw.length) {
    const famIn = cache.familiesRaw.map(f => `"${String(f).replace(/"/g, '""')}"`).join(', ');
    const now = new Date();
    const s6 = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const e6 = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthRows = await executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
        "s", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]), "last", CALCULATE(MAX(ALL_PARTS[תאריך]))),
        ALL_PARTS[חברה] = "ICE", ALL_PARTS[תאור משפחת מוצר] IN {${famIn}}, MONTH(ALL_PARTS[תאריך]) = MONTH(TODAY()), YEAR(ALL_PARTS[תאריך]) = YEAR(TODAY()))`);
    const avgRows = await executeDax(`EVALUATE CALCULATETABLE(ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
        "s", DIVIDE(CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]), 6), "o", DIVIDE(CALCULATE(DISTINCTCOUNT(ALL_PARTS[תאריך])), 6)),
        ALL_PARTS[חברה] = "ICE", ALL_PARTS[תאור משפחת מוצר] IN {${famIn}},
        ALL_PARTS[תאריך] >= DATE(${s6.getFullYear()},${s6.getMonth() + 1},1), ALL_PARTS[תאריך] <= DATE(${e6.getFullYear()},${e6.getMonth() + 1},${e6.getDate()}))`);
    const patch = (rows, fn) => {
      for (const r of rows) {
        const id = String(r['ALL_PARTS[מספר לקוח]'] || '');
        if (!cache.clientById.has(id)) continue;
        for (const c of cache.byAgent.get(cache.clientById.get(id).agentCode) || []) if (c.custId === id) fn(c, r);
      }
    };
    patch(monthRows, (c, r) => {
      c.monthlySales = Math.round(parseFloat(r['[s]']) || 0);
      c.lastOrderDate = r['[last]'] ? new Date(r['[last]']).toISOString().slice(0, 10) : null;
    });
    patch(avgRows, (c, r) => { c.avg6Sales = Math.round(parseFloat(r['[s]']) || 0); c.avg6Orders = Math.round(parseFloat(r['[o]']) || 0); });
  }
  return cache;
}

// Priority visit order (bdd-priority.js bddVisitOrder) → priorityOrder of the matching
// client-day row, so "הגרסה שלי" sorts like the tablet. Rows without an order keep 9000/9500.
function applyVisitOrder(cache, rows) {
  const ord = new Map(rows.map(r => [`${r.custId}|${r.dayNum}`, r.visitOrder]));
  let n = 0;
  for (const list of cache.byAgent.values()) {
    for (const c of list) {
      const o = ord.get(`${c.custId}|${c.dayNum}`);
      if (o > 0) { c.priorityOrder = o; n++; }
    }
  }
  return n;
}

// Disk copy of the day's cache: a restart/deploy on the same Israel day reads it
// instead of re-running the DAX queries (user 2026-09-29: PBI once a day, morning).
function serializeBddCache(cache, date) {
  return {
    date,
    agentGroup: [...cache.agentGroup], agentsByGroup: [...cache.agentsByGroup],
    byAgent: [...cache.byAgent], clientById: [...cache.clientById],
    families: [...cache.families], familiesRaw: cache.familiesRaw, loadedAt: cache.loadedAt,
  };
}
function deserializeBddCache(obj, today) {
  if (!obj || obj.date !== today) return null;
  return {
    agentGroup: new Map(obj.agentGroup), agentsByGroup: new Map(obj.agentsByGroup),
    byAgent: new Map(obj.byAgent), clientById: new Map(obj.clientById),
    families: new Set(obj.families), familiesRaw: obj.familiesRaw, loadedAt: new Date(obj.loadedAt),
  };
}

module.exports = { BDD_GROUPS, unreversePbi, buildBddCache, summarizeBddDocs, bddCanWrite, canUseBdd, resolveBddGps, loadBddCache, BDD_DAX_GAP_MS, serializeBddCache, deserializeBddCache, applyVisitOrder };
