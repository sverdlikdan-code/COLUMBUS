require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');
const { executeDax, getDatasetRefreshTime } = require('./powerbi');
const { custIdsWithOpenOrderToday, iceMishCustIdsWithOpenOrderToday, dayClosingSummary, dayClosingSellout, dayClosingByAgentAll, dayClosingOrdersToday, liveOrderGpsForNewClient } = require('./priority-db');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── SERVER ENVIRONMENT ─────────────────────────────────────────────────────
// Declared at top to prevent TDZ if code order changes during refactors
const IS_LOCAL = process.platform === 'win32';
const VPS_URL  = 'https://api.sverdlik-apps.site';

// ── PBI CACHE ──────────────────────────────────────────────────────────────
// Single source of truth: all client/agent/manager data loaded from Power BI
// at startup and refreshed daily. Endpoints serve from memory → <5ms latency.

const DAY_HE_TO_NUM = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5 };

let pbiCache = null; // set by loadPBICache()

// Per-client zikuy/return-form data (products, 3mo return%, last shipment) —
// safe to cache for a full day: today's sales can't affect what a client can
// return (can't return what hasn't shipped yet, confirmed by user 2026-08-24).
// Cleared only on a SUCCESSFUL daily pbiCache reload (see _loadPBICacheAttempt)
// so a failed/retrying reload doesn't wipe still-valid cached returns data.
const clientReturnsCache = new Map(); // custId -> { data, at: Date }

// Per-client ניתוח לקוח (family breakdown, YoY trend, chain gaps) — same reasoning
// as clientReturnsCache: this app has no real-time data source anywhere (the PBI
// dataset itself only refreshes on its own schedule), so a live DAX call here never
// returns anything fresher than what's already cached until the next daily reload.
// Confirmed by user 2026-08-24. Cleared on the same successful-reload hook.
const clientAnalyticsCache = new Map(); // `${custId}_${lang}` -> { data, at: Date }

// One retry after a long pause, not a hammering loop — Power BI has bitten us with
// 429 rate-limits before (see PM2 logs, 2026-08-17), so a fast retry burst risks
// making a real overload worse instead of recovering from a transient 500 like the
// one that left pbiCache null for 27 minutes on 2026-08-19. If the retry also fails,
// give up exactly like before (next scheduled reload at 06:00, or /admin/reload-cache).
async function loadPBICache() {
  try {
    await _loadPBICacheAttempt();
  } catch (err) {
    console.error('[PBI] Cache load error (attempt 1):', err.message);
    console.log('[PBI] Retrying in 35s...');
    await new Promise(r => setTimeout(r, 35000));
    try {
      await _loadPBICacheAttempt();
    } catch (err2) {
      console.error('[PBI] Cache load error (retry failed):', err2.message);
    }
  }
}

async function _loadPBICacheAttempt() {
  console.log('[PBI] Loading cache...');
  {
    // A: All active clients + targets from 'משטח'
    const clientRows = await executeDax(`
EVALUATE
ADDCOLUMNS(
  FILTER('משטח', 'משטח'[סטטוס] = "פעיל"),
  "target", CALCULATE([יעד $])
)
`);

    // B: Visit schedule from 'משטח עם כפולות' (one row per customer-day)
    const schedRows = await executeDax(`
EVALUATE
SELECTCOLUMNS(
  'משטח עם כפולות',
  "custId",     'משטח עם כפולות'[מס.לקוח],
  "day",        'משטח עם כפולות'[יום],
  "visitOrder", 'משטח עם כפולות'[סדר ביקור]
)
`);

    // Family → company classification (FORMULA/ICE_MISH/INTER/ICE_BDD) — same מחלקה
    // substring pattern already used elsewhere (day-briefing, sadran chain-products).
    // lastOrderDate below must stay scoped to FORMULA+ICE_MISH only: an ICE בודדים
    // (ICE_BDD) purchase is a different channel/agent entirely and shouldn't make a
    // FORMULA/ICE-MISH client look recently active on the route list. Live bug found
    // 2026-08-25: נורית נבון showed "24.08" sourced from an ICE_BDD invoice while her
    // real FORMULA/ICE-MISH last order was 14.06 — the unscoped MAX(ALL_PARTS[תאריך])
    // below had no family filter at all, unlike every other last-order query in this
    // file (see daxLastOrder in the day-briefing section, which already does this).
    const famRows = await executeDax(`
EVALUATE
ADDCOLUMNS(
  SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
  "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר])
)
`);
    const LASTORDER_INTER_CATS = new Set(['מדף', 'מתוקים  🍬']);
    const classifyLastOrderCompany = (machlaka) => {
      if (!machlaka) return null;
      if (machlaka.includes('mish')) return 'ICE_MISH';
      if (machlaka.includes('bdd')) return 'ICE_BDD';
      if (LASTORDER_INTER_CATS.has(machlaka)) return 'INTER';
      return 'FORMULA';
    };
    const lastOrderFamilies = famRows
      .filter(r => ['FORMULA', 'ICE_MISH'].includes(classifyLastOrderCompany(r['[מחלקה]'] || '')))
      .map(r => r['ALL_PARTS[תאור משפחת מוצר]'])
      .filter(Boolean);
    const escFam = f => `"${String(f).replace(/"/g, '""')}"`;
    const lastOrderFamFilter = `ALL_PARTS[תאור משפחת מוצר] IN {${(lastOrderFamilies.length ? lastOrderFamilies : ['__none__']).map(escFam).join(', ')}}`;

    // C: Current month sales + overall last order date per customer from ALL_PARTS
    const [salesRows, lastOrderRows] = await Promise.all([
      executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "monthlySales", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]),
    "lastDate",     CALCULATE(MAX(ALL_PARTS[תאריך]))
  ),
  MONTH(ALL_PARTS[תאריך]) = MONTH(TODAY()),
  YEAR(ALL_PARTS[תאריך])  = YEAR(TODAY())
)
`),
      executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "lastOrderDate", CALCULATE(MAX(ALL_PARTS[תאריך]))
  ),
  ${lastOrderFamFilter},
  ALL_PARTS[ASHMADOT] = "-מכר-"
)
`),
    ]);

    // Build client map: custId → client object
    const clientMap = new Map();
    for (const r of clientRows) {
      const custId = String(r['משטח[מס. לקוח]'] || '');
      if (!custId) continue;
      const rawAddr = r['משטח[כתובת]'] || '';
      const rawCity = r['משטח[עיר]'] || '';
      clientMap.set(custId, {
        custId,
        custName:  fixBiDi(r['משטח[שם לקוח]']  || ''),
        city:      expandCityAbbrev(fixBiDi(rawCity)),
        address:   expandCityAbbrev(fixBiDiAddress(rawAddr)),
        lat:       r['משטח[קו רוחב]']  || null,
        lng:       r['משטח[קו אורך]']  || null,
        status:     r['משטח[סטטוס]']   || '',
        hevra:      r['משטח[HEVRA]']      || 'FORMULA',
        kosher:     r['משטח[כשרות]']   || '',
        saleType:   r['משטח[סוג מכירה]'] || '',
        clientType: fixBiDi(r['משטח[סוג לקוח]'] || ''),
        param7:    r['משטח[פרמטר 7]'] || null,
        agentCode: r['משטח[סוכן]']    || '',
        agentName: fixBiDi(r['משטח[שם סוכן]'] || ''),
        manager:   r['משטח[קבוצה]']   || '',
        sadran:    r['משטח[שם סדרן]'] || '',
        target:    Math.round(parseFloat(r['[target]']) || 0),
        monthlySales:  0,
        avg6Sales:     0,
        avg6Orders:    0,
        avg6IceSales:  0,
        lastOrderDate: null,
      });
    }

    // Build lastOrderMap from all-time query (no month filter)
    const lastOrderMap = new Map();
    for (const r of (lastOrderRows || [])) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      const d = r['[lastOrderDate]'];
      if (custId && d) lastOrderMap.set(custId, new Date(d).toISOString().slice(0, 10));
    }

    // Build salesMap for all custIds (used for both FORMULA and ICE)
    const salesMap = new Map();
    for (const r of salesRows) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      if (!custId) continue;
      salesMap.set(custId, {
        monthlySales: Math.round(parseFloat(r['[monthlySales]']) || 0),
        lastOrderDate: lastOrderMap.get(custId) || null,
      });
    }
    // Also populate lastOrderDate for clients not in salesRows (no current month sales)
    for (const [custId, lastDate] of lastOrderMap) {
      if (!salesMap.has(custId)) salesMap.set(custId, { monthlySales: 0, lastOrderDate: lastDate });
    }

    // Merge sales into clientMap (FORMULA clients)
    for (const [custId, c] of clientMap) {
      const s = salesMap.get(custId);
      if (!s) continue;
      c.monthlySales  = s.monthlySales;
      c.lastOrderDate = s.lastOrderDate;
    }

    // D: Avg sales + order days per client — last 6 complete months
    const _now = new Date();
    const _d6s = new Date(_now.getFullYear(), _now.getMonth() - 6, 1);
    const _d6e = new Date(_now.getFullYear(), _now.getMonth(), 0);
    const d6start = `DATE(${_d6s.getFullYear()},${_d6s.getMonth()+1},1)`;
    const d6end   = `DATE(${_d6e.getFullYear()},${_d6e.getMonth()+1},${_d6e.getDate()})`;
    const avg6Rows = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "avg6Sales",  DIVIDE(CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]), 6),
    "avg6Orders", DIVIDE(CALCULATE(DISTINCTCOUNT(ALL_PARTS[תאריך])), 6)
  ),
  ALL_PARTS[תאריך] >= ${d6start},
  ALL_PARTS[תאריך] <= ${d6end}
)
`);
    for (const r of avg6Rows) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      const c = clientMap.get(custId);
      if (!c) continue;
      c.avg6Sales  = Math.round(parseFloat(r['[avg6Sales]'])  || 0);
      c.avg6Orders = Math.round(parseFloat(r['[avg6Orders]']) || 0);
    }

    // E: ICE MISH avg6 — משפחתי גלידה families only (BiDi stored as יתחפשמ)
    const avg6IceRows = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "avg6IceSales", DIVIDE(CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]), 6)
  ),
  ALL_PARTS[תאריך] >= ${d6start},
  ALL_PARTS[תאריך] <= ${d6end},
  SEARCH("יתחפשמ", ALL_PARTS[תאור משפחת מוצר], 1, 0) > 0
)
`);
    for (const r of avg6IceRows) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      const c = clientMap.get(custId);
      if (!c) continue;
      c.avg6IceSales = Math.round(parseFloat(r['[avg6IceSales]']) || 0);
    }

    // Build schedule map: custId → [{dayNum, dayLabel, visitOrder}]
    const schedMap = new Map();
    for (const r of schedRows) {
      const custId = String(r['[custId]'] || '');
      if (!custId) continue;
      const day = fixBiDi(r['[day]'] || '');
      const dayNum = DAY_HE_TO_NUM[day] || null;
      // Priority day "ש" (Saturday) isn't a Formula Road work day (Sun-Thu only) —
      // clients with only a Saturday schedule row must fall through to the "?"
      // (noScheduleByAgent) bucket below, not disappear from every day tab.
      if (dayNum === null) continue;
      if (!schedMap.has(custId)) schedMap.set(custId, []);
      schedMap.get(custId).push({ dayNum, dayLabel: day, visitOrder: parseInt(r['[visitOrder]']) || 999 });
    }
    // Build byAgent map: agentCode → sorted array of {client+schedule}
    const byAgent = new Map();
    for (const [custId, scheds] of schedMap) {
      const c = clientMap.get(custId);
      if (!c || !c.agentCode) continue;
      for (const s of scheds) {
        if (!byAgent.has(c.agentCode)) byAgent.set(c.agentCode, []);
        byAgent.get(c.agentCode).push({
          ...c,
          dayNum:        s.dayNum,
          dayLabel:      s.dayLabel,
          priorityOrder: s.visitOrder,
          fullAddress:   [c.address, c.city, 'ישראל'].filter(Boolean).join(', '),
          pct: c.target > 0 ? Math.round((c.monthlySales / c.target) * 100) : 0,
        });
      }
    }
    for (const [, arr] of byAgent) {
      arr.sort((a, b) => (a.priorityOrder - b.priorityOrder) || a.custId.localeCompare(b.custId));
    }

    // Formula clients with NO scheduled day (not in meshtat im kfulot) → appear under day=0 "לא מוגדר"
    const scheduledIds = new Set(schedMap.keys());
    const noScheduleByAgent = new Map();
    for (const [custId, c] of clientMap) {
      if (!c.agentCode || scheduledIds.has(custId)) continue;
      if (!noScheduleByAgent.has(c.agentCode)) noScheduleByAgent.set(c.agentCode, []);
      noScheduleByAgent.get(c.agentCode).push({
        ...c,
        dayNum: null,
        dayLabel: '',
        priorityOrder: 9500,
        fullAddress: [c.address, c.city, 'ישראל'].filter(Boolean).join(', '),
        pct: c.target > 0 ? Math.round((c.monthlySales / c.target) * 100) : 0,
      });
    }
    const totalNoSched = [...noScheduleByAgent.values()].reduce((s,a)=>s+a.length,0);
    if (totalNoSched) console.log(`[PBI] Formula clients without scheduled day: ${totalNoSched}`);

    // Build managers list and agents-per-manager
    const managers = new Set();
    const agentsByManager = new Map();
    for (const [, c] of clientMap) {
      if (!c.manager) continue;
      managers.add(c.manager);
      if (!agentsByManager.has(c.manager)) agentsByManager.set(c.manager, new Map());
      const agMap = agentsByManager.get(c.manager);
      if (c.agentCode && !agMap.has(c.agentCode)) {
        agMap.set(c.agentCode, { agentCode: c.agentCode, agentName: c.agentName });
      }
    }

    // Agents whose clients ALL have empty קבוצה (no manager) → they ARE managers → see everything
    const managerAgents = new Set();
    for (const [agentCode, clients] of byAgent) {
      if (clients.length > 0 && clients.every(c => !c.manager)) managerAgents.add(agentCode);
    }

    // D: ICE-only clients — secondary agent (מס.סוכן נוסף) = Formula agent code
    // These clients are NOT in Formula meshtat but are visited by Formula agents in ICE territory
    const ICE_DS = process.env.POWERBI_ICE_DATASET_ID;
    const iceByAgent = new Map(); // agentCode → [{client obj, iceOnly:true}]
    if (ICE_DS) {
      try {
        const iceRows = await executeDax(`
EVALUATE
SELECTCOLUMNS(
  FILTER('MISHPAHTI ICE MISHTAH',
    LEN('MISHPAHTI ICE MISHTAH'[שם סוכן נוסף]) > 0
  ),
  "custId",    'MISHPAHTI ICE MISHTAH'[מס. לקוח],
  "custName",  'MISHPAHTI ICE MISHTAH'[שם לקוח],
  "city",      'MISHPAHTI ICE MISHTAH'[עיר],
  "address",   'MISHPAHTI ICE MISHTAH'[כתובת],
  "agentCode", 'MISHPAHTI ICE MISHTAH'[מס.סוכן נוסף],
  "dayLetter", 'MISHPAHTI ICE MISHTAH'[פרמטר 18]
)
`, ICE_DS);

        const ICE_DAY_MAP = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5 };
        for (const r of iceRows) {
          const custId    = String(r['[custId]'] || '');
          const agentCode = String(r['[agentCode]'] || '');
          if (!custId || !agentCode || agentCode === 'null') continue;
          const dayLetter = (r['[dayLetter]'] || '').trim();
          const dayNum    = ICE_DAY_MAP[dayLetter] || null; // null = no day assigned
          // Skip if already in Formula meshtat
          if (clientMap.has(custId)) continue;

          const rawCity = r['[city]'] || '';
          const rawAddr = r['[address]'] || '';
          const city    = expandCityAbbrev(fixBiDi(rawCity));
          // 'MISHPAHTI ICE MISHTAH' (unlike 'משטח') carries no LRO markers, so
          // fixBiDiAddress's word-reversal branch never runs — but the source
          // still stores house-number digit runs pre-reversed (e.g. "180"→"081",
          // confirmed live 2026-08-30 on 251/2922 rows via the leading-zero tell;
          // the rest are equally corrupted, just undetectable from the pattern
          // alone). Un-reverse digits here only when there's no LRO marker —
          // if one IS present, fixBiDiAddress already re-reversed them correctly.
          const hasLRO  = /[‪‭]/.test(rawAddr);
          let   address = expandCityAbbrev(fixBiDiAddress(rawAddr));
          if (!hasLRO) address = address.replace(/\d+/g, mm => mm.split('').reverse().join(''));

          // Inherit agentName + manager from Formula byAgent (same agentCode = מס.סוכן נוסף)
          const _formulaAgentClients = byAgent.get(agentCode);
          const _agentName = _formulaAgentClients?.[0]?.agentName || '';
          const _manager   = _formulaAgentClients?.[0]?.manager   || '';

          if (!iceByAgent.has(agentCode)) iceByAgent.set(agentCode, []);
          iceByAgent.get(agentCode).push({
            custId,
            custName:      fixBiDi(r['[custName]'] || ''),
            city,
            address,
            lat:           null,
            lng:           null,
            agentCode,
            agentName:     _agentName,
            manager:       _manager,
            dayNum,
            dayLabel:      dayLetter,
            priorityOrder: 9000,
            fullAddress:   [address, city, 'ישראל'].filter(Boolean).join(', '),
            target:        0,
            monthlySales:  salesMap.get(custId)?.monthlySales || 0,
            lastOrderDate: salesMap.get(custId)?.lastOrderDate || null,
            avg6Sales:     0,
            avg6Orders:    0,
            avg6IceSales:  0,
            pct:           0,
            hevra:         'ICE',
            iceOnly:       true,
          });
        }
        console.log(`[PBI] ICE clients loaded: ${[...iceByAgent.values()].reduce((s,a)=>s+a.length,0)} across ${iceByAgent.size} agents`);
      } catch (iceErr) {
        console.error('[PBI] ICE load error:', iceErr.message);
      }
    }

    // Patch avg6 sales into ICE-only clients using already-fetched FORMULA ALL_PARTS rows
    const iceClientFlat = new Map();
    for (const arr of iceByAgent.values()) {
      for (const c of arr) iceClientFlat.set(c.custId, c);
    }
    for (const r of avg6Rows) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      const c = iceClientFlat.get(custId);
      if (!c) continue;
      c.avg6Sales  = Math.round(parseFloat(r['[avg6Sales]'])  || 0);
      c.avg6Orders = Math.round(parseFloat(r['[avg6Orders]']) || 0);
    }
    for (const r of avg6IceRows) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      const c = iceClientFlat.get(custId);
      if (!c) continue;
      c.avg6IceSales = Math.round(parseFloat(r['[avg6IceSales]']) || 0);
    }

    // Latest real sale date across the WHOLE company (no client filter) — the actual
    // content-freshness signal, not a REST "last refresh completed" timestamp. If this
    // date stops advancing, either Power BI's own scheduled refresh stalled or nobody
    // actually sold anything, both worth surfacing to the app. Confirmed 2026-08-25:
    // this is what should drive the app's cache-freshness display, not /pbi/formula-refresh.
    let latestSaleDate = null;
    try {
      const maxDateRows = await executeDax(`
EVALUATE
ROW("maxDate", CALCULATE(MAX(ALL_PARTS[תאריך]), ALL_PARTS[ASHMADOT] = "-מכר-"))
`);
      latestSaleDate = maxDateRows[0]?.['[maxDate]'] || null;
    } catch (e) {
      console.error('[PBI] latestSaleDate query failed:', e.message);
    }

    pbiCache = {
      clientMap,
      byAgent,
      iceByAgent,
      noScheduleByAgent,
      managers: [...managers].sort(),
      agentsByManager: new Map([...agentsByManager].map(([k, v]) => [k, [...v.values()]])),
      managerAgents,
      loadedAt: new Date(),
      latestSaleDate,
    };
    clientReturnsCache.clear();
    clientAnalyticsCache.clear();
    console.log(`[PBI] Cache loaded: ${clientMap.size} clients, ${byAgent.size} agents, ${managers.size} managers, ${managerAgents.size} manager-agents`);

    // Geocode ICE clients in background — updates pbiCache.iceByAgent objects in-place
    // so subsequent /customers requests serve pre-geocoded lat/lng without API calls
    const _allIce = [...iceByAgent.values()].flat().filter(c => !c.lat);
    if (_allIce.length > 0) {
      geocodeBatch(_allIce).then(() => {
        const done = _allIce.filter(c => c.lat && c.lng).length;
        console.log(`[PBI] ICE geocode: ${done}/${_allIce.length} with GPS`);
      }).catch(() => {});
    }
  }
}

// Schedule daily reload at 06:00 Israel wall-clock time. The VPS OS clock runs in
// UTC, so a naive setHours(6,0,0,0) on a plain Date fired at 06:00 UTC = 09:00
// Israel in summer DST (confirmed live 2026-08-25) — agents started their morning
// route on yesterday's data for the first 3 hours of the day. Reads Israel's
// current wall-clock hour/minute via Intl (same 'Asia/Jerusalem' pattern as
// todayIsraelDate()) instead of assuming a fixed UTC offset, and reschedules
// itself with a fresh setTimeout after every run (not setInterval) so a DST
// transition self-corrects the next day instead of drifting by an hour.
function msUntilNextIsraelSixAM() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  const nowIsraelMs = (+parts.hour) * 3600000 + (+parts.minute) * 60000 + (+parts.second) * 1000;
  const sixAmMs = 6 * 3600000;
  let diff = sixAmMs - nowIsraelMs;
  if (diff <= 0) diff += 24 * 3600000;
  return diff;
}
function scheduleDailyPBIReload() {
  setTimeout(() => {
    loadPBICache();
    scheduleDailyPBIReload();
  }, msUntilNextIsraelSixAM());
}

const app = express();
app.use(cors({
  origin: [
    'https://sverdlikdan-code.github.io',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:5500',
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Session'],
  credentials: true,
}));
app.use(express.json({ limit: '512kb' }));
app.use((req, res, next) => { if (req.method === 'POST') console.log(`[POST] ${req.path} sess=${req.headers['x-session']?.slice(0,8)||'none'}`); next(); });

// ── HTTP SECURITY HEADERS ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https://nominatim.openstreetmap.org https://router.project-osrm.org; " +
    "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
    "frame-ancestors 'none';"
  );
  next();
});

// ── ACCESS LOGGING ─────────────────────────────────────────────────────────
const ACCESS_LOG = path.join(__dirname, 'access-log.json');

function readLog() {
  try { return JSON.parse(fs.readFileSync(ACCESS_LOG, 'utf8')); } catch { return []; }
}

function writeLog(entry) {
  const log = readLog();
  log.push(entry);
  if (log.length > 2000) log.splice(0, log.length - 2000);
  try { fs.writeFileSync(ACCESS_LOG, JSON.stringify(log, null, 2), 'utf8'); } catch (_) {}
}

function getRealIp(req) {
  return req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || '';
}

function deviceType(ua) {
  if (!ua) return 'unknown';
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return 'mobile';
  return 'desktop';
}

// ── RATE LIMITER ────────────────────────────────────────────────────────────
const loginAttempts = new Map();
const generalRequests = new Map();
const renderRequests = new Map();
const dayMoveRequests = new Map();
// Cleanup expired rate-limit entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) { if (now > rec.resetAt) loginAttempts.delete(ip); }
  for (const [ip, rec] of generalRequests) { if (now > rec.resetAt) generalRequests.delete(ip); }
}, 5 * 60 * 1000);

function checkRateLimit(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) rec = { count: 0, resetAt: now + 60_000 };
  rec.count++;
  loginAttempts.set(ip, rec);
  return rec.count > 10; // block after 10 auth attempts/min
}

// General rate limit: 60 requests/min per IP for data endpoints
function checkGeneralLimit(ip) {
  const now = Date.now();
  let rec = generalRequests.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) rec = { count: 0, resetAt: now + 60_000 };
  rec.count++;
  generalRequests.set(ip, rec);
  return rec.count > 60;
}

const dataRateLimit = (req, res, next) => {
  if (checkGeneralLimit(getRealIp(req))) return res.status(429).json({ error: 'rate_limit' });
  next();
};

// Each request here launches a real headless-browser page (server-side share
// image render) — far more expensive than a typical data endpoint, so the
// generous 60/min general limit above isn't tight enough on its own.
function checkRenderLimit(ip) {
  const now = Date.now();
  let rec = renderRequests.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) rec = { count: 0, resetAt: now + 60_000 };
  rec.count++;
  renderRequests.set(ip, rec);
  return rec.count > 10;
}
const renderRateLimit = (req, res, next) => {
  if (checkRenderLimit(getRealIp(req))) return res.status(429).json({ error: 'rate_limit' });
  next();
};

// route-day-move used to share the 60/min general limit with GET /customers polling —
// an agent bulk-moving a whole day's clients (confirmed live: 16 moves in 250ms) plus
// the app's own background polling could blow through 60/min, and the client silently
// swallowed the 429 (fixed separately in pushDayMove) — a moved client would then
// look "stuck" back on its old day next time the page loaded. This is a small JSON
// write, not worth rationing as tightly as the general budget. Live bug 2026-08-30/31.
function checkDayMoveLimit(ip) {
  const now = Date.now();
  let rec = dayMoveRequests.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) rec = { count: 0, resetAt: now + 60_000 };
  rec.count++;
  dayMoveRequests.set(ip, rec);
  return rec.count > 300;
}
const dayMoveRateLimit = (req, res, next) => {
  if (checkDayMoveLimit(getRealIp(req))) return res.status(429).json({ error: 'rate_limit' });
  next();
};

// ── INPUT VALIDATION ─────────────────────────────────────────────────────────
function validateAgentCode(code) {
  return /^\d{1,10}$/.test(String(code || ''));
}
function validateManagerName(name) {
  // Letters (any), digits, spaces, Hebrew, plus, hyphen — max 60 chars
  return /^[\wא-ת\s+\-]{1,60}$/.test(String(name || ''));
}

// ── SESSION MANAGEMENT ─────────────────────────────────────────────────────
const crypto = require('crypto');
const sessions = new Map(); // token → { agentCode, isManager, expiresAt }

// Sessions persist to disk so a server restart (crash/redeploy/manual
// recovery per CLAUDE.md) doesn't silently invalidate every logged-in
// manager/agent token — without this, restarts force everyone through the
// silent-reauth path, which is broken cross-origin (see /auth/pbi below).
const SESSIONS_FILE = path.join(__dirname, '.sessions.json');

function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    for (const [token, sess] of Object.entries(raw)) {
      if (sess.expiresAt > now) sessions.set(token, sess);
    }
  } catch (_) { /* no file yet or unreadable — start empty */ }
}

let _saveSessionsTimer = null;
function saveSessions() {
  if (_saveSessionsTimer) return;
  _saveSessionsTimer = setTimeout(() => {
    _saveSessionsTimer = null;
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))); }
    catch (_) { /* best-effort */ }
  }, 5000);
}

loadSessions();

function createSession(agentCode, isManager, viaPbi = false, pbiUser = null) {
  const token = crypto.randomUUID();
  const TTL = isManager ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  sessions.set(token, { agentCode, isManager, viaPbi, pbiUser, expiresAt: Date.now() + TTL });
  // Prune expired sessions when map grows large
  if (sessions.size > 500) {
    const now = Date.now();
    for (const [t, s] of sessions) { if (s.expiresAt < now) sessions.delete(t); }
  }
  saveSessions();
  return token;
}

function requireAuth(req, res, next) {
  const token = (req.headers['x-session'] || '').trim();
  const sess = sessions.get(token);
  if (!sess || Date.now() > sess.expiresAt) return res.status(401).json({ error: 'unauthorized' });
  // Rolling session: extend expiry on every use
  const TTL = sess.isManager ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  sess.expiresAt = Date.now() + TTL;

  // Soft device fingerprint — warn, never block. IP alone is useless as a signal
  // here: a field agent's IP legitimately rotates all day (cell tower handoffs
  // between client visits), so IP-based blocking would either lock out real
  // agents constantly or, if lenient, catch nothing. User-Agent is stable per
  // device/browser and is the actual "is this a different device" signal — a
  // forwarded invite link or shared agent code opened elsewhere shows up as a
  // UA change. First authenticated request on a session sets the baseline;
  // later mismatches log once and adopt the new UA as the baseline, so a
  // genuine device switch (new phone) doesn't spam the log on every request after.
  // Skipped entirely for viaPbi sessions — that door is deliberately wide open
  // (anyone who clicks through the PBI report button, from whatever device is
  // on hand in the office, is meant to get in with zero friction).
  if (!sess.viaPbi) {
    const ua = (req.headers['user-agent'] || '').substring(0, 120);
    const ip = getRealIp(req);
    if (!sess.ua) {
      sess.ua = ua;
      sess.ip = ip;
    } else if (sess.ua !== ua) {
      writeLog({
        ts: new Date().toISOString(),
        event: 'device_mismatch',
        agentCode: sess.agentCode || null,
        isManager: !!sess.isManager,
        prevUa: sess.ua, newUa: ua,
        prevIp: sess.ip || null, newIp: ip,
        device: deviceType(ua),
      });
      sess.ua = ua;
      sess.ip = ip;
    }
  }

  saveSessions();
  req.session = sess;
  next();
}

// Agent list cache — loaded from formula-road-data.json (built by GitHub Actions)
let agentListCache = null;
function loadAgentList() {
  if (agentListCache) return agentListCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'formula-road-data.json'), 'utf8');
    const data = JSON.parse(raw);
    if (data.agents && Object.keys(data.agents).length > 0) {
      agentListCache = data.agents;
    } else if (data.agentsByManager) {
      const map = {};
      for (const list of Object.values(data.agentsByManager)) {
        for (const a of list) {
          const c = String(a.agentCode || '');
          if (c && !map[c]) map[c] = { name: a.agentName || '' };
        }
      }
      agentListCache = map;
    } else {
      agentListCache = {};
    }
    return agentListCache;
  } catch { return {}; }
}

