// server/bdd-routes.js
// ICE BDD channel: all state, background jobs and /api/bdd/* routes.
// Isolation rule (PRD/ice-bdd-channel-design.md): BDD reads FORMULA state through
// deps.formulaGps() and never writes FORMULA files or caches; every entry point
// catches its own errors so a BDD failure never reaches FORMULA.
const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs'); // Task 8: fridge order email, same package index.js already depends on
const { BDD_GROUPS, summarizeBddDocs, bddCanWrite, canUseBdd, resolveBddGps, loadBddCache, serializeBddCache, deserializeBddCache, applyVisitOrder } = require('./bdd');
const { bddDocLinesToday, bddClientPromos, bddCustFamiliesWithActivePromo, bddVisitOrder } = require('./bdd-priority');
const { lineFor, coverageCounts, coverageClients, COVERAGE_EXCLUDED_TEAMS } = require('./coverage');

// Email HTML escape — copied from index.js's escEmail (one-liner, not worth a
// deps wire-up or a shared module just for this).
function escEmail(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DB = () => process.env.DB_ICECREA || 'icecrea';
const FILES = {
  overrides: path.join(__dirname, 'data', 'route-overrides-bdd.json'),
  geocoded: path.join(__dirname, 'data', 'bdd-geocode-resolved.json'),
  google: path.join(__dirname, 'data', 'bdd-google-gps.json'), // "🤖 בדוק מיקום גוגל" answers
  gps: path.join(__dirname, '..', 'docs', 'gps-corrections-bdd.json'),
  mekarer: path.join(__dirname, '..', 'docs', 'mekarer-orders-bdd.json'),
  cache: path.join(__dirname, 'data', 'bdd-cache.json'), // today's PBI result — restart reads it, no DAX
};
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return dflt; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), 'utf8');

// Serializes BDD file writes. Own queue — FORMULA's withGpsCorrectionsLock is not shared.
let writeChain = Promise.resolve();
const withBddLock = fn => (writeChain = writeChain.then(fn, fn));

const BDD_DOCS_CACHE_MS = 75 * 1000;
const BDD_TEST_MANAGER_ID = 'bdd-test'; // managers.json row used for the dark launch
const BDD_TEST_EMAIL = 'd.sverdlik@DilerBMD.com';
const BDD_GEOCODE_NIGHT_CAP = 200; // 212 BDD clients had no GPS on 2026-09-28 → ~2 nights

