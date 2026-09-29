// server/bdd-routes.js
// ICE BDD channel: all state, background jobs and /api/bdd/* routes.
// Isolation rule (PRD/ice-bdd-channel-design.md): BDD reads FORMULA state through
// deps.formulaGps() and never writes FORMULA files or caches; every entry point
// catches its own errors so a BDD failure never reaches FORMULA.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { BDD_GROUPS, summarizeBddDocs, bddCanWrite, resolveBddGps, loadBddCache } = require('./bdd');
const { bddDocLinesToday, bddClientPromos, bddCustFamiliesWithActivePromo } = require('./bdd-priority');

const DB = () => process.env.DB_ICECREA || 'icecrea';
const FILES = {
  overrides: path.join(__dirname, 'data', 'route-overrides-bdd.json'),
  geocoded: path.join(__dirname, 'data', 'bdd-geocode-resolved.json'),
  gps: path.join(__dirname, '..', 'docs', 'gps-corrections-bdd.json'),
  mekarer: path.join(__dirname, '..', 'docs', 'mekarer-orders-bdd.json'),
};
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return dflt; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), 'utf8');

// Serializes BDD file writes. Own queue — FORMULA's withGpsCorrectionsLock is not shared.
let writeChain = Promise.resolve();
const withBddLock = fn => (writeChain = writeChain.then(fn, fn));

const BDD_DOCS_CACHE_MS = 75 * 1000;
const BDD_GEOCODE_NIGHT_CAP = 200; // user 2026-09-28: few BDD clients will need it