// HTML escape helper for log output
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Email HTML escape — prevent XSS in email templates
function escEmail(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// POST /log-access — client sends login/logout events
const LOG_EVENTS = new Set(['login', 'logout']);
app.post('/log-access', requireAuth, dataRateLimit, (req, res) => {
  const { event, agentCode, agentName, isManager } = req.body || {};
  const ip = getRealIp(req);
  writeLog({
    ts: new Date().toISOString(),
    event: LOG_EVENTS.has(event) ? event : 'login',
    agentCode: agentCode ? String(agentCode).substring(0, 20) : null,
    agentName: agentName ? String(agentName).substring(0, 60) : null,
    isManager: !!isManager,
    ip,
    device: deviceType(req.headers['user-agent'] || ''),
    ua: (req.headers['user-agent'] || '').substring(0, 120),
  });
  res.json({ ok: true });
});

// ── Magic-link invite tokens (HMAC-SHA256, no external lib) ─────────────────
const INVITE_SECRET = process.env.INVITE_SECRET;
if (!INVITE_SECRET) { console.error('FATAL: INVITE_SECRET not set in .env'); process.exit(1); }
function signInvite(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = require('crypto').createHmac('sha256', INVITE_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifyInvite(token) {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 1) return null;
    const data = token.slice(0, dot), sig = token.slice(dot + 1);
    const expected = require('crypto').createHmac('sha256', INVITE_SECRET).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch(_) { return null; }
}

function _inviteRedirect(payload, res) {
  // Manager invites (payload.isManager) create a real manager session — full
  // access, not scoped to any single agentCode — same as the /auth/pbi path.
  // payload.code for a manager invite is whatever placeholder was on their row
  // (not a real routable agent), so it's never passed to createSession here.
  const isManager = !!payload.isManager;
  const sessionToken = createSession(isManager ? null : payload.code, isManager);
  const name = encodeURIComponent(payload.name || '');
  const code = encodeURIComponent(payload.code || '');
  const inv  = encodeURIComponent(sessionToken);
  res.setHeader('Set-Cookie', 'fr_ok=1; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=2592000');
  return res.redirect(302, `https://api.sverdlik-apps.site/formula-road?_inv=${inv}&_ac=${code}&_an=${name}&_im=${isManager ? '1' : '0'}`);
}
const _inviteExpiredPage = `<!DOCTYPE html><html><head><meta charset=utf-8><title>קישור לא בתוקף</title></head>
<body style="font-family:Arial;text-align:center;padding:60px;background:#f5f5f5">
<h2 style="color:#c62828">הקישור פג תוקף</h2>
<p style="color:#555">בקש קישור חדש מהמנהל.</p></body></html>`;

// GET /invite/:token — magic link: verify → set cookie → redirect directly to formula-road with params
// formula-road.html reads _inv/_ac/_an from URL params and sets localStorage itself (avoids Custom Tab context split)
app.get('/invite/:token', dataRateLimit, (req, res) => {
  const payload = verifyInvite(req.params.token);
  if (!payload) return res.status(400).send(_inviteExpiredPage);
  return _inviteRedirect(payload, res);
});

// GET /i/:code — short invite link. Same security properties as /invite/:token
// (unguessable random code, server-stored, expires), just short enough to look
// presentable in an email/WhatsApp message instead of a long base64 blob.
const SHORT_INVITE_FILE = path.join(__dirname, 'data', 'short-invites.json');
function loadShortInvites() {
  try { return JSON.parse(fs.readFileSync(SHORT_INVITE_FILE, 'utf8')); } catch { return {}; }
}
function saveShortInvites(map) {
  fs.mkdirSync(path.dirname(SHORT_INVITE_FILE), { recursive: true });
  fs.writeFileSync(SHORT_INVITE_FILE, JSON.stringify(map, null, 2), 'utf8');
}
function makeShortInvite(code, name, days = 30, isManager = false) {
  const map = loadShortInvites();
  const short = crypto.randomBytes(5).toString('base64url'); // ~7 chars, URL-safe
  map[short] = { code, name, exp: Date.now() + days * 24 * 60 * 60 * 1000, isManager };
  saveShortInvites(map);
  return `https://api.sverdlik-apps.site/i/${short}`;
}
app.get('/i/:code', dataRateLimit, (req, res) => {
  const map = loadShortInvites();
  const payload = map[req.params.code];
  if (!payload || Date.now() > payload.exp) return res.status(400).send(_inviteExpiredPage);
  return _inviteRedirect(payload, res);
});

// GET /auth/pbi — auto-login as manager if opened via PBI (fr_ok cookie present)
app.get('/auth/pbi', dataRateLimit, mahsanIpGuard, (req, res) => {
  const cookies = req.headers.cookie || '';
  if (!/(?:^|;\s*)fr_ok=1/.test(cookies)) return res.status(401).json({ ok: false });
  // fr_pbiu is set by formulaRoadGuard from the report button's own ?u= param
  // (meant to carry USERPRINCIPALNAME() from a DAX-built deep link) — lets us
  // attribute an anonymous PBI-manager session to a real viewer, not just an IP.
  const m = cookies.match(/(?:^|;\s*)fr_pbiu=([^;]+)/);
  const pbiUser = m ? decodeURIComponent(m[1]) : null;
  const token = createSession(null, true, true, pbiUser);
  writeLog({ ts: new Date().toISOString(), event: 'login-pbi', pbiUser, ip: getRealIp(req) });
  return res.json({ ok: true, token });
});

// POST /auth — unified login: manager password OR agent code → returns session token
app.post('/auth', (req, res) => {
  const ip = getRealIp(req);
  if (checkRateLimit(ip)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  const { code } = req.body || {};
  const codeStr = String(code || '').trim();

  // Super-manager password (sees ALL managers + ALL agents)
  const MANAGER_PASS = process.env.MANAGER_PASS;
  if (MANAGER_PASS && codeStr === MANAGER_PASS) {
    loginAttempts.delete(ip);
    return res.json({ ok: true, type: 'manager', token: createSession(null, true) });
  }

  // Agent code check — validate against formula-road-data.json
  const agents = loadAgentList();
  const agent = agents[codeStr];
  if (agent) {
    loginAttempts.delete(ip);
    // If this agent's clients have no manager (empty קבוצה) → they ARE a manager → see everything
    if (pbiCache?.managerAgents?.has(codeStr)) {
      return res.json({ ok: true, type: 'manager', token: createSession(null, true) });
    }
    return res.json({ ok: true, type: 'agent', agentCode: codeStr, agentName: agent.name, token: createSession(codeStr, false) });
  }

  res.json({ ok: false, error: 'invalid_code' });
});

// GET /admin/logs?key=KEY — view access log
app.get('/admin/logs', dataRateLimit, (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_LOG_KEY || '';
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });
  const log = readLog().slice(-300).reverse();
  const html = req.headers.accept?.includes('text/html');
  if (html) {
    const rows = log.map(e => {
      const d = new Date(e.ts);
      const local = d.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', hour12: false });
      if (e.event === 'device_mismatch') {
        return `<tr class="warn-row">
          <td>${esc(local)}</td>
          <td>⚠️ device_mismatch</td>
          <td>${e.isManager ? '👑 מנהל' : ''} ${e.agentCode ? `(${esc(e.agentCode)})` : ''}</td>
          <td>${esc(e.prevIp || '')} → ${esc(e.newIp || '')}</td>
          <td title="${esc(e.prevUa || '')} → ${esc(e.newUa || '')}">${esc(e.device)} (UA שונה)</td>
        </tr>`;
      }
      return `<tr>
        <td>${esc(local)}</td>
        <td>${e.event === 'logout' ? '🚪' : '🟢'} ${esc(e.event)}</td>
        <td>${e.isManager ? '👑 מנהל' : esc(e.agentName || '')} ${e.agentCode ? `(${esc(e.agentCode)})` : ''}</td>
        <td>${esc(e.ip)}</td>
        <td>${esc(e.device)}</td>
      </tr>`;
    }).join('');
    return res.send(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>Access Log</title>
      <style>body{font-family:Arial;padding:20px;direction:rtl}table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#1A3F7C;color:#fff}
      tr:nth-child(even){background:#f5f5f5}tr.warn-row{background:#FFF3E0}h2{color:#1A3F7C}</style></head>
      <body><h2>Formula Road — Access Log (${log.length} entries)</h2>
      <table><thead><tr><th>זמן</th><th>אירוע</th><th>משתמש</th><th>IP</th><th>מכשיר</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`);
  }
  res.json(log);
});

// POST /admin/revoke?key=KEY&agentCode=CODE — invalidate all sessions for a specific agent
app.post('/admin/revoke', dataRateLimit, (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_LOG_KEY || '';
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });
  const code = String(req.query.agentCode || '').trim();
  if (!code) return res.status(400).json({ error: 'agentCode required' });
  let revoked = 0;
  for (const [token, sess] of sessions) {
    if (sess.agentCode === code) { sessions.delete(token); revoked++; }
  }
  if (revoked > 0) saveSessions();
  writeLog({ event: 'revoke', agentCode: code, revokedCount: revoked, ip: getRealIp(req), device: req.headers['user-agent'] || '' });
  res.json({ ok: true, agentCode: code, revokedSessions: revoked });
});

// GET /manager/gps-report — CSV: clients where our GPS differs from Priority (manager session only)
app.get('/manager/gps-report', requireAuth, async (req, res) => {
  if (!req.session.isManager) return res.status(403).json({ error: 'forbidden' });
  try {
    const rows = await executeDax(`
EVALUATE
SELECTCOLUMNS(
  FILTER('משטח', 'משטח'[סטטוס] = "פעיל"),
  "custId",    'משטח'[מס. לקוח],
  "custName",  'משטח'[שם לקוח],
  "city",      'משטח'[עיר],
  "address",   'משטח'[כתובת],
  "lat",       'משטח'[קו רוחב],
  "lng",       'משטח'[קו אורך],
  "agentCode", 'משטח'[סוכן],
  "agentName", 'משטח'[שם סוכן]
)
ORDER BY 'משטח'[מס. לקוח] ASC
    `);

    const clients = rows.map(r => ({
      custId:    r['[custId]'],
      custName:  r['[custName]'] || '',
      city:      r['[city]']    || '',
      address:   r['[address]'] || '',
      lat:       r['[lat]']     || null,
      lng:       r['[lng]']     || null,
      agentCode: r['[agentCode]'] || '',
      agentName: r['[agentName]'] || '',
    }));

    await geocodeBatch(clients);

    // load manual corrections
    const correctionsPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    let corrections = {};
    try { corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8')); } catch (_) {}

    const diffClients = clients.filter(c => c.gpsSource !== 'pbi');

    const csvRows = [['מס. לקוח', 'שם לקוח', 'עיר', 'כתובת', 'קו רוחב Priority', 'קו אורך Priority', 'קו רוחב מערכת', 'קו אורך מערכת', 'מקור GPS', 'קוד סוכן', 'שם סוכן', 'תיקון ידני']];
    for (const c of diffClients) {
      const corr = corrections[c.custId];
      csvRows.push([
        c.custId,
        c.custName,
        c.city,
        c.address,
        c.pbiLat  ?? '',
        c.pbiLng  ?? '',
        corr ? corr.lat : (c.lat ?? ''),
        corr ? corr.lng : (c.lng ?? ''),
        corr ? 'correction' : c.gpsSource,
        c.agentCode,
        c.agentName,
        corr ? 'כן' : 'לא',
      ]);
    }

    const csv = csvRows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const BOM = '﻿';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gps-report-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(BOM + csv);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

const DAY_LABELS = { 1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה' };

// Israel bounding box
const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── Persistent geocode cache ──────────────────────────────────────────────────
const GEOCODE_CACHE_PATH = path.join(__dirname, 'geocode-cache.json');
const geocodeCache = new Map();

(function loadGeocodeCache() {
  try {
    const data = JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, 'utf8'));
    let purged = 0;
    for (const [k, v] of Object.entries(data)) {
      // skip keys that contain BiDi control chars — those were geocoded with reversed Hebrew
      if (/[‎‏‪-‮]/.test(k)) { purged++; continue; }
      geocodeCache.set(k, v);
    }
    console.log(`geocode cache loaded: ${geocodeCache.size} entries (purged ${purged} BiDi-corrupted)`);
    if (purged > 0) saveGeocodeCache();
  } catch (_) {}
})();

function saveGeocodeCache() {
  try {
    const obj = {};
    for (const [k, v] of geocodeCache) obj[k] = v;
    fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(obj), 'utf8');
  } catch (_) {}
}

// Tablet-from-orders GPS (docs/priority-gps-cross.json, built by gps-build-combined.js) —
// real observed position at order-creation time, custId → {lat,lng,cluster_pct,...}. Used
// in geocodeBatch as a fallback tier AFTER a client's own PBI coordinate (only when PBI has
// none/invalid) — not ahead of it. Being tried as the FIRST/unconditional source for every
// client (overriding already-good PBI coordinates) caused a cascade of live routing bugs
// 2026-08-30/31 and was rolled back same day (commit 43279a5e); this narrower re-add can
// only help a client with no PBI coordinate, never override one that already has a good
// one. File is a plain array (build script output), keyed here by its `cust` field.
// Live request 2026-08-31.
const tabletGpsCache = new Map();
try {
  const _tabletFile = path.join(__dirname, '..', 'docs', 'priority-gps-cross.json');
  if (fs.existsSync(_tabletFile)) {
    const _tabletData = JSON.parse(fs.readFileSync(_tabletFile, 'utf8'));
    for (const row of _tabletData) {
      if (row?.cust && Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
        tabletGpsCache.set(String(row.cust), { lat: row.lat, lng: row.lng, cluster_pct: row.cluster_pct });
      }
    }
    console.log(`[tablet-gps] loaded ${tabletGpsCache.size} clients from priority-gps-cross.json`);
  }
} catch (_) {}

// City bounding-box cache: city name → { minLat, maxLat, minLng, maxLng } | null
const cityBBoxCache = new Map();
// Pre-load from persistent file built by build-formula-road.js (survives server restarts)
try {
  const _bboxFile = path.join(__dirname, '..', 'docs', 'city-bbox-cache.json');
  if (fs.existsSync(_bboxFile)) {
    const _bboxData = JSON.parse(fs.readFileSync(_bboxFile, 'utf8'));
    for (const [city, bbox] of Object.entries(_bboxData)) { cityBBoxCache.set(city, bbox); }
    console.log(`[bbox] Loaded ${cityBBoxCache.size} cities from city-bbox-cache.json`);
  }
} catch (_) {}

async function getCityBBox(city) {
  if (!city) return null;
  if (cityBBoxCache.has(city)) return cityBBoxCache.get(city);

  // LocationIQ — city bounding box
  if (LOCATIONIQ_KEY) {
    try {
      const url = `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_KEY}&q=${encodeURIComponent(city + ', ישראל')}&countrycode=il&format=json&limit=1&accept-language=he`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = await resp.json();
      const r = Array.isArray(data) ? data[0] : null;
      if (r?.boundingbox) {
        const [minLat, maxLat, minLng, maxLng] = r.boundingbox.map(Number);
        const bbox = { minLat, maxLat, minLng, maxLng };
        cityBBoxCache.set(city, bbox);
        return bbox;
      }
    } catch (_) {}
  }

  // Azure Maps fallback
  if (AZURE_MAPS_KEY) {
    try {
      const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(city + ', ישראל')}&countrySet=IL&limit=1&subscription-key=${AZURE_MAPS_KEY}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = await resp.json();
      const r = data?.results?.[0];
      if (r?.viewport) {
        const bbox = {
          minLat: r.viewport.btmRightPoint.lat, maxLat: r.viewport.topLeftPoint.lat,
          minLng: r.viewport.topLeftPoint.lon,  maxLng: r.viewport.btmRightPoint.lon,
        };
        cityBBoxCache.set(city, bbox);
        return bbox;
      }
    } catch (_) {}
  }

  // Nominatim last resort
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ', ישראל')}&format=json&limit=1&countrycodes=il`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ColumbusDillerApp/1.1' }, signal: AbortSignal.timeout(4000) });
    const data = await resp.json();
    if (data.length > 0 && data[0].boundingbox) {
      const bb = data[0].boundingbox;
      const bbox = { minLat: parseFloat(bb[0]), maxLat: parseFloat(bb[1]), minLng: parseFloat(bb[2]), maxLng: parseFloat(bb[3]) };
      cityBBoxCache.set(city, bbox);
      return bbox;
    }
  } catch (_) {}
  cityBBoxCache.set(city, null);
  return null;
}

function isWithinCityBBox(lat, lng, bbox) {
  if (!bbox) return true;
  const PAD = 0.018; // ~2km tolerance
  return lat >= bbox.minLat - PAD && lat <= bbox.maxLat + PAD &&
         lng >= bbox.minLng - PAD && lng <= bbox.maxLng + PAD;
}

// ── Address normalization ──────────────────────────────────────────────────────
const ABBREV_MAP = [
  // רח'/רחוב — генерик "street", не входит в индексируемое имя у геокодеров,
  // удаляем целиком вместо разворота (меньше шума в запросе)
  [/רח[''׳]\s*/g, ''],
  [/(?<![א-ת])רחוב(?![א-ת])\s*/g, ''],
  [/(?<![א-ת])רח(?![א-ת'"׳])\s*/g, ''],
  [/ד[""״]ר\s*/g, 'דוקטור '],
  [/פרופ[''׳]\s*/g, 'פרופסור '],
  // שד'/שדרות — смыслоразличительно (бульвар ≠ улица того же имени, и часто
  // ≠ название города, см. "שד' ירושלים" в אשדוד которое без "שדרות" ловится
  // геокодером как город Иерусалим) — обязательно разворачиваем, не удаляем
  [/שד[''׳]\s*/g, 'שדרות '],
  [/(?<![א-ת])שד(?![א-ת'"׳])\s*/g, 'שדרות '],
];

const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi, /מרכז עסקים[^,]*/gi, /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi, /מתחם[^,]*/gi, /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi, /בית קפה[^,]*/gi, /מסעדה[^,]*/gi,
  /סופרמרקט[^,]*/gi, /קומה\s*\d+/gi, /דירה\s*\d+/gi,
  /כניסה\s*[א-ת\d]+/gi, /בניין\s*[א-ת\d]*/gi, /\(.*?\)/g,
  // "הרצל 15 פינת ויצמן" → "הרצל 15" — описание перекрёстка лишь шумит
  // геокодеру; lookbehind требует реальный текст до "פינה/פינת", иначе
  // "פינת X" в начале строки (адрес-перекрёсток без основной улицы) не трогаем
  /(?<=[א-ת0-9])\s+פינ[הת]\b.*$/g,
];

function isPoBox(address) {
  return /ת\.?ד\.?\s*\d+/i.test(address) || /p\.?o\.?\s*box/i.test(address);
}

// Priority ERP stores digit sequences reversed within Hebrew text fields.
// Reverse each digit run to recover the correct numbers.
function fixPriNumbers(str) {
  if (!str) return str;
  return String(str).replace(/\d+/g, m => m.split('').reverse().join(''));
}

// Expand Hebrew city abbreviations used by Priority ERP to full city names
// so geocoding services can resolve them correctly.
function expandCityAbbrev(str) {
  if (!str) return str;
  return str
    .replace(/ב["״״]ש\b/g, 'באר שבע')
    .replace(/ת["״״]א\b/g, 'תל אביב')
    .replace(/י["״״]מ\b/g, 'ירושלים')
    .replace(/\bי-ם\b/g,        'ירושלים')
    .replace(/ק["״״]ג\b/g, 'קריית גת')
    .replace(/ק["״״]מ\b/g, 'קריית מלאכי')
    .replace(/נ["״״]ע\b/g, 'נהריה');
}

// PBI stores Hebrew addresses in visual order wrapped in LTR-Override markers.
// Strip BiDi marks and reverse Hebrew segments to get logical (geocodable) text.
function fixBiDiAddress(str) {
  if (!str) return str;
  const hasLROverride = /[‪‭]/.test(str);
  let clean = str.replace(/[‎‏‪-‮]/g, '');
  if (hasLROverride) {
    clean = clean.split(/\s+/).reverse()
      .map(w => /[֐-׿יִ-ﭏ]/.test(w)
        ? w.split('').reverse().join('').replace(/\d+/g, mm => mm.split('').reverse().join(''))
        : w)
      .join(' ');
  }
  return clean.trim();
}

function cleanAddressForGeocoding(address) {
  if (!address) return address;
  let s = fixBiDiAddress(address);
  for (const [pat, rep] of ABBREV_MAP) s = s.replace(pat, rep);
  // strip apartment fraction: "הרצל 5/3" → "הרצל 5"
  s = s.replace(/(\d+)\/\d+/g, '$1');
  for (const pattern of VENUE_PATTERNS) s = s.replace(pattern, '');
  return s.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

// ── Geocoding services ────────────────────────────────────────────────────────
const AZURE_MAPS_KEY    = process.env.AZURE_MAPS_KEY    || '';
const GOOGLE_MAPS_KEY   = process.env.GOOGLE_MAPS_KEY   || '';  // REQUEST_DENIED — billing not enabled
const LOCATIONIQ_KEY    = process.env.LOCATIONIQ_KEY    || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// LocationIQ — OSM-based, works well for Israel, no billing required
async function geocodeLocationIQ(query) {
  if (!LOCATIONIQ_KEY) return null;
  try {
    const url = `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_KEY}&q=${encodeURIComponent(query)}&countrycode=il&format=json&limit=1&accept-language=he`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    const r = Array.isArray(data) ? data[0] : null;
    if (r?.lat && r?.lon) return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
  } catch (_) {}
  return null;
}

async function geocodeAzure(query) {
  if (!AZURE_MAPS_KEY) return null;
  try {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(query)}&countrySet=IL&limit=1&subscription-key=${AZURE_MAPS_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data = await resp.json();
    const r = data?.results?.[0];
    if (r?.position) return { lat: r.position.lat, lng: r.position.lon };
  } catch (_) {}
  return null;
}

// Google geocoding disabled — REQUEST_DENIED (billing not enabled on GCP project)
async function geocodeGoogle(query) { return null; }

let _lastNominatimMs = 0;
async function geocodeNominatim(query, city) {
  // respect 1 req/sec limit
  const wait = 1100 - (Date.now() - _lastNominatimMs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNominatimMs = Date.now();
  try {
    // structured query (street + city separately) gives better results for Hebrew
    const bbox = city ? (cityBBoxCache.get(city) ?? null) : null;
    // strip city/country suffix so street= param contains only street+number
    let streetPart = query;
    if (city) {
      streetPart = query.replace(new RegExp(`,\\s*${city}.*$`), '').replace(/,\s*ישראל\s*$/, '').trim();
    }
    const baseUrl = city
      ? `https://nominatim.openstreetmap.org/search?street=${encodeURIComponent(streetPart)}&city=${encodeURIComponent(city)}&country=Israel&format=json&limit=5&countrycodes=il`
      : `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&countrycodes=il`;
    const resp = await fetch(baseUrl, { headers: { 'User-Agent': 'ColumbusDillerApp/1.1' }, signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    if (!Array.isArray(data) || !data.length) return null;
    // prefer first result within city bbox
    for (const r of data) {
      const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      if (!bbox || isWithinCityBBox(lat, lng, bbox)) return { lat, lng };
    }
    // fallback: first result regardless
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (_) {}
  return null;
}


// Haiku parses messy Hebrew addresses when all else fails (~$0.001/address)
async function normalizeAddressWithAI(address, city) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{ role: 'user', content: `Extract ONLY the street name and house number from this Israeli address for geocoding. Return "street_name number" in Hebrew. If no street (P.O. box, vague description), return null.\n\nAddress: "${address}"\nCity: "${city || ''}"` }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    const text = (data?.content?.[0]?.text || '').trim();
    if (!text || text === 'null') return null;
    return text;
  } catch (_) { return null; }
}

async function geocodeAddress(query, city) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);
  let result = await geocodeLocationIQ(query);
  if (!result) result = await geocodeNominatim(query, city);
  if (!result) result = await geocodeAzure(query);
  geocodeCache.set(query, result || null);
  return result || null;
}

function extractStreetNum(address) {
  if (!address) return null;
  const m = address.match(/[א-ת"'\-\s]{2,}\s+\d+/);
  return m ? m[0].trim() : null;
}

const SETTLEMENT_RE = /(מושב|קיבוץ|כפר|ישוב|מוצא|נחלה)/;

async function geocodeAddressCascade(address, city) {
  if (isPoBox(address || '')) return null;

  const cleaned = cleanAddressForGeocoding(address);

  // settlement-type address with no street number → skip geocoding, use city center
  if (SETTLEMENT_RE.test(cleaned || address || '') && !extractStreetNum(cleaned || address || '')) {
    if (city) {
      const r = await geocodeAddress(city + ', ישראל');
      if (r) return { ...r, cityCenter: true };
    }
    return null;
  }
  const cityStr = city ? `, ${city}` : '';

  // attempt 1: full cleaned address + city
  if (cleaned) {
    const r = await geocodeAddress(cleaned + cityStr + ', ישראל', city);
    if (r) return r;
  }

  // attempt 2: AI normalization — knows Hebrew better than regex
  const aiAddr = await normalizeAddressWithAI(address, city);
  if (aiAddr) {
    const r = await geocodeAddress(aiAddr + cityStr + ', ישראל', city);
    if (r) { saveGeocodeCache(); return r; }
  }

  // attempt 3: street+number only + city
  const street = extractStreetNum(cleaned || address || '');
  if (street && street !== cleaned) {
    const r = await geocodeAddress(street + cityStr + ', ישראל', city);
    if (r) return r;
  }

  // attempt 4: city-only fallback — mark as approximate
  if (city) {
    const r = await geocodeAddress(city + ', ישראל', city);
    if (r) return { ...r, cityCenter: true };
  }

  return null;
}

// ── PBI Sibling Lookup ────────────────────────────────────────────────────────
// Finds clients in PBI with GPS at the same address (or same street ±10 houses)
// to use their coordinates instead of geocoding from scratch.

function getPBISiblingData() {
  if (!pbiCache) return [];
  const result = [];
  for (const [, c] of pbiCache.clientMap) {
    if (c.lat && c.lng && isValidIL(c.lat, c.lng)) {
      result.push({ addr: c.address || '', city: c.city || '', lat: c.lat, lng: c.lng });
    }
  }
  return result;
}

async function loadPBISiblingData() {
  return getPBISiblingData();
}

function parseAddrParts(addr) {
  // "הציונות 41" or "41 הציונות" → { street, num }
  const m1 = addr.match(/^([֐-׿\s"'\-]+?)\s+(\d+)\s*$/);
  if (m1) return { street: m1[1].trim(), num: parseInt(m1[2]) };
  const m2 = addr.match(/^(\d+)\s+([֐-׿\s"'\-]+?)\s*$/);
  if (m2) return { street: m2[2].trim(), num: parseInt(m2[1]) };
  return { street: addr.trim(), num: null };
}

async function findPBISibling(address, city) {
  if (!address || !city) return null;
  const siblings = await loadPBISiblingData();
  const clean = fixBiDiAddress(address).trim();
  const norm = s => s.replace(/\s+/g, ' ').trim();

  // Step 1: exact address match in same city
  const exact = siblings.find(s =>
    s.city === city && norm(s.addr) === norm(clean)
  );
  if (exact) return { lat: exact.lat, lng: exact.lng, source: 'pbi-sibling' };

  // Step 2: same city + same street + house number ±10
  const { street, num } = parseAddrParts(clean);
  if (street && num !== null) {
    const nearby = siblings.find(s => {
      if (s.city !== city) return false;
      const p = parseAddrParts(s.addr);
      if (!p.street || p.num === null) return false;
      if (!p.street.includes(street) && !street.includes(p.street)) return false;
      return Math.abs(p.num - num) <= 10;
    });
    if (nearby) return { lat: nearby.lat, lng: nearby.lng, source: 'pbi-sibling-near' };
  }

  return null;
}

// ── FORM+I+INT Client GPS Lookup ────────────────────────────────────────────
// 'לקוחות FORM+I+INT' carries verified per-client GPS (custId match) for ~58%
// of all clients — far more reliable than re-geocoding a messy free-text
// address, since it's an exact ID match rather than fuzzy street matching.
async function loadFormIIntGPS() {
  if (!pbiCache) return new Map();
  const map = new Map();
  for (const [custId, c] of pbiCache.clientMap) {
    if (c.lat && c.lng && isValidIL(c.lat, c.lng)) map.set(custId, { lat: c.lat, lng: c.lng });
  }
  return map;
}

async function findFormIIntGPS(custId) {
  if (!custId) return null;
  const map = await loadFormIIntGPS();
  const hit = map.get(String(custId));
  if (!hit) return null;
  return { lat: hit.lat, lng: hit.lng, source: 'form-i-int' };
}

async function geocodeBatch(clients) {
  // fetch city bboxes (Azure Maps, no delays)
  const allCities = [...new Set(clients.map(c => c.city).filter(Boolean))];
  await Promise.all(allCities.map(city => cityBBoxCache.has(city) ? null : getCityBBox(city)));

  // save Priority GPS and mark source before any overwrite
  for (const c of clients) {
    // Manual corrections are authoritative — callers (/customers, /api/territory/clients)
    // apply gps-corrections.json onto c.lat/c.lng/c.gpsSource BEFORE calling this function.
    // Re-running the bbox check on an already-corrected point defeats the entire point of
    // correcting it: the correction usually exists precisely because PBI/bbox placement was
    // wrong, so a real fix is disproportionately likely to land outside the (possibly also
    // wrong) bbox and get silently discarded here. Bug found 2026-08-24 — custId 1112017's
    // correction was being wiped on every /customers load.
    if (c.gpsSource === 'correction') continue;

    c.pbiLat = c.lat || null;
    c.pbiLng = c.lng || null;

    const la = parseFloat(c.lat), lo = parseFloat(c.lng);
    if (isValidIL(la, lo)) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(la, lo, bbox)) {
        c.lat = la; c.lng = lo;
        c.gpsSource = 'pbi';
      } else {
        // PBI coords valid Israel but outside city bbox — re-geocode
        c.lat = null; c.lng = null;
        c.gpsSource = 'geocoded';
        console.log(`[bbox] custId=${c.custId} city=${c.city} pbi=(${la},${lo}) outside bbox → re-geocode`);
      }
    } else {
      c.gpsSource = 'geocoded';
    }
  }

  // geocode clients still missing valid coords
  const needsGeocode = clients.filter(c => !isValidIL(c.lat, c.lng));
  let resolved = 0;
  for (const c of needsGeocode) {
    // Step -1: tablet-from-orders — real observed position, tried before the
    // address-geocoding tiers below since an actual visit beats guessing from
    // text, but only here (after PBI's own coordinate already had its chance
    // above) so it can never override a client that already has a good PBI fix.
    const tablet = tabletGpsCache.get(String(c.custId));
    if (tablet) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(tablet.lat, tablet.lng, bbox)) {
        c.lat = tablet.lat; c.lng = tablet.lng;
        c.gpsSource = 'tablet-order';
        resolved++;
        continue;
      }
    }

    // Step 0a: exact custId GPS lookup against 'לקוחות FORM+I+INT' —
    // verified per-client coordinates, more reliable than re-geocoding text
    const exact = await findFormIIntGPS(c.custId);
    if (exact) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(exact.lat, exact.lng, bbox)) {
        c.lat = exact.lat; c.lng = exact.lng;
        c.gpsSource = exact.source;
        resolved++;
        continue;
      }
    }

    // Step 0b: PBI sibling lookup (accurate, no external API)
    const sibling = await findPBISibling(c.address, c.city);
    if (sibling) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(sibling.lat, sibling.lng, bbox)) {
        c.lat = sibling.lat; c.lng = sibling.lng;
        c.gpsSource = sibling.source;
        resolved++;
        continue;
      }
    }

    const result = await geocodeAddressCascade(c.address, c.city);
    if (result) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(result.lat, result.lng, bbox)) {
        c.lat = result.lat; c.lng = result.lng; resolved++;
        c.gpsSource = result.cityCenter ? 'city-center' : 'geocoded';
      } else {
        // result outside city bbox — mark queries as null so cache doesn't replay bad coords
        const cityStr = c.city ? `, ${c.city}` : '';
        const cleaned = cleanAddressForGeocoding(c.address);
        if (cleaned) geocodeCache.set(cleaned + cityStr + ', ישראל', null);
        if (c.address && c.address !== cleaned) geocodeCache.set(c.address + cityStr + ', ישראל', null);
      }
    }
    // Last resort, only reached if PBI + FORM+I+INT + PBI-sibling + address geocoding
    // ALL failed: live 30-day order GPS lookup, for clients too new to have any of the
    // above yet. Deliberately last in line, not first — this is a per-request live SQL
    // query (slow, and a single order's GPS ping is less reliable than a full address
    // match), so it only runs for the minority of clients nothing else resolved. Live
    // request 2026-08-31.
    if (!isValidIL(c.lat, c.lng)) {
      const live = await liveOrderGpsForNewClient(c.custId, 30).catch(() => null);
      if (live) {
        const bbox = cityBBoxCache.get(c.city) ?? null;
        if (isWithinCityBBox(live.lat, live.lng, bbox)) {
          c.lat = live.lat; c.lng = live.lng;
          c.gpsSource = 'tablet-order-live';
          resolved++;
        }
      }
    }
    if (!isValidIL(c.lat, c.lng)) c.gpsSource = 'no-gps';
  }
  if (resolved > 0) { saveGeocodeCache(); console.log(`geocodeBatch: resolved ${resolved}/${needsGeocode.length}`); }
  return clients;
}

// GET /geocode?address=&city= — geocode a single address
app.get('/geocode', requireAuth, async (req, res) => {
  const { address, city } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });
  const cleaned = cleanAddressForGeocoding(address);
  const query = [cleaned, city, 'ישראל'].filter(Boolean).join(', ');
  const result = await geocodeAddress(query);
  res.json(result || {});
});

// GET /managers — from PBI cache
app.get('/managers', requireAuth, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  res.json(pbiCache.managers.map(m => ({ managerCode: m })));
});

// GET /territory-cities — unique cities from PBI cache (Formula + ICE)
app.get('/territory-cities', requireAuth, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const cities = new Set();
  for (const clients of pbiCache.byAgent.values()) {
    for (const c of clients) { if (c.city) cities.add(c.city); }
  }
  if (pbiCache.iceByAgent) {
    for (const clients of pbiCache.iceByAgent.values()) {
      for (const c of clients) { if (c.city) cities.add(c.city); }
    }
  }
  res.json([...cities].sort((a,b) => a.localeCompare(b, 'he')));
});

// GET /agent-cities?agents=X,Y&managers=A,B — cities for specific agents/managers
app.get('/agent-cities', requireAuth, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const agentCodes  = req.query.agents   ? req.query.agents.split(',').map(s=>s.trim()).filter(Boolean)   : [];
  const managerNames= req.query.managers ? req.query.managers.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const cities = new Set();
  for (const [agentCode, clients] of pbiCache.byAgent) {
    if (agentCodes.length && !agentCodes.includes(agentCode)) continue;
    for (const c of clients) {
      if (managerNames.length && !managerNames.includes(c.manager)) continue;
      if (c.city) cities.add(c.city);
    }
  }
  res.json([...cities].sort((a,b) => a.localeCompare(b, 'he')));
});

// GET /territory-clients?cities=CITY1,CITY2 — all clients in cities across all agents
app.get('/territory-clients', requireAuth, dataRateLimit, async (req, res) => {
  const { city, cities } = req.query;
  const raw = cities || city;
  if (!raw) return res.status(400).json({ error: 'cities required' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const cityAll = raw.trim() === 'ALL';
  const citySet = cityAll ? null : new Set(raw.split(',').map(c => c.trim()).filter(Boolean));
  console.log(`[territory-clients] cities=${cityAll?'ALL':citySet?.size}, iceByAgent=${pbiCache.iceByAgent?.size||0}`);
  const results = [];
  const seen = new Set();
  const formulaCustIds = new Set(); // for ICE dedup: skip custIds already in formula list
  const pushClient = (c, agentCode, extra = {}) => {
    const key = `${c.custId}_${agentCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      custId:        c.custId,
      custName:      c.custName,
      city:          c.city,
      address:       c.address || '',
      lat:           c.lat || null,
      lng:           c.lng || null,
      gpsSource:     c.gpsSource || null,
      agentCode:     c.agentCode || agentCode,
      agentName:     c.agentName || '',
      manager:       c.manager || '',
      dayNum:        c.dayNum || null,
      dayLabel:      c.dayLabel || '',
      lastOrderDate: c.lastOrderDate || null,
      monthlySales:  c.monthlySales || 0,
      avg6Sales:     c.avg6Sales || 0,
      avg6IceSales:  c.avg6IceSales || 0,
      pct:           c.pct || 0,
      clientType:    c.clientType || '',
      sadran:        c.sadran || '',
      hevra:         c.hevra || 'FORMULA',
      ...extra,
    });
  };
  // Apply GPS corrections (same as /customers)
  const corrPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
  const corrections = fs.existsSync(corrPath) ? JSON.parse(fs.readFileSync(corrPath, 'utf8')) : {};

  const clientsForBatch = [];
  for (const [agentCode, clients] of pbiCache.byAgent) {
    for (const c of clients) {
      if (!cityAll && (!c.city || !citySet.has(c.city))) continue;
      const corr = corrections[String(c.custId)];
      const enriched = corr
        ? { ...c, lat: corr.lat, lng: corr.lng, gpsSource: 'correction' }
        : { ...c, gpsSource: c.lat && c.lng ? 'pbi' : undefined };
      clientsForBatch.push({ _agentCode: agentCode, _extra: {}, client: enriched });
      formulaCustIds.add(c.custId);
    }
  }
  if (pbiCache.iceByAgent) {
    for (const [agentCode, clients] of pbiCache.iceByAgent) {
      const formulaClients = pbiCache.byAgent.get(agentCode);
      const agentName = formulaClients?.[0]?.agentName
        || clients.find(c => c.agentName)?.agentName
        || agentCode;
      for (const c of clients) {
        if (!cityAll && (!c.city || !citySet.has(c.city))) continue;
        if (formulaCustIds.has(c.custId)) continue;
        clientsForBatch.push({ _agentCode: agentCode, _extra: { hevra: 'ICE', iceOnly: true, agentName }, client: { ...c } });
      }
    }
  }
  console.log(`[territory-clients] formula=${formulaCustIds.size}, ice=${clientsForBatch.filter(x=>x._extra.iceOnly).length}`);

  // geocodeBatch: bbox check + re-geocode for clients outside city bbox (same as /customers)
  const rawClients = clientsForBatch.map(x => x.client);
  await Promise.race([geocodeBatch(rawClients), new Promise(r => setTimeout(r, 7000))]);

  for (const x of clientsForBatch) {
    pushClient(x.client, x._agentCode, x._extra);
  }
  res.json(results);
});

// GET /all-agents — flat list of all agents from PBI cache
app.get('/all-agents', requireAuth, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const agents = new Map();
  for (const [agentCode, clients] of pbiCache.byAgent) {
    if (!clients.length) continue;
    const sample = clients.find(c => c.agentName) || clients[0];
    if (!agents.has(agentCode)) agents.set(agentCode, { agentCode, agentName: sample?.agentName || agentCode });
  }
  res.json([...agents.values()].sort((a,b) => (a.agentName||'').localeCompare(b.agentName||'')));
});

// GET /manager-agents?manager=NAME — from PBI cache
app.get('/manager-agents', requireAuth, dataRateLimit, async (req, res) => {
  const { manager } = req.query;
  if (!manager) return res.status(400).json({ error: 'manager required' });
  if (!validateManagerName(manager)) return res.status(400).json({ error: 'invalid manager' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const agents = pbiCache.agentsByManager.get(manager) || [];
  res.json(agents.sort((a, b) => (a.agentName || '').localeCompare(b.agentName || '')));
});

// GET /agent-exists?agent=CODE — быстрая проверка наличия агента в кэше (без геокодинга)
app.get('/agent-exists', requireAuth, async (req, res) => {
  const { agent } = req.query;
  if (!agent || !validateAgentCode(agent)) return res.json({ exists: false, reason: 'invalid' });
  if (!pbiCache) return res.json({ exists: null, reason: 'loading' }); // null = неизвестно, сервер грузится
  const exists = pbiCache.byAgent.has(agent);
  res.json({ exists, count: exists ? pbiCache.byAgent.get(agent).length : 0 });
});

// GET /agent-manager?agent=CODE — team/קבוצה this agent belongs to, for picking
// the right yedaim.png (2026-08-20) — same מנהל/קבוצה every other agent-scoped
// endpoint here already reads off pbiCache, just surfaced for the client.
app.get('/agent-manager', requireAuth, async (req, res) => {
  const { agent } = req.query;
  if (!agent || !validateAgentCode(agent)) return res.json({ manager: null });
  if (!pbiCache) return res.json({ manager: null, reason: 'loading' });
  const clients = pbiCache.byAgent.get(agent);
  const manager = clients?.find(c => c.manager)?.manager || null;
  res.json({ manager });
});

// GET /customers?agent=CODE&day=1 — from PBI cache
app.get('/customers', requireAuth, dataRateLimit, async (req, res) => {
  const { agent, day } = req.query;
  if (!agent) return res.status(400).json({ error: 'agent required' });
  if (!validateAgentCode(agent)) return res.status(400).json({ error: 'invalid agent code' });
  if (day && !/^[0-5]$/.test(String(day))) return res.status(400).json({ error: 'invalid day' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });

  // day=0 → "לא מוגדר": ICE clients with no scheduled day
  // day=1-5 → Formula clients for that day + ICE clients with that specific day
  // day=null → all clients
  const dayNum = day !== undefined && day !== '' ? parseInt(day) : null;

  try {
    const allForAgent    = pbiCache.byAgent.get(agent) || [];
    const noSchedFormula = (pbiCache.noScheduleByAgent?.get(agent) || []);
    // All Formula custIds (scheduled + unscheduled) — never show as ICE-only
    const allFormulaIds  = new Set([...allForAgent, ...noSchedFormula].map(c => c.custId));
    console.log(`[/customers] agent=${agent} day=${dayNum} scheduled=${allForAgent.length} noSched=${noSchedFormula.length}`);

    // route-overrides.json reflects a manual drag-to-a-day in the app (Priority's
    // own schedule never changes from that). Every dayNum branch below now checks
    // it both ways — anyone with a dayMoves entry leaves their PBI-schedule bucket
    // (movedAwayIds), and anyone moved INTO the requested day gets added even
    // though PBI never put them there (movedInIds). Previously only the day=0
    // ("?") branch subtracted moves, and only for FORMULA's noSchedFormula — a
    // client moved OFF a specific weekday (not off "?") or any ICE client moved
    // between days never reflected server-side, so it either stuck to its old
    // PBI day forever or (for ICE moved off "?") vanished from every tab, only
    // "found" again if the agent happened to revisit "?". Live complaint
    // 2026-08-30/31 (ICE clients kept reappearing under "?" after being moved).
    const dayMoves = readRouteOverrides()[agent]?.dayMoves || {};
    const movedAwayIds = new Set(Object.keys(dayMoves));
    const movedInIds = dayNum ? Object.keys(dayMoves).filter(id => dayMoves[id]?.day === dayNum) : [];

    let clients;
    if (dayNum === 0) {
      // "לא מוגדר": Formula unscheduled + ICE with no day, minus anything the agent already moved to a day
      clients = noSchedFormula.filter(c => !movedAwayIds.has(String(c.custId)));
    } else if (dayNum) {
      clients = allForAgent.filter(c => c.dayNum === dayNum && !movedAwayIds.has(String(c.custId)));
    } else {
      clients = allForAgent.slice();
    }

    // Merge ICE-only clients (not in any Formula list)
    const iceAll = pbiCache.iceByAgent?.get(agent) || [];
    let iceForDay;
    if (dayNum === 0) {
      iceForDay = iceAll.filter(c => c.dayNum === null && !allFormulaIds.has(c.custId) && !movedAwayIds.has(String(c.custId)));
    } else if (dayNum) {
      iceForDay = iceAll.filter(c => c.dayNum === dayNum && !allFormulaIds.has(c.custId) && !movedAwayIds.has(String(c.custId)));
    } else {
      iceForDay = iceAll.filter(c => !allFormulaIds.has(c.custId));
    }
    if (iceForDay.length) console.log(`[/customers] +${iceForDay.length} ICE-only clients`);
    clients = [...clients, ...iceForDay];

    // Add clients moved INTO this specific day from somewhere else (any other day,
    // "?", or a different PBI bucket entirely) — search every pool we have, then
    // fall back to the snapshot pushDayMove sent at move time so a client is never
    // silently dropped just because the PBI cache doesn't carry them under this id.
    for (const id of movedInIds) {
      if (clients.some(c => String(c.custId) === id)) continue;
      const found = allForAgent.find(c => String(c.custId) === id)
        || noSchedFormula.find(c => String(c.custId) === id)
        || iceAll.find(c => String(c.custId) === id)
        || (dayMoves[id]?.client ? { ...dayMoves[id].client, custId: id } : null);
      if (found) clients.push({ ...found, dayNum, priorityOrder: 9500 });
    }
    console.log(`[/customers] after day filter + ICE + moves: ${clients.length}`);

    // Apply GPS corrections from local file
    const correctionsPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    let corrections = {};
    try { corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8')); } catch (_) {}

    clients = clients.map(c => {
      const corr = corrections[c.custId];
      return {
        ...c,
        lat:       corr ? corr.lat : c.lat,
        lng:       corr ? corr.lng : c.lng,
        gpsSource: corr ? 'correction' : (c.lat && c.lng ? 'pbi' : undefined),
      };
    });

    // geocodeBatch can be slow (sequential external API calls per client).
    // Cap at 7s so the response always arrives before the 12s client timeout.
    await Promise.race([geocodeBatch(clients), new Promise(r => setTimeout(r, 7000))]);
    res.json(clients);
  } catch (err) {
    console.error('/customers error:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ── Territory Day/Agent Overrides — server-side persistence ─────────────────
const OVERRIDES_FILE = path.join(__dirname, 'territory-overrides.json');

app.get('/api/territory-overrides', requireAuth, (req, res) => {
  try {
    const data = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')) : {};
    res.json(data);
  } catch (_) { res.json({}); }
});

app.post('/api/territory-overrides', requireAuth, (req, res) => {
  try {
    const overrides = req.body;
    if (!overrides || typeof overrides !== 'object') return res.status(400).json({ error: 'invalid' });
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf8');
    writeLog({ ts: new Date().toISOString(), event: 'territory-overrides-save',
      count: Object.keys(overrides).length, agentCode: req.session?.agentCode || null, ip: getRealIp(req) });
    res.json({ ok: true, count: Object.keys(overrides).length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// POST /api/export-route-xlsx — Excel с Smart Table, подсветкой изменений и GPS
app.post('/api/export-route-xlsx', requireAuth, dataRateLimit, async (req, res) => {
  const { rows, agentName, dayLabel } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'missing rows' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Formula Road';
  const ws = wb.addWorksheet('מסלול', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  // Column indices (1-based):  1=pos 2=custId 3=name 4=company 5=day 6=dayOrig 7=agent 8=agentOrig 9=city 10=address 11=lat 12=lng 13=gps 14=priority
  const COLS = [
    { name: 'סדר ביקור מתוקן',   width: 8  },
    { name: 'מס. לקוח',          width: 14 },
    { name: 'שם לקוח',           width: 28 },
    { name: 'חברה',              width: 10 },
    { name: 'יום',               width: 10 },
    { name: 'יום PBI',           width: 10 },
    { name: 'סוכן',              width: 22 },
    { name: 'סוכן PBI',          width: 22 },
    { name: 'עיר',               width: 16 },
    { name: 'כתובת',             width: 26 },
    { name: 'קו רוחב',           width: 13 },
    { name: 'קו אורך',           width: 13 },
    { name: 'GPS',               width: 14 },
    { name: 'סדר ביקור PRIORITY', width: 15 },
  ];
  const COL_DAY        = 5;
  const COL_DAY_ORIG   = 6;
  const COL_AGENT      = 7;
  const COL_AGENT_ORIG = 8;

  ws.addTable({
    name: 'RouteTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: COLS.map(c => ({ name: c.name, filterButton: true })),
    rows: rows.map(r => {
      const gpsCell = (() => {
        if (!r.corrected) return r.lat && r.lng ? '✓' : 'חסר';
        if (r.pbiLat && r.pbiLng) return haversineDist(r.lat, r.lng, Number(r.pbiLat), Number(r.pbiLng)) <= 20 ? '✓' : '✓ CHANGED';
        return '✓ CHANGED';
      })();
      return [
        r.currentPos,
        String(r.custId || ''),
        r.custName || '',
        r.hevra || 'FORMULA',
        r.dayLabel || '',
        r.dayChanged ? (r.originalDayLabel || '') : '',
        r.agentName || '',
        r.agentChanged ? (r.originalAgentName || '') : '',
        r.city || '',
        r.address || '',
        r.lat ? Number(parseFloat(r.lat).toFixed(6)) : '',
        r.lng ? Number(parseFloat(r.lng).toFixed(6)) : '',
        gpsCell,
        r.noOrder ? 'חסר סדר ביקור' : (r.originalPos != null ? r.originalPos : ''),
      ];
    }),
  });

  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const FILL_GREEN1       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } }; // corrected GPS even
  const FILL_GREEN2       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA5D6A7' } }; // corrected GPS odd
  const FILL_ORANGE       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC80' } }; // doubtful GPS
  const FILL_GRAY1        = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEFF1' } }; // noOrder even
  const FILL_GRAY2        = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }; // noOrder odd
  const FILL_STRIPE1      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; // normal even
  const FILL_STRIPE2      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; // normal odd
  const FILL_ICE1         = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB2DFDB' } }; // ICE even
  const FILL_ICE2         = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF80CBC4' } }; // ICE odd
  const FILL_DAY_CHANGED  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF176' } }; // changed day cell
  const FILL_AGENT_CHANGED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD54F' } }; // changed agent cell (amber)
  const DOUBTFUL          = new Set(['geocoded', 'pbi-sibling-near', 'city-center', 'no-gps']);

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const isGpsChanged = r.corrected && (
      !r.pbiLat || !r.pbiLng || haversineDist(r.lat, r.lng, Number(r.pbiLat), Number(r.pbiLng)) > 20
    );
    // Row-level base fill (no longer yellow for overrides — handled per-cell below)
    let rowFill;
    if (r.iceOnly)                   rowFill = i % 2 === 0 ? FILL_ICE1   : FILL_ICE2;
    else if (r.noOrder)              rowFill = i % 2 === 0 ? FILL_GRAY1  : FILL_GRAY2;
    else if (isGpsChanged)           rowFill = i % 2 === 0 ? FILL_GREEN1 : FILL_GREEN2;
    else if (DOUBTFUL.has(r.gpsSource)) rowFill = FILL_ORANGE;
    else                             rowFill = i % 2 === 0 ? FILL_STRIPE1 : FILL_STRIPE2;
    for (let col = 1; col <= COLS.length; col++) ws.getCell(rowNum, col).fill = rowFill;

    // Cell-level override for changed day / agent
    if (r.dayChanged) {
      ws.getCell(rowNum, COL_DAY).fill      = FILL_DAY_CHANGED;
      ws.getCell(rowNum, COL_DAY_ORIG).fill = FILL_DAY_CHANGED;
    }
    if (r.agentChanged) {
      ws.getCell(rowNum, COL_AGENT).fill      = FILL_AGENT_CHANGED;
      ws.getCell(rowNum, COL_AGENT_ORIG).fill = FILL_AGENT_CHANGED;
    }
  });

  const today = new Date().toISOString().slice(0, 10);
  const fname = `מסלול_${agentName || ''}_${dayLabel || ''}_${today}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  await wb.xlsx.write(res);
  res.end();
});

// Push gps-corrections.json to GitHub so GitHub Actions build picks it up
async function pushGpsToGithub(content) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const owner = 'sverdlikdan-code';
  const repo  = 'COLUMBUS';
  const filePath = 'docs/gps-corrections.json';
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
  };
  // Get current SHA
  const getRes = await fetch(apiBase, { headers });
  const getJson = await getRes.json();
  const sha = getJson.sha;
  const body = JSON.stringify({
    message: `chore(gps): update correction for ${new Date().toISOString().slice(0,10)}`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha,
    committer: { name: 'COLUMBUS Bot', email: 'columbus-bot@diler.co.il' },
  });
  await fetch(apiBase, { method: 'PUT', headers, body });
}

// Save GPS correction — shared across all users via gps-corrections.json
app.post('/save-gps', requireAuth, dataRateLimit, async (req, res) => {
  try {
    const { custId, lat, lng, name, city, address } = req.body;
    if (!custId || !lat || !lng) return res.status(400).json({ error: 'missing custId/lat/lng' });
    if (!/^\d{1,15}$/.test(String(custId))) return res.status(400).json({ error: 'invalid custId' });
    if (lat < IL.minLat || lat > IL.maxLat || lng < IL.minLng || lng > IL.maxLng) {
      return res.status(400).json({ error: 'coordinates outside Israel' });
    }
    const filePath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    const current  = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
    current[String(custId)] = { lat, lng, correctedAt: new Date().toISOString(), name: name || '', city: city || '', address: address || '' };
    const json = JSON.stringify(current, null, 2);
    fs.writeFileSync(filePath, json, 'utf8');
    // Audit log
    writeLog({ ts: new Date().toISOString(), event: 'gps-correction', custId: String(custId),
      agentCode: req.session?.agentCode || null, ip: getRealIp(req) });
    // Push to GitHub so next build picks up the correction
    pushGpsToGithub(json).catch(e => console.error('GitHub push failed:', e.message));
    res.json({ ok: true, total: Object.keys(current).length });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// TEMPORARY diagnostic endpoint — live complaint 2026-08-24: zikuy WhatsApp
// share hangs for minutes on some devices with no error, no visibility into
// why (html2canvas runs entirely client-side, nothing else about it reaches
// the server). Client posts a beacon at capture start and at each phase
// finishing so a real hang shows up as a 'start' with no matching 'done' in
// the log, and a real slow-but-working case shows up as large ms values.
// Remove once the root cause is confirmed and fixed.
app.post('/api/share-timing', requireAuth, dataRateLimit, (req, res) => {
  try {
    const { phase, ms, imgCount, custId } = req.body || {};
    if (!phase || typeof phase !== 'string' || phase.length > 40) return res.status(400).json({ error: 'invalid phase' });
    writeLog({
      ts: new Date().toISOString(), event: 'share-timing', phase,
      ms: Number.isFinite(ms) ? Math.round(ms) : null,
      imgCount: Number.isFinite(imgCount) ? imgCount : null,
      custId: custId ? String(custId).slice(0, 20) : null,
      agentCode: req.session?.agentCode || null, ip: getRealIp(req),
      ua: req.headers['user-agent'] || null,
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'server_error' }); }
});

// POST /api/client-error — window.onerror/unhandledrejection reporter. No
// requireAuth on purpose: a crash during/before login is exactly the kind of
// failure we most want to see, and requiring a valid session would silently
// drop those. dataRateLimit (60/min/IP) is the abuse guard instead. Soft
// session lookup (no 401 if missing/expired) just enriches the log entry
// with agentCode when we have it. Live request 2026-08-28 ("если что-то
// ломается в JS прямо на телефоне агента — мы не узнаём").
app.post('/api/client-error', dataRateLimit, (req, res) => {
  try {
    const { message, stack, url, page } = req.body || {};
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'invalid message' });
    const sess = sessions.get((req.headers['x-session'] || '').trim());
    writeLog({
      ts: new Date().toISOString(), event: 'client-error',
      message: String(message).slice(0, 300),
      stack: stack ? String(stack).slice(0, 1000) : null,
      url: url ? String(url).slice(0, 300) : null,
      page: page ? String(page).slice(0, 60) : null,
      agentCode: sess?.agentCode || null, isManager: !!sess?.isManager,
      ip: getRealIp(req), device: deviceType(req.headers['user-agent'] || ''),
      ua: (req.headers['user-agent'] || '').substring(0, 150),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'server_error' }); }
});

// Lightweight funnel events (zikuy_form_started/submitted/abandoned) — one
// line per event, append-only. Starter scope per Vault research note
// 2026-08-25 ("behavioral analytics for internal B2B apps"): only the zikuy
// form funnel for now, not the full category list from that research —
// expand events.jsonl consumers if more categories are needed later.
const EVENTS_FILE = path.join(__dirname, 'data', 'events.jsonl');
app.post('/api/event', requireAuth, dataRateLimit, (req, res) => {
  try {
    const { event, custId, itemCount } = req.body || {};
    if (!event || typeof event !== 'string' || event.length > 40) return res.status(400).json({ error: 'invalid event' });
    fs.appendFileSync(EVENTS_FILE, JSON.stringify({
      ts: new Date().toISOString(), event,
      custId: custId ? String(custId).slice(0, 20) : null,
      itemCount: Number.isFinite(itemCount) ? itemCount : null,
      agentCode: req.session?.agentCode || null,
    }) + '\n', 'utf8');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'server_error' }); }
});

// ── Server-side render of the zikuy share blank ─────────────────────────────
// 2026-08-24 — three separate client-side fixes (html2canvas→snapDOM, paint-
// wait, concurrent-capture guard) each closed a real, confirmed bug and each
// still left iOS Safari specifically (never Android) producing a blank table
// in the shared image, unreproducible in any test harness. Root cause is
// "phones are an unbounded set of timing/memory/WebKit-version edge cases,"
// not any single bug — so the fix moves the actual rasterization off the
// phone entirely. Opens docs/zikuy-order.html itself (same file, same CSS,
// same snapDOM capture code) in a real, controlled headless Chromium on this
// VPS via a `_shareData` param the page reads on load (see initRenderMode()
// in that file) — the agent's phone never runs any of it, just receives the
// finished PNG. One warm browser instance is reused across requests (each
// request still gets its own fresh page/tab — no state shared between
// captures) to avoid paying the ~1s browser-launch cost on every share.
let _renderBrowser = null;
async function getRenderBrowser() {
  if (!_renderBrowser) {
    _renderBrowser = puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    _renderBrowser.catch(() => { _renderBrowser = null; }); // launch itself failed — allow retry next call
  }
  try {
    return await _renderBrowser;
  } catch (e) {
    _renderBrowser = null;
    throw e;
  }
}
app.post('/api/render-share-image', requireAuth, renderRateLimit, async (req, res) => {
  const { custId, custName, city, agentCode, agentName, barcodeMode, items } = req.body || {};
  if (!custId || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'invalid payload' });
  if (items.length > 200) return res.status(400).json({ error: 'too many items' });
  // qty must actually be numeric — this used to be guaranteed by the interactive
  // qty-stepper widget alone; now that it can arrive as raw JSON, reject bad
  // shapes here instead of coercing to a string (renderProformaTable() also
  // escapes it client-side as defense in depth, but the boundary is here).
  if (items.some(it => !Number.isFinite(it.qty))) return res.status(400).json({ error: 'invalid qty' });
  const payload = Buffer.from(JSON.stringify({
    items: items.slice(0, 200).map(it => ({
      sku: String(it.sku || '').slice(0, 30), name: String(it.name || '').slice(0, 200),
      imgUrl: String(it.imgUrl || '').slice(0, 300), lastShipDate: it.lastShipDate || null,
      lastShipQty: Number.isFinite(it.lastShipQty) ? it.lastShipQty : null,
      ean: String(it.ean || '').slice(0, 20), famCode: String(it.famCode || '').slice(0, 10),
      qty: it.qty, date: String(it.date || '').slice(0, 20),
      option: String(it.option || '').slice(0, 40),
    })),
    barcodeMode: !!barcodeMode,
  })).toString('base64');
  const qs = new URLSearchParams({
    custId: String(custId).slice(0, 20), custName: String(custName || '').slice(0, 100),
    city: String(city || '').slice(0, 50), agentCode: String(agentCode || '').slice(0, 20),
    agentName: String(agentName || '').slice(0, 50), _shareData: payload,
    // Keeps this internal render instance's own API calls (img-proxy included)
    // on loopback instead of round-tripping through the public domain/Cloudflare
    // — live symptom: table rendered fine, product photos came through blank
    // (headless-Chrome UA getting blocked/challenged at the edge). 2026-08-24.
    _apiBase: `http://localhost:${PORT}`,
  });
  let page;
  try {
    const browser = await getRenderBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1600 });
    await page.goto(`http://localhost:${PORT}/zikuy-order.html?${qs}`, { waitUntil: 'load', timeout: 15000 });
    const base64 = await page.evaluate(async () => {
      if (!window.__renderReady) throw new Error('not_in_render_mode');
      const blob = await window.__renderReady;
      if (!blob) throw new Error('capture_failed');
      const buf = await blob.arrayBuffer();
      let binary = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.from(base64, 'base64'));
  } catch (e) {
    console.error('[render-share-image]', e.message);
    res.status(500).json({ error: 'render_failed' });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// ── GPS Sync Check: compare corrections vs PBI coords ───────────────────────
function haversineDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// GET /api/gps-sync-check — returns corrections that match PBI coords (within threshold)
app.get('/api/gps-sync-check', requireAuth, (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const THRESHOLD_M = 20;
  const filePath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
  const corrections = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  const synced = [];
  const pending = [];
  for (const [custId, corr] of Object.entries(corrections)) {
    const pbi = pbiCache.clientMap.get(String(custId));
    if (!pbi || !pbi.lat || !pbi.lng) { pending.push({ custId, name: corr.name, reason: 'not_in_pbi' }); continue; }
    const dist = haversineDist(corr.lat, corr.lng, Number(pbi.lat), Number(pbi.lng));
    if (dist <= THRESHOLD_M) {
      synced.push({ custId, name: corr.name, city: corr.city, dist: Math.round(dist), correctedAt: corr.correctedAt });
    } else {
      pending.push({ custId, name: corr.name, city: corr.city, dist: Math.round(dist) });
    }
  }
  res.json({ synced, pending, threshold: THRESHOLD_M, total: Object.keys(corrections).length });
});

// POST /api/gps-sync-clean — delete confirmed synced corrections
app.post('/api/gps-sync-clean', requireAuth, (req, res) => {
  try {
    const { custIds } = req.body;
    if (!Array.isArray(custIds) || !custIds.length) return res.status(400).json({ error: 'custIds required' });
    const filePath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    const corrections = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
    const removed = [];
    for (const id of custIds) {
      if (corrections[String(id)]) { removed.push(String(id)); delete corrections[String(id)]; }
    }
    const json = JSON.stringify(corrections, null, 2);
    fs.writeFileSync(filePath, json, 'utf8');
    writeLog({ ts: new Date().toISOString(), event: 'gps-sync-clean', removed, ip: getRealIp(req) });
    pushGpsToGithub(json).catch(e => console.error('GitHub push failed:', e.message));
    res.json({ ok: true, removed: removed.length, remaining: Object.keys(corrections).length });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// ── GPS VERSIONS — named snapshots of gps-corrections.json ──────────────────
const GPS_VERSIONS_PATH = path.join(__dirname, '..', 'docs', 'gps-versions.json');
function readGpsVersions() {
  try { return JSON.parse(fs.readFileSync(GPS_VERSIONS_PATH, 'utf8')); } catch (_) { return []; }
}
function writeGpsVersions(arr) {
  fs.writeFileSync(GPS_VERSIONS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

// POST /api/gps/save-version — save named snapshot of corrections + day/agent overrides
app.post('/api/gps/save-version', requireAuth, (req, res) => {
  try {
    const { name, visitOrder } = req.body;
    if (!name || typeof name !== 'string' || name.length > 80) return res.status(400).json({ error: 'invalid name' });
    const correctionsPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    let corrections = {};
    try { corrections = JSON.parse(fs.readFileSync(correctionsPath, 'utf8')); } catch (_) {}
    let overrides = {};
    try { if (fs.existsSync(OVERRIDES_FILE)) overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')); } catch (_) {}
    const id = Date.now().toString();
    const version = {
      id, name: name.trim(), createdAt: new Date().toISOString(),
      gpsCount: Object.keys(corrections).length,
      overridesCount: Object.keys(overrides).length,
      corrections, overrides,
      visitOrder: Array.isArray(visitOrder) ? visitOrder : []
    };
    const versions = readGpsVersions();
    versions.unshift(version);
    if (versions.length > 30) versions.splice(30);
    writeGpsVersions(versions);
    writeLog({ ts: new Date().toISOString(), event: 'gps-version-save', name: name.trim(), gpsCount: version.gpsCount, overridesCount: version.overridesCount, ip: getRealIp(req) });
    res.json({ ok: true, id, gpsCount: version.gpsCount, overridesCount: version.overridesCount, total: versions.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// GET /api/gps/versions — list of saved versions (no body content)
app.get('/api/gps/versions', requireAuth, (req, res) => {
  const versions = readGpsVersions().map(({ id, name, createdAt, gpsCount, overridesCount, count, visitOrder }) => ({ id, name, createdAt, gpsCount: gpsCount ?? count ?? 0, overridesCount: overridesCount ?? 0, visitOrder: visitOrder || [] }));
  res.json(versions);
});

// POST /api/gps/restore-version — restore corrections + overrides from a version
app.post('/api/gps/restore-version', requireAuth, (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const versions = readGpsVersions();
    const v = versions.find(x => x.id === id);
    if (!v) return res.status(404).json({ error: 'version not found' });
    // Restore GPS corrections
    const correctionsPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    const json = JSON.stringify(v.corrections, null, 2);
    fs.writeFileSync(correctionsPath, json, 'utf8');
    pushGpsToGithub(json).catch(e => console.error('GitHub push failed:', e.message));
    // Restore overrides if present
    if (v.overrides && Object.keys(v.overrides).length) {
      fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(v.overrides, null, 2), 'utf8');
    }
    writeLog({ ts: new Date().toISOString(), event: 'gps-version-restore', id, name: v.name, ip: getRealIp(req) });
    res.json({ ok: true, name: v.name, gpsCount: Object.keys(v.corrections).length, overridesCount: Object.keys(v.overrides || {}).length, visitOrder: v.visitOrder || [] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// GET /api/gps-pending-xlsx — Excel of all corrections not yet in PBI
app.get('/api/gps-pending-xlsx', requireAuth, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const THRESH = 20;
  const filePath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
  const corrections = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  const pending = [];
  for (const [custId, corr] of Object.entries(corrections)) {
    const pbi = pbiCache.clientMap.get(String(custId));
    const dist = (pbi && pbi.lat && pbi.lng) ? Math.round(haversineDist(corr.lat, corr.lng, Number(pbi.lat), Number(pbi.lng))) : null;
    if (dist === null || dist > THRESH) pending.push({ custId, ...corr, pbiLat: pbi?.lat||null, pbiLng: pbi?.lng||null, dist });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GPS Pending', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  const COLS = [
    { name: 'מס. לקוח', width: 14 }, { name: 'שם לקוח', width: 30 }, { name: 'עיר', width: 16 },
    { name: 'כתובת', width: 26 }, { name: 'קו רוחב (תיקון)', width: 16 }, { name: 'קו אורך (תיקון)', width: 16 },
    { name: 'קו רוחב PBI', width: 14 }, { name: 'קו אורך PBI', width: 14 },
    { name: "מרחק (מ')", width: 12 }, { name: 'תאריך תיקון', width: 18 },
  ];
  ws.addTable({ name: 'GpsPending', ref: 'A1', headerRow: true, totalsRow: false,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: COLS.map(c => ({ name: c.name, filterButton: true })),
    rows: pending.map(p => [
      String(p.custId), p.name||'', p.city||'', p.address||'',
      p.lat ? +parseFloat(p.lat).toFixed(6) : '',
      p.lng ? +parseFloat(p.lng).toFixed(6) : '',
      p.pbiLat ? +parseFloat(p.pbiLat).toFixed(6) : 'חסר ב-PBI',
      p.pbiLng ? +parseFloat(p.pbiLng).toFixed(6) : 'חסר ב-PBI',
      p.dist !== null ? p.dist : 'N/A',
      p.correctedAt ? new Date(p.correctedAt).toLocaleString('he-IL') : '',
    ]),
  });
  COLS.forEach((c, i) => { ws.getColumn(i+1).width = c.width; });
  const hdr = ws.getRow(1);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  const F1 = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
  const F2 = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF5F5F5' } };
  pending.forEach((_, i) => { const r=ws.getRow(i+2); r.fill = i%2===0?F1:F2; r.eachCell(c=>{c.fill=i%2===0?F1:F2;}); });

  // ── Sheet 2: חסר GPS (no-gps — outside IL bounds or truly missing) ──
  const DOUBTFUL_SOURCES = new Set(['geocoded','pbi-sibling-near','city-center','no-gps']);
  const seen = new Set();
  const noGpsClients = [], doubtfulClients = [];
  for (const [, c] of pbiCache.clientMap) {
    if (seen.has(c.custId)) continue; seen.add(c.custId);
    if (c.gpsSource === 'no-gps' || !c.lat || !c.lng) noGpsClients.push(c);
    else if (DOUBTFUL_SOURCES.has(c.gpsSource)) doubtfulClients.push(c);
  }
  const GEO_COLS = [
    { name: 'מס. לקוח', width: 14 }, { name: 'שם לקוח', width: 30 }, { name: 'עיר', width: 16 },
    { name: 'כתובת', width: 26 }, { name: 'קו רוחב', width: 13 }, { name: 'קו אורך', width: 13 },
    { name: 'מקור GPS', width: 16 }, { name: 'קוד סוכן', width: 12 }, { name: 'שם סוכן', width: 22 },
  ];
  const makeGeoRow = c => [
    String(c.custId||''), c.custName||'', c.city||'', c.address||'',
    c.lat ? +parseFloat(c.lat).toFixed(6) : '', c.lng ? +parseFloat(c.lng).toFixed(6) : '',
    c.gpsSource||'', c.agentCode||'', c.agentName||'',
  ];
  const addGeoSheet = (name, tableName, rows, hdrArgb) => {
    const s = wb.addWorksheet(name, { views:[{ rightToLeft:true, state:'frozen', ySplit:1 }] });
    s.addTable({ name: tableName, ref:'A1', headerRow:true, totalsRow:false,
      style:{ theme:'TableStyleLight1', showRowStripes:false },
      columns: GEO_COLS.map(c=>({ name:c.name, filterButton:true })),
      rows: rows.map(makeGeoRow),
    });
    GEO_COLS.forEach((c,i)=>{ s.getColumn(i+1).width=c.width; });
    const h=s.getRow(1); h.font={bold:true,color:{argb:'FFFFFFFF'}}; h.fill={type:'pattern',pattern:'solid',fgColor:{argb:hdrArgb}};
    rows.forEach((_,i)=>{ const r=s.getRow(i+2); r.eachCell(cell=>{ cell.fill=i%2===0?F1:F2; }); });
  };
  addGeoSheet('חסר GPS', 'NoGpsTable', noGpsClients, 'FFB71C1C');       // red header
  addGeoSheet('לא מדויק', 'DoubtfulTable', doubtfulClients, 'FFE65100'); // orange header

  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(`GPS_Pending_${date}.xlsx`)}`);
  await wb.xlsx.write(res); res.end();
});

// POST /api/export-all-days-xlsx — multi-sheet Excel, one sheet per day
app.post('/api/export-all-days-xlsx', requireAuth, dataRateLimit, async (req, res) => {
  try {
  const { agentCode, agentName, dayOverrides = {}, savedOrders = {} } = req.body;
  if (!agentCode) return res.status(400).json({ error: 'agentCode required' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const formulaClients = pbiCache.byAgent.get(agentCode) || [];
  if (!formulaClients.length) return res.status(404).json({ error: 'no clients' });
  // Merge ICE-only clients (same logic as /customers)
  const allFormulaIds = new Set(formulaClients.map(c => c.custId));
  const iceAll = pbiCache.iceByAgent?.get(agentCode) || [];
  const iceOnly = iceAll.filter(c => !allFormulaIds.has(c.custId));
  const allClients = [...formulaClients, ...iceOnly];
  const corrPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
  const corrections = fs.existsSync(corrPath) ? JSON.parse(fs.readFileSync(corrPath, 'utf8')) : {};
  const aiGpsPath = path.join(__dirname, '..', 'docs', 'google-gps.json');
  const aiGps = fs.existsSync(aiGpsPath) ? JSON.parse(fs.readFileSync(aiGpsPath, 'utf8')) : {};
  const DAY_ORDER = ['א','ב','ג','ד','ה','ו'];
  const DAY_LABEL = {1:'א',2:'ב',3:'ג',4:'ד',5:'ה'};
  const byDay = {};
  for (const c of allClients) {
    // Apply dayOverrides: use overridden day if set, else original
    const overriddenDay = dayOverrides[String(c.custId)];
    const d = overriddenDay ? (DAY_LABEL[overriddenDay] || String(overriddenDay)) : (c.dayLabel || String(c.dayNum||''));
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(c);
  }
  const days = DAY_ORDER.filter(d=>byDay[d]).concat(Object.keys(byDay).filter(d=>d && !DAY_ORDER.includes(d)));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Formula Road';
  const THRESH = 20;
  const DOUBTFUL = new Set(['geocoded','pbi-sibling-near','city-center','no-gps']);
  const FILLS = {
    G1:{type:'pattern',pattern:'solid',fgColor:{argb:'FFC8E6C9'}}, G2:{type:'pattern',pattern:'solid',fgColor:{argb:'FFA5D6A7'}},
    OR:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFFCC80'}},
    GR1:{type:'pattern',pattern:'solid',fgColor:{argb:'FFECEFF1'}}, GR2:{type:'pattern',pattern:'solid',fgColor:{argb:'FFE0E0E0'}},
    W:{type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'}}, S:{type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F5F5'}},
  };
  const DAY_NUM = {'א':1,'ב':2,'ג':3,'ד':4,'ה':5};
  for (const day of days) {
    const dayNum = DAY_NUM[day];
    const savedOrder = dayNum && savedOrders[dayNum] ? savedOrders[dayNum] : null;
    let clients;
    if (savedOrder && savedOrder.length) {
      const byId = Object.fromEntries((byDay[day]||[]).map(c=>[String(c.custId),c]));
      const ordered = savedOrder.map(id=>byId[id]).filter(Boolean);
      const rest = (byDay[day]||[]).filter(c=>!savedOrder.includes(String(c.custId)));
      clients = [...ordered, ...rest];
    } else {
      clients = (byDay[day]||[]).sort((a,b)=>(a.priorityOrder||999)-(b.priorityOrder||999));
    }
    const ws = wb.addWorksheet(day, { views:[{ rightToLeft:true, state:'frozen', ySplit:1 }] });
    const COLS = [
      {name:'סדר ביקור מתוקן',width:8},{name:'מס. לקוח',width:14},{name:'שם לקוח',width:28},
      {name:'חברה',width:10},
      {name:'עיר',width:16},{name:'כתובת',width:26},{name:'קו רוחב',width:13},{name:'קו אורך',width:13},
      {name:'GPS',width:14},{name:'סדר ביקור PRIORITY',width:15},
      {name:'קו רוחב Google',width:14},{name:'קו אורך Google',width:14},
    ];
    const rowData = clients.map((c,i) => {
      const corr = corrections[String(c.custId)];
      const lat = corr ? corr.lat : (c.lat||null);
      const lng = corr ? corr.lng : (c.lng||null);
      const pbiLat = c.lat ? Number(c.lat) : null;
      const pbiLng = c.lng ? Number(c.lng) : null;
      let gps = lat&&lng ? '✓' : 'חסר';
      let isChanged = false;
      if (corr) {
        const dist = pbiLat&&pbiLng ? haversineDist(corr.lat,corr.lng,pbiLat,pbiLng) : Infinity;
        isChanged = dist > THRESH;
        gps = isChanged ? '✓ CHANGED' : '✓';
      }
      const ai = aiGps[String(c.custId)];
      const hevra = c.iceOnly ? 'ICE' : 'FORMULA';
      return {
        row:[i+1,String(c.custId||''),c.custName||'',hevra,c.city||'',c.address||'',
          lat?+parseFloat(lat).toFixed(6):'', lng?+parseFloat(lng).toFixed(6):'',
          gps, c.priorityOrder||'',
          ai?.aiLat||'', ai?.aiLng||''],
        isChanged, gpsSource:c.gpsSource||null, noOrder:!c.priorityOrder, even:i%2===0, isIce:!!c.iceOnly,
      };
    });
    ws.addTable({ name:`RouteTable_${day.charCodeAt(0)}`, ref:'A1', headerRow:true, totalsRow:false,
      style:{theme:'TableStyleLight1',showRowStripes:false},
      columns:COLS.map(c=>({name:c.name,filterButton:true})),
      rows:rowData.map(r=>r.row),
    });
    COLS.forEach((c,i)=>{ ws.getColumn(i+1).width=c.width; });
    ws.getRow(1).height=22;
    for(let ci=1;ci<=COLS.length;ci++){
      const cell=ws.getCell(1,ci);
      cell.font={bold:true,color:{argb:'FFFFFFFF'},size:10};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1565C0'}};
      cell.alignment={horizontal:'right',vertical:'middle'};
    }
    const FILL_ICE1={type:'pattern',pattern:'solid',fgColor:{argb:'FFB2DFDB'}};
    const FILL_ICE2={type:'pattern',pattern:'solid',fgColor:{argb:'FF80CBC4'}};
    rowData.forEach((r,i) => {
      const rowNum=i+2;
      let f = r.isIce      ? (r.even?FILL_ICE1:FILL_ICE2)
             : r.isChanged ? (r.even?FILLS.G1:FILLS.G2)
             : r.noOrder   ? (r.even?FILLS.GR1:FILLS.GR2)
             : DOUBTFUL.has(r.gpsSource) ? FILLS.OR
             : (r.even?FILLS.W:FILLS.S);
      const row=ws.getRow(rowNum); row.height=18;
      for(let col=1;col<=COLS.length;col++){
        const cell=ws.getCell(rowNum,col); cell.fill=f;
        cell.alignment={horizontal:'right',vertical:'middle'};
      }
    });
  }
  const today=new Date().toISOString().slice(0,10);
  const fname=`מסלול_${agentName||agentCode}_כל_הימים_${today}.xlsx`;
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
  await wb.xlsx.write(res); res.end();
  } catch (err) { console.error('[export-all-days-xlsx]', err); if (!res.headersSent) res.status(500).json({ error: 'export_failed' }); }
});

// ── Territory Planner (one-time) ──────────────────────────────────────────────
app.get('/api/territory/clients', requireAuth, async (req, res) => {
  try {
    if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
    const corrPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    const corrections = fs.existsSync(corrPath) ? JSON.parse(fs.readFileSync(corrPath, 'utf8')) : {};
    const result = []; const seen = new Set();
    for (const [agentCode, clients] of pbiCache.byAgent) {
      for (const c of clients) {
        const id = String(c.custId);
        if (seen.has(id)) continue; seen.add(id);
        const corr = corrections[id];
        const lat = corr ? corr.lat : c.lat;
        const lng = corr ? corr.lng : c.lng;
        if (!lat || !lng) continue;
        result.push({ custId: c.custId, name: c.custName, city: c.city, lat, lng, agentCode, agentName: c.agentName || agentCode });
      }
    }
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/territory/jerusalem', requireAuth, async (req, res) => {
  try {
    if (!pbiCache) return res.json([]);
    const corrPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    const corrections = fs.existsSync(corrPath) ? JSON.parse(fs.readFileSync(corrPath, 'utf8')) : {};
    const result = []; const seen = new Set();
    for (const [agentCode, clients] of pbiCache.byAgent) {
      for (const c of clients) {
        const id = String(c.custId);
        if (seen.has(id)) continue; seen.add(id);
        if (!(c.city||'').includes('ירושלים')) continue;
        const corr = corrections[id];
        const lat = corr ? corr.lat : c.lat;
        const lng = corr ? corr.lng : c.lng;
        if (!lat || !lng) continue;
        result.push({ custId: c.custId, name: c.custName, city: c.city, lat, lng, agentCode, agentName: c.agentName || agentCode });
      }
    }
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Territory variants (save/restore redistribution experiments) ──────────────
const VARIANTS_PATH = path.join(__dirname, '..', 'docs', 'territory-variants.json');
function _loadVariants(){ try{ return JSON.parse(fs.readFileSync(VARIANTS_PATH,'utf8')); }catch(_){ return []; } }
function _saveVariants(v){ fs.writeFileSync(VARIANTS_PATH, JSON.stringify(v, null, 2)); }

app.get('/api/territory/variants', requireAuth, (req, res) => {
  res.json(_loadVariants());
});
app.post('/api/territory/variants', requireAuth, (req, res) => {
  const { name, city, moves } = req.body;
  if (!name || !city || !moves) return res.status(400).json({ error: 'missing fields' });
  const list = _loadVariants();
  const id = Date.now();
  list.unshift({ id, name, city, moves, savedAt: new Date().toISOString(), moveCount: Object.keys(moves).length });
  if (list.length > 100) list.splice(100);
  _saveVariants(list);
  res.json({ ok: true, id });
});
app.delete('/api/territory/variants/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  _saveVariants(_loadVariants().filter(v => v.id !== id));
  res.json({ ok: true });
});

// Cities where 2+ agents have clients (for territory analysis)
app.get('/api/territory/cities', requireAuth, async (req, res) => {
  try {
    if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
    const cityMap = new Map(); // city → { agents: Set, count: 0 }
    for (const [agentCode, clients] of pbiCache.byAgent) {
      for (const c of clients) {
        if (!c.city) continue;
        if (!cityMap.has(c.city)) cityMap.set(c.city, { agents: new Set(), count: 0 });
        cityMap.get(c.city).agents.add(agentCode);
        cityMap.get(c.city).count++;
      }
    }
    const result = [];
    for (const [city, d] of cityMap) {
      result.push({ city, agentCount: d.agents.size, clientCount: d.count });
    }
    result.sort((a, b) => b.clientCount - a.clientCount);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// All clients in a city, grouped by agent
app.get('/api/territory/city', requireAuth, async (req, res) => {
  try {
    if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
    const { city } = req.query;
    if (!city) return res.status(400).json({ error: 'city required' });
    const corrPath = path.join(__dirname, '..', 'docs', 'gps-corrections.json');
    const corrections = fs.existsSync(corrPath) ? JSON.parse(fs.readFileSync(corrPath, 'utf8')) : {};
    const agentMap = new Map(); // agentCode → { agentCode, agentName, manager, clients[] }
    for (const [agentCode, clients] of pbiCache.byAgent) {
      const cityClients = clients.filter(c => c.city === city);
      if (!cityClients.length) continue;
      const corr = (c) => corrections[String(c.custId)];
      agentMap.set(agentCode, {
        agentCode,
        agentName: cityClients[0].agentName || agentCode,
        manager:   cityClients[0].manager   || '',
        clients: cityClients.map(c => ({
          custId:      c.custId,
          custName:    c.custName,
          address:     c.address,
          dayNum:      c.dayNum,
          lat: corr(c) ? corr(c).lat : c.lat,
          lng: corr(c) ? corr(c).lng : c.lng,
          monthlySales: c.monthlySales,
          avg6Sales:    c.avg6Sales,
          avg6Orders:   c.avg6Orders,
          target:       c.target,
          sadran:       c.sadran || '',
          iceOnly:      c.iceOnly || false,
        })),
      });
    }
    res.json({ city, agents: [...agentMap.values()] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/territory/geocode', requireAuth, dataRateLimit, async (req, res) => {
  try {
    const { q } = req.body;
    if (!q) return res.status(400).json({ error: 'q required' });
    if (!process.env.GOOGLE_MAPS_KEY) return res.status(503).json({ error: 'no key' });
    const cacheFile = path.join(__dirname, '..', 'docs', 'google-geocode-cache.json');
    const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
    if (cache[q]) return res.json(cache[q]);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=he&region=il&key=${process.env.GOOGLE_MAPS_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    const loc = d?.results?.[0]?.geometry?.location;
    if (loc) { cache[q] = { lat: loc.lat, lng: loc.lng }; fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)); }
    res.json(loc || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Save planogram base JSON back to docs/
app.post('/save-kapua', requireAuth, mahsanIpGuard, (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.picks) return res.status(400).json({ error: 'invalid payload' });
    if (!req.session?.isManager) return res.status(403).json({ error: 'managers only' });
    const dest = path.join(__dirname, '..', 'docs', 'kapua-base.json');
    fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
    // Audit log
    writeLog({ ts: new Date().toISOString(), event: 'planogram-save',
      picks: Object.keys(data.picks || {}).length, ip: getRealIp(req) });
    res.json({ ok: true, v: data.v });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// ── ג normalization: ג'004 / 'ג032 → 004 ג ──────────────────────────────────
function fixGimel(s) {
  if (!s) return s;
  // apostrophe before gimel: 'ג032 → 032 ג
  s = s.replace(/[\u0027\u2018\u2019\u05F3\u02BC\u00B4`]\s*\u05D2\s*(\d+)[\u0027\u2019\u05F3]?/g, ' $1 \u05D2');
  // digits before gimel+apostrophe: 0021ג' → 0021 ג  (actual PBI format)
  s = s.replace(/(\d+)\u05D2[\u0027\u2018\u2019\u05F3\u02BC\u00B4`]/g, '$1 \u05D2 ');
  // gimel before digits (no apostrophe): ג025 → 025 ג
  s = s.replace(/\u05D2[\u0027\u2018\u2019\u05F3\u02BC\u00B4`]?\s*(\d+)[\u0027\u2019\u05F3]?/g, ' $1 \u05D2');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// ── BiDi decode (same logic as export-gps-report.js) ────────────────────────
const _BIDI_TEST  = /[‎‏‪-‮]/;
const _BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = _BIDI_TEST.test(raw);
  const s = raw.replace(_BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const fixed = s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('').replace(/\d+/g, m => m.split('').reverse().join('')) : w)
    .join(' ');
  // BiDi visual encoding mirrors parentheses — swap them back
  return fixed.replace(/\(/g, '\x01').replace(/\)/g, '(').replace(/\x01/g, ')');
}

// GET /api/mekarer-parts — product names for the 6 refrigerator codes.
// Was 4 (901301/302/401/402, all chest-freezer "אמבטיה" models) — missed 901303
// (also chest) and 901405 (the only upright/"עומד" model) since the feature was
// first built (ae7dfecd, 2026-06-04), copied straight from the catalog without
// checking completeness. Found live 2026-09-01: the original 4 codes have ZERO
// sales in ALL_PARTS ever, while both missing ones have real recent sales
// (901405 last 2025-05-27, 901303 last 2025-09-28) — the form was offering
// unordered models and hiding the ones agents actually sell.
//
// 901303/901405 are NOT in 'KARTIS PARIT' (verified live, two independent ways —
// exact IN-filter and a full-table CONTAINSSTRING scan both come back empty) even
// though they're real, sold SKUs — they only exist in ALL_PARTS (the sales/fact
// table). So this is two queries, not one: the master-catalog table for the
// original 4, plus a direct makat lookup against ALL_PARTS for the 2 that the
// catalog is missing. ALL_PARTS uses a different SKU column name/quote style
// ([מק'ט], not KARTIS PARIT's [מק"ט]) and a different name column ([תאור מוצר],
// not [תאור]) — confirmed live, not guessed.
app.get('/api/mekarer-parts', requireAuth, async (req, res) => {
  try {
    const [catalogRows, allPartsRows] = await Promise.all([
      executeDax(`
EVALUATE
FILTER(
  SELECTCOLUMNS('KARTIS PARIT', "makat", 'KARTIS PARIT'[מק"ט], "name", 'KARTIS PARIT'[תאור]),
  [makat] IN {"901301", "901302", "901401", "901402"}
)
`),
      executeDax(`
EVALUATE
DISTINCT(
  SELECTCOLUMNS(
    FILTER(ALL_PARTS, ALL_PARTS[מק'ט] = "901303" || ALL_PARTS[מק'ט] = "901405"),
    "makat", ALL_PARTS[מק'ט],
    "name", ALL_PARTS[תאור מוצר]
  )
)
`),
    ]);
    const parts = [...catalogRows, ...allPartsRows].map(r => ({
      makat: r['[makat]'],
      name: fixBiDi(r['[name]']),
    }));
    res.json(parts);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/client-sales?custId=X&company=X — last 12 months sales per (month, company)
app.get('/api/client-sales', requireAuth, async (req, res) => {
  const custId = parseInt(req.query.custId);
  if (!custId) return res.status(400).json({ error: 'custId required' });
  const company = req.query.company || '';
  if (company && !/^[֐-׿a-zA-Z0-9 \-]{1,60}$/.test(company)) {
    return res.status(400).json({ error: 'invalid company' });
  }
  const ALLOWED_COMPANIES = new Set(['FORMULA', 'INTER', 'ICE', 'הכל', '']);
  if (company && !ALLOWED_COMPANIES.has(company)) {
    return res.status(400).json({ error: 'invalid company' });
  }
  const companyArg = company && company !== 'הכל'
    ? `,\n  ALL_PARTS[חברה] = "${company}"`
    : '';
  const SKIP_CATS = new Set(['ציוד', 'שאריות', 'תגמולים']);
  try {
    const rows = await executeDax(`
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[תאריך], ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "sales", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),
  ALL_PARTS[מספר לקוח] = "${custId}"${companyArg}
)
ORDER BY ALL_PARTS[תאריך] DESC
`);
    // Aggregate by month + מחלקה
    const monthMap = {};
    const catTotals = {};
    for (const r of rows) {
      const d = r['ALL_PARTS[תאריך]'];
      const s = r['[sales]'] || 0;
      if (!d || !s) continue;
      const dt = new Date(d);
      const mKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const rawCat = r['[מחלקה]'] || '';
      if (!rawCat) continue;
      const cat = fixBiDi(rawCat);
      if (!cat || SKIP_CATS.has(cat)) continue;
      if (!monthMap[mKey]) monthMap[mKey] = {};
      monthMap[mKey][cat] = Math.round((monthMap[mKey][cat] || 0) + s);
      catTotals[cat] = (catTotals[cat] || 0) + s;
    }
    // Top 7 categories by total sales
    const topCats = Object.entries(catTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 7)
      .map(([c]) => c);
    const months = Object.entries(monthMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 24)
      .map(([month, cats]) => {
        const row = { month };
        let total = 0;
        for (const cat of topCats) { row[cat] = cats[cat] || 0; total += row[cat]; }
        // other = everything not in top7
        const other = Object.entries(cats)
          .filter(([c]) => !topCats.includes(c))
          .reduce((s, [, v]) => s + v, 0);
        row['אחרים'] = Math.round(other);
        total += other;
        row.total = Math.round(total);
        return row;
      });
    res.json({ months, categories: topCats });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/mekarer-order — save equipment order
app.post('/api/mekarer-order', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.custId) return res.status(400).json({ error: 'invalid order' });
    const order = {
      custId:      String(body.custId).substring(0, 20),
      custName:    String(body.custName    || '').substring(0, 100),
      city:        String(body.city        || '').substring(0, 60),
      agentName:   String(body.agentName   || '').substring(0, 60),
      contactName: String(body.contactName || '').substring(0, 80),
      phone:       String(body.phone       || '').substring(0, 20),
      location:    String(body.location    || '').substring(0, 200),
      mekarerim:   Array.isArray(body.mekarerim) ? body.mekarerim.slice(0, 50) : [],
      manager:     String(body.manager     || '').substring(0, 60),
    };
    const filePath = path.join(__dirname, '..', 'docs', 'mekarer-orders.json');
    console.log(`[mekarer-order] saving to: ${filePath}`);
    const list = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
    const id = Date.now();
    list.push({ id, ...order, submittedAt: new Date().toISOString(),
      agentCode: req.session?.agentCode || null });
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
    writeLog({ ts: new Date().toISOString(), event: 'mekarer-order', id,
      custId: String(order.custId), agentCode: req.session?.agentCode || null, ip: getRealIp(req) });
    res.json({ ok: true, id });
    // Send email notification with Excel attachment (fire-and-forget)
    if (resend && process.env.NOTIFY_EMAIL) {
      (async () => {
        try {
          // ── Build Excel ──────────────────────────────────────────────
          const wb = new ExcelJS.Workbook();
          wb.creator = 'COLUMBUS'; wb.created = new Date();
          const ws = wb.addWorksheet('הזמנת מקרר', { views: [{ rightToLeft: true }] });

          const BLUE = '1A3F7C', WHITE = 'FFFFFF', LGRAY = 'F2F4F7', DGRAY = '555555';
          const hFill  = { type:'pattern', pattern:'solid', fgColor:{ argb: 'FF'+BLUE } };
          const gFill  = { type:'pattern', pattern:'solid', fgColor:{ argb: 'FF'+LGRAY } };
          const boldW  = { bold:true, color:{ argb:'FF'+WHITE }, size:12 };
          const boldB  = { bold:true, size:11 };
          const gray   = { color:{ argb:'FF'+DGRAY }, size:10 };

          // Title row — centerContinuous instead of merge
          const nowStr = new Date().toLocaleString('he-IL');
          const title = ws.getCell('A1');
          title.value = `הזמנת מקרר חדשה — ${order.custName}`;
          title.font = { ...boldW, size:14 }; title.fill = hFill;
          title.alignment = { horizontal:'centerContinuous', vertical:'middle' };
          ws.getRow(1).height = 32;

          // Info rows — no merge, label col A, value col B
          const info = [
            ['לקוח', order.custName], ['מספר לקוח', String(order.custId || '')], ['עיר', order.city],
            ['סוכן', order.agentName], ['מנהל', order.manager],
            ['איש קשר', order.contactName], ['טלפון', order.phone],
            ['מיקום', order.location],
            ['תאריך הזמנה', nowStr],
            ['מספר הזמנה', String(id)],
          ];
          info.forEach(([label, val], i) => {
            const r = i + 2;
            const altFill = i % 2 === 0 ? gFill : { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFFF' } };
            const lCell = ws.getCell(`A${r}`); lCell.value = label;
            lCell.font = gray; lCell.alignment = { horizontal:'right' };
            lCell.fill = altFill;
            const vCell = ws.getCell(`B${r}`); vCell.value = val || '';
            vCell.font = i === 0 ? boldB : { size:11 };
            vCell.alignment = { horizontal:'right' };
            vCell.fill = altFill;
          });

          // Gap row
          const gapR = info.length + 2;
          ws.getRow(gapR).height = 8;

          // Equipment header
          const eqHdrR = gapR + 1;
          const eqCols = ['פעולה','דגם','סלסלות','עגלה','תאריך אספקה','דגם החזרה','תקלה'];
          eqCols.forEach((h, ci) => {
            const cell = ws.getCell(eqHdrR, ci + 1);
            cell.value = h; cell.font = boldW; cell.fill = hFill;
            cell.alignment = { horizontal:'right', vertical:'middle' };
            cell.border = { bottom:{ style:'thin', color:{ argb:'FFFFFFFF' } } };
          });
          ws.getRow(eqHdrR).height = 22;

          // Equipment rows
          order.mekarerim.forEach((m, i) => {
            const r = eqHdrR + 1 + i;
            const modelStr = m.newModelName || m.newModel || '';
            const returnStr = m.returnModelName || m.returnModel || '';
            const rowVals = [m.action||'', modelStr, m.salot||0, m.agala ? '✓' : '', m.supplyDate||'', returnStr, m.fault||''];
            const rowFill = i%2===0 ? gFill : { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFFFFF'} };
            rowVals.forEach((v, ci) => {
              const cell = ws.getCell(r, ci+1); cell.value = v; cell.fill = rowFill;
              cell.alignment = { horizontal: (ci===2||ci===3) ? 'center' : 'right', vertical:'middle' };
              cell.border = { bottom:{ style:'hair', color:{ argb:'FFDDDDDD' } } };
            });
            ws.getRow(r).height = 20;
          });

          // Column widths
          [28, 38, 8, 8, 16, 32, 24].forEach((w, i) => { ws.getColumn(i+1).width = w; });

          // Freeze header row + autofilter
          ws.views[0].state = 'frozen'; ws.views[0].ySplit = eqHdrR;
          ws.autoFilter = { from:{ row:eqHdrR, column:1 }, to:{ row:eqHdrR, column:7 } };

          const xlsBuf = await wb.xlsx.writeBuffer();
          const xlsB64 = Buffer.from(xlsBuf).toString('base64');
          const safeDate = new Date().toISOString().slice(0,10);
          const safeName = (order.custName || 'order').replace(/[^\w֐-׿ ]/g,'').trim().slice(0,30);

          // ── HTML rows ────────────────────────────────────────────────
          const mekarerRows = order.mekarerim.map(m => {
            const modelStr = m.newModel ? `${escEmail(m.newModel)}${m.newModelName && m.newModelName !== m.newModel ? ' — ' + escEmail(m.newModelName) : ''}` : '';
            return `<tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${escEmail(m.action)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${modelStr}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${Number(m.salot||0)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${m.agala?'✓':''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${escEmail(m.supplyDate)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${escEmail(m.fault)}</td>
            </tr>`;
          }).join('');

          await resend.emails.send({
            from: process.env.RESEND_FROM || 'orders@sverdlik-apps.site',
            to: process.env.NOTIFY_EMAIL.split(',').map(e => e.trim()),
            subject: `הזמנת מקרר חדשה — ${order.custName} (${order.city})`,
            attachments: [{ filename: `mekarer-${safeDate}-${safeName}.xlsx`, content: xlsB64 }],
            html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
<h2 style="background:#1A3F7C;color:#fff;padding:16px;border-radius:8px 8px 0 0;margin:0">🧊 הזמנת מקרר חדשה</h2>
<div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:20px">
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
<tr><td style="color:#666;padding:4px 0;width:120px">לקוח</td><td style="font-weight:bold">${order.custName}</td></tr>
<tr><td style="color:#666;padding:4px 0">מספר לקוח</td><td>${order.custId||''}</td></tr>
<tr><td style="color:#666;padding:4px 0">עיר</td><td>${order.city}</td></tr>
<tr><td style="color:#666;padding:4px 0">סוכן</td><td>${order.agentName}</td></tr>
<tr><td style="color:#666;padding:4px 0">מנהל</td><td>${order.manager}</td></tr>
<tr><td style="color:#666;padding:4px 0">איש קשר</td><td>${order.contactName}</td></tr>
<tr><td style="color:#666;padding:4px 0">טלפון</td><td style="text-align:right">${order.phone}</td></tr>
<tr><td style="color:#666;padding:4px 0">מיקום</td><td>${order.location}</td></tr>
</table>
<h3 style="margin:16px 0 8px">ציוד</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<tr style="background:#f5f5f5"><th style="padding:6px 8px;text-align:right">פעולה</th><th style="padding:6px 8px;text-align:right">דגם</th><th style="padding:6px 8px;text-align:center">סלסלות</th><th style="padding:6px 8px;text-align:center">עגלה</th><th style="padding:6px 8px;text-align:right">תאריך אספקה</th><th style="padding:6px 8px;text-align:right">תקלה</th></tr>
${mekarerRows}
</table>
<p style="margin-top:16px;font-size:12px;color:#aaa">📎 מצורף קובץ Excel · מזהה: ${id} · ${new Date().toLocaleString('he-IL')}</p>
</div></div>`
          });
        } catch(e) { console.error('[resend]', e.message); }
      })();
    }
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/mekarer-export — download all מקרר orders as Excel
app.get('/api/mekarer-export', requireAuth, async (req, res) => {
  try {
    const filePath = path.join(__dirname, '..', 'docs', 'mekarer-orders.json');
    const orders = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'COLUMBUS';

    function hCell(cell, text, bg, fontColor) {
      cell.value = text;
      cell.font = { bold: true, color: { argb: fontColor || 'FFFFFFFF' }, size: 11, name: 'Calibri' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg || 'FF0D47A1' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
    }
    function dCell(cell, text, opts = {}) {
      cell.value = text ?? '';
      cell.font = { size: opts.size || 10, bold: !!opts.bold, color: { argb: opts.fc || 'FF1A1A2E' }, name: 'Calibri' };
      if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } };
      cell.alignment = { horizontal: opts.align || 'right', vertical: 'middle', wrapText: !!opts.wrap };
    }
    function fmtDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
    }
    function fmtDT(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return `${fmtDate(iso)} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }

    // ── Sheet 1: Summary ────────────────────────────────────────────────────
    const ws1 = wb.addWorksheet('סיכום הזמנות', { views: [{ rightToLeft: true }] });
    ws1.mergeCells('A1:K1');
    const t1 = ws1.getCell('A1');
    t1.value = `הזמנות מקרר — FORMULA  |  ${fmtDate(new Date().toISOString())}  |  ${orders.length} הזמנות`;
    t1.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
    t1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 28;

    const s1cols = [
      ['A',5,'#'],['B',13,'מס\' לקוח'],['C',28,'שם לקוח'],['D',15,'עיר'],
      ['E',20,'שם סוכן'],['F',14,'מנהל'],['G',16,'איש קשר'],['H',14,'טלפון'],
      ['I',12,'מיקום'],['J',11,'מקררים'],['K',20,'תאריך הגשה'],
    ];
    s1cols.forEach(([k, w, lbl]) => { ws1.getColumn(k).width = w; hCell(ws1.getCell(`${k}2`), lbl); });
    ws1.getRow(2).height = 20;

    orders.forEach((o, i) => {
      const r = 3 + i;
      const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFEEF2F8';
      ws1.getRow(r).height = 18;
      dCell(ws1.getCell(`A${r}`), i+1,              { align:'center', bold:true, bg });
      dCell(ws1.getCell(`B${r}`), o.custId,          { align:'center', bg });
      dCell(ws1.getCell(`C${r}`), o.custName,        { bold:true, bg });
      dCell(ws1.getCell(`D${r}`), o.city,            { bg });
      dCell(ws1.getCell(`E${r}`), o.agentName,       { bg });
      dCell(ws1.getCell(`F${r}`), o.manager,         { bg });
      dCell(ws1.getCell(`G${r}`), o.contactName,     { bg });
      dCell(ws1.getCell(`H${r}`), o.phone,           { align:'left', bg });
      dCell(ws1.getCell(`I${r}`), o.location,        { align:'center', bg });
      dCell(ws1.getCell(`J${r}`), (o.mekarerim||[]).length, { align:'center', bold:true, bg });
      dCell(ws1.getCell(`K${r}`), fmtDT(o.submittedAt), { align:'center', bg });
    });
    ws1.autoFilter = { from: 'A2', to: `K${2+orders.length}` };
    ws1.views[0] = { rightToLeft: true, state: 'frozen', ySplit: 2 };

    // ── Sheet 2: Detail (one row per unit) ──────────────────────────────────
    const ws2 = wb.addWorksheet('פירוט מקררים', { views: [{ rightToLeft: true }] });
    const totalUnits = orders.reduce((s, o) => s + (o.mekarerim||[]).length, 0);
    ws2.mergeCells('A1:Q1');
    const t2 = ws2.getCell('A1');
    t2.value = `פירוט מקררים — ${totalUnits} יחידות`;
    t2.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    t2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 28;

    const s2cols = [
      ['A',5,'#'],['B',13,'מס\' לקוח'],['C',28,'שם לקוח'],['D',15,'עיר'],
      ['E',20,'שם סוכן'],['F',14,'מנהל'],['G',16,'איש קשר'],['H',14,'טלפון'],
      ['I',12,'מיקום'],['J',14,'פעולה'],['K',16,'דגם לספק'],['L',16,'דגם לאסוף'],
      ['M',8,'שלות'],['N',8,'עגלה'],['O',16,'תאריך אספקה'],['P',24,'הערה'],['Q',20,'הגשה'],
    ];
    s2cols.forEach(([k, w, lbl]) => { ws2.getColumn(k).width = w; hCell(ws2.getCell(`${k}2`), lbl); });
    ws2.getRow(2).height = 20;

    const ACTION_BG = { 'לספק':'FFE8F5E9','להחליף':'FFE3F2FD','לאסוף':'FFFFF3E0','לתקן':'FFFFF9C4' };
    const ACTION_FC = { 'לספק':'FF2E7D32','להחליף':'FF0D47A1','לאסוף':'FFE65100','לתקן':'FF6D4C41' };

    let row = 3, unit = 1;
    orders.forEach((o, oi) => {
      (o.mekarerim || []).forEach(m => {
        const bg = oi % 2 === 0 ? 'FFFFFFFF' : 'FFEEF2F8';
        ws2.getRow(row).height = 18;
        dCell(ws2.getCell(`A${row}`), unit,          { align:'center', bold:true, bg });
        dCell(ws2.getCell(`B${row}`), o.custId,      { align:'center', bg });
        dCell(ws2.getCell(`C${row}`), o.custName,    { bold:true, bg });
        dCell(ws2.getCell(`D${row}`), o.city,        { bg });
        dCell(ws2.getCell(`E${row}`), o.agentName,   { bg });
        dCell(ws2.getCell(`F${row}`), o.manager,     { bg });
        dCell(ws2.getCell(`G${row}`), o.contactName, { bg });
        dCell(ws2.getCell(`H${row}`), o.phone,       { align:'left', bg });
        dCell(ws2.getCell(`I${row}`), o.location,    { align:'center', bg });
        const act = m.action || '';
        dCell(ws2.getCell(`J${row}`), act, { align:'center', bold:true, bg: ACTION_BG[act]||bg, fc: ACTION_FC[act]||'FF1A1A2E' });
        dCell(ws2.getCell(`K${row}`), m.newModel||'',    { align:'center', bg });
        dCell(ws2.getCell(`L${row}`), m.returnModel||'', { align:'center', bg });
        dCell(ws2.getCell(`M${row}`), m.salot??'',       { align:'center', bold:true, bg });
        const agala = !!m.agala;
        dCell(ws2.getCell(`N${row}`), agala?'כן':'לא', { align:'center', bold:true, bg: agala?'FFE8F5E9':bg, fc: agala?'FF2E7D32':'FF1A1A2E' });
        dCell(ws2.getCell(`O${row}`), fmtDate(m.supplyDate), { align:'center', bg });
        dCell(ws2.getCell(`P${row}`), m.fault||'',       { bg, wrap:true });
        dCell(ws2.getCell(`Q${row}`), fmtDT(o.submittedAt), { align:'center', bg });
        row++; unit++;
      });
    });
    ws2.autoFilter = { from: 'A2', to: `Q${row-1}` };
    ws2.views[0] = { rightToLeft: true, state: 'frozen', ySplit: 2 };

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="mekarer-orders-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/bbox-audit-xlsx — clients with valid IL GPS from PBI but outside city bbox
app.get('/api/bbox-audit-xlsx', async (req, res) => {
  const adminOk = req.query.key === process.env.ADMIN_LOG_KEY;
  if (!adminOk) {
    const token = (req.headers['x-session'] || '').trim();
    const sess = sessions.get(token);
    if (!sess || Date.now() > sess.expiresAt) return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
    const seen = new Set();
    const allClients = [];
    for (const [, list] of pbiCache.byAgent) {
      for (const c of list) { if (!seen.has(c.custId)) { seen.add(c.custId); allClients.push(c); } }
    }
    const allCities = [...new Set(allClients.map(c => c.city).filter(Boolean))];
    await Promise.all(allCities.map(city => cityBBoxCache.has(city) ? null : getCityBBox(city)));

    const bad = [];
    for (const c of allClients) {
      const la = parseFloat(c.lat), lo = parseFloat(c.lng);
      if (!isValidIL(la, lo)) continue;
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (!bbox) continue;
      if (!isWithinCityBBox(la, lo, bbox)) {
        bad.push({ custId: c.custId, custName: c.custName, address: c.address || '', city: c.city,
          agentName: c.agentName, manager: c.manager, lat: la, lng: lo });
      }
    }
    const wb = new ExcelJS.Workbook(); wb.creator = 'COLUMBUS';
    const ws = wb.addWorksheet('GPS Bbox Errors', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'מספר לקוח', key: 'custId',    width: 13 },
      { header: 'שם לקוח',   key: 'custName',  width: 32 },
      { header: 'כתובת PBI', key: 'address',   width: 30 },
      { header: 'עיר PBI',   key: 'city',      width: 18 },
      { header: 'סוכן',      key: 'agentName', width: 24 },
      { header: 'מנהל',      key: 'manager',   width: 12 },
      { header: 'lat PBI',   key: 'lat',       width: 12 },
      { header: 'lng PBI',   key: 'lng',       width: 12 },
    ];
    const hdr = ws.getRow(1);
    hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB71C1C' } };
    hdr.height = 20;
    ws.autoFilter = { from: 'A1', to: 'H1' };
    bad.forEach(r => { const row = ws.addRow(r); row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } }; });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bbox-errors-${date}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// GET /pbi/formula-refresh — latest real sale date across the whole company (from
// pbiCache.latestSaleDate, computed once per daily reload — see _loadPBICacheAttempt).
// Content-freshness signal, not a REST "refresh completed" timestamp (switched
// 2026-08-25 per user: this is what the app's cache-freshness display should use).
app.get('/pbi/formula-refresh', requireAuth, dataRateLimit, async (req, res) => {
  res.json({ ok: true, refreshedAt: pbiCache?.latestSaleDate || null });
});

// GET /pbi/dagim-all-monthly — last 16 months carton sales for ALL dagim/halavi products (batch)
// Used by הזמנה דגים trend column (last 13 shown in chart) + YoY comparison (needs same 3 months last year).
app.get('/pbi/dagim-all-monthly', requireAuth, dataRateLimit, async (req, res) => {
  const now = new Date();
  const conds = [];
  for (let i = 15; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    conds.push(`(DIMCALENDAR[Year]=${d.getFullYear()}&&DIMCALENDAR[Month]=${d.getMonth()+1})`);
  }
  const dateFilter = `FILTER(ALL(DIMCALENDAR),${conds.join('||')})`;

  try {
    const rows = await executeDax(`
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'ALL_PARTS'[מק'ט],
          DIMCALENDAR[Year],
          DIMCALENDAR[Month],
          "mkr", [TOTAL מכר בקרטונים]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        'ALL_PARTS'[ASHMADOT] IN {"-מכר-"},
        ${dateFilter}
      )
      ORDER BY 'ALL_PARTS'[מק'ט], DIMCALENDAR[Year], DIMCALENDAR[Month]
    `);

    const byMk = {};
    for (const r of rows) {
      const mk = String(r["ALL_PARTS[מק'ט]"]);
      if (!byMk[mk]) byMk[mk] = [];
      byMk[mk].push({
        year:  r['DIMCALENDAR[Year]'],
        month: r['DIMCALENDAR[Month]'],
        mkr:   Math.round(r['[mkr]'] || 0),
      });
    }
    res.json({ ok: true, byMk });
  } catch (err) {
    console.error('[dagim-all-monthly]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Server-side cache for /pbi/dagim-sales — survives PBI 429 bursts (TTL: 60 min)
const _dagimSalesCache = new Map(); // key → { data, totalBranchy, ts }
const _DAGIM_SALES_TTL = 60 * 60 * 1000;

// GET /pbi/dagim-sales?periods=2026-5,2026-6 — live sales for הזמנה period filter (combined period)
// Legacy single-month form also supported: ?year=2026&month=5
app.get('/pbi/dagim-sales', requireAuth, dataRateLimit, async (req, res) => {
  let dateFilter;

  if (req.query.periods) {
    const parts = String(req.query.periods).split(',').map(s => s.trim()).filter(Boolean);
    const conds = [];
    for (const p of parts) {
      const [y, m] = p.split('-').map(Number);
      if (!y || y < 2020 || y > 2030) return res.status(400).json({ error: `invalid period: ${p}` });
      if (m) {
        if (m < 1 || m > 12) return res.status(400).json({ error: `invalid month in: ${p}` });
        conds.push(`(YEAR('ALL_PARTS'[תאריך])=${y}&&MONTH('ALL_PARTS'[תאריך])=${m})`);
      } else {
        conds.push(`YEAR('ALL_PARTS'[תאריך])=${y}`);
      }
    }
    if (!conds.length) return res.status(400).json({ error: 'no valid periods' });
    dateFilter = `FILTER(ALL('ALL_PARTS'[תאריך]),${conds.join('||')})`;
  } else {
    const year  = parseInt(req.query.year  || '0', 10);
    const month = parseInt(req.query.month || '0', 10);
    if (!year || year < 2020 || year > 2030) return res.status(400).json({ error: 'invalid year' });
    if (month && (month < 1 || month > 12))  return res.status(400).json({ error: 'invalid month' });
    dateFilter = month
      ? `FILTER(ALL('ALL_PARTS'[תאריך]),YEAR('ALL_PARTS'[תאריך])=${year}&&MONTH('ALL_PARTS'[תאריך])=${month})`
      : `FILTER(ALL('ALL_PARTS'[תאריך]),YEAR('ALL_PARTS'[תאריך])=${year})`;
  }

  // Optional: distinct-count of customers who bought ANY of these מק"ט in the period
  // (the currently visible/filtered subset on the client) — same measure as totalBranchy,
  // just scoped to a makat list instead of all דגים products.
  let visibleMakatim = null;
  if (req.query.makat) {
    visibleMakatim = String(req.query.makat).split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
    if (!visibleMakatim.length) return res.status(400).json({ error: 'invalid makat list' });
  }

  // Serve from cache if fresh
  const cacheKey = (req.query.periods || `${req.query.year}-${req.query.month}`) +
    (visibleMakatim ? '|' + visibleMakatim.slice().sort().join(',') : '');
  const cached = _dagimSalesCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < _DAGIM_SALES_TTL) {
    return res.json({ ok: true, data: cached.data, totalBranchy: cached.totalBranchy, visibleBranchy: cached.visibleBranchy, fromCache: true });
  }

  try {
    // Query 1: CALCULATETABLE wraps SUMMARIZECOLUMNS — filters outside, measure runs clean
    const rows = await executeDax(`
      EVALUATE
      CALCULATETABLE(
        SUMMARIZECOLUMNS(
          'ALL_PARTS'[מק'ט],
          "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        ${dateFilter}
      )
    `);

    const visibleMakatSet = visibleMakatim ? '{' + visibleMakatim.map(m => `"${m}"`).join(',') + '}' : null;

    // Query 2 — total carton sales + per-product branchy in selected period
    const [extRows, totRes, branchyRows, visibleBranchyRes] = await Promise.all([
      executeDax(`
        EVALUATE
        CALCULATETABLE(
          SUMMARIZECOLUMNS(
            'ALL_PARTS'[מק'ט],
            "mkrTk", [TOTAL מכר בקרטונים]
          ),
          'ALL_PARTS'[חברה] = "FORMULA",
          ${dateFilter}
        )
      `).catch(() => null),
      executeDax(`
        EVALUATE
        CALCULATETABLE(
          ROW("tot", CALCULATE([DIST COUNT מ.CAT 7], 'ALL_PARTS'[ASHMADOT] IN {"-מכר-"}, 'משטח'[סטטוס] IN {"פעיל"})),
          'ALL_PARTS'[חברה] = "FORMULA",
          ${dateFilter}
        )
      `).catch(() => null),
      executeDax(`
        EVALUATE
        CALCULATETABLE(
          ADDCOLUMNS(
            SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
            "branchy", CALCULATE([DIST COUNT מ.CAT 7], 'ALL_PARTS'[ASHMADOT] IN {"-מכר-"}, 'משטח'[סטטוס] IN {"פעיל"})
          ),
          'ALL_PARTS'[חברה] = "FORMULA",
          ${dateFilter}
        )
      `).catch(() => null),
      visibleMakatSet ? executeDax(`
        EVALUATE
        CALCULATETABLE(
          ROW("tot", CALCULATE([DIST COUNT מ.CAT 7], 'ALL_PARTS'[ASHMADOT] IN {"-מכר-"}, 'משטח'[סטטוס] IN {"פעיל"})),
          'ALL_PARTS'[חברה] = "FORMULA",
          ${dateFilter},
          TREATAS(${visibleMakatSet}, 'ALL_PARTS'[מק'ט])
        )
      `).catch(() => null) : Promise.resolve(null),
    ]);

    const totalBranchy = totRes?.[0]?.['[tot]'] ?? null;
    const visibleBranchy = visibleBranchyRes?.[0]?.['[tot]'] ?? null;

    // Build ext lookup by מק"ט
    const extMap = {};
    if (extRows) {
      for (const r of extRows) {
        const mk = r["ALL_PARTS[מק'ט]"];
        if (mk != null) extMap[String(mk)] = { mkrTk: r['[mkrTk]'] ?? null };
      }
    }
    if (branchyRows) {
      for (const r of branchyRows) {
        const mk = r["ALL_PARTS[מק'ט]"];
        if (mk != null) {
          if (!extMap[String(mk)]) extMap[String(mk)] = {};
          extMap[String(mk)].branchy = r['[branchy]'] ?? null;
        }
      }
    }

    const data = {};
    for (const r of rows) {
      const mk = r["ALL_PARTS[מק'ט]"];
      if (mk != null) data[String(mk)] = {
        daySales: r['[daySales]'] ?? null,
        ...(extMap[String(mk)] || {}),
      };
    }
    _dagimSalesCache.set(cacheKey, { data, totalBranchy, visibleBranchy, ts: Date.now() });
    res.json({ ok: true, data, totalBranchy, visibleBranchy });
  } catch (err) {
    console.error(err);
    // Return stale cache on PBI error rather than failing the user
    const stale = _dagimSalesCache.get(cacheKey);
    if (stale) return res.json({ ok: true, data: stale.data, totalBranchy: stale.totalBranchy, visibleBranchy: stale.visibleBranchy, fromCache: true, stale: true });
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /pbi/inter-sales?periods=2026-5,2026-6 — products + sales for INTER ordering page
// Source: INTERNATIONAL CONTROL DESK (CONTROL workspace) — includes photo URL, ENG name, krat
const INTER_WS = process.env.POWERBI_INTER_WORKSPACE_ID || 'ee9e5fc6-bc10-4e7d-a8f3-b23c08d150ed';
const INTER_DS = process.env.POWERBI_INTER_DATASET_ID   || 'fb6691a0-9b2f-413b-b438-78d2982c4e70';
const INTER_DATA = `'DataIINא+F+I+MMD 25-23-24-22'`;

app.get('/pbi/inter-sales', requireAuth, dataRateLimit, async (req, res) => {
  if (!req.query.periods) return res.status(400).json({ error: 'periods param required' });

  const parts = String(req.query.periods).split(',').map(s => s.trim()).filter(Boolean);
  const conds = [];
  for (const p of parts) {
    const [y, m] = p.split('-').map(Number);
    if (!y || y < 2020 || y > 2030) return res.status(400).json({ error: `invalid period: ${p}` });
    if (m) {
      if (m < 1 || m > 12) return res.status(400).json({ error: `invalid month in: ${p}` });
      conds.push(`(YEAR(DIMCALENDAR[Date])=${y}&&MONTH(DIMCALENDAR[Date])=${m})`);
    } else {
      conds.push(`YEAR(DIMCALENDAR[Date])=${y}`);
    }
  }
  if (!conds.length) return res.status(400).json({ error: 'no valid periods' });
  const dateFilter = `FILTER(ALL(DIMCALENDAR[Date]),${conds.join('||')})`;

  try {
    const rows = await executeDax(`
      EVALUATE
      ADDCOLUMNS(
        CALCULATETABLE(
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            'KARTIS PARIT'[תאור],
            'KARTIS PARIT'[תאור לועזי],
            'KARTIS PARIT'[מותג],
            'KARTIS PARIT'[תאור פרמטר 2 למוצר],
            'KARTIS PARIT'[תאור משפחה],
            'KARTIS PARIT'[משפחת מוצר],
            'KARTIS PARIT'[URL תמונה],
            'KARTIS PARIT'[KARTON IN PALLET],
            'KARTIS PARIT'[הזמנה לכמה ימים],
            'KARTIS PARIT'[MKOD]
          ),
          ${INTER_DATA}[חברה] = "INTER",
          ${INTER_DATA}[ASHMADOT] = "-מכר-",
          'KARTIS PARIT'[סטטוס] = "פעיל"
        ),
        "totKarton", CALCULATE(SUM(${INTER_DATA}[KARTON]),
          ${INTER_DATA}[חברה]="INTER", ${INTER_DATA}[ASHMADOT]="-מכר-", ${dateFilter}),
        "days", CALCULATE(DISTINCTCOUNT(${INTER_DATA}[תאריך]),
          ${INTER_DATA}[חברה]="INTER", ${INTER_DATA}[ASHMADOT]="-מכר-", ${dateFilter}),
        "tot365", CALCULATE(SUM(${INTER_DATA}[KARTON]),
          ${INTER_DATA}[חברה]="INTER", ${INTER_DATA}[ASHMADOT]="-מכר-",
          FILTER(ALL(DIMCALENDAR[Date]), DIMCALENDAR[Date] >= TODAY()-365 && DIMCALENDAR[Date] <= TODAY())),
        "malaiKarton",  CALCULATE(SUM('מלאי INT+F+ICE'[מלאי קרטון]), 'מלאי INT+F+ICE'[חברה]="INTER"),
        "hazmanaPtuha", CALCULATE(SUM('תעריכי הזמנות'[הזמנה פתוחה KARTON]), TREATAS(VALUES('KARTIS PARIT'[מק"ט]), 'תעריכי הזמנות'[מק'ט])),
        "supDate",      CALCULATE(MAX('תעריכי הזמנות'[ת. אספקה]),          TREATAS(VALUES('KARTIS PARIT'[מק"ט]), 'תעריכי הזמנות'[מק'ט]))
      )
      ORDER BY 'KARTIS PARIT'[מותג] ASC, 'KARTIS PARIT'[תאור פרמטר 2 למוצר] ASC, 'KARTIS PARIT'[מק"ט] ASC
    `, INTER_DS, INTER_WS);

    console.log(`[inter-sales] got ${rows.length} products from CONTROL`);

    const INTER_FAMILY_IDS = new Set(['30', '39']); // 30=מתוקים, 39=מוצרי מדף
    const products = [];
    const sales = {};
    for (const r of rows) {
      const makat = String(r['KARTIS PARIT[מק"ט]'] ?? '');
      if (!makat) continue;
      const famId = String(r['KARTIS PARIT[משפחת מוצר]'] ?? '');
      if (!INTER_FAMILY_IDS.has(famId)) continue;
      const tot365 = r['[tot365]'] ?? null;
      if (!tot365 || tot365 <= 0) continue;
      const family = fixBiDi(String(r['KARTIS PARIT[תאור משפחה]'] ?? ''));
      const totKarton   = r['[totKarton]'] ?? null;
      const days        = r['[days]'] ?? null;
      const daySales    = (totKarton != null && days) ? totKarton / days : null;
      const daySales365 = tot365 / 365;
      products.push({
        makat,
        name:         fixBiDi(String(r['KARTIS PARIT[תאור]'] ?? '')),
        nameEng:      String(r['KARTIS PARIT[תאור לועזי]'] ?? ''),
        motag:        fixBiDi(String(r['KARTIS PARIT[מותג]'] ?? '')),
        param2:       fixBiDi(String(r['KARTIS PARIT[תאור פרמטר 2 למוצר]'] ?? '')),
        mishpacaId:   r['KARTIS PARIT[משפחת מוצר]'] ?? null,
        mishpacaTaur: family,
        photoUrl:     String(r['KARTIS PARIT[URL תמונה]'] ?? '') || null,
        krat:         r['KARTIS PARIT[KARTON IN PALLET]'] ?? null,
        orderDays:    r['KARTIS PARIT[הזמנה לכמה ימים]'] ?? null,
        mkod:         String(r['KARTIS PARIT[MKOD]'] ?? ''),
        malaiKarton:  +(r['[malaiKarton]']  ?? 0),
        hazmanaPtuha: +(r['[hazmanaPtuha]'] ?? 0),
        supDate:      r['[supDate]'] ?? null,
      });
      sales[makat] = { daySales, mkrTk: totKarton, daySales365 };
    }

    res.json({ ok: true, products, sales });
  } catch (err) {
    console.error('[inter-sales]', err?.message || err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ── Order history (דגים order page) — shared across devices, file-persisted ──
const ORDER_HISTORY_FILE = path.join(__dirname, 'order-history-store.json');

function readOrderHistory() {
  try { return JSON.parse(fs.readFileSync(ORDER_HISTORY_FILE, 'utf8')); } catch { return []; }
}

app.get('/api/order-history', requireAuth, dataRateLimit, (req, res) => {
  res.json({ ok: true, versions: readOrderHistory() });
});

app.post('/api/order-history', requireAuth, dataRateLimit, (req, res) => {
  try {
    const edits = req.body?.edits;
    if (!edits || typeof edits !== 'object' || !Object.keys(edits).length) {
      return res.status(400).json({ error: 'missing edits' });
    }
    const versions = readOrderHistory();
    const ts = new Date().toISOString();
    versions.unshift({ ts, edits });
    if (versions.length > 5) versions.length = 5;
    fs.writeFileSync(ORDER_HISTORY_FILE, JSON.stringify(versions, null, 2), 'utf8');
    res.json({ ok: true, ts });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// ── Inter order history (INTER order page) — shared across devices, file-persisted ──
const INTER_ORDER_HISTORY_FILE = path.join(__dirname, 'inter-order-history-store.json');

function readInterOrderHistory() {
  try { return JSON.parse(fs.readFileSync(INTER_ORDER_HISTORY_FILE, 'utf8')); } catch { return []; }
}

app.get('/api/inter-order-history', requireAuth, dataRateLimit, (req, res) => {
  res.json({ ok: true, versions: readInterOrderHistory() });
});

app.post('/api/inter-order-history', requireAuth, dataRateLimit, (req, res) => {
  try {
    const edits = req.body?.edits;
    if (!edits || typeof edits !== 'object' || !Object.keys(edits).length) {
      return res.status(400).json({ error: 'missing edits' });
    }
    const versions = readInterOrderHistory();
    const ts = new Date().toISOString();
    versions.unshift({ ts, edits });
    if (versions.length > 5) versions.length = 5;
    fs.writeFileSync(INTER_ORDER_HISTORY_FILE, JSON.stringify(versions, null, 2), 'utf8');
    res.json({ ok: true, ts });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// SSRF guard: only allow HTTPS to external public hosts
const PHOTO_ALLOWED_HOSTS = new Set(['priority.dilerbmd.com', 'sverdlikdan-code.github.io']);
function isSafePhotoUrl(url) {
  if (typeof url !== 'string' || url.length > 500) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  return PHOTO_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
}

app.post('/api/export-order-xlsx', requireAuth, dataRateLimit, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'missing rows' });
    const periods = req.body?.periods || '';
    const modeNote = req.body?.modeNote || '';

    const wb = new ExcelJS.Workbook();
    wb.creator = 'COLUMBUS';
    const ws = wb.addWorksheet('הזמנה דגים', { views: [{ rightToLeft: true }] });

    const today = new Date();
    const dateStr = today.toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const totalOrder = rows.filter(r => r.orderK > 0).reduce((s, r) => s + r.orderK, 0);
    const totalPal = rows.filter(r => r.orderK > 0).reduce((s, r) => s + r.orderP, 0);
    const orderCnt = rows.filter(r => r.orderK > 0).length;

    // Column A and row 1 are left blank on purpose — visual margin so the
    // table doesn't start flush against the sheet edge (approved style, see
    // memory feedback_excel_style.md).
    ws.getColumn(1).width = 10;
    ws.getRow(1).height = 22;

    // Merge title across all 15 data columns (B–P) so text is visible
    const LAST_COL_LETTER = 'P'; // 15 columns: B(photo)..P(last)
    ws.mergeCells(`B2:${LAST_COL_LETTER}2`);

    const titleCell = ws.getCell('B2');
    titleCell.value = `🐟 הזמנת דגים FORMULA  —  תאריך: ${dateStr}${periods ? ' | תקופה: ' + periods : ''}${modeNote}`;
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    titleCell.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getRow(2).height = 26;

    // Photo column (B) + data columns (C onward)
    const PHOTO_COL = 2;  // Excel column B
    ws.getColumn(PHOTO_COL).width = 14;

    const tableCols = [
      { name: 'תמונה',             width: 14, totalsRowFunction: 'none' },
      { name: 'תאור',              width: 38, totalsRowFunction: 'none', totalsRowLabel: 'Total' },
      { name: 'English Name',      width: 38, totalsRowFunction: 'none' },
      { name: 'מק"ט',             width: 11, totalsRowFunction: 'none' },
      { name: 'ברקוד EAN',         width: 18, totalsRowFunction: 'none' },
      { name: 'משפחה',             width: 18, totalsRowFunction: 'none' },
      { name: 'קרט/פלט',          width:  9, totalsRowFunction: 'none' },
      { name: 'מלאי+הזמנות (קרט)', width: 14, totalsRowFunction: 'sum' },
      { name: 'PAL מלאי',          width: 10, totalsRowFunction: 'sum' },
      { name: 'הזמנות פתוחות',    width: 13, totalsRowFunction: 'sum' },
      { name: 'מכר קרט/יום',      width: 12, totalsRowFunction: 'sum' },
      { name: 'לכמה ימים',         width: 10, totalsRowFunction: 'sum' },
      { name: 'ימי בטחון',         width: 10, totalsRowFunction: 'sum' },
      { name: 'הזמנה KARTON',      width: 13, totalsRowFunction: 'sum' },
      { name: 'הזמנה PALLET',      width: 13, totalsRowFunction: 'sum' },
    ];
    tableCols.forEach((c, i) => { ws.getColumn(i + 2).width = c.width; });

    const tableRows = rows.map(r => [
      '',  // photo placeholder
      r.name || '',
      r.nameForeign || '',
      r.mk != null && r.mk !== '' ? (isNaN(Number(r.mk)) ? r.mk : Number(r.mk)) : '',
      r.ean != null && r.ean !== '' ? (isNaN(Number(r.ean)) ? r.ean : Number(r.ean)) : '',
      r.fam || '',
      r.krat || 1,
      r.spo ?? 0,
      r.palSpo ? Math.round(r.palSpo * 10) / 10 : 0,
      r.openOrders || 0,
      r.daySales ? Math.round(r.daySales * 10) / 10 : 0,
      r.daysStk != null ? Math.round(r.daysStk) : 0,
      r.safetyDays ?? 0,
      r.orderK > 0 ? r.orderK : 0,
      r.orderK > 0 ? Math.round(r.orderP * 10) / 10 : 0,
    ]);

    const HEADER_ROW = 4;
    ws.addTable({
      name: 'OrderDagim',
      ref: `B${HEADER_ROW}`,
      headerRow: true,
      totalsRow: true,
      style: { theme: 'TableStyleLight9', showRowStripes: true },
      columns: tableCols.map(c => ({ name: c.name, filterButton: true, totalsRowFunction: c.totalsRowFunction, totalsRowLabel: c.totalsRowLabel })),
      rows: tableRows,
    });
    ws.getRow(HEADER_ROW).font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    ws.getRow(HEADER_ROW + 1 + tableRows.length).font = { bold: true, name: 'Calibri' };
    ws.views[0] = { rightToLeft: true, state: 'frozen', ySplit: HEADER_ROW };

    // Center-align all table cells (header + data + totals)
    const TAUR_COL  = PHOTO_COL + 1; // תאור — right-aligned RTL
    const MAKAT_COL = PHOTO_COL + 3; // מק"ט (English Name column now sits between תאור and מק"ט)
    const EAN_COL   = PHOTO_COL + 4; // ברקוד EAN
    for (let ri = 0; ri <= tableRows.length + 1; ri++) {
      const row = ws.getRow(HEADER_ROW + ri);
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        cell.alignment = colNum === TAUR_COL && ri > 0
          ? { horizontal: 'right', vertical: 'middle', wrapText: true }
          : { horizontal: 'center', vertical: 'middle', wrapText: true };
      });
    }
    // EAN / מק"ט — force plain integer format (no scientific notation)
    for (let ri = 1; ri <= tableRows.length; ri++) {
      ws.getCell(HEADER_ROW + ri, MAKAT_COL).numFmt = '0';
      ws.getCell(HEADER_ROW + ri, EAN_COL).numFmt   = '0';
    }

    // Fetch and embed product photos — use ext (pixels) not br to ensure image fills cell
    const IMG_PX = 90;        // photo display size in pixels
    const IMG_ROW_PT = 68;    // row height in points  (1pt ≈ 1.333px → 68pt ≈ 91px)
    await Promise.all(rows.map(async (r, i) => {
      if (!r.photoUrl || !isSafePhotoUrl(r.photoUrl)) return;
      try {
        const resp = await fetch(r.photoUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) return;
        const buf = Buffer.from(await resp.arrayBuffer());
        const ext = /\.png(\?|$)/i.test(r.photoUrl) ? 'png' : 'jpeg';
        const imgId = wb.addImage({ buffer: buf, extension: ext });
        const excelRow = HEADER_ROW + 1 + i;
        ws.addImage(imgId, {
          tl: { col: PHOTO_COL - 1 + 0.04, row: excelRow - 1 + 0.04 },
          ext: { width: IMG_PX, height: IMG_PX },
          editAs: 'oneCell',
        });
        ws.getRow(excelRow).height = IMG_ROW_PT;
      } catch { /* skip */ }
    }));

    const date = today.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="order-dagim-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// ── PHOTO PROXY (CORS bridge for github.io → priority.dilerbmd.com) ─────────
app.get('/api/photo-proxy', requireAuth, dataRateLimit, async (req, res) => {
  const url = req.query.url;
  if (!isSafePhotoUrl(url)) return res.status(400).json({ error: 'invalid url' });
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const r    = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return res.status(r.status).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buf);
  } catch { res.status(502).end(); }
});

// ── POSITION TABLE XLSX (מיקום + photos) ────────────────────────────────────
app.post('/api/export-position-xlsx', requireAuth, dataRateLimit, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'missing rows' });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'COLUMBUS';
    const ws = wb.addWorksheet('מיקום', { views: [{ rightToLeft: true }] });

    const dateStr = new Date().toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit', day: '2-digit' });

    ws.getColumn(1).width = 10;
    ws.getRow(1).height = 22;

    const titleCell = ws.getCell('B2');
    titleCell.value = `📦 טבלת מיקום FORMULA  —  תאריך: ${dateStr}`;
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    titleCell.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getRow(2).height = 26;

    const PHOTO_COL = 2;
    ws.getColumn(PHOTO_COL).width = 14;

    const HEADER_ROW = 4;
    const tableCols = [
      { name: 'תמונה',      width: 8,  totalsRowFunction: 'none' },
      { name: 'תאור',       width: 38, totalsRowFunction: 'none' },
      { name: 'מק"ט',      width: 11, totalsRowFunction: 'none' },
      { name: 'חלוקה',     width: 9,  totalsRowFunction: 'none' },
      { name: 'מחלקה',     width: 12, totalsRowFunction: 'none' },
      { name: 'סדר הדפסה', width: 10, totalsRowFunction: 'none' },
      { name: 'מיקום',     width: 9,  totalsRowFunction: 'none' },
      { name: 'בי',         width: 9,  totalsRowFunction: 'none' },
      { name: 'משפחה',     width: 22, totalsRowFunction: 'none' },
    ];

    tableCols.forEach((c, i) => { ws.getColumn(PHOTO_COL + i).width = c.width; });

    rows.sort((a, b) => {
      const ha = a.haluka ?? 999, hb = b.haluka ?? 999;
      if (ha !== hb) return ha - hb;
      return (Number(a.printOrder) || 0) - (Number(b.printOrder) || 0);
    });
    const tableRows = rows.map(r => ['', r.name || '', r.makat || '', r.haluka ?? '—', r.sec || '', r.printOrder || '', r.pos || '', r.bay || '', r.fam || '']);
    ws.addTable({
      name: 'PositionTable',
      ref: `B${HEADER_ROW}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: tableCols.map(c => ({ name: c.name, filterButton: true, totalsRowFunction: c.totalsRowFunction })),
      rows: tableRows,
    });

    ws.getRow(HEADER_ROW).height = 22;
    ws.getRow(HEADER_ROW).font = { bold: true };
    ws.views[0] = { rightToLeft: true, state: 'frozen', ySplit: HEADER_ROW };

    const IMG_ROW_PT = 17;
    const BATCH = 5;
    const fetchPhoto = async (r, i) => {
      if (!r.photoUrl || !isSafePhotoUrl(r.photoUrl)) return;
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 3500);
        const resp = await fetch(r.photoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
        clearTimeout(tid);
        if (!resp.ok) return;
        const buf = Buffer.from(await resp.arrayBuffer());
        const ext = /\.png(\?|$)/i.test(r.photoUrl) ? 'png' : 'jpeg';
        const imgId = wb.addImage({ buffer: buf, extension: ext });
        const excelRow = HEADER_ROW + 1 + i;
        ws.addImage(imgId, {
          tl: { col: PHOTO_COL - 1 + 0.05, row: excelRow - 1 + 0.05 },
          br: { col: PHOTO_COL - 0.05,     row: excelRow - 0.05 },
          editAs: 'twoCell',
        });
        ws.getRow(excelRow).height = IMG_ROW_PT;
      } catch { /* skip */ }
    };
    for (let b = 0; b < rows.length; b += BATCH) {
      await Promise.all(rows.slice(b, b + BATCH).map((r, j) => fetchPhoto(r, b + j)));
    }

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="position-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// ── MMD ORDERS ──────────────────────────────────────────────────────────────
function mmdGuard(req, res, next) {
  const key = process.env.MMD_PBI_KEY;
  if (!key) return res.status(503).end();
  const cookies = req.headers.cookie || '';
  const hasCookie = /(?:^|;\s*)pbi_ok=1/.test(cookies);
  if (req.query.k === key) {
    res.setHeader('Set-Cookie', 'pbi_ok=1; Path=/mmd; HttpOnly; SameSite=Lax; Max-Age=2592000');
    return next();
  }
  if (hasCookie) return next();
  return res.status(403).send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>גישה מוגבלת</title><style>body{font-family:sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;background:#fff;padding:48px 40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08)}h2{margin:0 0 12px;color:#1a1a2e;font-size:1.4rem}p{color:#666;margin:0}</style></head><body><div><div style="font-size:2.5rem;margin-bottom:16px">🔒</div><h2>גישה דרך Power BI בלבד</h2><p>יש לפתוח את האפליקציה מתוך לוח הבקרה ב-Power BI</p></div></body></html>`);
}
app.get('/mmd/mmd-orders.json', mmdGuard, (req, res) => {
  const livePath = path.join(__dirname, 'data', 'mmd-orders-live.json');
  const fallback = path.join(__dirname, '..', 'docs', 'mmd-orders.json');
  res.sendFile(fs.existsSync(livePath) ? livePath : fallback);
});
app.get('/mmd/img/:mkt', mmdGuard, (req, res) => {
  const mkt = req.params.mkt.replace(/\D/g, '');
  if (!mkt) return res.status(400).end();
  // Use the real img URL from product data when passed as ?u=, validate hostname
  let imgUrl = `https://priority.dilerbmd.com/priimages/${mkt}.jpg`;
  if (req.query.u) {
    try {
      const parsed = new URL(req.query.u);
      if (parsed.hostname === 'priority.dilerbmd.com') imgUrl = req.query.u;
    } catch (_) {}
  }
  const req2 = https.get(imgUrl, imgRes => {
    if (imgRes.statusCode !== 200) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    imgRes.pipe(res);
  });
  req2.on('error', () => res.status(502).end());
  req2.setTimeout(4000, () => { req2.destroy(); res.status(504).end(); });
});

// ── MMD DRAFT SYNC ─────────────────────────────────────────────────────────
const DRAFTS_DIR = path.join(__dirname, '..', 'docs', 'mmd-drafts');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR);

function draftFilename(userId) {
  return path.join(DRAFTS_DIR, String(userId).replace(/[^א-תa-zA-Z0-9_\-]/gu, '_').slice(0, 30) + '.json');
}

// POST /mmd/draft — save current user's qty state
app.post('/mmd/draft', mmdGuard, dataRateLimit, (req, res) => {
  const { userId, items, tukuf } = req.body || {};
  if (!userId || typeof userId !== 'string' || userId.length > 30) {
    return res.status(400).json({ error: 'invalid userId' });
  }
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid items' });
  }
  const safe = {};
  for (const [mkt, val] of Object.entries(items)) {
    if (!/^[A-Za-z0-9]{1,15}$/.test(mkt) || !val || val.k == null) continue;
    safe[mkt] = { k: Number(val.k) };
  }
  const safeTukuf = {};
  if (tukuf && typeof tukuf === 'object') {
    for (const [mkt, val] of Object.entries(tukuf)) {
      if (/^[A-Za-z0-9]{1,15}$/.test(mkt) && typeof val === 'string' && val.length < 30) {
        safeTukuf[mkt] = val;
      }
    }
  }
  fs.writeFileSync(draftFilename(userId), JSON.stringify({ userId, items: safe, tukuf: safeTukuf, savedAt: new Date().toISOString() }, null, 2), 'utf8');
  res.json({ ok: true, count: Object.keys(safe).length });
});

// GET /mmd/draft/:userId — load a specific user's draft
app.get('/mmd/draft/:userId', mmdGuard, (req, res) => {
  const file = draftFilename(req.params.userId);
  if (!fs.existsSync(file)) return res.json({ ok: false, items: {} });
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ ok: true, userId: d.userId, items: d.items || {}, tukuf: d.tukuf || {}, savedAt: d.savedAt });
  } catch { res.status(500).json({ error: 'read_error' }); }
});

// GET /mmd/draft-list — list all users with saved drafts
app.get('/mmd/draft-list', mmdGuard, (req, res) => {
  try {
    const files = fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('.json') && !f.endsWith('-hist.json')) : [];
    const users = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8'));
        return { userId: d.userId, savedAt: d.savedAt, count: Object.keys(d.items || {}).length };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    res.json({ users });
  } catch { res.status(500).json({ error: 'list_error' }); }
});

// ── MMD ORDER SNAPSHOTS (cross-device history) ──────────────────────────────
function histFilename(userId) {
  return path.join(DRAFTS_DIR, String(userId).replace(/[^א-תa-zA-Z0-9_\-]/gu, '_').slice(0, 30) + '-hist.json');
}

// POST /mmd/history — save timestamped snapshot on שמור click
app.post('/mmd/history', mmdGuard, dataRateLimit, (req, res) => {
  const { userId, items, ts } = req.body || {};
  if (!userId || typeof userId !== 'string' || userId.length > 30)
    return res.status(400).json({ error: 'invalid userId' });
  if (!Array.isArray(items)) return res.status(400).json({ error: 'missing items' });
  const snap = { ts: ts || new Date().toISOString(), userId, count: items.slice(0, 600).length, items: items.slice(0, 600) };
  const histPath = histFilename(userId);
  const hist = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : [];
  hist.unshift(snap);
  if (hist.length > 10) hist.length = 10;
  fs.writeFileSync(histPath, JSON.stringify(hist, null, 2), 'utf8');
  res.json({ ok: true });
});

// GET /mmd/history-all — all users' snapshots (last 3 per user) for cross-device history
app.get('/mmd/history-all', mmdGuard, dataRateLimit, (req, res) => {
  try {
    const files = fs.existsSync(DRAFTS_DIR)
      ? fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('-hist.json'))
      : [];
    const snapshots = [];
    for (const f of files) {
      try {
        const hist = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8'));
        if (Array.isArray(hist)) snapshots.push(...hist.slice(0, 3));
      } catch {}
    }
    snapshots.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    res.json({ ok: true, snapshots });
  } catch { res.status(500).json({ error: 'server_error' }); }
});

const MMD_LIVE_PATH = path.join(__dirname, 'data', 'mmd-orders-live.json');
let rebuildInProgress = false;
app.post('/mmd/rebuild', mmdGuard, dataRateLimit, (req, res) => {
  if (rebuildInProgress) return res.json({ ok: false, busy: true });
  rebuildInProgress = true;
  const script = path.join(__dirname, 'build-mmd-orders.js');
  // MMD_LIVE_OUTPUT makes the script write straight to the untracked live path —
  // docs/ is never touched, so the VPS git working tree never gets dirtied.
  execFile('node', [script], {
    timeout: 60000,
    env: { ...process.env, MMD_LIVE_OUTPUT: MMD_LIVE_PATH },
  }, (err, stdout) => {
    rebuildInProgress = false;
    if (err) { console.error('[rebuild]', err.message); return res.status(500).json({ ok: false, error: 'build_failed' }); }
    const m = stdout.match(/Saved (\d+) products/);
    res.json({ ok: true, products: m ? Number(m[1]) : null });
  });
});

app.get('/mmd/period-data', mmdGuard, dataRateLimit, async (req, res) => {
  const d1s = req.query.d1, d2s = req.query.d2;
  if (!d1s || !d2s || !/^\d{4}-\d{2}-\d{2}$/.test(d1s) || !/^\d{4}-\d{2}-\d{2}$/.test(d2s)) {
    return res.status(400).json({ ok: false, error: 'bad params: need d1, d2 as YYYY-MM-DD' });
  }
  const [y1,m1,day1] = d1s.split('-').map(Number);
  const [y2,m2,day2] = d2s.split('-').map(Number);
  const dateD1 = new Date(d1s), dateD2 = new Date(d2s);
  if (y1 < 2020 || y2 > 2100 || dateD1 > dateD2) {
    return res.status(400).json({ ok: false, error: 'bad date range' });
  }
  if ((dateD2 - dateD1) > 366 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ ok: false, error: 'date range too large (max 366 days)' });
  }
  const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;
  if (!MMD_DS) return res.status(503).json({ ok: false, error: 'MMD dataset not configured' });
  const df = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},${day1}), DATE(${y2},${m2},${day2}))`;
  // Previous period = same span length, immediately before d1
  const spanMs = dateD2.getTime() - dateD1.getTime();
  const prevD2 = new Date(dateD1.getTime() - 24*60*60*1000);
  const prevD1 = new Date(prevD2.getTime() - spanMs);
  const [yp1,mp1,dp1] = prevD1.toISOString().slice(0,10).split('-').map(Number);
  const [yp2,mp2,dp2] = prevD2.toISOString().slice(0,10).split('-').map(Number);
  const df_prev = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${yp1},${mp1},${dp1}), DATE(${yp2},${mp2},${dp2}))`;
  try {
    const rows = await executeDax(`
      EVALUATE
      SUMMARIZECOLUMNS(
        'KARTIS PARIT'[מק"ט],
        'KARTIS PARIT'[ASHDOD KAARTON],
        'KARTIS PARIT'[MMD KARTON],
        'KARTIS PARIT'[תכולת האריזה למוצר],
        'KARTIS PARIT'[URL תמונה],
        "eilat_k",    [מלאי בקרטון EILAT],
        "maavar",     [מחסן מעבר],
        "mkr_shvua",  CALCULATE([מכר ממוצע בשבוע קרטון], ${df}),
        "mkr_prev6",  CALCULATE([מכר ממוצע בשבוע קרטון], ${df_prev}),
        "mkr_tk",     CALCULATE([מכר קרטון],              ${df}),
        "shavuot",    CALCULATE([לכמה שבועות יספיק המלאי], ${df}),
        "cust_bought", CALCULATE([כמות לקוחות], NOT 'לקוחות'[תאור סוג לקוח] IN { "סיטונאים", "מלונות", "פתאל מוסדי", "אסטרל", "--", "רשות הטבע" }, ${df}),
        "pizur",      CALCULATE([% לקוחות], NOT 'לקוחות'[תאור סוג לקוח] IN { "סיטונאים", "מלונות", "פתאל מוסדי", "אסטרל", "--", "רשות הטבע" }, ${df}),
        "hamlatza_k", CALCULATE([המלצה להזמנה קרטון],     ${df}),
        "tukuf",      [List of ת. תפוגת תוקף values],
        "yamim",      MIN('תוקף FORM'[כמה ימים נשארו])
      )
    `, MMD_DS);
    const data = rows.map(r => ({
      mkt:        r['KARTIS PARIT[מק"ט]'],
      ashdod_k:   r['KARTIS PARIT[ASHDOD KAARTON]']          ?? null,
      mmd_k:      r['KARTIS PARIT[MMD KARTON]']             ?? null,
      krat:       r['KARTIS PARIT[תכולת האריזה למוצר]']    ?? null,
      img:        r['KARTIS PARIT[URL תמונה]']              ?? null,
      eilat_k:    r['[eilat_k]']    ?? null,
      maavar:     r['[maavar]']     ?? null,
      mkr_shvua:  r['[mkr_shvua]']  != null ? Math.round(r['[mkr_shvua]']  * 10) / 10 : null,
      mkr_prev6:  r['[mkr_prev6]']  != null ? Math.round(r['[mkr_prev6]']  * 10) / 10 : null,
      mkr_tk:     r['[mkr_tk]']     != null ? Math.round(r['[mkr_tk]'])              : null,
      shavuot:    r['[shavuot]']    != null ? Math.round(r['[shavuot]']  * 10) / 10 : null,
      cust_bought: r['[cust_bought]'] != null ? Math.round(r['[cust_bought]'])         : null,
      pizur:      r['[pizur]']      != null ? Math.round(r['[pizur]']     * 100)     : null,
      hamlatza:   r['[hamlatza_k]'] != null ? Math.round(r['[hamlatza_k]'] * 10) / 10 : null,
      tukuf:      r['[tukuf]']      ?? null,
      yamim:      r['[yamim]']      != null ? Math.round(r['[yamim]'])               : null,
    }));
    res.json({ ok: true, data });
  } catch(e) {
    console.error('[period-data]', e.message);
    res.status(500).json({ ok: false, error: 'data_error' });
  }
});

const MMD_LOCAL_STUB = '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>MMD Orders</title><style>body{font-family:sans-serif;background:#04111f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fff}div{text-align:center}a{color:#4fc3f7;font-size:1.2rem;font-weight:700;display:block;margin-top:16px}</style></head><body><div><div style="font-size:3rem;margin-bottom:16px">📦</div><p>MMD Orders פועל בשרת</p><a href="https://api.sverdlik-apps.site/mmd/">פתח MMD Orders ←</a></div></body></html>';
// Hourly version token — changes on every server restart/deploy, forces fresh HTML fetch
const MMD_BUILD_V = String(Math.floor(Date.now() / 3600000));

app.get('/mmd', (req, res, next) => {
  if (IS_LOCAL) return res.status(200).send(MMD_LOCAL_STUB);
  if (req.query.r === '1') {
    const q = new URLSearchParams(req.query);
    q.set('r', '2');
    return res.redirect(302, '/mmd/?' + q.toString());
  }
  next();
});
app.get('/mmd/', (req, res, next) => {
  if (IS_LOCAL) return res.status(200).send(MMD_LOCAL_STUB);
  if (req.query.r === '1') {
    const q = new URLSearchParams(req.query);
    q.set('r', '2');
    return res.redirect(302, '/mmd/?' + q.toString());
  }
  next();
});

// Cache-bust: redirect HTML pages to versioned URL so browsers always get fresh content on deploy
app.use('/mmd', (req, res, next) => {
  const p = req.path;
  if (!IS_LOCAL && (p === '/' || p === '' || p.endsWith('.html')) && req.query.v !== MMD_BUILD_V) {
    res.set('Cache-Control', 'no-store');
    const q = new URLSearchParams(req.query); // preserve k=, r=, etc.
    q.set('v', MMD_BUILD_V);
    return res.redirect(302, '/mmd' + (p || '/') + '?' + q.toString());
  }
  next();
});

app.use('/mmd', mmdGuard, express.static(path.join(__dirname, '..', 'MMD ORDERS'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
  }
}));

// ── FORMULA ROAD ─────────────────────────────────────────────────────────────
// ── MAHSAN IP WHITELIST ─────────────────────────────────────────────────────
// MAHSAN_ALLOWED_IPS in .env — comma-separated IPv4/IPv6. Empty = allow all.
function mahsanIpGuard(req, res, next) {
  const raw = process.env.MAHSAN_ALLOWED_IPS || '';
  if (!raw.trim()) return next(); // not configured → open
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  const ip = getRealIp(req);
  if (allowed.includes(ip)) return next();
  writeLog({ ts: new Date().toISOString(), event: 'mahsan-blocked', ip, path: req.path, ua: (req.headers['user-agent'] || '').substring(0, 120) });
  return res.status(403).json({ ok: false, error: 'access_denied' });
}

function formulaRoadGuard(req, res, next) {
  const key = process.env.FORMULA_PBI_KEY;
  if (!key) return res.status(503).end();
  const cookies = req.headers.cookie || '';
  const hasCookie = /(?:^|;\s*)fr_ok=1/.test(cookies);
  if (req.query.k === key) {
    // SameSite=None;Secure (not Lax) — formula-road.html is served from
    // GitHub Pages, a different origin than this API, so the cookie must be
    // sendable on cross-site fetch() calls (Lax blocks those, only allows
    // top-level navigation).
    // ?u= is optional — a DAX measure on the report's button can append
    // USERPRINCIPALNAME() to the deep link so we know WHO clicked through,
    // not just that someone did. Carried via its own cookie to /auth/pbi,
    // which is called separately (no query params) by the client JS.
    const pbiUser = req.query.u ? String(req.query.u).slice(0, 100) : '';
    const setCookies = ['fr_ok=1; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=2592000'];
    if (pbiUser) setCookies.push(`fr_pbiu=${encodeURIComponent(pbiUser)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=2592000`);
    res.setHeader('Set-Cookie', setCookies);
    writeLog({ ts: new Date().toISOString(), event: 'gate-pbi', ip: getRealIp(req), path: req.path, device: deviceType(req.headers['user-agent'] || ''), pbiUser: pbiUser || null });
    return next();
  }
  if (hasCookie) {
    writeLog({ ts: new Date().toISOString(), event: 'gate-cookie', ip: getRealIp(req), path: req.path, device: deviceType(req.headers['user-agent'] || '') });
    return next();
  }
  writeLog({ ts: new Date().toISOString(), event: 'gate-blocked', ip: getRealIp(req), path: req.path, device: deviceType(req.headers['user-agent'] || ''), ua: (req.headers['user-agent'] || '').substring(0, 120) });
  return res.status(403).send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>גישה מוגבלת</title><style>body{font-family:sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;background:#fff;padding:48px 40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08)}h2{margin:0 0 12px;color:#1a1a2e;font-size:1.4rem}p{color:#666;margin:0}</style></head><body><div><div style="font-size:2.5rem;margin-bottom:16px">🔒</div><h2>גישה דרך Power BI בלבד</h2><p>יש לפתוח את האפליקציה מתוך לוח הבקרה ב-Power BI</p></div></body></html>`);
}
// On local Windows dev server, show a pointer page instead of serving Formula Road
// (avoids session mismatch; avoids redirect loop if local cloudflared is running)
app.get('/formula-road', (req, res, next) => {
  if (IS_LOCAL) return res.status(200).send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Formula Road</title><style>body{font-family:sans-serif;background:#0a1628;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fff}div{text-align:center}a{color:#4fc3f7;font-size:1.2rem;font-weight:700}</style></head><body><div><div style="font-size:3rem;margin-bottom:16px">🗺</div><p>Formula Road פועל בשרת</p><a href="${VPS_URL}/formula-road">פתח Formula Road ←</a></div></body></html>`);
  next();
}, formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'formula-road.html'));
});
app.get('/mekarer-order.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'mekarer-order.html'));
});
app.get('/zikuy-order.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'zikuy-order.html'));
});
app.get('/day-closing.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'day-closing.html'));
});
// GET /yedaim/:team.png — daily snapshot of the FORMULA DASHBORD "יעדים" PBI
// page, one per קבוצה team (2026-08-20). Whitelisted slugs only — no path
// traversal via req.params. requireAuth: real sales figures per team.
const YEDAIM_SLUGS = new Set(['alexey', 'anatol', 'natalya', 'sadran-plus', 'sveta', 'vlad']);
app.get('/yedaim/:team.png', requireAuth, (req, res) => {
  const slug = String(req.params.team || '');
  if (!YEDAIM_SLUGS.has(slug)) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'data', `yedaim-${slug}.png`), err => {
    if (err) res.status(404).end();
  });
});
// Public, allowlisted image proxy: priority.dilerbmd.com sends no CORS headers,
// so html2canvas/snapDOM can't capture hotlinked product photos into the zikuy
// WhatsApp share. Re-serves the same public product photo with
// Access-Control-Allow-Origin set.
//
// Disk-cached 2026-08-24 — product photos essentially never change once
// uploaded to Priority per SKU, so every repeat request for the same photo
// was paying a full round-trip to priority.dilerbmd.com for nothing. Cache
// key is the URL path itself: already safe to reuse as a relative disk path
// because the regex below rejects '..' and restricts the charset before this
// point ever runs. First request for a photo fetches+caches it; every
// request after that is served straight off disk, no upstream dependency at
// all — also means a slow/down Priority server no longer affects photos
// we've already seen once.
const IMG_CACHE_DIR = path.join(__dirname, 'data', 'img-cache');
const IMG_MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
app.get('/api/img-proxy', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https:\/\/priority\.dilerbmd\.com\/(?!.*\.\.)[A-Za-z0-9_\-\/.]+\.(jpg|jpeg|png|gif|webp)$/i.test(url)) {
    return res.status(400).send('invalid url');
  }
  const relPath = url.slice('https://priority.dilerbmd.com/'.length);
  const cachePath = path.join(IMG_CACHE_DIR, relPath);
  const ext = path.extname(cachePath).slice(1).toLowerCase();
  try {
    const cached = await fs.promises.readFile(cachePath).catch(() => null);
    if (cached) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', IMG_MIME_BY_EXT[ext] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(cached);
    }
    const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return res.status(502).send('upstream error');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
    // Fire-and-forget write, after the response is already sent — a failed
    // cache write must never delay or break serving the photo itself.
    fs.promises.mkdir(path.dirname(cachePath), { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, buf))
      .catch(e => console.warn('[img-proxy] cache write failed', e.message));
  } catch (e) {
    res.status(502).send('fetch failed');
  }
});
app.get('/territory-planner.html', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'territory-planner.html'));
});
app.get('/territory.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'territory.html'));
});
app.get('/priority-gps.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'priority-gps.html'));
});
app.get('/priority-gps-cross.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'priority-gps-cross.json'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  // Without this, Cloudflare's default browser-cache-ttl (max-age=14400, seen
  // live 2026-08-26) fills the gap — a device's SW update-check can be served
  // a 4-hour-stale sw.js from Cloudflare's edge, delaying every fix INSIDE the
  // service worker itself (like the formula-road.html network-first fix
  // earlier today) by up to 4h even after this file is redeployed.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'docs', 'sw.js'));
});
// manifest.json's icons[] and apple-touch-icon in formula-road.html use paths
// relative to this origin ("./icons/icon-180.png") — without this route they
// 404 here, so iOS falls back to a generic letter icon on "Add to Home Screen".
app.use('/icons', express.static(path.join(__dirname, '..', 'docs', 'icons')));
// docs/manifest.json's start_url ("./formula-road.html") is correct for the
// GitHub Pages static host it's normally served from, but resolves relative to
// THIS route's own URL (/manifest.json → /formula-road.html) when fetched here
// on the VPS — a route that doesn't exist (only the guarded /formula-road does),
// so a PWA installed via the Power BI / invite-link flow 404s every time it's
// reopened from the home-screen icon. Same file, rewritten start_url for this
// origin only — GitHub Pages keeps serving the static file untouched.
app.get('/manifest.json', (req, res) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'manifest.json'), 'utf8'));
    manifest.start_url = '/formula-road';
    res.json(manifest);
  } catch (_) {
    res.sendFile(path.join(__dirname, '..', 'docs', 'manifest.json'));
  }
});
// Static data files referenced via relative fetch in formula-road.html
app.get('/gps-corrections.json', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'gps-corrections.json'));
});
app.get('/formula-road-data.json', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'formula-road-data.json'));
});
app.get('/google-gps.json', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'google-gps.json'));
});

app.get('/logo-diler-bmd.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'logo-diler-bmd.png'));
});

app.get('/pbi/mmd-orders', mmdGuard, dataRateLimit, async (req, res) => {
  const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;
  if (!MMD_DS) return res.status(503).json({ error: 'MMD dataset not configured' });
  try {
    // Period for date-sensitive measures (default: prev + current month)
    const now = new Date();
    const curY = now.getFullYear(), curM = now.getMonth() + 1;
    const prevM = curM === 1 ? 12 : curM - 1;
    const prevY = curM === 1 ? curY - 1 : curY;
    const y1 = parseInt(req.query.y1) || prevY;
    const m1 = parseInt(req.query.m1) || prevM;
    const y2 = parseInt(req.query.y2) || curY;
    const m2 = parseInt(req.query.m2) || curM;
    const lastDay2 = new Date(y2, m2, 0).getDate();
    const df = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},1), DATE(${y2},${m2},${lastDay2}))`;

    const rows = await executeDax(`
      EVALUATE
      FILTER(
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          'KARTIS PARIT'[תאור],
          'KARTIS PARIT'[תאור משפחה],
          'KARTIS PARIT'[HEVRA.חברה],
          'KARTIS PARIT'[תכולת האריזה למוצר],
          'KARTIS PARIT'[URL תמונה],
          'KARTIS PARIT'[ASHDOD KAARTON],
          'KARTIS PARIT'[MMD KARTON],
          "eilat_k",    [מלאי בקרטון EILAT],
          "maavar",     [מחסן מעבר],
          "mkr_shvua",  CALCULATE([מכר ממוצע בשבוע קרטון], ${df}),
          "mkr_tk",     CALCULATE([מכר קרטון],              ${df}),
          "shavuot",    CALCULATE([לכמה שבועות יספיק המלאי], ${df}),
          "weeks_nf",   [WEEKS נפח הזמנה],
          "yamim_haya", CALCULATE([ימים שהיה בהם מלאי],    ${df}),
          "pct_mkr",    CALCULATE([ימי מכר מכלל ימי עבודה %], ${df}),
          "hamlatza_k", CALCULATE([המלצה להזמנה קרטון],     ${df}),
          "tukuf",      [List of ת. תפוגת תוקף values],
          "yamim",      MIN('תוקף FORM'[כמה ימים נשארו])
        ),
        OR('KARTIS PARIT'[ASHDOD KAARTON] > 0, 'KARTIS PARIT'[MMD KARTON] > 0)
      )
      ORDER BY 'KARTIS PARIT'[תאור משפחה] ASC, 'KARTIS PARIT'[מק"ט] ASC
    `, MMD_DS);

    const data = rows.map(r => ({
      mkt:       r['KARTIS PARIT[מק"ט]'],
      taur:      fixGimel(fixBiDi(r['KARTIS PARIT[תאור]'] || '')),
      mishpacha: fixBiDi(r['KARTIS PARIT[תאור משפחה]'] || ''),
      hevra:     r['KARTIS PARIT[HEVRA.חברה]'] || '',
      krat:      r['KARTIS PARIT[תכולת האריזה למוצר]'] ?? null,
      img:       r['KARTIS PARIT[URL תמונה]'] || null,
      ashdod_k:  r['KARTIS PARIT[ASHDOD KAARTON]'] ?? null,
      mmd_k:     r['KARTIS PARIT[MMD KARTON]'] ?? null,
      eilat_k:   r['[eilat_k]'] ?? null,
      maavar:    r['[maavar]'] ?? null,
      mkr_shvua:  r['[mkr_shvua]']  != null ? Math.round(r['[mkr_shvua]']  * 10) / 10 : null,
      mkr_tk:     r['[mkr_tk]']     != null ? Math.round(r['[mkr_tk]'])              : null,
      shavuot:    r['[shavuot]']    != null ? Math.round(r['[shavuot]']  * 10) / 10 : null,
      weeks_nf:   r['[weeks_nf]']   != null ? Math.round(r['[weeks_nf]'])            : null,
      yamim_haya: r['[yamim_haya]'] != null ? Math.round(r['[yamim_haya]'])          : null,
      pct_mkr:    r['[pct_mkr]']    != null ? Math.round(r['[pct_mkr]']  * 100)      : null,
      hamlatza:   r['[hamlatza_k]'] != null ? Math.round(r['[hamlatza_k]'] * 10) / 10 : null,
      tukuf:      r['[tukuf]']  || null,
      yamim:      r['[yamim]']  != null ? Math.round(r['[yamim]']) : null,
    }));

    const refreshedAt = await getDatasetRefreshTime(MMD_DS);
    res.json({ ok: true, data, ts: Date.now(), refreshedAt });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// GET /admin/debug-cache?key=KEY — временный диагностический endpoint
app.get('/admin/debug-cache', dataRateLimit, async (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_LOG_KEY || '';
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });
  if (!pbiCache) return res.json({ error: 'no cache' });
  const agents = [];
  for (const [code, clients] of pbiCache.byAgent) {
    const days = [...new Set(clients.map(c => c.dayNum))].sort();
    agents.push({ code, name: clients[0]?.agentName || '', mgr: clients[0]?.manager || '', count: clients.length, days });
  }
  res.json({ managers: pbiCache.managers, agents, loadedAt: pbiCache.loadedAt });
});

// POST /admin/reload-cache — перезагрузить PBI кэш без перезапуска
app.post('/admin/reload-cache', requireAuth, async (req, res) => {
  if (!req.session.isManager) return res.status(403).json({ error: 'forbidden' });
  await loadPBICache();
  res.json({ ok: true, clients: pbiCache?.clientMap?.size || 0, loadedAt: pbiCache?.loadedAt });
});

// Keep old endpoint for backward compat (redirects to new)
app.post('/admin/reload-targets', requireAuth, async (req, res) => {
  if (!req.session.isManager) return res.status(403).json({ error: 'forbidden' });
  await loadPBICache();
  res.json({ ok: true, clients: pbiCache?.clientMap?.size || 0, loadedAt: pbiCache?.loadedAt });
});

// ── Day Top Sales — lightweight ranking (no AI call) for the 👑 crown badge on
// the top 3-5 clients by last-3-closed-months sales within the selected day.
// Deliberately skips Gemini — this runs automatically on every route load, unlike
// /api/day-briefing which is only called on-demand from the "📊 ניתוח" button.
app.get('/api/day-top-sales', requireAuth, async (req, res) => {
  const queryAgent = req.query.agent ? String(req.query.agent) : null;
  if (queryAgent && !validateAgentCode(queryAgent)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
  const agentCode = queryAgent || req.session.agentCode;
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  if (!pbiCache) return res.status(503).json({ ok: false, error: 'cache_loading' });

  const dayNum = parseInt(req.query.day) || 0;
  const allClients = pbiCache.byAgent.get(agentCode) || [];
  const dayClients = dayNum ? allClients.filter(c => c.dayNum === dayNum) : allClients;
  if (!dayClients.length) return res.json({ ok: true, top: [] });

  const now = new Date();
  const cm = now.getMonth() + 1, cy = now.getFullYear();
  const months = [];
  for (let i = 3; i >= 1; i--) {
    let m = cm - i, y = cy;
    if (m <= 0) { m += 12; y--; }
    months.push({ year: y, month: m });
  }
  const curStart = months[0], curEnd = months[2];
  const curLastDay = new Date(curEnd.year, curEnd.month, 0).getDate();
  const custIds = [...new Set(dayClients.map(c => String(c.custId)))];
  const inList = custIds.map(id => `"${id}"`).join(', ');

  const dax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "total", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
)`;

  try {
    const rows = await executeDax(dax);
    const ranked = rows
      .map(r => ({ custId: String(r['ALL_PARTS[מספר לקוח]'] || r['[מספר לקוח]'] || ''), total: Math.round(r['[total]'] || 0) }))
      .filter(r => r.custId && r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    res.json({ ok: true, top: ranked });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Day Briefing — TOP 10 clients of agent's day, split by company (FORMULA vs
// ICE MISHPACHTI — never mixed together; INTER/ICE BDD are out of scope for this
// report). Per company: YoY growth/failures, structured highlights + an itemized
// recommendation bank (not prose — the agent picks items off it and gives 👍/👎
// feedback per item via /api/ai-feedback). Result is fixed once/day per agent+day+
// lang (see dayBriefingCache below) — deliberately NOT recomputed on every open.
const DAY_BRIEFING_CACHE_FILE = path.join(__dirname, 'data', 'day-briefing-cache.json');
const DAY_BRIEFING_RATE_FILE = path.join(__dirname, 'data', 'day-briefing-rate.json');
function readDayBriefingCache() {
  try { return JSON.parse(fs.readFileSync(DAY_BRIEFING_CACHE_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeDayBriefingCache(cache) {
  try {
    fs.mkdirSync(path.dirname(DAY_BRIEFING_CACHE_FILE), { recursive: true });
    fs.writeFileSync(DAY_BRIEFING_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
}
function todayIsraelDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); }

// 30 real computations/agent/day, resets at Israel midnight (see call site for why
// this exists — not a rate-limit fix, just a floor against something pathological).
function dayBriefingRateOk(agentCode, todayIL) {
  let rate = {};
  try { rate = JSON.parse(fs.readFileSync(DAY_BRIEFING_RATE_FILE, 'utf8')); } catch (_) {}
  const key = `${agentCode}_${todayIL}`;
  const count = (rate[key] || 0) + 1;
  if (count > 30) return false;
  // Drop yesterday's keys as we go, keep every agent's count for today — cheap way
  // to stop the file growing forever without a separate cleanup job.
  const kept = {};
  for (const k in rate) if (k.endsWith(`_${todayIL}`)) kept[k] = rate[k];
  kept[key] = count;
  try {
    fs.mkdirSync(path.dirname(DAY_BRIEFING_RATE_FILE), { recursive: true });
    fs.writeFileSync(DAY_BRIEFING_RATE_FILE, JSON.stringify(kept), 'utf8');
  } catch (_) {}
  return true;
}

// Deterministic תובנות — Gemini commentary dropped here too, same call as the
// client-analytics panel 2026-08-20 (b399de2a): the table below already shows
// growth/decline/dormancy in numbers, and the LLM round-trip was intermittently
// unparseable JSON (a client name with a literal Hebrew geresh like ר"ג broke
// string escaping, or the model ignored the compact-JSON instruction and got
// truncated by maxTokens) — silently landing as an empty highlights list for
// whichever agent got unlucky that day. This can't fail to parse; same 5-item
// cap and crown(TOP3)-first priority the old prompt asked for.
const dayInsightText = {
  he: {
    growth:  c => `${c.crown ? '👑 TOP לקוח, ' : ''}צמיחה של ${c.yoy}% לעומת אשתקד (₪${c.total.toLocaleString()})`,
    risk:    c => `${c.crown ? '👑 TOP לקוח, ' : ''}ירידה של ${Math.abs(c.yoy)}% לעומת אשתקד`,
    dormant: c => `לא הזמין כבר ${c.daysSince} ימים`,
  },
  ru: {
    growth:  c => `${c.crown ? '👑 TOP-клиент, ' : ''}рост ${c.yoy}% к прошлому году (₪${c.total.toLocaleString()})`,
    risk:    c => `${c.crown ? '👑 TOP-клиент, ' : ''}падение ${Math.abs(c.yoy)}% к прошлому году`,
    dormant: c => `Не заказывал уже ${c.daysSince} дней`,
  },
  uk: {
    growth:  c => `${c.crown ? '👑 TOP-клієнт, ' : ''}зростання ${c.yoy}% до минулого року (₪${c.total.toLocaleString()})`,
    risk:    c => `${c.crown ? '👑 TOP-клієнт, ' : ''}падіння ${Math.abs(c.yoy)}% до минулого року`,
    dormant: c => `Не замовляв уже ${c.daysSince} днів`,
  },
};
function buildDeterministicHighlights(result, lang) {
  const t = dayInsightText[lang] || dayInsightText.he;
  const top = result.clients.slice(0, 10);
  const candidates = [];
  for (const c of top) {
    if (c.yoy != null && c.yoy > 5) candidates.push({ type: 'growth', client: c.name, note: t.growth(c), crown: !!c.crown, score: c.yoy });
    else if (c.yoy != null && c.yoy < -10) candidates.push({ type: 'risk', client: c.name, note: t.risk(c), crown: !!c.crown, score: -c.yoy });
  }
  for (const d of result.dormant) {
    const inTop = top.find(c => c.custId === d.custId);
    if (inTop && !candidates.some(x => x.client === d.name)) {
      candidates.push({ type: 'risk', client: d.name, note: t.dormant(d), crown: !!inTop.crown, score: d.daysSince });
    }
  }
  candidates.sort((a, b) => (Number(b.crown) - Number(a.crown)) || (b.score - a.score));
  return candidates.slice(0, 5).map(({ type, client, note }) => ({ type, client, note }));
}

// Core computation for the on-demand endpoint below. Returns null for "no clients
// that day" (not an error); throws on real failures (DAX).
async function computeDayBriefing(agentCode, dayNum, lang) {
  const allClients = pbiCache.byAgent.get(agentCode) || [];
  const dayClients = dayNum ? allClients.filter(c => c.dayNum === dayNum) : allClients;
  if (!dayClients.length) return null;

  const now = new Date();
  const cm = now.getMonth() + 1, cy = now.getFullYear();
  const months = [];
  for (let i = 3; i >= 1; i--) {
    let m = cm - i, y = cy;
    if (m <= 0) { m += 12; y--; }
    months.push({ year: y, month: m });
  }
  const curStart = months[0], curEnd = months[2];
  const curLastDay = new Date(curEnd.year, curEnd.month, 0).getDate();
  const prevMonths = months.map(m => ({ year: m.year - 1, month: m.month }));
  const prevStart = prevMonths[0], prevEnd = prevMonths[2];
  const prevLastDay = new Date(prevEnd.year, prevEnd.month, 0).getDate();

  const custIds = [...new Set(dayClients.map(c => String(c.custId)))];
  const inList = custIds.map(id => `"${id}"`).join(', ');

  // Same מחלקה→company classification used across the app (client-returns, sadran
  // chain-products) — the department name itself encodes ICE's mish/bdd sub-brands.
  const classifyDayCompany = (machlaka) => {
    if (!machlaka) return null;
    if (machlaka.includes('mish')) return 'ICE_MISH';
    if (machlaka.includes('bdd')) return 'ICE_BDD';
    return 'FORMULA';
  };

  // Small dimension lookup (family -> מחלקה) scoped to this day's clients/period —
  // classified in JS, then used to build a family IN-list filter per company. Doing
  // it this way (vs. re-classifying per fact row) means DISTINCTCOUNT(תאריך)/SKU
  // below are computed on an already-filtered fact table, not double-counted.
  const daxFamCompany = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר])
  ),
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${prevStart.year},${prevStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
)`;

  const buildQueries = (familyList) => {
    const esc = f => `"${String(f).replace(/"/g, '""')}"`;
    const famFilter = familyList.length
      ? `ALL_PARTS[תאור משפחת מוצר] IN {${familyList.map(esc).join(', ')}},`
      : `ALL_PARTS[תאור משפחת מוצר] IN {"__none__"},`;
    const daxCur = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "total",     CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]),
    "orderDays", CALCULATE(DISTINCTCOUNT(ALL_PARTS[תאריך])),
    "skus",      CALCULATE(DISTINCTCOUNT(ALL_PARTS[מק'ט]))
  ),
  ${famFilter}
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
)`;
    // Real last-order date must NOT be limited to the "3 closed months" window (that
    // window deliberately excludes the current in-progress month for fair sales
    // comparison) — a client who ordered today would otherwise show their last
    // May/June/July date and look dormant for weeks they were never actually gone.
    const daxLastOrder = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]), "lastOrder", CALCULATE(MAX(ALL_PARTS[תאריך]))),
  ${famFilter}
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-"
)`;
    const daxPrev = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "prevTotal", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),
  ${famFilter}
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${prevStart.year},${prevStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${prevEnd.year},${prevEnd.month},${prevLastDay})
)`;
    // Company-scoped current-calendar-month sales — same MONTH(TODAY())/YEAR(TODAY())
    // semantics as monthlySales in loadPBICache, but restricted to this company's own
    // families. Plain monthlySales (loadPBICache) is client-wide across ALL companies
    // combined, so it can't be reused as-is for a per-company מכר column — a client who
    // also buys ICE Mishpachti would show FORMULA's total inflated by their ICE spend.
    // Bug found 2026-08-19: FORMULA table was showing all-company מכר against a
    // FORMULA-only יעד, inflating % ביצוע.
    const daxCurMonth = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "curMonthSales", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),
  ${famFilter}
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  MONTH(ALL_PARTS[תאריך]) = MONTH(TODAY()),
  YEAR(ALL_PARTS[תאריך]) = YEAR(TODAY())
)`;
    return { daxCur, daxLastOrder, daxPrev, daxCurMonth };
  };

  // Fraction of this month's working days elapsed so far — fetched from the
  // model's own [ימי עבודה %] measure (MEASURES TABLE.tmdl) rather than
  // reimplemented in JS, so the Fri/Sat + holiday-list logic never drifts out of
  // sync with the source of truth. Assigned before buildCompanyResult runs below.
  let workDaysPct = 0;

  // Per company: every scheduled client for this agent/day (not just a top slice),
  // flag the top 3 by current sales as 👑 (crown — real money moves there), list
  // clients dormant >21 days.
  const buildCompanyResult = async (familyList) => {
    const { daxCur, daxLastOrder, daxPrev, daxCurMonth } = buildQueries(familyList);
    const [curRows, prevRows, lastOrderRows, curMonthRows] = await Promise.all([
      executeDax(daxCur), executeDax(daxPrev), executeDax(daxLastOrder), executeDax(daxCurMonth),
    ]);
    const curMap = {}, prevMap = {}, lastOrderMap = {}, curMonthMap = {};
    for (const r of curRows) {
      const id = String(r['ALL_PARTS[מספר לקוח]'] || r['[מספר לקוח]'] || '');
      if (id) curMap[id] = { total: Math.round(r['[total]'] || 0), orderDays: r['[orderDays]'] || 0, skus: r['[skus]'] || 0 };
    }
    for (const r of prevRows) {
      const id = String(r['ALL_PARTS[מספר לקוח]'] || r['[מספר לקוח]'] || '');
      if (id) prevMap[id] = Math.round(r['[prevTotal]'] || 0);
    }
    for (const r of lastOrderRows) {
      const id = String(r['ALL_PARTS[מספר לקוח]'] || r['[מספר לקוח]'] || '');
      if (id) lastOrderMap[id] = r['[lastOrder]'] || null;
    }
    for (const r of curMonthRows) {
      const id = String(r['ALL_PARTS[מספר לקוח]'] || r['[מספר לקוח]'] || '');
      if (id) curMonthMap[id] = Math.round(r['[curMonthSales]'] || 0);
    }
    const enriched = dayClients.map(c => {
      const id = String(c.custId);
      const s = curMap[id] || { total: 0, orderDays: 0, skus: 0 };
      const prevTotal = prevMap[id] || 0;
      const yoy = prevTotal > 0 ? Math.round((s.total / prevTotal - 1) * 100) : null;
      const avgBasket = s.orderDays > 0 ? Math.round(s.total / s.orderDays) : 0;
      const lastOrder = lastOrderMap[id] || null;
      const daysSince = lastOrder ? Math.round((Date.now() - new Date(lastOrder)) / 86400000) : null;
      // Target achievement — משטח[יעד $] (FORMULA's own target) against this family's
      // OWN current-calendar-month sales (curMonthMap), not the client-wide monthlySales
      // from loadPBICache — that one spans every company the client buys from combined.
      const target = c.target || 0;
      const monthlySales = curMonthMap[id] || 0;
      const pctTarget = target > 0 ? Math.round((monthlySales / target) * 100) : null;
      // Same pacing logic as the model's own INDICATION measure: behind if actual
      // achievement trails the fraction of working days elapsed by >5pp — a client
      // at 33% of target on day 10 of a 30-working-day month is ON PACE, not behind.
      const indication = target > 0
        ? ((monthlySales / target) - workDaysPct < -0.05 ? '😕' : '🚀')
        : null;
      return {
        custId: id, name: c.custName || id, city: c.city || '', total: s.total, prevTotal, yoy,
        orderDays: s.orderDays, skus: s.skus, avgBasket, daysSince,
        sadran: c.sadran || '', isIce: c.hevra === 'ICE',
        target, monthlySales, pctTarget, indication,
      };
    });
    enriched.sort((a, b) => b.total - a.total);
    const clients = enriched.map((c, i) => ({ ...c, crown: i < 3 }));
    const dormant = enriched.filter(c => c.daysSince !== null && c.daysSince > 21);
    const totalTarget = enriched.reduce((s, c) => s + c.target, 0);
    const totalSales = enriched.reduce((s, c) => s + c.monthlySales, 0);
    const totalPct = totalTarget > 0 ? Math.round((totalSales / totalTarget) * 100) : null;
    // Same pacing rule as each client's own `indication` — the סה"כ row needs it too,
    // otherwise the frontend has no pace signal for the total and can only fall back
    // to a flat %-of-target threshold (the exact thing that made almost every client
    // row red/orange regardless of how far into the month it was). 2026-08-23.
    const totalIndication = totalTarget > 0
      ? ((totalSales / totalTarget) - workDaysPct < -0.05 ? '😕' : '🚀')
      : null;
    return { clients, dormant, totalTarget, totalSales, totalPct, totalIndication };
  };

  const [famRows, workDaysRows] = await Promise.all([
    executeDax(daxFamCompany),
    // Without a date filter, [ימי עבודה %]'s own DIMCALENDAR-based ratio spans the
    // whole calendar table (years), not "this month" — it only comes out right inside
    // a report page where a month slicer already narrows DIMCALENDAR. Same
    // MONTH(TODAY())/YEAR(TODAY()) filter as monthlySales above so both sides of the
    // INDICATION comparison mean "this calendar month".
    executeDax('EVALUATE CALCULATETABLE(ROW("pct", [ימי עבודה %]), MONTH(DIMCALENDAR[Date]) = MONTH(TODAY()), YEAR(DIMCALENDAR[Date]) = YEAR(TODAY()))'),
  ]);
  workDaysPct = parseFloat(workDaysRows?.[0]?.['[pct]']) || 0;
  const formulaFamilies = [], iceMishFamilies = [];
  famRows.forEach(r => {
    const fam = r['ALL_PARTS[תאור משפחת מוצר]'] || r['[תאור משפחת מוצר]'];
    if (!fam) return;
    const co = classifyDayCompany(r['[מחלקה]']);
    if (co === 'FORMULA') formulaFamilies.push(fam);
    else if (co === 'ICE_MISH') iceMishFamilies.push(fam);
  });

  // ICE MISHPACHTI only needs its dormant list here (⏰ לא הזמינו מעל 3 שבועות) — no
  // company-specific יעד exists in the model to build a sales/target table against,
  // and no AI highlights are requested for it (see prompt below, FORMULA-only).
  const [formulaResult, iceMishResult] = await Promise.all([
    buildCompanyResult(formulaFamilies),
    buildCompanyResult(iceMishFamilies),
  ]);

  const monthStr = `${months[0].month}/${months[0].year} — ${curEnd.month}/${curEnd.year}`;
  const prevStr  = `${prevMonths[0].month}/${prevMonths[0].year} — ${prevEnd.month}/${prevEnd.year}`;

  const highlights = buildDeterministicHighlights(formulaResult, lang);

  return {
    ok: true,
    monthStr, prevStr,
    companies: {
      FORMULA: { ...formulaResult, highlights },
      ICE_MISH: { dormant: iceMishResult.dormant },
    },
  };
}

app.get('/api/day-briefing', requireAuth, async (req, res) => {
  // Managers browsing an agent's route (ROADS) pass ?agent= explicitly, same as /customers;
  // an agent's own session falls back to their session agentCode.
  const queryAgent = req.query.agent ? String(req.query.agent) : null;
  if (queryAgent && !validateAgentCode(queryAgent)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
  const agentCode = queryAgent || req.session.agentCode;
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  if (!pbiCache) return res.status(503).json({ ok: false, error: 'cache_loading' });

  const lang = (req.query.lang || 'he').slice(0, 2);
  const dayNum = parseInt(req.query.day) || 0;

  // Fixed once per Israel calendar day, reused statically for every agent/manager
  // who opens this route/day for the rest of the day — repeat clicks are free.
  const dayBriefingCacheKey = `${agentCode}_${dayNum}_${lang}`;
  const todayIL = todayIsraelDate();
  const dayBriefingCache = readDayBriefingCache();
  if (dayBriefingCache[dayBriefingCacheKey]?.date === todayIL) {
    return res.json(dayBriefingCache[dayBriefingCacheKey].payload);
  }

  // Safety cap on actual computations (cache MISSES only — cache hits above are
  // free) per agent per day: 30/day, resets at Israel midnight. Not a rate-limit
  // fix (a human clicking a button isn't a real PBI-throttling risk — the cache
  // above already caps the common case to ~1 compute/agent/day) — just a floor
  // against something pathological (a bug, a loop, someone probing every day
  // param) burning PBI quota unbounded. 2026-08-17.
  if (!dayBriefingRateOk(agentCode, todayIL)) {
    return res.status(429).json({ ok: false, error: 'daily_limit', message: 'הגעת למכסת הבקשות היומית (30) — מתאפס מחר' });
  }

  try {
    const payload = await computeDayBriefing(agentCode, dayNum, lang);
    if (!payload) return res.json({ ok: false, error: 'no_clients' });
    dayBriefingCache[dayBriefingCacheKey] = { date: todayIL, payload };
    writeDayBriefingCache(dayBriefingCache);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/today-orders — direct-to-Priority (deliberately NOT PBI: PBI refreshes
// 2x/day and can't see an order opened an hour ago). Global cache shared by every
// poller — one query pair per TODAY_ORDERS_CACHE_MS total, not one per agent per
// poll. Never 500s: Priority being slow/down just means the ✔️ badge doesn't light
// up this cycle, nothing else on the route breaks (see server/priority-db.js).
const TODAY_ORDERS_CACHE_MS = 75 * 1000;
let todayOrdersCache = { date: null, at: 0, formula: [], iceMish: [] };

// Factored out of the /api/today-orders handler so /api/team-order-stats below
// can reuse the exact same 75s cache instead of making its own HTTP round-trip
// back into this server or duplicating the Priority queries.
async function getTodayOrdersSets() {
  const todayIL = todayIsraelDate();
  const fresh = todayOrdersCache.date === todayIL && (Date.now() - todayOrdersCache.at) < TODAY_ORDERS_CACHE_MS;
  if (!fresh) {
    const [formulaSet, iceSet] = await Promise.all([
      custIdsWithOpenOrderToday(process.env.DB_NAME || 'form', todayIL),
      iceMishCustIdsWithOpenOrderToday(process.env.DB_ICECREA || 'icecrea', todayIL),
    ]);
    // null (query failed) -> empty, not stale cross-day data from a previous cache entry.
    todayOrdersCache = { date: todayIL, at: Date.now(), formula: formulaSet ? [...formulaSet] : [], iceMish: iceSet ? [...iceSet] : [] };
  }
  return todayOrdersCache;
}

app.get('/api/today-orders', requireAuth, dataRateLimit, async (req, res) => {
  const c = await getTodayOrdersSets();
  res.json({ ok: true, formula: c.formula, iceMish: c.iceMish });
});

// GET /api/day-closing-team — FORMULA order sum/count TODAY for every agent at
// once (grouped by entering agent), used by the manager's agent-picker screens
// so each row/tile can show a live order snapshot without one Priority query
// per agent. Same 75s-cache shape as /api/today-orders and for the same reason
// — cheap to share across every manager viewing the screen concurrently.
const DAY_CLOSING_TEAM_CACHE_MS = 75 * 1000;
let dayClosingTeamCache = { date: null, at: 0, byAgent: [] };

async function getDayClosingTeamSums() {
  const todayIL = todayIsraelDate();
  const fresh = dayClosingTeamCache.date === todayIL && (Date.now() - dayClosingTeamCache.at) < DAY_CLOSING_TEAM_CACHE_MS;
  if (!fresh) {
    const byAgent = await dayClosingByAgentAll(process.env.DB_NAME || 'form', todayIL);
    dayClosingTeamCache = { date: todayIL, at: Date.now(), byAgent: byAgent || [] };
  }
  return dayClosingTeamCache;
}

app.get('/api/day-closing-team', requireAuth, dataRateLimit, async (req, res) => {
  const c = await getDayClosingTeamSums();
  res.json({ ok: true, byAgent: c.byAgent });
});

// Route day (Sun=1..Thu=5, Fri/Sat collapse to Sunday's) — mirrors the client's
// _todayRouteDay() exactly so "today" means the same day on both sides.
function todayRouteDay() {
  const wd = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' });
  return { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 1, Sat: 1 }[wd] || 1;
}

// Raw per-order rows for TODAY (custId/dispPrice/enteringAgentCode, no
// grouping) — same 75s-cache shape as the other today-scoped caches above.
const DAY_CLOSING_ORDERS_CACHE_MS = 75 * 1000;
let dayClosingOrdersCache = { date: null, at: 0, rows: [] };

async function getDayClosingOrdersToday() {
  const todayIL = todayIsraelDate();
  const fresh = dayClosingOrdersCache.date === todayIL && (Date.now() - dayClosingOrdersCache.at) < DAY_CLOSING_ORDERS_CACHE_MS;
  if (!fresh) {
    const rows = await dayClosingOrdersToday(process.env.DB_NAME || 'form', todayIL);
    dayClosingOrdersCache = { date: todayIL, at: Date.now(), rows: rows || [] };
  }
  return dayClosingOrdersCache;
}

// custId → roster-owner agentCode, built fresh from pbiCache each call (cheap:
// pbiCache only refreshes once a day, this is a plain in-memory Map build).
function custIdToRosterAgent() {
  const map = new Map();
  for (const src of [pbiCache.byAgent, pbiCache.noScheduleByAgent]) {
    if (!src) continue;
    for (const [agentCode, clients] of src) {
      for (const c of clients) if (!map.has(c.custId)) map.set(c.custId, agentCode);
    }
  }
  return map;
}

// GET /api/team-order-stats — FORMULA "today" order dynamics (denom/numer/sum)
// for every agent AND aggregated per manager, built entirely from data already
// in memory: pbiCache's schedule (no extra Priority query) plus the cache
// below. Powers the manager-tile screen, the agent-picker list rows, and its
// team-total banner with one shared cheap call instead of one /customers
// round-trip per agent. Live request 2026-08-30: manager wants live order
// dynamics on every screen, not just inside one agent's own route.
//
// numer/sum use the same roster-OR-entering-agent rule as the single-agent
// banner's dayClosingSummary, computed for the whole team in one pass over
// today's raw orders instead of one query per agent. Live correction
// 2026-08-31: Oleg Gladkikh (110) showed "0 מתוך 22" with a real ₪0 while his
// own banner showed "2 מתוך 22, ₪6,396" — both his day's orders were entered
// under Alexey Brilov's code (53) for Oleg's roster clients. The previous
// version only credited whoever entered the order (dayClosingByAgentAll,
// GROUP BY entering agent) — never the roster owner — so a client's own agent
// could show zero activity even with real sales on their clients today.
// denom stays route-day-scoped (it's "how many of today's scheduled clients").
app.get('/api/team-order-stats', requireAuth, dataRateLimit, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ ok: false, error: 'cache_loading' });
  const ordersCache = await getDayClosingOrdersToday();
  const rosterAgentByCust = custIdToRosterAgent();
  const todayDay = todayRouteDay();

  const custSetByAgent = new Map(); // agentCode -> Set(custId)
  const sumByAgent = new Map(); // agentCode -> number
  for (const row of ordersCache.rows) {
    const credited = new Set();
    const rosterAgent = rosterAgentByCust.get(row.custId);
    if (rosterAgent) credited.add(rosterAgent);
    if (row.enteringAgentCode) credited.add(row.enteringAgentCode);
    for (const ag of credited) {
      if (!custSetByAgent.has(ag)) custSetByAgent.set(ag, new Set());
      custSetByAgent.get(ag).add(row.custId);
      sumByAgent.set(ag, (sumByAgent.get(ag) || 0) + row.dispPrice);
    }
  }

  const byAgent = {};
  for (const [agentCode, clients] of pbiCache.byAgent) {
    const today = clients.filter(c => c.dayNum === todayDay);
    const numer = custSetByAgent.get(agentCode)?.size || 0;
    const sum = Math.round((sumByAgent.get(agentCode) || 0) * 100) / 100;
    byAgent[agentCode] = { denom: today.length, numer, sum };
  }

  const byManager = {};
  for (const [manager, agents] of pbiCache.agentsByManager) {
    const acc = { denom: 0, numer: 0, sum: 0 };
    for (const a of agents) {
      const s = byAgent[a.agentCode];
      if (!s) continue;
      acc.denom += s.denom; acc.numer += s.numer; acc.sum += s.sum;
    }
    byManager[manager] = acc;
  }

  res.json({ ok: true, byAgent, byManager });
});

// "סגירת יום" (day close) — fixed sellout makat list, set directly in code (not
// agent-selected/persisted — user explicitly simplified this 2026-08-26). Update
// this array when the tracked SKUs change; no UI for it yet.
const DAY_CLOSING_SELLOUT_SKUS = ['413000', '413001', '413002', '413500', '413501', '413502', '403004', '403006'];

// Same product-photo source as zikuy-order.html's fetchPhotosRet() (KARTIS
// PARIT[URL תמונה] via DAX) — not a guessed priority.dilerbmd.com/priimages/
// URL. Live correction 2026-08-26: that guess 404s for two of the seven fixed
// SKUs (721/724, confirmed no such file exists there at all) while this exact
// DAX path is what already renders their photos correctly in zikuy/mahsan.
async function fetchSelloutPhotos(skus) {
  if (!skus.length) return new Map();
  try {
    const skuIn = skus.map(s => `"${s}"`).join(',');
    const rows = await executeDax(
      `EVALUATE SELECTCOLUMNS(FILTER('KARTIS PARIT', 'KARTIS PARIT'[מק"ט] IN {${skuIn}}), "sku", 'KARTIS PARIT'[מק"ט], "img", 'KARTIS PARIT'[URL תמונה])`
    );
    return new Map(rows.map(r => [String(r['[sku]']), r['[img]'] || '']));
  } catch (e) {
    console.error('[day-closing] photo fetch failed:', e.message);
    return new Map();
  }
}

// Full client roster for an agent — every scheduled day + unscheduled ("לא
// מוגדר") formula clients + ICE-only clients, no day filter at all. Mirrors
// /customers' pieces but skips its day-scoping entirely (that endpoint's
// dayNum=null branch actually EXCLUDES noScheduleByAgent — only dayNum===0
// includes it — so it can't be reused as-is for "give me every client this
// agent has, period"). Built for day-closing: pressing "סגירת יום" must catch
// an order from any of the agent's clients regardless of which day they're
// routed for. Previously the frontend tried to build this itself by unioning
// STATIC_DATA.routes[agent_1..5] — that key doesn't exist in
// formula-road-data.json at all (confirmed live 2026-08-26), so it silently
// fell back to just today's day every time. Resolving it here server-side
// removes that whole fragile path.
function getAllCustIdsForAgent(agentCode) {
  if (!pbiCache) return [];
  const scheduled = pbiCache.byAgent?.get(agentCode) || [];
  const unscheduled = pbiCache.noScheduleByAgent?.get(agentCode) || [];
  const ice = pbiCache.iceByAgent?.get(agentCode) || [];
  const ids = new Set([...scheduled, ...unscheduled, ...ice].map(c => c.custId).filter(Boolean));
  return [...ids];
}

app.get('/api/day-closing', requireAuth, dataRateLimit, async (req, res) => {
  const agentCode = String(req.query.agentCode || '').trim();
  const type = req.query.type === 'ice' ? 'ice' : 'formula';
  if (!agentCode) return res.status(400).json({ ok: false, error: 'agentCode required' });
  // agentCode is passed to dayClosingSummary/Sellout as a fallback too — a
  // brand-new client isn't in the PBI-cached roster yet (refreshes once a
  // day), so custIds alone can't catch their order. See priority-db.js.
  const custIds = getAllCustIdsForAgent(agentCode);
  const todayIL = todayIsraelDate();
  try {
    if (type === 'ice') {
      const summary = await dayClosingSummary(process.env.DB_ICECREA || 'icecrea', todayIL, custIds, agentCode, { iceMishOnly: true });
      return res.json({ ok: true, type, ...summary, items: [] });
    }
    const [summary, items, imgMap] = await Promise.all([
      dayClosingSummary(process.env.DB_NAME || 'form', todayIL, custIds, agentCode),
      dayClosingSellout(process.env.DB_NAME || 'form', todayIL, custIds, agentCode, DAY_CLOSING_SELLOUT_SKUS),
      fetchSelloutPhotos(DAY_CLOSING_SELLOUT_SKUS),
    ]);
    items.forEach(it => { it.imgUrl = imgMap.get(it.sku) || ''; });
    res.json({ ok: true, type, ...summary, items });
  } catch (e) {
    console.error('[day-closing] failed:', e.message);
    res.status(502).json({ ok: false, error: 'priority query failed' });
  }
});

// POST /api/ai-feedback — 👍/👎 on a single AI recommendation (day-briefing or
// client-analytics). Append-only log, no auth-scoped read-back needed yet — this is
// the seed dataset for eventually training which recommendations actually land.
const AI_FEEDBACK_FILE = path.join(__dirname, 'data', 'ai-feedback.json');
app.post('/api/ai-feedback', requireAuth, (req, res) => {
  const { source, company, custId, client, action, feedback, day } = req.body || {};
  if (!['up', 'down'].includes(feedback)) return res.status(400).json({ ok: false, error: 'feedback must be up/down' });
  if (typeof action !== 'string' || !action.trim()) return res.status(400).json({ ok: false, error: 'action required' });
  const entry = {
    ts: new Date().toISOString(),
    agentCode: req.session.agentCode || null,
    source: String(source || 'day-briefing').slice(0, 40),
    company: String(company || '').slice(0, 20),
    day: Number.isInteger(day) ? day : null,
    custId: custId ? String(custId).slice(0, 20) : null,
    client: String(client || '').slice(0, 120),
    action: String(action).slice(0, 400),
    feedback,
  };
  let log = [];
  try { log = JSON.parse(fs.readFileSync(AI_FEEDBACK_FILE, 'utf8')); } catch (_) {}
  log.push(entry);
  try {
    fs.mkdirSync(path.dirname(AI_FEEDBACK_FILE), { recursive: true });
    fs.writeFileSync(AI_FEEDBACK_FILE, JSON.stringify(log, null, 2), 'utf8');
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
  res.json({ ok: true });
});

// POST/GET /api/zikuy-history — append-only log of finalized זיכוי blanks (only
// logged at actual send-time — see docs/zikuy-order.html's sendAsImage()/
// downloadAndOpenWaWeb() call sites, NOT at prewarm/preview time, so opening a
// blank and closing it without sending doesn't pollute the history). Each
// agent only ever sees their own entries — agentCode/agentName are resolved
// server-side from the session, never trusted from the request body. Kept for
// ~3 months, pruned on every write.
const BLANK_HISTORY_FILE = path.join(__dirname, 'data', 'blank-history.json');
const BLANK_HISTORY_MAX_AGE_MS = 92 * 24 * 3600 * 1000;
function readBlankHistory() {
  try { return JSON.parse(fs.readFileSync(BLANK_HISTORY_FILE, 'utf8')); } catch (_) { return []; }
}
function writeBlankHistory(arr) {
  const cutoff = Date.now() - BLANK_HISTORY_MAX_AGE_MS;
  const pruned = arr.filter(e => new Date(e.ts).getTime() >= cutoff);
  try {
    fs.mkdirSync(path.dirname(BLANK_HISTORY_FILE), { recursive: true });
    fs.writeFileSync(BLANK_HISTORY_FILE, JSON.stringify(pruned, null, 2), 'utf8');
  } catch (_) {}
  return pruned;
}
app.post('/api/zikuy-history', requireAuth, dataRateLimit, (req, res) => {
  const { custId, custName, city, items } = req.body || {};
  if (!custId || !Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, error: 'invalid payload' });
  if (items.length > 200) return res.status(400).json({ ok: false, error: 'too many items' });
  const agentCode = req.session.agentCode || null;
  const agentName = (loadAgentList()[agentCode] || {}).name || '';
  const entry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    agentCode, agentName,
    custId: String(custId).slice(0, 20),
    custName: String(custName || '').slice(0, 100),
    city: String(city || '').slice(0, 50),
    items: items.slice(0, 200).map(it => ({
      sku: String(it.sku || '').slice(0, 30), name: String(it.name || '').slice(0, 200),
      qty: Number.isFinite(it.qty) ? it.qty : 0,
      date: String(it.date || '').slice(0, 20),
      option: String(it.option || '').slice(0, 40),
    })),
  };
  const log = readBlankHistory();
  log.push(entry);
  writeBlankHistory(log);
  res.json({ ok: true });
});
app.get('/api/zikuy-history', requireAuth, dataRateLimit, (req, res) => {
  // Same convention as /customers and /api/day-briefing: a manager viewing a
  // specific agent's line passes ?agent= explicitly (their own session has no
  // agentCode — createSession(null, true), see _inviteRedirect), an agent's
  // own session falls back to their session agentCode. Live feedback
  // 2026-08-25: "manager sees literally everyone" was the wrong model — a
  // manager on agent X's line should see agent X's blanks, not the whole
  // team's mixed together.
  const queryAgent = req.query.agent ? String(req.query.agent) : null;
  if (queryAgent && !validateAgentCode(queryAgent)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
  const agentCode = queryAgent || req.session.agentCode;
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  const cutoff = Date.now() - BLANK_HISTORY_MAX_AGE_MS;
  const entries = readBlankHistory().filter(e =>
    e.agentCode === agentCode && new Date(e.ts).getTime() >= cutoff
  );
  res.json({ ok: true, entries });
});

// ── Route order / day-move — server-persisted per agent, audited via writeLog() ──
// Was localStorage-only (fr_${code}_${day}, fr_dayov_${code}) — lost on device
// switch/cache clear, and no way to see who changed a route or revert it (live
// concern 2026-08-25: sensitive before an agent's departure). Same audit
// approach already proven for gps-corrections — snapshot/restore explicitly
// NOT wanted for this (user confirmed), just persistence + who/when.
const ROUTE_OVERRIDES_FILE = path.join(__dirname, 'data', 'route-overrides.json');
function readRouteOverrides() {
  try { return JSON.parse(fs.readFileSync(ROUTE_OVERRIDES_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeRouteOverrides(data) {
  try {
    fs.mkdirSync(path.dirname(ROUTE_OVERRIDES_FILE), { recursive: true });
    fs.writeFileSync(ROUTE_OVERRIDES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}
app.post('/api/route-order', requireAuth, dataRateLimit, (req, res) => {
  // Deliberately session-only, no manager-on-behalf-of-agent fallback (unlike
  // route-day-move below) — live decision 2026-08-27: within-day client
  // ordering is a personal working view, a manager's drag-reorder while
  // looking at someone's line shouldn't overwrite the agent's own route.
  const agentCode = req.session.agentCode;
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  const { day, order } = req.body || {};
  const dayNum = parseInt(day, 10);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 5) return res.status(400).json({ ok: false, error: 'invalid day' });
  if (!Array.isArray(order) || order.length > 500) return res.status(400).json({ ok: false, error: 'invalid order' });
  const data = readRouteOverrides();
  if (!data[agentCode]) data[agentCode] = { order: {}, dayMoves: {} };
  data[agentCode].order[dayNum] = order.map(id => String(id).slice(0, 20));
  writeRouteOverrides(data);
  writeLog({ ts: new Date().toISOString(), event: 'route-order-change', agentCode, day: dayNum, count: order.length, ip: getRealIp(req) });
  res.json({ ok: true });
});
app.post('/api/route-day-move', requireAuth, dayMoveRateLimit, (req, res) => {
  // See /api/route-order above for why the body-agentCode fallback exists.
  const { custId, day, client, agentCode: bodyAgentCode } = req.body || {};
  let agentCode = req.session.agentCode;
  if (!agentCode && req.session.isManager && bodyAgentCode) {
    const a = String(bodyAgentCode);
    if (!validateAgentCode(a)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
    agentCode = a;
  }
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  if (!custId || typeof custId !== 'string') return res.status(400).json({ ok: false, error: 'invalid custId' });
  const dayNum = parseInt(day, 10);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 5) return res.status(400).json({ ok: false, error: 'invalid day' });
  const data = readRouteOverrides();
  if (!data[agentCode]) data[agentCode] = { order: {}, dayMoves: {} };
  const id = String(custId).slice(0, 20);
  if (client && typeof client === 'object') {
    data[agentCode].dayMoves[id] = { day: dayNum, client, movedAt: new Date().toISOString() };
  } else {
    // No client payload = override cleared (client moved back to its original day).
    delete data[agentCode].dayMoves[id];
  }
  writeRouteOverrides(data);
  writeLog({ ts: new Date().toISOString(), event: 'route-day-move', agentCode, custId: id, day: dayNum, ip: getRealIp(req) });
  res.json({ ok: true });
});
app.get('/api/route-overrides', requireAuth, dataRateLimit, (req, res) => {
  const queryAgent = req.query.agent ? String(req.query.agent) : null;
  if (queryAgent && !validateAgentCode(queryAgent)) return res.status(400).json({ ok: false, error: 'invalid agent code' });
  const agentCode = queryAgent || req.session.agentCode;
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  const data = readRouteOverrides();
  const entry = data[agentCode] || { order: {}, dayMoves: {} };
  res.json({ ok: true, order: entry.order || {}, dayMoves: entry.dayMoves || {} });
});

// ── Client Return Form (זיכוי) — products this client bought in the last 365 days,
// each with a 3-closed-month return-rate (% זיכויים) and photo, for building a
// physical-return proforma. Header (client/city/agent) comes from the URL query string
// on the frontend page — this endpoint only needs to return the product list.
app.get('/api/client-returns/:custId', requireAuth, async (req, res) => {
  const custId = String(req.params.custId || '').trim();
  if (!custId) return res.status(400).json({ ok: false, error: 'custId required' });
  if (!/^\d{1,15}$/.test(custId)) return res.status(400).json({ ok: false, error: 'invalid custId' });

  const cached = clientReturnsCache.get(custId);
  if (cached) return res.json(cached.data);

  const now = new Date();
  const cm = now.getMonth() + 1, cy = now.getFullYear();
  const periodMonths = (fromBack, toBack) => {
    const arr = [];
    for (let i = fromBack; i >= toBack; i--) {
      let m = cm - i, y = cy;
      if (m <= 0) { m += 12; y--; }
      arr.push({ year: y, month: m });
    }
    return arr;
  };
  const d365 = new Date(Date.now() - 365 * 86400000);
  // מדף + מתוקים = INTER company (approved mapping, scripts/sadran-data.js DEPT_COMPANY,
  // user-approved 2026-07-21) — verified live against ADIFUT[מחלקה] raw values.
  const INTER_CATS_RET = new Set(['מדף', 'מתוקים  🍬']);
  const classifyCompanyRet = (machlaka) => {
    if (!machlaka) return null;
    if (machlaka.includes('mish')) return 'ICE_MISH';
    if (machlaka.includes('bdd')) return 'ICE_BDD';
    if (INTER_CATS_RET.has(machlaka)) return 'INTER';
    return 'FORMULA';
  };

  try {
    // 365-day purchase history — candidates for return (never show products the client
    // never actually bought).
    const histDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט], ALL_PARTS[תאור מוצר], ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "total365", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),
  ALL_PARTS[מספר לקוח] = "${custId}",
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${d365.getFullYear()},${d365.getMonth() + 1},${d365.getDate()})
)`;
    // Official model semantics for '% זיכויים NOW' = DIVIDE([זיכויים], [TOTAL SALES brutto]):
    //   [זיכויים]           = SUM(סכום) where ASHMADOT="השמדות", excluding ExcludedProducts SKUs
    //                         and (agent IN {יוסי אליאב, כללי} OR blank agent) on those rows
    //   [TOTAL SALES brutto] = SUM(סכום) where ASHMADOT="-מכר-" (no agent/SKU filter)
    // Can't call the named measure per-SKU: [זיכויים]'s own CALCULATE filters NOT(מק'ט IN
    // ExcludedProducts) on the SAME column used for SUMMARIZE grouping below — an explicit
    // CALCULATE filter on a column already fixed by row-context transition REPLACES that
    // transition instead of intersecting with it (identical trap already hit in famDax/skuDax,
    // see 2026-08-18 INTER bug), so every row would get the sum across all SKUs, not its own.
    // Fix: SKU exclusion moved to the outer CALCULATETABLE (removes those SKUs' rows entirely
    // before grouping); agent exclusion stays inline since [שם סוכן] isn't the grouping column.
    // Window changed from "3 closed months" to today-90..today per user request 2026-08-25.
    const d90 = new Date(Date.now() - 90 * 86400000);
    const todayD = new Date();
    const ZIKUY_EXCLUDED_SKUS = ['0', '915001', '915002', '916000', '916001', '916002', '916003', '916004', '916005', '916006', '916007', '916008', '916009', '916010', '916011'];
    const zikuyDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט]),
    "zikuy", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT] = "השמדות", NOT(ALL_PARTS[שם סוכן] IN {"‭באילא יסוי‬", "‭יללכ‬"}), NOT(ISBLANK(ALL_PARTS[שם סוכן]))),
    "brutto", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT] = "-מכר-")
  ),
  ALL_PARTS[מספר לקוח] = "${custId}",
  NOT(ALL_PARTS[מק'ט] IN {${ZIKUY_EXCLUDED_SKUS.map(s => `"${s}"`).join(', ')}}),
  ALL_PARTS[תאריך] >= DATE(${d90.getFullYear()},${d90.getMonth() + 1},${d90.getDate()}),
  ALL_PARTS[תאריך] <= DATE(${todayD.getFullYear()},${todayD.getMonth() + 1},${todayD.getDate()})
)`;

    // Last shipment (date + qty in units) per SKU — real sales only (ASHMADOT="-מכר-"),
    // same convention as the queries above, never destruction/ashmadot records.
    const lastShipDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט]),
    "lastDate", CALCULATE(MAX(ALL_PARTS[תאריך])),
    "lastQty", VAR _ld = CALCULATE(MAX(ALL_PARTS[תאריך])) RETURN CALCULATE(SUM(ALL_PARTS[כמות ביח' מפעל]), ALL_PARTS[תאריך] = _ld)
  ),
  ALL_PARTS[מספר לקוח] = "${custId}",
  ALL_PARTS[ASHMADOT] = "-מכר-"
)`;

    const [histRows, zikuyRows, lastShipRows] = await Promise.all([
      executeDax(histDax), executeDax(zikuyDax), executeDax(lastShipDax),
    ]);

    const zikuyMap = new Map();
    zikuyRows.forEach(r => {
      const sku = String(r["ALL_PARTS[מק'ט]"] || '');
      const zikuy = r['[zikuy]'] || 0, brutto = r['[brutto]'] || 0;
      zikuyMap.set(sku, brutto > 0 ? Math.round((zikuy / brutto) * 1000) / 10 : 0);
    });

    // Company-wide average % זיכויים per SKU (same formula/window as zikuyDax, no
    // client filter — "agents with a manager" = the same real-agent population
    // already used everywhere else in this model, per user decision 2026-08-25.
    // Scoped to only the SKUs this client actually has, to keep the query small.
    const returnSkus = [...new Set(histRows.map(r => String(r["ALL_PARTS[מק'ט]"] || '')).filter(Boolean))];
    let companyAvgMap = new Map();
    if (returnSkus.length) {
      const companyAvgDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט]),
    "zikuy", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT] = "השמדות", NOT(ALL_PARTS[שם סוכן] IN {"‭באילא יסוי‬", "‭יללכ‬"}), NOT(ISBLANK(ALL_PARTS[שם סוכן]))),
    "brutto", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]), ALL_PARTS[ASHMADOT] = "-מכר-", NOT(ALL_PARTS[שם סוכן] IN {"‭באילא יסוי‬", "‭יללכ‬"}), NOT(ISBLANK(ALL_PARTS[שם סוכן])))
  ),
  ALL_PARTS[מק'ט] IN {${returnSkus.map(s => `"${s}"`).join(', ')}},
  ALL_PARTS[תאריך] >= DATE(${d90.getFullYear()},${d90.getMonth() + 1},${d90.getDate()}),
  ALL_PARTS[תאריך] <= DATE(${todayD.getFullYear()},${todayD.getMonth() + 1},${todayD.getDate()})
)`;
      const companyAvgRows = await executeDax(companyAvgDax);
      companyAvgRows.forEach(r => {
        const sku = String(r["ALL_PARTS[מק'ט]"] || '');
        const zikuy = r['[zikuy]'] || 0, brutto = r['[brutto]'] || 0;
        companyAvgMap.set(sku, brutto > 0 ? Math.round((zikuy / brutto) * 1000) / 10 : 0);
      });
    }

    const lastShipMap = new Map();
    lastShipRows.forEach(r => {
      const sku = String(r["ALL_PARTS[מק'ט]"] || '');
      const d = r['[lastDate]'];
      lastShipMap.set(sku, { date: d ? String(d).slice(0, 10) : '', qty: Math.round(r['[lastQty]'] || 0) });
    });

    // Scope: this return form only covers FORMULA and ICE MISH — INTER and ICE BDD
    // don't go back to this warehouse, so they're dropped entirely, not just hidden.
    let products = histRows
      .filter(r => Math.round(r['[total365]'] || 0) > 0)
      .map(r => {
        const sku = String(r["ALL_PARTS[מק'ט]"] || '');
        const machlaka = r['[מחלקה]'] || '';
        return {
          sku,
          name: fixBiDi(r['ALL_PARTS[תאור מוצר]'] || ''),
          family: fixBiDi(r['ALL_PARTS[תאור משפחת מוצר]'] || ''),
          machlaka: fixBiDi(machlaka),
          company: classifyCompanyRet(machlaka),
          total365: Math.round(r['[total365]'] || 0),
          zikuyPct90d: zikuyMap.get(sku) || 0,
          companyAvgPct90d: companyAvgMap.get(sku) || 0,
          // Magnitude compare, not raw compare — both values are negative (raw
          // ERP sign for השמדות amounts), so "worse than average" means further
          // from zero, not numerically smaller. Threshold: >2pp, per user 2026-08-25.
          pctOutlier: Math.abs(zikuyMap.get(sku) || 0) - Math.abs(companyAvgMap.get(sku) || 0) > 2,
          lastShipDate: lastShipMap.get(sku)?.date || '',
          lastShipQty: lastShipMap.get(sku)?.qty || 0,
          imgUrl: '',
          ean: '',
          famCode: '',
        };
      })
      .filter(p => p.company === 'FORMULA' || p.company === 'ICE_MISH');

    // FORMULA and ICE each have their OWN KARTIS PARIT product-master table (ICE SKUs
    // aren't in the main KARTIS PARIT at all — verified live earlier this session).
    // ean (ברקוד, full EAN-13) and famCode (משפחת מוצר, numeric family code e.g. "025" —
    // stable across renames/typos, unlike the free-text ALL_PARTS[תאור משפחת מוצר];
    // used by the frontend to flag weight-sold products, see GRAM_FAM_CODES in
    // zikuy-order.html) pulled the same pass as the photo — same table, same SKU
    // filter, no extra round-trip.
    const fetchPhotosRet = async (items, table) => {
      if (!items.length) return;
      const skuIn = items.map(p => `"${p.sku}"`).join(',');
      const rows = await executeDax(
        `EVALUATE SELECTCOLUMNS(FILTER('${table}', '${table}'[מק"ט] IN {${skuIn}}), "sku", '${table}'[מק"ט], "img", '${table}'[URL תמונה], "ean", '${table}'[ברקוד], "famCode", '${table}'[משפחת מוצר])`
      );
      const imgMap = new Map(rows.map(r => [String(r['[sku]']), r['[img]'] || '']));
      const eanMap = new Map(rows.map(r => [String(r['[sku]']), r['[ean]'] || '']));
      const famCodeMap = new Map(rows.map(r => [String(r['[sku]']), String(r['[famCode]'] ?? '')]));
      items.forEach(p => { p.imgUrl = imgMap.get(p.sku) || ''; p.ean = eanMap.get(p.sku) || ''; p.famCode = famCodeMap.get(p.sku) || ''; });
    };
    await Promise.all([
      fetchPhotosRet(products.filter(p => p.company === 'FORMULA'), 'KARTIS PARIT'),
      fetchPhotosRet(products.filter(p => p.company === 'ICE_MISH'), 'KARTIS PARIT ICE'),
    ]);

    const responseData = {
      ok: true,
      products,
      curLabel: `${d90.toLocaleDateString('he-IL')}-${todayD.toLocaleDateString('he-IL')}`,
    };
    clientReturnsCache.set(custId, { data: responseData, at: new Date() });
    res.json(responseData);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Client Analytics — per-customer sales by מחלקה, 3 closed months ──────
// Uses main FORMULA dataset (POWERBI_DATASET_ID): ALL_PARTS + ADIFUT[מחלקה]
app.get('/api/client-analytics/:custId', requireAuth, async (req, res) => {
  const custId = String(req.params.custId || '').trim();
  if (!custId) return res.status(400).json({ ok: false, error: 'custId required' });
  if (!/^\d{1,15}$/.test(custId)) return res.status(400).json({ ok: false, error: 'invalid custId' });
  const lang = (req.query.lang || 'he').slice(0, 2);

  const analyticsCacheKey = `${custId}_${lang}`;
  const cachedAnalytics = clientAnalyticsCache.get(analyticsCacheKey);
  if (cachedAnalytics) return res.json(cachedAnalytics.data);

  // GEMINI/ANTHROPIC key gate removed 2026-08-20 — the LLM commentary itself
  // was dropped (see `const analysis = null` below), so this endpoint no
  // longer calls either provider and doesn't need a key to function.

  // Re-enabled 2026-08-20 after a temporary disable — a burst of diagnostic
  // DAX calls (unrelated investigation, same PBI service principal) tripped
  // Power BI API 429 for all agents. The ~12 executeDax calls/click here are
  // still the same as before; re-enabled because normal usage shouldn't
  // reproduce the same burst. If 429s come back under normal load, this is
  // the endpoint to look at — not just the DAX volume that caused the trip.

  // Two 3-month windows: current (last 3 closed months) vs the SAME 3 calendar months one
  // year earlier — YoY, not a rolling prior-quarter comparison. Seasonal categories (e.g.
  // ice cream in summer) would otherwise show a fake "decline" against the prior 3 months
  // just because of the season, not real performance.
  const now = new Date();
  const cm = now.getMonth() + 1, cy = now.getFullYear();
  const periodMonths = (fromBack, toBack) => {
    const arr = [];
    for (let i = fromBack; i >= toBack; i--) {
      let m = cm - i, y = cy;
      if (m <= 0) { m += 12; y--; }
      arr.push({ year: y, month: m, label: `${m}/${y}` });
    }
    return arr;
  };
  const curMonths = periodMonths(3, 1);
  const priorMonths = curMonths.map(m => ({ year: m.year - 1, month: m.month, label: `${m.month}/${m.year - 1}` }));
  const curStart = curMonths[0], curEnd = curMonths[2];
  const priorStart = priorMonths[0], priorEnd = priorMonths[2];
  const SKIP_CATS = new Set(['ציוד', 'שאריות', 'תגמולים']);
  // 'מתוקים' comes through ALL_PARTS from the INTER company DB (separate sales channel,
  // same mapping as scripts/sadran-data.js DEPT_COMPANY) — kept out of the main FORM/ICE
  // breakdown so it doesn't get analyzed as if it were part of the agent's own department
  // mix; shown as its own block instead. Also used below to classify dormant products by
  // company (מחלקה itself encodes ICE's mish/bdd sub-brands — see classifyCompany).
  // מדף + מתוקים = INTER company (approved mapping, scripts/sadran-data.js DEPT_COMPANY,
  // user-approved 2026-07-21) — same set already used by classifyCompanyRet for
  // client-returns; this endpoint's own copy was missing 'מדף', so its מכר/מגמה leaked
  // into the main FORMULA family table instead of the ערוץ נפרד (INTER) block below.
  const INTER_CATS = new Set(['מדף', 'מתוקים  🍬']); // raw ADIFUT[מחלקה] values — verified live, has 2 spaces + emoji

  try {
    // Client segment: kashrut flag, private-market vs chain, and peer-group key. FORMULA
    // clients live in 'משטח' ('משטח'[רשתות - פרטי] / 'משטח'[תאור סוג לקוח] — same source
    // fields as CUSTSPEC.SPEC11/SPEC3 in Priority). ICE-only clients (badge "ICE" in the
    // UI, not in pbiCache.clientMap — see loadPBICache) never had a row in 'משטח' at all,
    // so this LOOKUPVALUE silently returned blank for them and every downstream chain/
    // kosher section (companyGaps, dormant chain products) just came up empty — not
    // "no data", the data lives in a separate dataset (POWERBI_ICE_DATASET_ID) that this
    // query never looked at. 'MISHPAHTI ICE MISHTAH' carries the same three fields under
    // different names, confirmed live 2026-08-19 ([רשת  - חנות] has the exact same two
    // values 'רשתות'/'שוק פרטי' as FORMULA's segment field). This peer-group field isn't
    // chain-only: private-market (שוק פרטי) clients carry a value too (e.g. "חנויות" —
    // generic small stores), so the same buyer-authorized-gap logic applies to them against
    // that peer group instead of a real chain. Kosher clients only compare against
    // kosher-tagged sales either way.
    const isIceOnlyClient = !pbiCache?.clientMap?.has(custId);
    const ICE_DS = process.env.POWERBI_ICE_DATASET_ID;
    const [metaTable, metaKosherCol, metaSegmentCol, metaChainCol, metaCustCol, metaDataset] =
      (isIceOnlyClient && ICE_DS)
        ? ["'MISHPAHTI ICE MISHTAH'", 'כשרות', 'רשת  - חנות', 'תאור סוג לקוח', 'מס. לקוח', ICE_DS]
        : ["'משטח'", 'כשרות', 'רשתות - פרטי', 'תאור סוג לקוח', 'מס. לקוח', undefined];
    const metaRows = await executeDax(`
EVALUATE
ROW(
  "kosher", LOOKUPVALUE(${metaTable}[${metaKosherCol}], ${metaTable}[${metaCustCol}], "${custId}"),
  "segment", LOOKUPVALUE(${metaTable}[${metaSegmentCol}], ${metaTable}[${metaCustCol}], "${custId}"),
  "chainName", LOOKUPVALUE(${metaTable}[${metaChainCol}], ${metaTable}[${metaCustCol}], "${custId}")
)`, metaDataset);
    const meta = metaRows?.[0] || {};
    const isKosher = meta['[kosher]'] === 'כן';
    const isChain = meta['[segment]'] === 'רשתות';
    const chainName = meta['[chainName]'] || '';
    const kosherFilter = isKosher ? `\n  ALL_PARTS[כשרות] = "כן",` : '';

    let chainInFilter = '';
    if (chainName) {
      const chainNameEsc = chainName.replace(/"/g, '""');
      const chainCustRows = await executeDax(
        `EVALUATE SELECTCOLUMNS(FILTER(${metaTable}, ${metaTable}[${metaChainCol}] = "${chainNameEsc}"), "cust", ${metaTable}[${metaCustCol}])`,
        metaDataset
      );
      const chainCustIds = chainCustRows.map(r => String(r['[cust]'] || '')).filter(Boolean);
      if (chainCustIds.length) {
        chainInFilter = `\n  ALL_PARTS[מספר לקוח] IN {${chainCustIds.map(id => `"${id}"`).join(',')}},`;
      }
    }

    const famDax = (start, end) => {
      const lastDay = new Date(end.year, end.month, 0).getDate();
      return `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "total",  CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]),
    "lastOrder", CALCULATE(MAX(ALL_PARTS[תאריך]))
  ),
  ALL_PARTS[מספר לקוח] = "${custId}",
  ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}
  ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
  ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
)`;
    };

    // Private-market (שוק פרטי / "חנויות") peer group is wide and heterogeneous —
    // verified live 2026-08-25 on the חנויות category, May-Jul 2026: 710 clients,
    // mean ₪23,892 vs median ₪14,456 (top account alone did ₪356,400 — a long
    // tail of large accounts pulls the mean well above what a typical small
    // private store actually does). Chain peer groups (isChain) don't have this
    // problem — a named chain's branches are much more homogeneous — so they
    // keep the plain mean. User decision 2026-08-25: median only for private-market.
    const daxAvg = (start, end) => {
      const lastDay = new Date(end.year, end.month, 0).getDate();
      if (!isChain) {
        // MEDIANX per-client. IMPORTANT: ASHMADOT/date/kosher filters must be
        // repeated INSIDE the per-row CALCULATE, not just on the outer
        // CALCULATETABLE that builds the client list — filters used to build a
        // table argument don't persist as ambient context for expressions
        // evaluated per-row via MEDIANX's context transition. Verified live
        // (probe-median-dax-verify.js, 2026-08-25): omitting them gave ₪145,799
        // (wrong — sums ALL ASHMADOT types/all dates per client), repeating them
        // gave ₪14,501 (matches independent JS median calc, ₪14,456). The
        // client-list filter (chainInFilter) is the opposite case — it targets
        // the SAME column MEDIANX groups by, so it must stay OUTER-ONLY (repeating
        // it inside would replace the per-row context transition instead of
        // intersecting with it — the same trap documented earlier in this file
        // for famDax/zikuyDax/skuDax).
        return `
EVALUATE
ROW(
  "avg_per_client",
  MEDIANX(
    CALCULATETABLE(
      SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
      ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}${chainInFilter}
      ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
      ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
    ),
    CALCULATE(
      SUM(ALL_PARTS[סכום (ש'ח)]),
      ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}
      ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
      ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
    )
  )
)`;
      }
      return `
EVALUATE
ROW(
  "avg_per_client", DIVIDE(
    CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)],
      ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}${chainInFilter}
      ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
      ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
    ),
    CALCULATE(DISTINCTCOUNT(ALL_PARTS[מספר לקוח]),
      ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}${chainInFilter}
      ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
      ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
    )
  )
)`;
    };

    // Per-SKU totals, cur+prior — only actually needed for the INTER breakdown
    // (see familiesInter below): INTER has no real תאור משפחת מוצר texture of its
    // own (famDax's SUMMARIZE collapses it to one bucket), so its sub-breakdown
    // has to come from KARTIS PARIT INTER's own פרמטר 2 field instead, which is
    // keyed by SKU, not family — same join pattern already used for the dormant
    // chain-products list above.
    //
    // Deliberately NOT using the named measure [TOTAL SALES (ללא זיכויים מרכזים)]
    // here (unlike famDax) — verified live against custId 1130037 that it returns
    // the SAME client-wide total on every single SKU row (104 rows, one figure
    // repeated 104×) instead of a per-SKU number. Root cause: the measure's own
    // definition has NOT(ALL_PARTS[מק'ט] IN ExcludedProducts) as a CALCULATE filter
    // argument on the exact column SUMMARIZE groups by — an explicit filter on a
    // column REPLACES row-context's filter on that same column (DAX filter-argument
    // semantics), instead of intersecting with it, so the per-row SKU restriction
    // from context transition gets silently thrown away. Works fine grouped by
    // family (a different column) — famDax above is unaffected. Fix: replicate the
    // exclusion as a CALCULATETABLE-level filter (applied once, before SUMMARIZE
    // groups rows) instead of inside the per-row CALCULATE, and sum the raw column
    // directly — same fix shape as the already-working zikuyDax/lastShipDax queries
    // elsewhere in this file, which never routed through this measure either.
    const skuDax = (start, end) => {
      const lastDay = new Date(end.year, end.month, 0).getDate();
      return `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט]),
    "total", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]))
  ),
  ALL_PARTS[מספר לקוח] = "${custId}",
  ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}
  NOT(ALL_PARTS[מק'ט] IN {"0","915001","915002","916000","916001","916002","916003","916004","916005","916006","916007","916008","916009","916010","916011"}),
  ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
  ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
)`;
    };

    const INTER_P2_BREAKDOWN_ENABLED = true;
    const [curRows, priorRows, avgRows, curSkuRows, priorSkuRows] = await Promise.all([
      executeDax(famDax(curStart, curEnd)),
      executeDax(famDax(priorStart, priorEnd)),
      executeDax(daxAvg(curStart, curEnd)),
      INTER_P2_BREAKDOWN_ENABLED ? executeDax(skuDax(curStart, curEnd)) : Promise.resolve([]),
      INTER_P2_BREAKDOWN_ENABLED ? executeDax(skuDax(priorStart, priorEnd)) : Promise.resolve([]),
    ]);

    const peerAvg = Math.round(avgRows?.[0]?.['[avg_per_client]'] || 0);

    // Chain-only diagnostics: "is this product even open for purchase at this client"
    // and "how does this store's mix compare to its own chain's". Both only make sense
    // when there's a chain to check against — a private-market (שוק פרטי) store has none.
    // "Open for purchase" is proxied as: the chain sold ≥1 unit somewhere in the last 120
    // days (real sales only, ASHMADOT="-מכר-", not השמדות write-offs) — if the whole peer
    // group never sold it, the buyer likely never approved it, and flagging a specific
    // branch for not ordering it would be a false "opportunity." Runs for both chain
    // clients (peer group = the chain) and private-market clients (peer group = same
    // customer-type category, e.g. "חנויות") — chainInFilter covers both.
    let dormantChainProducts = { FORMULA: [], ICE_MISH: [], INTER: [], ICE_BDD: [] };
    // Keyed by company (only companies that actually have chain data get a key) — the
    // deviation table used to be one flat list mixing FORMULA/ICE_MISH/INTER families
    // together (a INTER "מתוקים" row sitting next to a FORMULA "SVALIA" row read as if
    // they were the same comparison base), split per user request 2026-08-23.
    let familyDeviation = {};
    let companyGaps = [];
    if (chainInFilter) {
      const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;
      const daysAgo = (days) => {
        const d = new Date(Date.now() - days * 86400000);
        return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
      };
      const d120 = daysAgo(120), d90 = daysAgo(90), today = daysAgo(0);
      const curLastDay = new Date(curEnd.year, curEnd.month, 0).getDate();

      // Company classification mirrors scripts/sadran-data.js DEPT_COMPANY: the department
      // name (מחלקה) itself encodes ICE's two sub-brands (מיש/bdd tag in the name), INTER
      // is the sweets-only channel, everything else is FORMULA.
      const classifyCompany = (machlaka) => {
        if (!machlaka) return null;
        if (machlaka.includes('mish')) return 'ICE_MISH';
        if (machlaka.includes('bdd')) return 'ICE_BDD';
        if (INTER_CATS.has(machlaka)) return 'INTER';
        return 'FORMULA';
      };
      // Excluded from ICE MISH recommendations entirely — branded ice cream (גלידות
      // מותגים), all 3 pack-size variants. Raw ALL_PARTS[תאור משפחת מוצר] values, verified
      // live via SUMMARIZE(FILTER(ALL_PARTS, ALL_PARTS[חברה]="ICE"), ...).
      const ICE_EXCLUDED_FAMILIES = new Set(['‭םיזראמ םיגתומ הדילג‬', '‭יתחפשמ םיגתומ הדילג‬', '‭םידדוב םיגתומ הדילג‬']);

      const chainOpenDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט], ALL_PARTS[תאור מוצר], ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "chainTotal", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),${chainInFilter}
  ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}
  ALL_PARTS[תאריך] >= DATE(${d120.year},${d120.month},${d120.day}),
  ALL_PARTS[תאריך] <= DATE(${today.year},${today.month},${today.day})
)`;
      const storeOrderedDax = `
EVALUATE
CALCULATETABLE(
  SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט]),
  ALL_PARTS[מספר לקוח] = "${custId}",
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${d90.year},${d90.month},${d90.day}),
  ALL_PARTS[תאריך] <= DATE(${today.year},${today.month},${today.day})
)`;
      const chainFamDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "total", CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)])
  ),${chainInFilter}
  ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}
  ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
)`;

      // SKU-level chain totals, same period as chainFamDax — needed only for INTER's
      // own breakdown below (KARTIS PARIT INTER's פרמטר 2, keyed by SKU, not family).
      // Raw SUM, not the named [TOTAL SALES...] measure — same context-transition bug
      // as skuDax above (grouping by the exact column the measure filters on repeats
      // one client-wide total across every SKU row).
      const chainSkuDax = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט]),
    "total", CALCULATE(SUM(ALL_PARTS[סכום (ש'ח)]))
  ),${chainInFilter}
  ALL_PARTS[ASHMADOT] = "-מכר-",${kosherFilter}
  NOT(ALL_PARTS[מק'ט] IN {"0","915001","915002","916000","916001","916002","916003","916004","916005","916006","916007","916008","916009","916010","916011"}),
  ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
)`;

      const [chainOpenRows, storeOrderedRows, chainFamRows, chainSkuRows, stockForm, stockIce] = await Promise.all([
        executeDax(chainOpenDax),
        executeDax(storeOrderedDax),
        executeDax(chainFamDax),
        executeDax(chainSkuDax),
        executeDax(`EVALUATE SELECTCOLUMNS('זמינות FORM', "sku", 'זמינות FORM'[מק'ט], "stock", 'זמינות FORM'[מלאי זמין])`, MMD_DS),
        executeDax(`EVALUATE SELECTCOLUMNS('זמינות ICE', "sku", 'זמינות ICE'[מק'ט], "stock", 'זמינות ICE'[מלאי זמין])`, MMD_DS),
      ]);

      // Company-level totals (store vs chain, current period): flags whether this branch
      // does ANY business with a company at all. chain>0 / store=0 for a whole company is a
      // bigger signal than any single dormant SKU — worth understanding why before pitching
      // individual products from a supplier line we may not even be servicing here.
      // A client that isn't in the main FORMULA client map at all (isIceOnlyClient,
      // computed above from pbiCache.clientMap) is an ICE-only account by nature —
      // it never had a relationship with FORMULA/INTER to begin with, so "doesn't
      // work with FORMULA/INTER" isn't a gap worth flagging (there's nothing to
      // "find out why" about), and every FORMULA/INTER block below (dormant list,
      // חלוקת משפחות index) would just be a wash of 0%-מהסניף noise repeating the
      // same non-fact. Scope every one of those blocks to ICE_MISH/ICE_BDD only for
      // this client type. 2026-08-23.
      const RELEVANT_COMPANIES = isIceOnlyClient
        ? new Set(['ICE_MISH', 'ICE_BDD'])
        : new Set(['FORMULA', 'ICE_MISH', 'INTER', 'ICE_BDD']);
      const companyTotal = { FORMULA: { store: 0, chain: 0 }, ICE_MISH: { store: 0, chain: 0 }, INTER: { store: 0, chain: 0 }, ICE_BDD: { store: 0, chain: 0 } };
      curRows.forEach(r => { const c = classifyCompany(r['[מחלקה]']); const v = Math.round(r['[total]'] || 0); if (c && v > 0) companyTotal[c].store += v; });
      chainFamRows.forEach(r => { const c = classifyCompany(r['[מחלקה]']); const v = Math.round(r['[total]'] || 0); if (c && v > 0) companyTotal[c].chain += v; });
      for (const co of RELEVANT_COMPANIES) {
        const { store, chain } = companyTotal[co];
        if (chain > 0 && store === 0) companyGaps.push({ company: co, chainTotal: chain });
      }

      // Dormant SKUs, split by company. FORMULA/ICE_MISH get filtered to what's actually in
      // stock right now (זמינות FORM/ICE in the MMD dataset, by SKU) — no point pitching
      // something we can't fulfill. INTER skips the stock check (not tracked there) and
      // ICE_BDD never gets item-level detail — only the company-gap flag above, if any.
      const stockMap = new Map();
      stockForm.forEach(r => stockMap.set(String(r['[sku]']), r['[stock]']));
      stockIce.forEach(r => stockMap.set(String(r['[sku]']), r['[stock]']));
      // A SKU missing from the availability table entirely (not just 0) is NOT "assume
      // it's fine" — verified live (SKU 800, חמאה ROSHEN בד"צ) that a real, actively-sold
      // FORMULA item can be completely absent from 'זמינות FORM'. The whole point of this
      // filter is "don't recommend what we can't confirm we can fulfill," so an unknown
      // stock status must exclude the item, not default it to available.
      const inStock = (sku) => (stockMap.get(String(sku)) || 0) > 0;

      const storeOrderedSkus = new Set(storeOrderedRows.map(r => String(r["ALL_PARTS[מק'ט]"] || '')));
      const dormantRaw = chainOpenRows
        .filter(r => !storeOrderedSkus.has(String(r["ALL_PARTS[מק'ט]"] || '')))
        .filter(r => !ICE_EXCLUDED_FAMILIES.has(r['ALL_PARTS[תאור משפחת מוצר]']))
        .map(r => ({
          sku: r["ALL_PARTS[מק'ט]"],
          name: fixBiDi(r['ALL_PARTS[תאור מוצר]'] || ''),
          chainTotal: Math.round(r['[chainTotal]'] || 0),
          company: classifyCompany(r['[מחלקה]']),
        }))
        .filter(x => x.chainTotal > 0 && x.company);

      // A company already in companyGaps (store buys ₪0 from it) doesn't need its
      // own dormant-SKU list — the company-gap flag already says "doesn't work
      // with this company", listing 10 products it also hasn't ordered is just
      // restating that. Skips the INTER subFamily/photo lookups below too when
      // it applies, one less DAX round-trip on a company we already know is a gap.
      const gapCompanySet = new Set(companyGaps.map(g => g.company));
      for (const item of dormantRaw) {
        if (item.company === 'ICE_BDD') continue;
        if (!RELEVANT_COMPANIES.has(item.company)) continue;
        if (gapCompanySet.has(item.company)) continue;
        if (item.company !== 'INTER' && !inStock(item.sku)) continue;
        dormantChainProducts[item.company].push(item);
      }
      for (const co of ['FORMULA', 'ICE_MISH', 'INTER']) {
        dormantChainProducts[co].sort((a, b) => b.chainTotal - a.chainTotal);
        dormantChainProducts[co] = dormantChainProducts[co].slice(0, 10);
      }

      // INTER has no real "family" field of its own (it's essentially all one מתוקים
      // department) — use KARTIS PARIT INTER's own פרמטר 2 sub-category instead, batched
      // by SKU in one query rather than one LOOKUPVALUE call per item. Same query also
      // pulls the product photo URL (real DB field, not a guessed image-server pattern).
      if (dormantChainProducts.INTER.length) {
        const interSkus = dormantChainProducts.INTER.map(x => `"${x.sku}"`).join(',');
        const p2Rows = await executeDax(
          `EVALUATE SELECTCOLUMNS(FILTER('KARTIS PARIT INTER', 'KARTIS PARIT INTER'[מק"ט] IN {${interSkus}}), "sku", 'KARTIS PARIT INTER'[מק"ט], "p2", 'KARTIS PARIT INTER'[תאור פרמטר 2 למוצר], "img", 'KARTIS PARIT INTER'[URL תמונה])`
        );
        const p2Map = new Map(p2Rows.map(r => [String(r['[sku]']), { p2: fixBiDi(r['[p2]'] || ''), img: r['[img]'] || '' }]));
        dormantChainProducts.INTER.forEach(x => { const m = p2Map.get(String(x.sku)); x.subFamily = m?.p2 || ''; x.imgUrl = m?.img || ''; });
      }

      // Product photos: FORMULA and ICE each have their OWN KARTIS PARIT table (ICE SKUs
      // aren't in the main 'KARTIS PARIT' at all — verified live, e.g. SKU 503061 returns
      // nothing there but exists in 'KARTIS PARIT ICE'), mirroring the INTER split above.
      const fetchPhotos = async (items, table) => {
        if (!items.length) return;
        const skuIn = items.map(x => `"${x.sku}"`).join(',');
        const rows = await executeDax(
          `EVALUATE SELECTCOLUMNS(FILTER('${table}', '${table}'[מק"ט] IN {${skuIn}}), "sku", '${table}'[מק"ט], "img", '${table}'[URL תמונה])`
        );
        const imgMap = new Map(rows.map(r => [String(r['[sku]']), r['[img]'] || '']));
        items.forEach(x => { x.imgUrl = imgMap.get(String(x.sku)) || ''; });
      };
      await Promise.all([
        fetchPhotos(dormantChainProducts.FORMULA, 'KARTIS PARIT'),
        fetchPhotos(dormantChainProducts.ICE_MISH, 'KARTIS PARIT ICE'),
      ]);

      // Bucket both chain-side and store-side totals per (company, family) — chainFamRows/
      // curRows already carry [מחלקה] per row (same SUMMARIZE+LOOKUPVALUE pattern used
      // everywhere else in this file), classified with the same classifyCompany used for
      // companyGaps/dormantChainProducts above, so all three stay consistent.
      const shareOf = (v, all) => all > 0 ? v / all : 0;
      const DEV_COMPANIES = ['FORMULA', 'ICE_MISH', 'INTER'].filter(co => RELEVANT_COMPANIES.has(co));
      const bucketByCompanyFam = (rows) => {
        const byCo = { FORMULA: {}, ICE_MISH: {}, INTER: {} };
        const allByCo = { FORMULA: 0, ICE_MISH: 0, INTER: 0 };
        rows.forEach(r => {
          const co = classifyCompany(r['[מחלקה]']);
          if (!co || !byCo[co]) return;
          const v = Math.round(r['[total]'] || 0);
          if (v <= 0) return;
          const fam = r['ALL_PARTS[תאור משפחת מוצר]'];
          byCo[co][fam] = (byCo[co][fam] || 0) + v;
          allByCo[co] += v;
        });
        return { byCo, allByCo };
      };
      const chainBuckets = bucketByCompanyFam(chainFamRows);
      const storeBuckets = bucketByCompanyFam(curRows);

      // Same top-7 + "rest of families" + 100% total row shape as before, just built
      // once per company instead of once across all of them mixed together.
      const buildDeviationRows = (chainFamTotal, chainFamAll, storeFamTotal, storeFamAll) => {
        const famEntries = Object.entries(chainFamTotal).sort(([, a], [, b]) => b - a);
        const topFamEntries = famEntries.slice(0, 7);
        const topFamSet = new Set(topFamEntries.map(([fam]) => fam));
        const rows = topFamEntries.map(([fam, chainV]) => {
          const chainShare = shareOf(chainV, chainFamAll);
          const storeV = storeFamTotal[fam] || 0;
          const storeShare = shareOf(storeV, storeFamAll);
          return {
            family: fixBiDi(fam || ''),
            chainSharePct: Math.round(chainShare * 100),
            storeSharePct: Math.round(storeShare * 100),
            index: chainShare > 0 ? Math.round((storeShare / chainShare) * 100) / 100 : null,
          };
        });

        // "Rest of families" + explicit 100% total row — without this the shown top-7
        // percentages silently add up to less than 100% and look like the whole picture.
        // subFamilies on this row is the same per-family breakdown one level down
        // (everything past the top 7), for the expand-on-click drilldown.
        const restChainV = famEntries.slice(7).reduce((s, [, v]) => s + v, 0);
        const restStoreV = Object.entries(storeFamTotal).reduce((s, [fam, v]) => topFamSet.has(fam) ? s : s + v, 0);
        if (restChainV > 0 || restStoreV > 0) {
          const chainShare = shareOf(restChainV, chainFamAll);
          const storeShare = shareOf(restStoreV, storeFamAll);
          const restSubFamilies = famEntries.slice(7)
            .map(([fam, chainV]) => {
              const fChainShare = shareOf(chainV, chainFamAll);
              const storeV = storeFamTotal[fam] || 0;
              const fStoreShare = shareOf(storeV, storeFamAll);
              return {
                family: fixBiDi(fam || ''),
                chainSharePct: Math.round(fChainShare * 100),
                storeSharePct: Math.round(fStoreShare * 100),
                index: fChainShare > 0 ? Math.round((fStoreShare / fChainShare) * 100) / 100 : null,
              };
            })
            .sort((a, b) => b.chainSharePct - a.chainSharePct);
          rows.push({
            family: 'שאר המשפחות',
            chainSharePct: Math.round(chainShare * 100),
            storeSharePct: Math.round(storeShare * 100),
            index: chainShare > 0 ? Math.round((storeShare / chainShare) * 100) / 100 : null,
            isRest: true,
            subFamilies: restSubFamilies,
          });
        }
        rows.push({ family: 'סה"כ', chainSharePct: 100, storeSharePct: 100, index: null, isTotal: true });
        return rows;
      };

      for (const co of DEV_COMPANIES) {
        if (co === 'INTER') continue; // handled separately below, by SKU/פרמטר 2
        if (chainBuckets.allByCo[co] > 0) {
          familyDeviation[co] = buildDeviationRows(
            chainBuckets.byCo[co], chainBuckets.allByCo[co],
            storeBuckets.byCo[co], storeBuckets.allByCo[co],
          );
        }
      }

      // INTER's own ALL_PARTS[תאור משפחת מוצר] is just the מחלקה name itself
      // (מתוקים/מדף) — not real sub-categories, so the text-based bucketing above
      // would only ever show 2 near-useless rows. Same fix as familiesInter/dormant-
      // products INTER breakdown: KARTIS PARIT INTER's own פרמטר 2 field, keyed by
      // SKU. Store-side reuses curSkuRows (already fetched above for familiesInter,
      // same custId+period); chain-side needs its own SKU-level query (chainSkuRows).
      const skuTotalMap = (rows) => {
        const m = {};
        for (const r of rows) {
          const sku = String(r["ALL_PARTS[מק'ט]"] || '');
          const v = Math.round(r['[total]'] || 0);
          if (sku && v > 0) m[sku] = (m[sku] || 0) + v;
        }
        return m;
      };
      const chainSkuTotal = skuTotalMap(chainSkuRows);
      const storeSkuTotalDev = skuTotalMap(curSkuRows);
      const interSkuUniverse = [...new Set([...Object.keys(chainSkuTotal), ...Object.keys(storeSkuTotalDev)])];
      if (RELEVANT_COMPANIES.has('INTER') && interSkuUniverse.length) {
        const skuInList = interSkuUniverse.map(s => `"${s}"`).join(',');
        const p2Rows = await executeDax(
          `EVALUATE SELECTCOLUMNS(FILTER('KARTIS PARIT INTER', 'KARTIS PARIT INTER'[מק"ט] IN {${skuInList}}), "sku", 'KARTIS PARIT INTER'[מק"ט], "p2", 'KARTIS PARIT INTER'[תאור פרמטר 2 למוצר])`
        );
        const sku2p2Dev = new Map(p2Rows.map(r => [String(r['[sku]']), r['[p2]'] || '']));
        const interP2Chain = {}, interP2Store = {};
        let interP2ChainAll = 0, interP2StoreAll = 0;
        for (const [sku, v] of Object.entries(chainSkuTotal)) {
          const p2 = sku2p2Dev.get(sku); if (!p2) continue;
          interP2Chain[p2] = (interP2Chain[p2] || 0) + v; interP2ChainAll += v;
        }
        for (const [sku, v] of Object.entries(storeSkuTotalDev)) {
          const p2 = sku2p2Dev.get(sku); if (!p2) continue;
          interP2Store[p2] = (interP2Store[p2] || 0) + v; interP2StoreAll += v;
        }
        if (interP2ChainAll > 0) {
          familyDeviation.INTER = buildDeviationRows(interP2Chain, interP2ChainAll, interP2Store, interP2StoreAll);
        }
      }
    }

    // FORMULA/ICE rows already carry their real, granular ALL_PARTS[תאור משפחת
    // מוצר] alongside the computed מחלקה (famDax SUMMARIZEs by it) — bucket by
    // (מחלקה, family) so each department row can expand into what it's made of.
    const collect = (rows) => {
      const byCat = {}, byCatFam = {};
      let total = 0, lastOrderDate = null;
      for (const r of rows) {
        const cat = r['[מחלקה]'] || '';
        const fam = r['ALL_PARTS[תאור משפחת מוצר]'] || '';
        const val = Math.round(r['[total]'] || 0);
        const lo  = r['[lastOrder]'];
        // ICE BDD (e.g. "גלידה bdd") is its own separate channel from FORMULA's own
        // departments, same as INTER — excluded from a FORMULA client's own family
        // breakdown for the same reason. But for an ICE-only client (isIceOnlyClient)
        // BDD IS one of their own departments, not a foreign channel — it belongs in
        // their table, not hidden from it. 2026-08-23.
        if (cat && !SKIP_CATS.has(cat) && val > 0 && !INTER_CATS.has(cat) && (isIceOnlyClient || !cat.includes('bdd'))) {
          byCat[cat] = (byCat[cat] || 0) + val;
          total += val;
          byCatFam[cat] = byCatFam[cat] || {};
          if (fam) byCatFam[cat][fam] = (byCatFam[cat][fam] || 0) + val;
        }
        if (lo && (!lastOrderDate || new Date(lo) > new Date(lastOrderDate))) lastOrderDate = lo;
      }
      return { byCat, byCatFam, total, lastOrderDate };
    };
    const cur = collect(curRows);
    const prior = collect(priorRows);

    const daysSinceOrder = cur.lastOrderDate
      ? Math.round((Date.now() - new Date(cur.lastOrderDate)) / 86400000)
      : null;

    // Per-family current vs prior period, with % change — this is the actual "what's
    // accelerating / what's slowing down" view, not a flat monthly table. subFamilies
    // is the same current-vs-prior shape one level down (ALL_PARTS[תאור משפחת מוצר]),
    // for the expand-on-click drilldown under each department row.
    const allCats = new Set([...Object.keys(cur.byCat), ...Object.keys(prior.byCat)]);
    const families = {};
    for (const cat of allCats) {
      const c = cur.byCat[cat] || 0, p = prior.byCat[cat] || 0;
      const curFam = cur.byCatFam[cat] || {}, priorFam = prior.byCatFam[cat] || {};
      const subFamilies = [...new Set([...Object.keys(curFam), ...Object.keys(priorFam)])]
        .map(fam => {
          const fc = curFam[fam] || 0, fp = priorFam[fam] || 0;
          return { name: fixBiDi(fam), current: fc, prior: fp, deltaPct: fp > 0 ? Math.round((fc / fp - 1) * 100) : null };
        })
        .sort((a, b) => b.current - a.current);
      families[cat] = { current: c, prior: p, deltaPct: p > 0 ? Math.round((c / p - 1) * 100) : null, subFamilies };
    }

    // INTER breakdown by KARTIS PARIT INTER's own פרמטר 2. Root cause of the
    // inflated numbers is fixed (see skuDax comment above, verified live against
    // custId 1130037) — flag lives next to the skuDax queries it also gates.
    // Known: totals sum a few % short of the reference total (rounding across
    // ~100 SKU rows, not re-chased further).
    const familiesInter = {};
    if (INTER_P2_BREAKDOWN_ENABLED) {
      const skuTotals = (rows) => {
        const m = {};
        for (const r of rows) {
          const sku = String(r["ALL_PARTS[מק'ט]"] || '');
          const val = Math.round(r['[total]'] || 0);
          if (sku && val > 0) m[sku] = (m[sku] || 0) + val;
        }
        return m;
      };
      const curSku = skuTotals(curSkuRows), priorSku = skuTotals(priorSkuRows);
      const interSkuList = [...new Set([...Object.keys(curSku), ...Object.keys(priorSku)])];
      if (interSkuList.length) {
        const skuInFilter = interSkuList.map(s => `"${s}"`).join(',');
        const p2Rows = await executeDax(
          `EVALUATE SELECTCOLUMNS(FILTER('KARTIS PARIT INTER', 'KARTIS PARIT INTER'[מק"ט] IN {${skuInFilter}}), "sku", 'KARTIS PARIT INTER'[מק"ט], "p2", 'KARTIS PARIT INTER'[תאור פרמטר 2 למוצר])`
        );
        const sku2p2 = new Map(p2Rows.map(r => [String(r['[sku]']), fixBiDi(r['[p2]'] || '')]));
        const p2Cur = {}, p2Prior = {};
        for (const [sku, val] of Object.entries(curSku)) {
          const p2 = sku2p2.get(sku); if (!p2) continue;
          p2Cur[p2] = (p2Cur[p2] || 0) + val;
        }
        for (const [sku, val] of Object.entries(priorSku)) {
          const p2 = sku2p2.get(sku); if (!p2) continue;
          p2Prior[p2] = (p2Prior[p2] || 0) + val;
        }
        for (const p2 of new Set([...Object.keys(p2Cur), ...Object.keys(p2Prior)])) {
          const c = p2Cur[p2] || 0, p = p2Prior[p2] || 0;
          familiesInter[p2] = { current: c, prior: p, deltaPct: p > 0 ? Math.round((c / p - 1) * 100) : null };
        }
      }
    }

    // ICE BDD gets the same "ערוץ נפרד" treatment as INTER above — its own small
    // current-vs-prior table for a REGULAR (non-ICE-only) client. Unlike INTER,
    // BDD's real ALL_PARTS[תאור משפחת מוצר] is granular on its own (not just the
    // machlaka name repeated), so this reuses curRows/priorRows directly — no
    // extra SKU/Parameter-2 lookup needed. Skipped entirely for an ICE-only
    // client: bdd is already inside `families` for them (see collect() above),
    // not a foreign channel to call out separately. 2026-08-23.
    const familiesBdd = {};
    if (!isIceOnlyClient) {
      const collectBdd = (rows) => {
        const m = {};
        for (const r of rows) {
          const cat = r['[מחלקה]'] || '';
          if (!cat.includes('bdd')) continue;
          const fam = r['ALL_PARTS[תאור משפחת מוצר]'] || cat;
          const val = Math.round(r['[total]'] || 0);
          if (val > 0) m[fam] = (m[fam] || 0) + val;
        }
        return m;
      };
      const curBdd = collectBdd(curRows), priorBdd = collectBdd(priorRows);
      for (const fam of new Set([...Object.keys(curBdd), ...Object.keys(priorBdd)])) {
        const c = curBdd[fam] || 0, p = priorBdd[fam] || 0;
        familiesBdd[fixBiDi(fam)] = { current: c, prior: p, deltaPct: p > 0 ? Math.round((c / p - 1) * 100) : null };
      }
    }

    const curLabel = `${curMonths[0].label}–${curMonths[2].label}`;
    const priorLabel = `${priorMonths[0].label}–${priorMonths[2].label}`;
    const famLines = Object.entries(families)
      .sort(([, a], [, b]) => b.current - a.current)
      .map(([cat, f]) => `${cat}: ₪${f.current.toLocaleString()} (תקופה קודמת ₪${f.prior.toLocaleString()}${f.deltaPct !== null ? `, ${f.deltaPct > 0 ? '+' : ''}${f.deltaPct}%` : ''})`);

    const clientDeltaPct = prior.total > 0 ? Math.round((cur.total / prior.total - 1) * 100) : null;
    const dormantNote = daysSinceOrder && daysSinceOrder > 21
      ? `\n⚠️ לא הזמין ${daysSinceOrder} ימים — דורש תשומת לב!`
      : '';
    // Private-market (non-chain) peerAvg is a MEDIAN, not a mean — see daxAvg
    // above for why (wide/heterogeneous category, mean skewed by large accounts,
    // verified live 2026-08-25). Label/wording says חציון there, not ממוצע.
    const peerWord = isChain ? 'ממוצע' : 'חציון';
    const peerLabel = isChain ? `ממוצע לקוח ברשת ${chainName}`
      : chainName ? `חציון לקוח בקטגוריה ${chainName}`
      : 'חציון לקוח בחברה';
    const avgNote = `\n${peerLabel}${isKosher ? ' (רק מוצרים כשרים)' : ''} לתקופה ${curLabel}: ₪${peerAvg.toLocaleString()}`;
    const clientNote = `סה"כ לקוח ${curLabel}: ₪${cur.total.toLocaleString()} (${cur.total > peerAvg ? '+' : ''}${peerAvg > 0 ? Math.round((cur.total/peerAvg-1)*100) : 0}% מה${peerWord})`
      + (clientDeltaPct !== null ? ` | לעומת ${priorLabel}: ₪${prior.total.toLocaleString()} (${clientDeltaPct > 0 ? '+' : ''}${clientDeltaPct}%)` : '');
    const kosherNote = isKosher ? `\nלקוח כשר — הנתונים וההשוואה כוללים רק מוצרים כשרים.` : '';

    const companyLabel = { FORMULA: 'FORMULA', ICE_MISH: 'ICE (מיש)', INTER: 'INTER (מתוקים)', ICE_BDD: 'ICE (BDD)' };
    // "Peer group" = the real chain for a chain client, or the same customer-type category
    // (e.g. "חנויות") for a private-market client — same underlying field either way.
    // Bare noun ("רשת"/"קטגוריה") for standalone use ("X ₪..." / "מה-X") — the construct
    // state "קטגוריית" only works followed by a name and breaks in the standalone spots.
    const peerGroupWord = isChain ? 'רשת' : 'קטגוריה';
    const peerGroupName = isChain ? `רשת ${chainName}` : `קטגוריית ${chainName}`;

    // Strongest possible signal: the branch does ZERO business with an entire company the
    // rest of its peer group buys from. Bigger than any single dormant SKU — worth
    // understanding why before pitching individual products from a line we may not even
    // carry here.
    const companyGapNote = companyGaps.length
      ? `\nהסניף לא עובד בכלל עם: ${companyGaps.map(g => `${companyLabel[g.company]} (${peerGroupWord} ₪${g.chainTotal.toLocaleString()})`).join(', ')} — כדאי לברר למה.`
      : '';

    // Products the buyer HAS approved (the peer group sold them in the last 120 days, and
    // for FORMULA/ICE they're confirmed in stock right now) that THIS branch hasn't ordered
    // in 90+ days — a real, buyer-authorized gap, not a guess. One line per company, in
    // order FORMULA → ICE (מיש) → INTER; ICE BDD never gets item-level detail (only the
    // company-gap flag above, if triggered).
    const gapLines = [];
    for (const co of ['FORMULA', 'ICE_MISH', 'INTER']) {
      const items = dormantChainProducts[co];
      if (items && items.length) {
        const top = items[0];
        const label = co === 'INTER' && top.subFamily ? `${top.subFamily} — ${top.name}` : top.name;
        gapLines.push(`${companyLabel[co]}: ${label} (${peerGroupWord} ₪${top.chainTotal.toLocaleString()}, סה"כ ${items.length} מוצרים)`);
      }
    }
    const gapNote = gapLines.length ? `\nמוצרים ש${peerGroupName} מוכרת (120 יום) והסניף לא הזמין 90+ יום —\n${gapLines.join('\n')}` : '';
    // Both ends of the deviation, not just the weakest — an under-indexed family next to
    // an over-indexed one is often a brand-substitution pattern (agent/store pushing one
    // brand instead of another within the same category), which is a sharper, more useful
    // read than either number alone.
    const realFamDev = Object.values(familyDeviation).flat().filter(f => !f.isRest && !f.isTotal && f.index !== null);
    const underIndexed = realFamDev.filter(f => f.index < 0.7).sort((a, b) => a.index - b.index)[0];
    const overIndexed = realFamDev.filter(f => f.index > 1.2).sort((a, b) => b.index - a.index)[0];
    const deviationLines = [];
    if (underIndexed) deviationLines.push(`חלש: ${underIndexed.family} (${underIndexed.storeSharePct}% מהסניף מול ${underIndexed.chainSharePct}% מה${peerGroupWord}, אינדקס ${underIndexed.index})`);
    if (overIndexed && overIndexed.family !== underIndexed?.family) deviationLines.push(`חזק: ${overIndexed.family} (${overIndexed.storeSharePct}% מהסניף מול ${overIndexed.chainSharePct}% מה${peerGroupWord}, אינדקס ${overIndexed.index})`);
    const deviationNote = deviationLines.length ? `\nחריגה מפרופיל ה${peerGroupWord} — ${deviationLines.join(' | ')}.` : '';

    const context = `תקופה נוכחית: ${curLabel} | תקופה קודמת: ${priorLabel}\n${famLines.join('\n')}${avgNote}\n${clientNote}${dormantNote}${kosherNote}${companyGapNote}${gapNote}${deviationNote}`;

    const scopeNote = 'הסוכן מבקר בחנות פיזית — הוא לא מתקשר לקונים/רוכשים ואינו יכול להפעיל "סמכות" ממחלקה אחרת. המלצה רק על פעולה שהוא יכול לבצע בביקור עצמו: הצעת מוצר/מבצע, כמות הזמנה, פייסינג במדף, תזכורת למוצר שלא הוזמן.';
    const noFabNote = 'אסור להמציא מספרים, אחוזים או כמויות שלא מופיעים בנתונים למעלה. כל מספר שאתה כותב חייב להיות מבוסס ישירות על הנתונים.';
    const priorityNote = { he: 'סדר עדיפות להמלצה: 1) אם הסניף לא עובד בכלל עם חברה מסוימת שהרשת כן קונה ממנה — זו ההמלצה הכי חשובה, כי זה פער מבני ולא רק מוצר בודד. 2) אחרת, אם יש "מוצר שהרשת מוכרת והסניף לא הזמין" — זו ההמלצה הבאה, כי היא מוצר שהקניין כבר אישר לרשת. 3) רק אם אין אף אחד מהשניים — המלצה כללית על מחלקה.', uk: 'Пріоритет рекомендації: 1) якщо філія взагалі не працює з компанією, з якою купує мережа — це найважливіша рекомендація, бо це структурна прогалина, а не один товар. 2) інакше, якщо є "товар, який мережа продає, а філія не замовляла" — це наступна за важливістю. 3) лише якщо немає жодного з двох — загальна рекомендація по відділу.', ru: 'Приоритет рекомендации: 1) если филиал вообще не работает с компанией, у которой закупает сеть — это самая важная рекомендация, потому что это структурный пробел, а не один товар. 2) иначе, если есть "товар, который сеть продаёт, а филиал не заказывал" — это следующая по важности. 3) только если нет ни того ни другого — общая рекомендация по отделу.' };
    const substNote = { he: 'אם יש בנתונים משפחה "חלש" ומשפחה "חזק" מאותה קטגוריה (למשל שני מותגי גלידה) — זו רק קורלציה בתקופה אחת, לא הוכחה. אם המשפחות דומות מהותית, אפשר לציין את זה כהשערה בלשון זהירה ("ייתכן ש...", "כדאי לבדוק אם...") — לעולם לא כקביעה ודאית כמו "מעיד על" או "מצביע על". אל תמציא קשר בין משפחות שלא קשורות.', uk: 'Якщо в даних є "слабка" і "сильна" родина з тієї самої категорії (наприклад два бренди морозива) — це лише кореляція за один період, не доказ. Якщо родини справді споріднені, можна згадати це як гіпотезу обережною мовою ("можливо...", "варто перевірити чи...") — ніколи як категоричне твердження. Не вигадуй зв\'язок між непов\'язаними родинами.', ru: 'Если в данных есть "слабое" и "сильное" семейство из одной категории (например два бренда мороженого) — это лишь корреляция за один период, а не доказательство. Если семейства действительно родственные, можно упомянуть это как гипотезу осторожным языком ("возможно...", "стоит проверить, не...") — никогда как категоричное утверждение вроде "указывает на" или "свидетельствует о". Не выдумывай связь между несвязанными семействами.' };
    const hedgeNote = { he: 'בכל מקום שבו אתה מסיק קשר סיבתי מנתונים שמראים רק שינוי אחד (למשל "עלייה מעידה על ביקוש") — נסח כהשערה זהירה, לא כעובדה ודאית. שינוי אחוזים הוא עובדה; הפרשנות שלו היא השערה.', uk: 'Скрізь, де ти робиш причинний висновок із даних, які показують лише одну зміну (наприклад "зростання свідчить про попит") — формулюй як обережну гіпотезу, не як точний факт. Зміна відсотків — це факт; її інтерпретація — гіпотеза.', ru: 'Везде, где ты делаешь причинный вывод из данных, которые показывают только одно изменение (например "рост указывает на спрос") — формулируй как осторожную гипотезу, а не как точный факт. Изменение процентов — это факт; его интерпретация — гипотеза.' };
    // Abstract instructions ("be terse", "no filler") get interpreted loosely —
    // a literal template + worked example is what actually makes the model copy
    // the exact shape instead of writing flowing sentences with connector words.
    const terseNote = {
      he: 'הסוכן קורא את זה בין לקוחות, בלחץ זמן. בלי משפט פתיחה, בלי ברכה, בלי מילות חיבור מיותרות ("כמו כן", "בנוסף", "לעומת התקופה הקודמת" — זה כבר ברור מהמבנה עצמו). כל שורת תצפית בפורמט קבוע ומדויק, בלי סטייה: "[שם המשפחה]: ₪[מספר] ([+/-]X%) — [פעולה או משפט קצר עד 5 מילים]". דוגמה מדויקת: "דגים: ₪20,908 (+17%) — להמשיך לדחוף, המשפחה החזקה ביותר". עד 3 שורות כאלה. שורה נפרדת אחרונה, אותו כלל — בלי משפט מסביב: "המלצה: [פעולה קונקרטית אחת]".',
      uk: 'Агент читає це між клієнтами, під тиском часу. Без вступного речення, без привітання, без зайвих сполучників ("також", "крім того", "порівняно з попереднім періодом" — це й так зрозуміло зі структури). Кожен рядок спостереження — у чіткому, незмінному форматі: "[назва родини]: ₪[число] ([+/-]X%) — [дія або коротка фраза до 5 слів]". Точний приклад: "דגים: ₪20,908 (+17%) — продовжувати штовхати, найсильніша родина". До 3 таких рядків. Останній окремий рядок, те саме правило: "Рекомендація: [одна конкретна дія]".',
      ru: 'Агент читает это между клиентами, под давлением времени. Без вступительного предложения, без приветствия, без лишних связок ("также", "кроме того", "по сравнению с предыдущим периодом" — это и так ясно из структуры). Каждая строка наблюдения — в строгом, неизменном формате: "[название семейства]: ₪[число] ([+/-]X%) — [действие или короткая фраза до 5 слов]". Точный пример: "דגים: ₪20,908 (+17%) — продолжать двигать, самое сильное семейство". До 3 таких строк. Последняя отдельная строка, то же правило: "Рекомендация: [одно конкретное действие]".',
    };
    const noMdNote = { he: 'טקסט רגיל בלבד, בלי Markdown (בלי **, בלי #, בלי רשימות עם כוכביות).', uk: 'Лише звичайний текст, без Markdown (без **, без #, без списків із зірочками).', ru: 'Только обычный текст, без Markdown (без **, без #, без списков со звёздочками).' };
    // Frontend highlights signed percentages by regex-matching a literal +/- glyph —
    // prose like "ירד ב-17%" or "снизились на 17%" has no such glyph to match, so
    // nothing gets colored. Forcing the sign into the number itself makes it both
    // human-scannable and machine-highlightable in one move.
    const signNote = { he: 'לפני כל אחוז שינוי חובה לכתוב סימן + או - צמוד למספר (למשל "-17%" או "+123%"), גם כשהניסוח המילולי כבר מרמז על כיוון (למשל "ירד ל -17%-").', uk: 'Перед кожним відсотком зміни обов\'язково пиши знак + або - впритул до числа (наприклад "-17%" або "+123%"), навіть якщо слово вже натякає на напрямок.', ru: 'Перед каждым процентом изменения обязательно пиши знак + или - вплотную к числу (например "-17%" или "+123%"), даже если слово уже намекает на направление.' };
    const noTranslitNote = { uk: 'Назви відділів іврітом (наприклад דגים, קפוא, חלבי) залишай як є, івритом — не транслітеруй кирилицею.', ru: 'Названия отделов на иврите (например דגים, קפוא, חלבי) оставляй как есть, ивритом — не транслитерируй кириллицей.' };
    const prompts = {
      he: `אתה מנהל אזור של חברת הפצה. נתוני מכירות לפי מחלקה, תקופה נוכחית מול קודמת:\n${context}\n\nתן עד 3 תצפיות חדות המבוססות על השינוי באחוזים בפועל + המלצה אחת. אם לא הזמין >3 שבועות — זה קריטי. ${scopeNote} ${priorityNote.he} ${substNote.he} ${hedgeNote.he} ${noFabNote} ${terseNote.he} ${noMdNote.he} ${signNote.he}`,
      uk: `Ти менеджер зони. Продажі по відділах, поточний період проти попереднього:\n${context}\n\nДай до 3 спостережень на основі реальної зміни у відсотках + одну рекомендацію. Якщо >3 тижні без замовлення — критично. Агент відвідує магазин особисто — не телефонує байєрам і не діє "авторитетом" іншого відділу. Заборонено вигадувати цифри, відсотки чи кількості, яких немає в даних вище. ${priorityNote.uk} ${substNote.uk} ${hedgeNote.uk} ${terseNote.uk} ${noMdNote.uk} ${noTranslitNote.uk} ${signNote.uk}`,
      ru: `Ты менеджер зоны. Продажи по отделам, текущий период против предыдущего:\n${context}\n\nДай до 3 наблюдений на основе реального изменения в процентах + одну рекомендацию. Если >3 недель без заказа — критично. Агент лично заходит в магазин — он не звонит байерам и не действует "авторитетом" другого отдела. Запрещено выдумывать цифры, проценты или количества, которых нет в данных выше. ${priorityNote.ru} ${substNote.ru} ${hedgeNote.ru} ${terseNote.ru} ${noMdNote.ru} ${noTranslitNote.ru} ${signNote.ru}`,
    };

    // Gemini prose commentary dropped 2026-08-20 — the tables/numbers below already
    // show the trend visually (colors, arrows, %), and the LLM round-trip added
    // latency for little extra value. Prompt-building above is left in place so
    // this is a one-line restore if the panel gets a real ask for it later.
    const analysis = null;

    const analyticsResponseData = {
      ok: true,
      curLabel,
      priorLabel,
      families,
      familiesInter,
      familiesBdd,
      dropped: Array.from(SKIP_CATS),
      clientTotal: cur.total,
      clientTotalPrior: prior.total,
      peerAvg,
      isChain,
      chainName,
      dormantChainProducts,
      companyGaps,
      familyDeviation,
      daysSinceOrder,
      isKosher,
      analysis,
    };
    clientAnalyticsCache.set(analyticsCacheKey, { data: analyticsResponseData, at: new Date() });
    res.json(analyticsResponseData);
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// /admin/send-test-invite removed — was unauthenticated and returned valid session tokens

// SADRAN reports (PPTX) — сгенерированы cron-джобом на VPS (fetch-sadran-data.js +
// generate-sadran-report*.js в изолированном /root/COLUMBUS-ai-analitik). Whitelist
// вместо req.params напрямую в path.join — иначе path traversal через имя файла.
const SADRAN_OUTPUT_DIR = '/root/COLUMBUS-ai-analitik/output/sadran';
const SADRAN_REPORT_FILES = new Set([
  'SADRAN_REPORT.pptx',
  'SADRAN_REPORT_IMPECCABLE.pptx',
  'SADRAN_REPORT_IMPECCABLE_HE.pptx',
]);
app.get('/reports/sadran/:filename', requireAuth, dataRateLimit, (req, res) => {
  if (!SADRAN_REPORT_FILES.has(req.params.filename)) return res.status(404).json({ error: 'not_found' });
  const filePath = path.join(SADRAN_OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not_generated_yet' });
  res.download(filePath, req.params.filename);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Columbus server running on port ${PORT}`);
  await loadPBICache();
  scheduleDailyPBIReload();
});

// Flush sessions to disk before pm2 restart/shutdown
process.on('SIGTERM', () => {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))); } catch (_) {}
  process.exit(0);
});
