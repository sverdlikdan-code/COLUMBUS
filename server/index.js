require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const { executeDax, getDatasetRefreshTime } = require('./powerbi');

// ── PBI CACHE ──────────────────────────────────────────────────────────────
// Single source of truth: all client/agent/manager data loaded from Power BI
// at startup and refreshed daily. Endpoints serve from memory → <5ms latency.

const DAY_HE_TO_NUM = { 'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5 };

let pbiCache = null; // set by loadPBICache()

async function loadPBICache() {
  console.log('[PBI] Loading cache...');
  try {
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
  FILTER('משטח עם כפולות', 'משטח עם כפולות'[סטטוס] = "פעיל"),
  "custId",     'משטח עם כפולות'[מס.לקוח],
  "day",        'משטח עם כפולות'[יום],
  "visitOrder", 'משטח עם כפולות'[סדר ביקור]
)
`);

    // C: Current month sales per customer from ALL_PARTS (FORM+ICE+INTER)
    const salesRows = await executeDax(`
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
`);

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
        status:    r['משטח[סטטוס]']   || '',
        kosher:    r['משטח[כשרות]']   || '',
        saleType:  r['משטח[סוג מכירה]'] || '',
        param7:    r['משטח[פרמטר 7]'] || null,
        agentCode: r['משטח[סוכן]']    || '',
        agentName: fixBiDi(r['משטח[שם סוכן]'] || ''),
        manager:   r['משטח[קבוצה]']   || '',
        target:    parseFloat(r['[target]']) || 0,
        monthlySales:  0,
        lastOrderDate: null,
      });
    }

    // Merge sales into clientMap
    for (const r of salesRows) {
      const custId = String(r['ALL_PARTS[מספר לקוח]'] || '');
      const c = clientMap.get(custId);
      if (!c) continue;
      c.monthlySales  = parseFloat(r['[monthlySales]']) || 0;
      const d = r['[lastDate]'];
      c.lastOrderDate = d ? new Date(d).toISOString().slice(0, 10) : null;
    }

    // Build schedule map: custId → [{dayNum, dayLabel, visitOrder}]
    const schedMap = new Map();
    for (const r of schedRows) {
      const custId = String(r['[custId]'] || '');
      if (!custId) continue;
      const day = fixBiDi(r['[day]'] || '');
      const dayNum = DAY_HE_TO_NUM[day] || null;
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

    pbiCache = {
      clientMap,
      byAgent,
      managers: [...managers].sort(),
      agentsByManager: new Map([...agentsByManager].map(([k, v]) => [k, [...v.values()]])),
      loadedAt: new Date(),
    };
    console.log(`[PBI] Cache loaded: ${clientMap.size} clients, ${byAgent.size} agents, ${managers.size} managers`);
  } catch (err) {
    console.error('[PBI] Cache load error:', err.message);
  }
}

// Schedule daily reload at 06:00 (server local time)
function scheduleDailyPBIReload() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(6, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  setTimeout(() => { loadPBICache(); setInterval(loadPBICache, 24 * 60 * 60 * 1000); }, ms);
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

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)));
  } catch (_) { /* best-effort — don't crash the request on disk issues */ }
}

loadSessions();

function createSession(agentCode, isManager) {
  const token = crypto.randomUUID();
  sessions.set(token, { agentCode, isManager, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
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
  sess.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
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

// POST /log-access — client sends login/logout events
const LOG_EVENTS = new Set(['login', 'logout']);
app.post('/log-access', dataRateLimit, (req, res) => {
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

// GET /auth/pbi — auto-login as manager if opened via PBI (fr_ok cookie present)
app.get('/auth/pbi', (req, res) => {
  const cookies = req.headers.cookie || '';
  if (!/(?:^|;\s*)fr_ok=1/.test(cookies)) return res.status(401).json({ ok: false });
  return res.json({ ok: true, token: createSession(null, true) });
});

// POST /auth — unified login: manager password OR agent code → returns session token
app.post('/auth', (req, res) => {
  const ip = getRealIp(req);
  if (checkRateLimit(ip)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  const { code } = req.body || {};
  const codeStr = String(code || '').trim();

  // Manager password check
  const MANAGER_PASS = process.env.MANAGER_PASS || '1999';
  if (codeStr === MANAGER_PASS) {
    loginAttempts.delete(ip);
    return res.json({ ok: true, type: 'manager', token: createSession(null, true) });
  }

  // Agent code check — validate against formula-road-data.json
  const agents = loadAgentList();
  const agent = agents[codeStr];
  if (agent) {
    loginAttempts.delete(ip);
    return res.json({ ok: true, type: 'agent', agentCode: codeStr, agentName: agent.name, token: createSession(codeStr, false) });
  }

  res.json({ ok: false, error: 'invalid_code' });
});

// GET /admin/logs?key=KEY — view access log
app.get('/admin/logs', (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_LOG_KEY || '';
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });
  const log = readLog().slice(-300).reverse();
  const html = req.headers.accept?.includes('text/html');
  if (html) {
    const rows = log.map(e => {
      const d = new Date(e.ts);
      const local = d.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', hour12: false });
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
      tr:nth-child(even){background:#f5f5f5}h2{color:#1A3F7C}</style></head>
      <body><h2>Formula Road — Access Log (${log.length} entries)</h2>
      <table><thead><tr><th>זמן</th><th>אירוע</th><th>משתמש</th><th>IP</th><th>מכשיר</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`);
  }
  res.json(log);
});