function createBdd(deps) {
  let cache = null;
  let docsCache = { date: null, at: 0, summary: null };
  let promoIdsCache = { date: null, ids: [] };

  async function load() {
    try {
      const ICE_DS = process.env.POWERBI_ICE_DATASET_ID;
      if (!ICE_DS) return;
      cache = await loadBddCache(deps.executeDax, ICE_DS, deps.fix);
      const n = [...cache.byAgent.values()].reduce((s, a) => s + a.length, 0);
      console.log(`[BDD] cache loaded: ${cache.agentGroup.size} agents, ${n} client-day rows, ${cache.families.size} families`);
    } catch (e) {
      console.error('[BDD] cache load failed:', e.message); // keep previous cache
    }
  }

  async function docsToday() {
    const today = deps.todayIsraelDate();
    const fresh = docsCache.date === today && (Date.now() - docsCache.at) < BDD_DOCS_CACHE_MS;
    if (!fresh && cache) {
      try {
        docsCache = { date: today, at: Date.now(), summary: summarizeBddDocs(await bddDocLinesToday(DB(), today), cache.families) };
      } catch (e) {
        console.error('[BDD] docs query failed:', e.message); // keep last same-day summary
        if (docsCache.date !== today) docsCache = { date: today, at: 0, summary: null };
      }
    }
    return docsCache.summary;
  }

  function gpsSources() {
    const f = deps.formulaGps(); // read-only view of FORMULA state
    const formulaKnown = new Map();
    for (const src of f.clientMaps) {
      if (!src) continue;
      for (const [, list] of src) for (const c of list) if (c.lat && c.lng && !formulaKnown.has(c.custId)) formulaKnown.set(c.custId, { lat: c.lat, lng: c.lng });
    }
    for (const [id, r] of f.resolved) if (!formulaKnown.has(id)) formulaKnown.set(id, r);
    return {
      bddCorr: readJson(FILES.gps, {}),
      formulaCorr: readJson(f.correctionsFile, {}),
      tablet: f.tablet, formulaKnown,
      bddResolved: readJson(FILES.geocoded, {}),
      isValid: deps.isValidIL,
    };
  }

  // 02:00 Israel, sequential, max BDD_GEOCODE_NIGHT_CAP. noCache: reads FORMULA's
  // address cache but never writes it (in memory or on disk) — results live only in
  // FILES.geocoded.
  async function nightGeocode() {
    if (!cache) return;
    const sources = gpsSources();
    const todo = [...cache.clientById.values()].filter(c => !resolveBddGps(c, sources).lat && c.address);
    const resolved = readJson(FILES.geocoded, {});
    let done = 0;
    for (const c of todo.slice(0, BDD_GEOCODE_NIGHT_CAP)) {
      try {
        const r = await deps.geocodeAddressCascade(c.address, c.city, { noCache: true }); // R8: never write FORMULA's cache
        if (r && deps.isValidIL(r.lat, r.lng)) { resolved[c.custId] = { lat: r.lat, lng: r.lng, cityCenter: !!r.cityCenter, at: new Date().toISOString() }; done++; }
      } catch (e) { console.error('[BDD geocode]', c.custId, e.message); }
    }
    await withBddLock(() => writeJson(FILES.geocoded, resolved));
    console.log(`[BDD geocode] ${done}/${Math.min(todo.length, BDD_GEOCODE_NIGHT_CAP)} resolved, ${todo.length} were missing`);
  }
  function scheduleNight() {
    setTimeout(() => { nightGeocode().catch(e => console.error('[BDD geocode]', e.message)); scheduleNight(); }, deps.msUntilNextIsraelTime(2, 0));
  }

  let started = false;
  function start() {
    load();
    if (!started) { started = true; scheduleNight(); }
  }

  const router = express.Router();
  // Every /api/bdd route: logged-in BDD manager (or super, for Dan's checks).
  router.use(deps.requireAuth, (req, res, next) => {
    const s = req.session;
    if (s?.channel === 'ICE_BDD' || s?.managerRole === 'super') return next();
    return res.status(403).json({ ok: false, error: 'forbidden' });
  });
  // Async handler wrapper: a thrown error answers 500 here and never escapes the router.
  const h = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    console.error('[BDD route]', req.path, e.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'server_error' });
  });
  const needCache = res => (cache ? false : (res.status(503).json({ ok: false, error: 'cache_loading' }), true));
  const validAgent = a => /^\d{1,10}$/.test(String(a || '')); // R7: same regex as FORMULA's validateAgentCode
  const validCust = c => /^\d{1,15}$/.test(c);

  // --- read routes (Task 6) ---
  router.get('/managers', deps.dataRateLimit, (req, res) => res.json(BDD_GROUPS.map(m => ({ managerCode: m }))));

  router.get('/manager-agents', deps.dataRateLimit, h((req, res) => {
    const manager = String(req.query.manager || '');
    if (!BDD_GROUPS.includes(manager)) return res.status(400).json({ error: 'invalid manager' });
    if (needCache(res)) return;
    const agents = cache.agentsByGroup.get(manager) || [];
    res.json([...agents].sort((a, b) => (a.agentName || '').localeCompare(b.agentName || '')));
  }));

  router.get('/agent-exists', deps.dataRateLimit, (req, res) => {
    const agent = String(req.query.agent || '');
    if (!validAgent(agent)) return res.status(400).json({ error: 'invalid agent code' });
    if (!cache) return res.json({ exists: null, reason: 'loading' });
    const list = cache.byAgent.get(agent) || [];
    res.json({ exists: list.length > 0, count: list.length });
  });

  // R7: mirror FORMULA's /customers day-parsing exactly (index.js ~2218-2228).
  router.get('/customers', deps.dataRateLimit, h((req, res) => {
    const { agent, day } = req.query;
    if (!validAgent(agent)) return res.status(400).json({ error: 'invalid agent code' });
    if (day && !/^[0-5]$/.test(String(day))) return res.status(400).json({ error: 'invalid day' });
    if (needCache(res)) return;
    const dayNum = day !== undefined && day !== '' ? parseInt(day) : null;
    const all = cache.byAgent.get(String(agent)) || [];
    const dayMoves = readJson(FILES.overrides, {})[agent]?.dayMoves || {};
    const movedAway = new Set(Object.keys(dayMoves));
    const clients = dayNum === 0 ? all.filter(c => c.dayNum === null && !movedAway.has(c.custId))
      : dayNum ? all.filter(c => c.dayNum === dayNum && !movedAway.has(c.custId))
      : all.slice();
    if (dayNum) {
      for (const [id, mv] of Object.entries(dayMoves)) {
        if (mv?.day !== dayNum || clients.some(c => c.custId === id)) continue;
        const found = all.find(c => c.custId === id);
        if (found) clients.push({ ...found, dayNum, priorityOrder: 9500 });
      }
    }
    // No live geocoding here — it spends quota FORMULA depends on; gaps are filled at night.
    const sources = gpsSources();
    res.json(clients.map(c => ({ ...c, ...resolveBddGps(c, sources) })));
  }));

  router.get('/route-overrides', deps.dataRateLimit, (req, res) => {
    const agent = String(req.query.agent || '');
    if (!validAgent(agent)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
    const entry = readJson(FILES.overrides, {})[agent] || { order: {}, dayMoves: {} };
    res.json({ ok: true, order: entry.order || {}, dayMoves: entry.dayMoves || {} });
  });
  // --- live routes (Task 7) ---
  // Same response keys as FORMULA's /api/today-orders + `bdd`, so the frontend poll
  // code runs unchanged and only reads the extra key.
  router.get('/api/today-orders', deps.dataRateLimit, h(async (req, res) => {
    const s = await docsToday();
    res.json({ ok: true, formula: [], iceMish: [], bdd: s ? [...s.custIds] : [] });
  }));

  // Line coverage: denominator = agent's clients scheduled today (משטח_ICE),
  // numerator/sum = what that agent executed today (BDD families). Same shape as FORMULA.
  router.get('/api/team-order-stats', deps.dataRateLimit, h(async (req, res) => {
    if (needCache(res)) return;
    const s = await docsToday();
    const todayDay = deps.todayRouteDay();
    const byAgent = {}, byManager = {};
    for (const [group, agents] of cache.agentsByGroup) {
      const acc = { denom: 0, numer: 0, sum: 0 };
      for (const a of agents) {
        const denom = (cache.byAgent.get(a.agentCode) || []).filter(c => c.dayNum === todayDay).length;
        const d = s?.byAgent.get(a.agentCode);
        byAgent[a.agentCode] = { denom, numer: d?.custCount || 0, sum: d?.sum || 0 };
        acc.denom += denom; acc.numer += byAgent[a.agentCode].numer; acc.sum += byAgent[a.agentCode].sum;
      }
      byManager[group] = acc;
    }
    res.json({ ok: true, byAgent, byManager });
  }));

  // סגירת יום: by executing agent, net of החזרות/זיכויים, no new-clients section.
  // Response carries every key docs/day-closing.html reads unconditionally from a
  // FORMULA/ICE closing (custCount, sum, newCustCount, newSum, byAgent, byClient,
  // items) with empty/zero values — sales/returns/credits kept for Task 10's bdd
  // returns line.
  router.get('/api/day-closing', deps.dataRateLimit, h(async (req, res) => {
    const agentCode = String(req.query.agentCode || '');
    if (!validAgent(agentCode)) return res.status(400).json({ ok: false, error: 'agentCode required' });
    const s = await docsToday();
    if (!s) return res.status(503).json({ ok: false, error: 'priority_unavailable' });
    const a = s.byAgent.get(agentCode);
    res.json({ ok: true, type: 'bdd', custCount: a?.custCount || 0, sum: a?.sum || 0,
      newCustCount: 0, newSum: 0,
      sales: a?.sales || 0, returns: a?.returns || 0, credits: a?.credits || 0,
      items: [], byClient: [], byAgent: [] });
  }));

  // --- write routes (Task 8) ---

  return { router, start };
}

module.exports = { createBdd };