function createBdd(deps) {
  let cache = null;
  let docsCache = { date: null, at: 0, summary: null };
  let promoIdsCache = { date: null, ids: [], failedAt: 0 };
  // SKU → photo URL for the promo modal, from KARTIS PARIT ICE (the table FORMULA's
  // ICE_MISH promos use). ONE DAX per day for the whole ICE catalog instead of one per
  // modal open (quota); the photos themselves are disk-cached by /api/img-proxy.
  let imgCache = { date: null, map: new Map(), failedAt: 0 }, imgInFlight = null;
  async function promoImgMap() {
    const today = deps.todayIsraelDate();
    if (imgCache.date === today || Date.now() - imgCache.failedAt < 10 * 60 * 1000) return imgCache.map;
    if (!imgInFlight) imgInFlight = (async () => {
      try {
        const T = `'KARTIS PARIT ICE'`;
        const rows = await deps.executeDax(`EVALUATE SELECTCOLUMNS(FILTER(${T}, NOT ISBLANK(${T}[URL תמונה])), "sku", ${T}[מק"ט], "img", ${T}[URL תמונה])`);
        imgCache = { date: today, map: new Map(rows.map(r => [String(r['[sku]']), r['[img]'] || ''])), failedAt: 0 };
      } catch (e) {
        console.error('[BDD] promo photos failed:', e.message); // modal falls back to 📦
        imgCache.failedAt = Date.now();
      }
    })().finally(() => { imgInFlight = null; });
    await imgInFlight;
    return imgCache.map;
  }
  let docsInFlight = null;

  // A second call while loading gets the same promise (no duplicate DAX burst). On
  // failure ONE retry is scheduled 10 min later — never stacked, cleared on success.
  let loading = null, retryTimer = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const ICE_DS = process.env.POWERBI_ICE_DATASET_ID;
      if (!ICE_DS) { console.error('[BDD] POWERBI_ICE_DATASET_ID missing'); return; }
      try {
        const fresh = await loadBddCache(deps.executeDax, ICE_DS, deps.fix);
        // Visit order from Priority (not PBI); a failure just leaves the AI/no-order default.
        try { console.log(`[BDD] visit order: ${applyVisitOrder(fresh, await bddVisitOrder(DB()))} client-days`); }
        catch (e) { console.error('[BDD] visit order failed:', e.message); }
        cache = fresh;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        const snap = serializeBddCache(cache, deps.todayIsraelDate());
        await withBddLock(() => writeJson(FILES.cache, snap)).catch(e => console.error('[BDD] cache file write failed:', e.message));
        const n = [...cache.byAgent.values()].reduce((s, a) => s + a.length, 0);
        console.log(`[BDD] cache loaded: ${cache.agentGroup.size} agents, ${n} client-day rows, ${cache.families.size} families`);
      } catch (e) {
        console.error('[BDD] cache load failed:', e.message); // keep previous cache
        if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; load(); }, 10 * 60 * 1000);
      }
    })().finally(() => { loading = null; });
    return loading;
  }

  // Concurrent callers share one in-flight Priority query. A failure is cached too
  // (at = now), so a Priority outage is retried at most once per BDD_DOCS_CACHE_MS
  // instead of on every poll from every open tablet.
  async function docsToday() {
    const today = deps.todayIsraelDate();
    const fresh = docsCache.date === today && (Date.now() - docsCache.at) < BDD_DOCS_CACHE_MS;
    if (!fresh && cache) {
      if (!docsInFlight) {
        docsInFlight = (async () => {
          try {
            docsCache = { date: today, at: Date.now(), summary: summarizeBddDocs(await bddDocLinesToday(DB(), today), cache.families) };
          } catch (e) {
            console.error('[BDD] docs query failed:', e.message); // keep last same-day summary
            docsCache = { date: today, at: Date.now(), summary: docsCache.date === today ? docsCache.summary : null };
          }
        })().finally(() => { docsInFlight = null; });
      }
      await docsInFlight;
    }
    return docsCache.summary;
  }

  // Memoized 60 s: rebuilding loops every FORMULA client map on the shared event loop,
  // too much for every /customers call. BDD /save-gps clears it (gpsMemo = null).
  let gpsMemo = null;
  function gpsSources() {
    if (gpsMemo && Date.now() - gpsMemo.at < 60 * 1000) return gpsMemo.sources;
    gpsMemo = { at: Date.now(), sources: buildGpsSources() };
    return gpsMemo.sources;
  }
  function buildGpsSources() {
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
      inCity: deps.inCityBBox,
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
  // Called after every FORMULA PBI load (06:00 daily + every restart/deploy). PBI is hit
  // only when there is no disk copy from today (Israel date) — i.e. once a day.
  function start() {
    const disk = deserializeBddCache(readJson(FILES.cache, null), deps.todayIsraelDate());
    if (disk) {
      if (!cache || cache.loadedAt < disk.loadedAt) {
        cache = disk;
        console.log(`[BDD] cache from disk (${disk.loadedAt.toISOString()}), no DAX`);
        // Visit order is Priority SQL (cheap, not PBI) — refresh it on every start.
        bddVisitOrder(DB()).then(rows => console.log(`[BDD] visit order: ${applyVisitOrder(disk, rows)} client-days`))
          .catch(e => console.error('[BDD] visit order failed:', e.message));
      }
    } else load();
    if (!started) { started = true; scheduleNight(); }
  }

  const router = express.Router();
  // Every /api/bdd route: BDD manager, bddAccess manager, or super (see canUseBdd).
  router.use(deps.requireAuth, (req, res, next) => {
    if (canUseBdd(req.session)) return next();
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

  // BDD line for a route day — PBI schedule + agent's in-app day moves (same rule as
  // /customers below). Shared by team-order-stats and the coverage snapshot.
  function bddLineFor(agentCode, dayNum, overrides) {
    const all = cache.byAgent.get(String(agentCode)) || [];
    const ids = new Set(all.map(c => String(c.custId)));
    const dayMoves = (overrides || readJson(FILES.overrides, {}))[agentCode]?.dayMoves || {};
    return lineFor({ scheduled: all, dayMoves, dayNum, movedInOk: id => ids.has(id) });
  }

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

  // Same as FORMULA's /geocode (start city, 📍 address search) but noCache (R8):
  // reads FORMULA's address cache, never writes it.
  router.get('/geocode', deps.dataRateLimit, h(async (req, res) => {
    const { address, city } = req.query;
    if (!address) return res.status(400).json({ error: 'address required' });
    const query = [deps.cleanAddressForGeocoding(address), city, 'ישראל'].filter(Boolean).join(', ');
    res.json((await deps.geocodeAddress(query, undefined, { noCache: true })) || {});
  }));
  // "🤖 בדוק מיקום גוגל" for any BDD client: FORMULA's AI_GPS (google-gps.json) covers
  // only FORMULA clients, so BDD asks Google Geocoding live by the client's address.
  // Point outside the client's city → rejected (same rule as resolveBddGps). Own cache
  // file; only shown for review in the page, saved only when the manager confirms.
  router.get('/google-gps', deps.dataRateLimit, h(async (req, res) => {
    const custId = String(req.query.custId || '');
    if (!validCust(custId)) return res.status(400).json({ ok: false, error: 'invalid custId' });
    if (needCache(res)) return;
    const c = cache.clientById.get(custId);
    if (!c) return res.status(404).json({ ok: false, error: 'unknown client' });
    const known = readJson(FILES.google, {})[custId];
    if (known) return res.json({ ok: true, lat: known.lat, lng: known.lng });
    if (!process.env.GOOGLE_MAPS_KEY || !c.address) return res.json({ ok: false, error: 'no_address' });
    const q = [deps.cleanAddressForGeocoding(c.address), c.city, 'ישראל'].filter(Boolean).join(', ');
    const d = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=he&region=il&key=${process.env.GOOGLE_MAPS_KEY}`, { signal: AbortSignal.timeout(8000) })).json();
    const loc = d?.results?.[0]?.geometry?.location;
    if (!loc || !deps.isValidIL(loc.lat, loc.lng) || !deps.inCityBBox(c.city, loc.lat, loc.lng)) return res.json({ ok: false, error: 'not_found' });
    await withBddLock(() => { const all = readJson(FILES.google, {}); all[custId] = { lat: loc.lat, lng: loc.lng, q, at: new Date().toISOString() }; writeJson(FILES.google, all); });
    res.json({ ok: true, lat: loc.lat, lng: loc.lng });
  }));
  // --- live routes (Task 7) ---
  // Same response keys as FORMULA's /api/today-orders + `bdd`, so the frontend poll
  // code runs unchanged and only reads the extra key.
  router.get('/api/today-orders', deps.dataRateLimit, h(async (req, res) => {
    const s = await docsToday();
    res.json({ ok: true, formula: [], iceMish: [], bdd: s ? [...s.custIds] : [] });
  }));

  // Line coverage: denominator = agent's line today (משטח_ICE + in-app day moves, bddLineFor),
  // numerator/sum = what that agent executed today (BDD families). Same shape as FORMULA.
  router.get('/api/team-order-stats', deps.dataRateLimit, h(async (req, res) => {
    if (needCache(res)) return;
    const s = await docsToday();
    const todayDay = deps.todayRouteDay();
    const byAgent = {}, byManager = {};
    const overrides = readJson(FILES.overrides, {});
    for (const [group, agents] of cache.agentsByGroup) {
      const acc = { denom: 0, numer: 0, sum: 0, offLine: 0 };
      for (const a of agents) {
        const d = s?.byAgent.get(a.agentCode);
        const served = new Set((d?.byClient || []).map(c => String(c.custId)));
        // offLine: served today but not in today's line — shown next to the % (user 2026-09-30), % itself unchanged.
        const { planned: denom, offLine } = coverageCounts(bddLineFor(a.agentCode, todayDay, overrides), served);
        byAgent[a.agentCode] = { denom, numer: d?.custCount || 0, sum: d?.sum || 0, offLine };
        acc.denom += denom; acc.numer += byAgent[a.agentCode].numer; acc.sum += byAgent[a.agentCode].sum; acc.offLine += offLine;
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
      items: [], byAgent: [],
      byClient: (a?.byClient || []).map(c => ({ ...c, custName: cache?.clientById.get(c.custId)?.custName || '' })) });
  }));

  // --- write routes (Task 8) ---
  // Stored day-move client = the fields BDD /customers returns (the frontend sends back
  // that same object), as capped primitives. Numbers keep null (lat/lng/dayNum can be null).
  const MOVED_STR = ['custId', 'custName', 'city', 'address', 'fullAddress', 'agentCode', 'agentName', 'manager',
    'clientType', 'hevra', 'dayLabel', 'gpsSource', 'lastOrderDate'];
  const MOVED_NUM = ['lat', 'lng', 'dayNum', 'priorityOrder', 'target', 'pct', 'monthlySales', 'avg6Sales', 'avg6Orders', 'avg6IceSales'];
  const cleanMovedClient = c => {
    const o = {};
    for (const k of MOVED_STR) if (c[k] != null) o[k] = String(c[k]).slice(0, 200);
    for (const k of MOVED_NUM) { const n = c[k] == null || c[k] === '' ? null : Number(c[k]); o[k] = Number.isFinite(n) ? n : null; }
    o.iceOnly = !!c.iceOnly;
    return o;
  };
  router.post('/api/route-day-move', deps.dayMoveRateLimit, h(async (req, res) => {
    const { custId, day, client, agentCode } = req.body || {};
    const a = String(agentCode || '');
    if (!validAgent(a)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
    if (!bddCanWrite(req.session, a, cache)) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (typeof custId !== 'string' || !validCust(custId)) return res.status(400).json({ ok: false, error: 'invalid custId' });
    const dayNum = parseInt(day, 10);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 5) return res.status(400).json({ ok: false, error: 'invalid day' });
    const id = custId.slice(0, 20);
    await withBddLock(() => {
      const data = readJson(FILES.overrides, {});
      if (!data[a]) data[a] = { order: {}, dayMoves: {} };
      if (client && typeof client === 'object') data[a].dayMoves[id] = { day: dayNum, client: cleanMovedClient(client), movedAt: new Date().toISOString() };
      else delete data[a].dayMoves[id]; // no client payload = moved back to its original day
      writeJson(FILES.overrides, data);
    });
    deps.writeLog({ ts: new Date().toISOString(), event: 'route-day-move-bdd', agentCode: a, custId: id, day: dayNum, ip: deps.getRealIp(req) });
    res.json({ ok: true });
  }));

  router.post('/save-gps', deps.dataRateLimit, h(async (req, res) => {
    const { custId, name, city, address } = req.body || {};
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    if (!custId || !lat || !lng) return res.status(400).json({ error: 'missing custId/lat/lng' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'invalid coordinates' });
    if (!validCust(String(custId))) return res.status(400).json({ error: 'invalid custId' });
    if (!deps.isValidIL(lat, lng)) return res.status(400).json({ error: 'coordinates outside Israel' });
    const client = cache?.clientById.get(String(custId));
    if (!client || !bddCanWrite(req.session, client.agentCode, cache)) return res.status(403).json({ error: 'forbidden' });
    const total = await withBddLock(() => {
      const current = readJson(FILES.gps, {});
      current[String(custId)] = { lat, lng, correctedAt: new Date().toISOString(), name: String(name || '').slice(0, 200), city: String(city || '').slice(0, 200), address: String(address || '').slice(0, 200) };
      writeJson(FILES.gps, current);
      return Object.keys(current).length;
    });
    gpsMemo = null; // the new 📍 point must show on the very next /customers
    res.json({ ok: true, total });
  }));

  // Only the fields docs/mekarer-order.html collectRef() sends, as plain primitives —
  // nothing object-shaped (e.g. {formula:...}) can reach ExcelJS or the email.
  const str = (x, n = 100) => String(x || '').slice(0, n);
  const cleanMekarer = m => ({
    action: str(m?.action), newModel: str(m?.newModel), newModelName: str(m?.newModelName),
    returnModel: str(m?.returnModel), returnModelName: str(m?.returnModelName),
    salot: Number(m?.salot) || 0, agala: !!m?.agala, supplyDate: str(m?.supplyDate),
    fault: str(m?.fault, 500), // free-text textarea — longer cap than the other fields
  });

  router.post('/api/mekarer-order', deps.dataRateLimit, h(async (req, res) => {
    const body = req.body || {};
    const client = cache?.clientById.get(String(body.custId || ''));
    if (!client || !bddCanWrite(req.session, client.agentCode, cache)) return res.status(403).json({ error: 'forbidden' });
    const order = {
      channel: 'ICE BDD', custId: client.custId, custName: client.custName, city: client.city, agentName: client.agentName, manager: client.manager,
      contactName: String(body.contactName || '').substring(0, 80), phone: String(body.phone || '').substring(0, 20),
      location: String(body.location || '').substring(0, 200),
      mekarerim: Array.isArray(body.mekarerim) ? body.mekarerim.slice(0, 50).map(cleanMekarer) : [],
    };
    const id = Date.now();
    await withBddLock(() => {
      const list = readJson(FILES.mekarer, []);
      list.push({ id, ...order, submittedAt: new Date().toISOString(), managerId: req.session.managerId || null });
      writeJson(FILES.mekarer, list);
    });
    deps.writeLog({ ts: new Date().toISOString(), event: 'mekarer-order-bdd', id, custId: order.custId, managerId: req.session.managerId || null, ip: deps.getRealIp(req) });
    res.json({ ok: true, id });
    // Dark-launch test account: its orders go to Dan only, never to the real recipients.
    const to = req.session.managerId === BDD_TEST_MANAGER_ID ? [BDD_TEST_EMAIL] : (process.env.NOTIFY_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
    if (deps.resend && to.length) sendMekarerEmail(order, id, to).catch(e => console.error('[mekarer-bdd] email', e.message));
  }));

  router.get('/api/promo-cust-ids', deps.dataRateLimit, h(async (req, res) => {
    const today = deps.todayIsraelDate();
    // failedAt: a failed query (null) is retried at most every 10 min, not on every request.
    if (promoIdsCache.date !== today && cache && Date.now() - promoIdsCache.failedAt > 10 * 60 * 1000) {
      const rows = await bddCustFamiliesWithActivePromo(DB());
      if (rows) promoIdsCache = { date: today, ids: [...new Set(rows.filter(r => cache.families.has(r.familyDes)).map(r => r.custId))], failedAt: 0 };
      else promoIdsCache.failedAt = Date.now();
    }
    // Key names match FORMULA's response; BDD clients are flagged through iceMish.
    // Frontend just unions formula[]+iceMish[] into one Set regardless of hevra
    // (docs/formula-road.html ~1523), so no per-row hevra filter is needed here.
    res.json({ ok: true, formula: [], iceMish: promoIdsCache.ids });
  }));

  // Same item shape as FORMULA's /api/client-promos (sku, name, price, qty, fromDate,
  // toDate, promoType, company) — ean/notBoughtIn90d are tolerated as undefined
  // by the promo modal (docs/formula-road.html ~4390-4400), so they're left out on
  // purpose (no extra PBI last-ship calls — quota). imgUrl comes from the once-a-day
  // promoImgMap() above (user 2026-09-29: photos like FORMULA). `stock` is NOT in that
  // tolerated list: the modal buckets by `p.stock >= 1` / `p.stock < 1`
  // (~4404-4405), and `undefined` satisfies neither comparison, so the card would
  // silently vanish from both buckets. BDD carries its own stock on the van, so
  // every item is reported as in-stock (stock: 1) instead of spending a PBI MLAY
  // lookup we were told not to make.
  router.get('/api/client-promos/:custId', h(async (req, res) => {
    const custId = String(req.params.custId || '').trim();
    if (!validCust(custId)) return res.status(400).json({ ok: false, error: 'invalid custId' });
    const [rows, imgMap] = await Promise.all([bddClientPromos(DB(), custId), promoImgMap()]);
    const promos = rows
      .filter(p => cache?.families.has(p.familyDes))
      .map(({ familyDes, ...p }) => ({ ...p, stock: 1, imgUrl: imgMap.get(p.sku) || '' }));
    res.json({ ok: true, promos });
  }));

  // Fridge order email — copied verbatim from FORMULA's /api/mekarer-order handler
  // (index.js ~3298-3428: Excel build + resend.emails.send), only: title/subject say
  // "ICE BDD", first Excel info row is ['ערוץ','ICE BDD']. The FORMULA block also CCs
  // whoever submitted the order (findAgentSubmitterEmail, index.js ~985) — that
  // helper reads managers.json/loadManagerRoster + an xlsx agent-email roster, both
  // index.js-only state; dropped here rather than added to deps, since a BDD order
  // always comes from a manager session already named in the email body (order.manager)
  // and losing the CC doesn't lose any information, just an extra recipient.
  async function sendMekarerEmail(order, id, to) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'COLUMBUS'; wb.created = new Date();
    const ws = wb.addWorksheet('הזמנת מקרר', { views: [{ rightToLeft: true }] });

    const BLUE = '1A3F7C', WHITE = 'FFFFFF', LGRAY = 'F2F4F7', DGRAY = '555555';
    const hFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BLUE } };
    const gFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + LGRAY } };
    const boldW  = { bold: true, color: { argb: 'FF' + WHITE }, size: 12 };
    const boldB  = { bold: true, size: 11 };
    const gray   = { color: { argb: 'FF' + DGRAY }, size: 10 };

    // Title row — centerContinuous instead of merge
    const nowStr = new Date().toLocaleString('he-IL');
    const title = ws.getCell('A1');
    title.value = `הזמנת מקרר חדשה — ICE BDD — ${order.custName}`;
    title.font = { ...boldW, size: 14 }; title.fill = hFill;
    title.alignment = { horizontal: 'centerContinuous', vertical: 'middle' };
    ws.getRow(1).height = 32;

    // Info rows — no merge, label col A, value col B
    const info = [
      ['ערוץ', 'ICE BDD'],
      ['לקוח', order.custName], ['מספר לקוח', String(order.custId || '')], ['עיר', order.city],
      ['סוכן', order.agentName], ['מנהל', order.manager],
      ['איש קשר', order.contactName], ['טלפון', order.phone],
      ['מיקום', order.location],
      ['תאריך הזמנה', nowStr],
      ['מספר הזמנה', String(id)],
    ];
    info.forEach(([label, val], i) => {
      const r = i + 2;
      const altFill = i % 2 === 0 ? gFill : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      const lCell = ws.getCell(`A${r}`); lCell.value = label;
      lCell.font = gray; lCell.alignment = { horizontal: 'right' };
      lCell.fill = altFill;
      const vCell = ws.getCell(`B${r}`); vCell.value = val || '';
      vCell.font = i === 0 ? boldB : { size: 11 };
      vCell.alignment = { horizontal: 'right' };
      vCell.fill = altFill;
    });

    // Gap row
    const gapR = info.length + 2;
    ws.getRow(gapR).height = 8;

    // Equipment header
    const eqHdrR = gapR + 1;
    const eqCols = ['פעולה', 'דגם', 'סלסלות', 'עגלה', 'תאריך אספקה', 'דגם החזרה', 'תקלה'];
    eqCols.forEach((h, ci) => {
      const cell = ws.getCell(eqHdrR, ci + 1);
      cell.value = h; cell.font = boldW; cell.fill = hFill;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });
    ws.getRow(eqHdrR).height = 22;

    // Equipment rows
    order.mekarerim.forEach((m, i) => {
      const r = eqHdrR + 1 + i;
      const modelStr = m.newModelName || m.newModel || '';
      const returnStr = m.returnModelName || m.returnModel || '';
      const rowVals = [m.action || '', modelStr, m.salot || 0, m.agala ? '✓' : '', m.supplyDate || '', returnStr, m.fault || ''];
      const rowFill = i % 2 === 0 ? gFill : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      rowVals.forEach((v, ci) => {
        const cell = ws.getCell(r, ci + 1); cell.value = v; cell.fill = rowFill;
        cell.alignment = { horizontal: (ci === 2 || ci === 3) ? 'center' : 'right', vertical: 'middle' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } };
      });
      ws.getRow(r).height = 20;
    });

    // Column widths
    [28, 38, 8, 8, 16, 32, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    // Freeze header row + autofilter
    ws.views[0].state = 'frozen'; ws.views[0].ySplit = eqHdrR;
    ws.autoFilter = { from: { row: eqHdrR, column: 1 }, to: { row: eqHdrR, column: 7 } };

    const xlsBuf = await wb.xlsx.writeBuffer();
    const xlsB64 = Buffer.from(xlsBuf).toString('base64');
    const safeDate = new Date().toISOString().slice(0, 10);
    const safeName = (order.custName || 'order').replace(/[^\w֐-׿ ]/g, '').trim().slice(0, 30);

    // ── HTML rows ────────────────────────────────────────────────
    const mekarerRows = order.mekarerim.map(m => {
      const modelStr = m.newModel ? `${escEmail(m.newModel)}${m.newModelName && m.newModelName !== m.newModel ? ' — ' + escEmail(m.newModelName) : ''}` : '';
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escEmail(m.action)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${modelStr}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${Number(m.salot || 0)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${m.agala ? '✓' : ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escEmail(m.supplyDate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escEmail(m.fault)}</td>
      </tr>`;
    }).join('');

    await deps.resend.emails.send({
      from: `AI Analytics Assistant <${process.env.RESEND_FROM || 'orders@sverdlik-apps.site'}>`,
      to,
      subject: `[ICE BDD] הזמנת מקרר חדשה — ${order.custName} (${order.city})`,
      attachments: [{ filename: `mekarer-bdd-${safeDate}-${safeName}.xlsx`, content: xlsB64 }],
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<h2 style="background:#1A3F7C;color:#fff;padding:16px;border-radius:8px 8px 0 0;margin:0">🧊 הזמנת מקרר חדשה — ICE BDD</h2>
<div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:20px">
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
<tr><td style="color:#666;padding:4px 0;width:120px">ערוץ</td><td style="font-weight:bold">ICE BDD</td></tr>
<tr><td style="color:#666;padding:4px 0">לקוח</td><td style="font-weight:bold">${escEmail(order.custName)}</td></tr>
<tr><td style="color:#666;padding:4px 0">מספר לקוח</td><td>${escEmail(order.custId || '')}</td></tr>
<tr><td style="color:#666;padding:4px 0">עיר</td><td>${escEmail(order.city)}</td></tr>
<tr><td style="color:#666;padding:4px 0">סוכן</td><td>${escEmail(order.agentName)}</td></tr>
<tr><td style="color:#666;padding:4px 0">מנהל</td><td>${escEmail(order.manager)}</td></tr>
<tr><td style="color:#666;padding:4px 0">איש קשר</td><td>${escEmail(order.contactName)}</td></tr>
<tr><td style="color:#666;padding:4px 0">טלפון</td><td style="text-align:right">${escEmail(order.phone)}</td></tr>
<tr><td style="color:#666;padding:4px 0">מיקום</td><td>${escEmail(order.location)}</td></tr>
</table>
<h3 style="margin:16px 0 8px">ציוד</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="background:#f5f5f5"><th style="padding:6px 8px;text-align:right">פעולה</th><th style="padding:6px 8px;text-align:right">דגם</th><th style="padding:6px 8px;text-align:center">סלסלות</th><th style="padding:6px 8px;text-align:center">עגלה</th><th style="padding:6px 8px;text-align:right">תאריך אספקה</th><th style="padding:6px 8px;text-align:right">תקלה</th></tr>
${mekarerRows}
</table>
<p style="margin-top:16px;font-size:12px;color:#aaa">📎 מצורף קובץ Excel · מזהה: ${id} · ${new Date().toLocaleString('he-IL')}</p>
</div></div>`,
    });
  }

  // Coverage snapshot rows for one date (PRD/coverage-history-design.md).
  // Queries Priority directly for that date — independent of the 75 s docsToday cache.
  // BDD families only (summarizeBddDocs) — channels never mix (user 2026-09-30).
  async function coverageRows(dateStr, dayNum) {
    if (!cache) throw new Error('bdd cache not loaded');
    const summary = summarizeBddDocs(await bddDocLinesToday(DB(), dateStr), cache.families);
    const overrides = readJson(FILES.overrides, {});
    const rows = [];
    for (const [group, agents] of cache.agentsByGroup) {
      if (COVERAGE_EXCLUDED_TEAMS.has(group)) continue;
      for (const a of agents) {
        const d = summary.byAgent.get(a.agentCode);
        const served = new Set((d?.byClient || []).map(c => String(c.custId)));
        const line = bddLineFor(a.agentCode, dayNum, overrides);
        rows.push({ date: dateStr, channel: 'bdd', agentCode: String(a.agentCode), agentName: a.agentName || '', team: group, dayNum,
          ...coverageCounts(line, served), clients: coverageClients(line, served, id => cache.clientById.get(id)?.custName) });
      }
    }
    return rows;
  }

  return { router, start, coverageRows, ready: () => !!cache };
}

module.exports = { createBdd };