// POST /admin/revoke?key=KEY&agentCode=CODE — invalidate all sessions for a specific agent
app.post('/admin/revoke', (req, res) => {
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

// City bounding-box cache: city name → { minLat, maxLat, minLng, maxLng } | null
const cityBBoxCache = new Map();

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
    clean = clean.replace(/[֐-׿יִ-ﭏ]+/g, seg =>
      seg.split('').reverse().join('')
    );
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

  // attempt 2: street+number only + city
  const street = extractStreetNum(cleaned || address || '');
  if (street && street !== cleaned) {
    const r = await geocodeAddress(street + cityStr + ', ישראל', city);
    if (r) return r;
  }

  // attempt 3: AI normalization + city
  const aiAddr = await normalizeAddressWithAI(address, city);
  if (aiAddr) {
    const r = await geocodeAddress(aiAddr + cityStr + ', ישראל', city);
    if (r) { saveGeocodeCache(); return r; }
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
    c.pbiLat = c.lat || null;
    c.pbiLng = c.lng || null;

    const la = parseFloat(c.lat), lo = parseFloat(c.lng);
    if (isValidIL(la, lo)) {
      // Trust Priority GPS if inside Israel — no city-bbox cross-check
      // (Azure/Nominatim bbox unreliable for Hebrew city abbreviations)
      c.lat = la; c.lng = lo;
      c.gpsSource = 'pbi';
    } else {
      c.gpsSource = 'geocoded';
    }
  }

  // geocode clients still missing valid coords
  const needsGeocode = clients.filter(c => !isValidIL(c.lat, c.lng) && (c.address || c.city));
  let resolved = 0;
  for (const c of needsGeocode) {
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

// GET /manager-agents?manager=NAME — from PBI cache
app.get('/manager-agents', requireAuth, dataRateLimit, async (req, res) => {
  const { manager } = req.query;
  if (!manager) return res.status(400).json({ error: 'manager required' });
  if (!validateManagerName(manager)) return res.status(400).json({ error: 'invalid manager' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const agents = pbiCache.agentsByManager.get(manager) || [];
  res.json(agents.sort((a, b) => (a.agentName || '').localeCompare(b.agentName || '')));
});

// GET /customers?agent=CODE&day=1 — from PBI cache
app.get('/customers', requireAuth, dataRateLimit, async (req, res) => {
  const { agent, day } = req.query;
  if (!agent) return res.status(400).json({ error: 'agent required' });
  if (!validateAgentCode(agent)) return res.status(400).json({ error: 'invalid agent code' });
  if (day && !/^[1-5]$/.test(String(day))) return res.status(400).json({ error: 'invalid day' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });

  const dayNum = day ? parseInt(day) : null;

  try {
    let clients = (pbiCache.byAgent.get(agent) || []).slice();
    if (dayNum) clients = clients.filter(c => c.dayNum === dayNum);

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

    await geocodeBatch(clients);
    res.json(clients);
  } catch (err) {
    console.error('/customers error:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/export-route-xlsx — Excel с Smart Table, подсветкой изменений и GPS
app.post('/api/export-route-xlsx', requireAuth, dataRateLimit, async (req, res) => {
  const { rows, agentName, dayLabel } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'missing rows' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Formula Road';
  const ws = wb.addWorksheet('מסלול', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });

  const COLS = [
    { name: '#',          width: 6  },
    { name: 'מס. לקוח',  width: 14 },
    { name: 'שם לקוח',   width: 28 },
    { name: 'יום',        width: 10 },
    { name: 'עיר',        width: 16 },
    { name: 'כתובת',      width: 26 },
    { name: 'קו רוחב',    width: 13 },
    { name: 'קו אורך',    width: 13 },
    { name: 'GPS',        width: 10 },
    { name: 'סדר מקורי',  width: 13 },
    { name: 'הערה',       width: 20 },
  ];

  ws.addTable({
    name: 'RouteTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium7', showRowStripes: true },
    columns: COLS.map(c => ({ name: c.name, filterButton: true })),
    rows: rows.map(r => [
      r.currentPos,
      String(r.custId || ''),
      r.custName || '',
      r.dayLabel || '',
      r.city || '',
      r.address || '',
      r.lat ? Number(parseFloat(r.lat).toFixed(6)) : '',
      r.lng ? Number(parseFloat(r.lng).toFixed(6)) : '',
      r.lat && r.lng ? '✓' : 'חסר',
      r.noOrder ? 'חסר סדר ביקור' : (r.originalPos != null ? r.originalPos : ''),
      r.note || '',
    ]),
  });

  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const FILL_YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF59D' } };
  const FILL_ORANGE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC80' } };
  const FILL_GRAY1  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEFF1' } };
  const FILL_GRAY2  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  const DOUBTFUL    = new Set(['geocoded', 'pbi-sibling-near', 'city-center', 'no-gps']);

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    let fill = null;
    if (r.noOrder) {
      fill = i % 2 === 0 ? FILL_GRAY1 : FILL_GRAY2;
    } else if (DOUBTFUL.has(r.gpsSource)) {
      fill = FILL_ORANGE;
    } else if (r.changed) {
      fill = FILL_YELLOW;
    }
    if (fill) {
      for (let col = 1; col <= COLS.length; col++) ws.getCell(rowNum, col).fill = fill;
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

// Save planogram base JSON back to docs/
app.post('/save-kapua', requireAuth, (req, res) => {
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

// GET /api/mekarer-parts — product names for the 4 refrigerator codes
app.get('/api/mekarer-parts', requireAuth, async (req, res) => {
  try {
    const rows = await executeDax(`
EVALUATE
FILTER(
  SELECTCOLUMNS('KARTIS PARIT', "makat", 'KARTIS PARIT'[מק"ט], "name", 'KARTIS PARIT'[תאור]),
  OR(OR(OR(
    [makat] = "901401",
    [makat] = "901402"),
    [makat] = "901301"),
    [makat] = "901302"
  )
)
`);
    const parts = rows.map(r => ({
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
  const companyArg = company && company !== 'הכל'
    ? `,\n  ALL_PARTS[חברה] = "${company.replace(/["\\\]]/g, '')}"`
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
    const list = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];
    const id = Date.now();
    list.push({ id, ...order, submittedAt: new Date().toISOString(),
      agentCode: req.session?.agentCode || null });
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
    writeLog({ ts: new Date().toISOString(), event: 'mekarer-order', id,
      custId: String(order.custId), agentCode: req.session?.agentCode || null, ip: getRealIp(req) });
    res.json({ ok: true, id });
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

// GET /pbi/formula-refresh — last PBI dataset refresh time for FORMULA dataset
app.get('/pbi/formula-refresh', dataRateLimit, async (req, res) => {
  try {
    const t = await getDatasetRefreshTime(process.env.POWERBI_DATASET_ID);
    res.json({ ok: true, refreshedAt: t });
  } catch (err) {
    res.json({ ok: false, refreshedAt: null });
  }
});

// GET /pbi/dagim-sales?periods=2026-5,2026-6 — live sales for הזמנה period filter (combined period)
// Legacy single-month form also supported: ?year=2026&month=5
app.get('/pbi/dagim-sales', dataRateLimit, async (req, res) => {
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

    // Query 2 — total carton sales per product in selected period
    const [extRows, totRes] = await Promise.all([
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
    ]);

    const totalBranchy = totRes?.[0]?.['[tot]'] ?? null;

    // Build ext lookup by מק"ט
    const extMap = {};
    if (extRows) {
      for (const r of extRows) {
        const mk = r["ALL_PARTS[מק'ט]"];
        if (mk != null) extMap[String(mk)] = { mkrTk: r['[mkrTk]'] ?? null };
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
    res.json({ ok: true, data, totalBranchy });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
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

// SSRF guard: only allow HTTPS to external public hosts
const PHOTO_ALLOWED_HOSTS = new Set(['priority.dilerbmd.com']);
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

    // Merge title across all 14 data columns (B–O) so text is visible
    const LAST_COL_LETTER = 'O'; // 14 columns: B(photo)..O(last)
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
    const MAKAT_COL = PHOTO_COL + 2; // מק"ט
    const EAN_COL   = PHOTO_COL + 3; // ברקוד EAN
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
    await Promise.all(rows.map(async (r, i) => {
      if (!r.photoUrl || !isSafePhotoUrl(r.photoUrl)) return;
      try {
        const resp = await fetch(r.photoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
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
    }));

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
  if (!key) return next(); // no key configured → open access (dev mode)
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
  res.sendFile(path.join(__dirname, '..', 'docs', 'mmd-orders.json'));
});

app.get('/mmd/img/:mkt', mmdGuard, (req, res) => {
  const mkt = req.params.mkt.replace(/\D/g, '');
  if (!mkt) return res.status(400).end();
  const imgUrl = `https://priority.dilerbmd.com/priimages/${mkt}.jpg`;
  const req2 = https.get(imgUrl, imgRes => {
    if (imgRes.statusCode !== 200) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    imgRes.pipe(res);
  });
  req2.on('error', () => res.status(502).end());
  req2.setTimeout(4000, () => { req2.destroy(); res.status(504).end(); });
});

let rebuildInProgress = false;
app.post('/mmd/rebuild', mmdGuard, (req, res) => {
  if (rebuildInProgress) return res.json({ ok: false, busy: true });
  rebuildInProgress = true;
  const script = path.join(__dirname, 'build-mmd-orders.js');
  execFile('node', [script], { timeout: 60000 }, (err, stdout) => {
    rebuildInProgress = false;
    if (err) return res.status(500).json({ ok: false, error: err.message });
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
  if (y1 < 2020 || y2 > 2100 || new Date(d1s) > new Date(d2s)) {
    return res.status(400).json({ ok: false, error: 'bad date range' });
  }
  const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;
  if (!MMD_DS) return res.status(503).json({ ok: false, error: 'MMD dataset not configured' });
  const df = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},${day1}), DATE(${y2},${m2},${day2}))`;
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
        "mkr_tk",     CALCULATE([מכר קרטון],              ${df}),
        "shavuot",    CALCULATE([לכמה שבועות יספיק המלאי], ${df}),
        "yamim_haya", CALCULATE([ימים שהיה בהם מלאי],    ${df}),
        "pct_mkr",    CALCULATE([ימי מכר מכלל ימי עבודה %], ${df}),
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
      mkr_tk:     r['[mkr_tk]']     != null ? Math.round(r['[mkr_tk]'])              : null,
      shavuot:    r['[shavuot]']    != null ? Math.round(r['[shavuot]']  * 10) / 10 : null,
      yamim_haya: r['[yamim_haya]'] != null ? Math.round(r['[yamim_haya]'])          : null,
      pct_mkr:    r['[pct_mkr]']   != null ? Math.round(r['[pct_mkr]'])             : null,
      hamlatza:   r['[hamlatza_k]'] != null ? Math.round(r['[hamlatza_k]'] * 10) / 10 : null,
      tukuf:      r['[tukuf]']      ?? null,
      yamim:      r['[yamim]']      != null ? Math.round(r['[yamim]'])               : null,
    }));
    res.json({ ok: true, data });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/mmd', mmdGuard, express.static(path.join(__dirname, '..', 'MMD ORDERS')));

// ── FORMULA ROAD ─────────────────────────────────────────────────────────────
function formulaRoadGuard(req, res, next) {
  const key = process.env.FORMULA_PBI_KEY;
  if (!key) return next();
  const cookies = req.headers.cookie || '';
  const hasCookie = /(?:^|;\s*)fr_ok=1/.test(cookies);
  if (req.query.k === key) {
    // SameSite=None;Secure (not Lax) — formula-road.html is served from
    // GitHub Pages, a different origin than this API, so the cookie must be
    // sendable on cross-site fetch() calls (Lax blocks those, only allows
    // top-level navigation).
    res.setHeader('Set-Cookie', 'fr_ok=1; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=2592000');
    return next();
  }
  if (hasCookie) return next();
  return res.status(403).send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>גישה מוגבלת</title><style>body{font-family:sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;background:#fff;padding:48px 40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08)}h2{margin:0 0 12px;color:#1a1a2e;font-size:1.4rem}p{color:#666;margin:0}</style></head><body><div><div style="font-size:2.5rem;margin-bottom:16px">🔒</div><h2>גישה דרך Power BI בלבד</h2><p>יש לפתוח את האפליקציה מתוך לוח הבקרה ב-Power BI</p></div></body></html>`);
}
app.get('/formula-road', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'formula-road.html'));
});
// Static data files referenced via relative fetch in formula-road.html
app.get('/gps-corrections.json', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'gps-corrections.json'));
});
app.get('/formula-road-data.json', formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'formula-road-data.json'));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Columbus server running on port ${PORT}`);
  await loadPBICache();
  scheduleDailyPBIReload();
});
