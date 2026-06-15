require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { executeDax, getDatasetRefreshTime } = require('./powerbi');

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
}));
app.use(express.json({ limit: '512kb' }));

// ── HTTP SECURITY HEADERS ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
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

function createSession(agentCode, isManager) {
  const token = crypto.randomUUID();
  sessions.set(token, { agentCode, isManager, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  // Prune expired sessions when map grows large
  if (sessions.size > 500) {
    const now = Date.now();
    for (const [t, s] of sessions) { if (s.expiresAt < now) sessions.delete(t); }
  }
  return token;
}

function requireAuth(req, res, next) {
  const token = (req.headers['x-session'] || '').trim();
  const sess = sessions.get(token);
  if (!sess || Date.now() > sess.expiresAt) return res.status(401).json({ error: 'unauthorized' });
  req.session = sess;
  next();
}

// Agent list cache — loaded from formula-road-data.json (built by GitHub Actions)
let agentListCache = null;
function loadAgentList() {
  if (agentListCache) return agentListCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'formula-road-data.json'), 'utf8');
    agentListCache = JSON.parse(raw).agents || {};
    return agentListCache;
  } catch { return {}; }
}

// HTML escape helper for log output
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// POST /log-access — client sends login/logout events
const LOG_EVENTS = new Set(['login', 'logout']);
app.post('/log-access', checkGeneralLimit, (req, res) => {
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
    for (const [k, v] of Object.entries(data)) geocodeCache.set(k, v);
    console.log(`geocode cache loaded: ${geocodeCache.size} entries`);
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

  // Azure Maps returns viewport (bounding box) — no rate limit
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

  // Nominatim fallback for bbox
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
  [/רח[''׳]\s*/g, 'רחוב '],
  [/ד[""״]ר\s*/g, 'דוקטור '],
  [/פרופ[''׳]\s*/g, 'פרופסור '],
  [/שד[''׳]\s*/g, 'שדרות '],
];

const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi, /מרכז עסקים[^,]*/gi, /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi, /מתחם[^,]*/gi, /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi, /בית קפה[^,]*/gi, /מסעדה[^,]*/gi,
  /סופרמרקט[^,]*/gi, /קומה\s*\d+/gi, /דירה\s*\d+/gi,
  /כניסה\s*[א-ת\d]+/gi, /בניין\s*[א-ת\d]*/gi, /\(.*?\)/g,
];

function isPoBox(address) {
  return /ת\.?ד\.?\s*\d+/i.test(address) || /p\.?o\.?\s*box/i.test(address);
}

function cleanAddressForGeocoding(address) {
  if (!address) return address;
  let s = address;
  for (const [pat, rep] of ABBREV_MAP) s = s.replace(pat, rep);
  // strip apartment fraction: "הרצל 5/3" → "הרצל 5"
  s = s.replace(/(\d+)\/\d+/g, '$1');
  for (const pattern of VENUE_PATTERNS) s = s.replace(pattern, '');
  return s.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

// ── Geocoding services ────────────────────────────────────────────────────────
const AZURE_MAPS_KEY = process.env.AZURE_MAPS_KEY || '';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

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

async function geocodeGoogle(query) {
  if (!GOOGLE_MAPS_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=il&key=${GOOGLE_MAPS_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    const r = data?.results?.[0]?.geometry?.location;
    if (r) return { lat: r.lat, lng: r.lng };
  } catch (_) {}
  return null;
}

let _lastNominatimMs = 0;
async function geocodeNominatim(query) {
  // respect 1 req/sec limit
  const wait = 1100 - (Date.now() - _lastNominatimMs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNominatimMs = Date.now();
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=il`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ColumbusDillerApp/1.1' }, signal: AbortSignal.timeout(4000) });
    const data = await resp.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
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

async function geocodeAddress(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);
  let result = await geocodeGoogle(query);
  if (!result) result = await geocodeAzure(query);
  if (!result) result = await geocodeNominatim(query);
  geocodeCache.set(query, result || null);
  return result || null;
}

function extractStreetNum(address) {
  if (!address) return null;
  const m = address.match(/[א-ת"'\-\s]{2,}\s+\d+/);
  return m ? m[0].trim() : null;
}

async function geocodeAddressCascade(address, city) {
  if (isPoBox(address || '')) return null;

  const cleaned = cleanAddressForGeocoding(address);
  const cityStr = city ? `, ${city}` : '';

  // attempt 1: full cleaned address + city
  if (cleaned) {
    const r = await geocodeAddress(cleaned + cityStr + ', ישראל');
    if (r) return r;
  }

  // attempt 2: street+number only + city
  const street = extractStreetNum(cleaned || address || '');
  if (street && street !== cleaned) {
    const r = await geocodeAddress(street + cityStr + ', ישראל');
    if (r) return r;
  }

  // attempt 3: AI normalization + city
  const aiAddr = await normalizeAddressWithAI(address, city);
  if (aiAddr) {
    const r = await geocodeAddress(aiAddr + cityStr + ', ישראל');
    if (r) { saveGeocodeCache(); return r; }
  }

  // attempt 4: city-only fallback
  if (city) {
    const r = await geocodeAddress(city + ', ישראל');
    if (r) return r;
  }

  return null;
}

async function geocodeBatch(clients) {
  // fetch city bboxes (Azure Maps, no delays)
  const allCities = [...new Set(clients.map(c => c.city).filter(Boolean))];
  await Promise.all(allCities.map(city => cityBBoxCache.has(city) ? null : getCityBBox(city)));

  // save Priority GPS and mark source before any overwrite
  for (const c of clients) {
    c.pbiLat = c.lat || null;
    c.pbiLng = c.lng || null;

    if (isValidIL(c.lat, c.lng)) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (!isWithinCityBBox(c.lat, c.lng, bbox)) {
        c.gpsSource = 'pbi-bad';
        c.lat = null; c.lng = null;
      } else {
        c.gpsSource = 'pbi';
      }
    } else {
      c.gpsSource = 'geocoded';
    }
  }

  // geocode clients still missing valid coords
  const needsGeocode = clients.filter(c => !isValidIL(c.lat, c.lng) && (c.address || c.city));
  let resolved = 0;
  for (const c of needsGeocode) {
    const result = await geocodeAddressCascade(c.address, c.city);
    if (result) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(result.lat, result.lng, bbox)) {
        c.lat = result.lat; c.lng = result.lng; resolved++;
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

// GET /managers — unique manager groups from Fabric
app.get('/managers', requireAuth, async (req, res) => {
  try {
    const rows = await executeDax(
      "EVALUATE DISTINCT(SELECTCOLUMNS('משטח', \"managerCode\", 'משטח'[קבוצה]))"
    );
    const managers = rows
      .map(r => ({ managerCode: r['[managerCode]'] }))
      .filter(m => m.managerCode)
      .sort((a, b) => a.managerCode.localeCompare(b.managerCode));
    res.json(managers);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// GET /manager-agents?manager=ALEXEY — agents for a manager
app.get('/manager-agents', requireAuth, dataRateLimit, async (req, res) => {
  const { manager } = req.query;
  if (!manager) return res.status(400).json({ error: 'manager required' });
  if (!validateManagerName(manager)) return res.status(400).json({ error: 'invalid manager' });
  try {
    const rows = await executeDax(`
EVALUATE
DISTINCT(
  SELECTCOLUMNS(
    FILTER('משטח', 'משטח'[קבוצה] = "${manager.replace(/"/g, '')}"),
    "agentCode", 'משטח'[סוכן],
    "agentName", 'משטח'[שם סוכן]
  )
)
ORDER BY [agentName] ASC
    `);
    res.json(
      rows.map(r => ({
        agentCode: r['[agentCode]'],
        agentName: r['[agentName]'],
      }))
    );
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// GET /customers?agent=CODE&day=1
app.get('/customers', requireAuth, dataRateLimit, async (req, res) => {
  const { agent, day } = req.query;
  if (!agent) return res.status(400).json({ error: 'agent required' });
  if (!validateAgentCode(agent)) return res.status(400).json({ error: 'invalid agent code' });
  if (day && !/^[1-5]$/.test(String(day))) return res.status(400).json({ error: 'invalid day' });

  const dayLabel = day ? DAY_LABELS[parseInt(day)] : null;
  const dayFilter = dayLabel
    ? `&& 'משטח עם כפולות'[יום] = "${dayLabel}"`
    : '';

  const dax = `
EVALUATE
ADDCOLUMNS(
  FILTER('משטח עם כפולות',
    'משטח עם כפולות'[סוכן] = "${agent.replace(/"/g, '')}"
    ${dayFilter}
  ),
  "כתובת",    LOOKUPVALUE('משטח'[כתובת],    'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "עיר",      LOOKUPVALUE('משטח'[עיר],      'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "כשרות",    LOOKUPVALUE('משטח'[כשרות],    'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "סוג מכירה",LOOKUPVALUE('משטח'[סוג מכירה],'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "קבוצה",    LOOKUPVALUE('משטח'[קבוצה],    'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "lat",      LOOKUPVALUE('משטח'[קו רוחב], 'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "lng",      LOOKUPVALUE('משטח'[קו אורך], 'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "הזמנה אחרונה",
    CALCULATE(
      MAX('ALL_PARTS'[תאריך]),
      FILTER('ALL_PARTS', 'ALL_PARTS'[מספר לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח]))
    ),
  "מכירות חודש",
    CALCULATE(
      [TOTAL SALES (ללא זיכויים מרכזים)],
      FILTER('ALL_PARTS',
        'ALL_PARTS'[מספר לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח])
        && YEAR('ALL_PARTS'[תאריך]) = YEAR(TODAY())
        && MONTH('ALL_PARTS'[תאריך]) = MONTH(TODAY())
      )
    ),
  "totalSales",
    CALCULATE(
      [TOTAL SALES (ללא זיכויים מרכזים)],
      FILTER('ALL_PARTS', 'ALL_PARTS'[מספר לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח]))
    ),
  "lastSaleDate",
    CALCULATE(
      MAX('ALL_PARTS'[תאריך]),
      FILTER('ALL_PARTS', 'ALL_PARTS'[מספר לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח]))
    ),
  "יעד",
    CALCULATE([יעד $],
      FILTER('משטח',
        'משטח'[מס. לקוח] = EARLIER('משטח עם כפולות'[מס.לקוח])
        && 'משטח'[סטטוס] IN {"פעיל"})),
  "% ביצוע",
    CALCULATE([% יעד כספי ביצוע],
      FILTER('ALL_PARTS','ALL_PARTS'[מספר לקוח]=EARLIER('משטח עם כפולות'[מס.לקוח])),
      FILTER('משטח','משטח'[מס. לקוח]=EARLIER('משטח עם כפולות'[מס.לקוח])))
)
ORDER BY 'משטח עם כפולות'[סדר ביקור] ASC
  `;

  try {
    const rows = await executeDax(dax);
    const clients = rows.map(r => {
      const custName = r['משטח עם כפולות[שם לקוח]'] || '';
      const address  = r['[כתובת]'] || '';
      const city     = r['[עיר]']   || '';
      const dayNum   = parseInt(day) || null;
      return {
        custId:        r['משטח עם כפולות[מס.לקוח]'],
        custName,
        city,
        address,
        fullAddress:   [address, city, 'ישראל'].filter(Boolean).join(', '),
        lat:           r['[lat]'] || null,
        lng:           r['[lng]'] || null,
        status:        r['משטח עם כפולות[סטטוס]'],
        kosher:        r['[כשרות]'],
        saleType:      r['[סוג מכירה]'],
        param7:        null,
        agentCode:     r['משטח עם כפולות[סוכן]'],
        agentName:     r['משטח עם כפולות[שם סוכן]'],
        schedulerName: null,
        dayNum,
        dayLabel:      dayLabel || r['משטח עם כפולות[יום]'],
        priorityOrder:   r['משטח עם כפולות[סדר ביקור]'] || 0,
        lastOrderDate:   r['[הזמנה אחרונה]'] ? r['[הזמנה אחרונה]'].split('T')[0] : null,
        monthlySales:    r['[מכירות חודש]'] || 0,
        totalSales:      r['[totalSales]'] || 0,
        lastSaleDate:    r['[lastSaleDate]'] ? r['[lastSaleDate]'].split('T')[0] : null,
        target:          r['[יעד]'] || 0,
        pct:             r['[% ביצוע]'] || 0,
      };
    });
    await geocodeBatch(clients);
    res.json(clients);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
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

// ── BiDi decode (same logic as export-gps-report.js) ────────────────────────
const _BIDI_TEST  = /[‎‏‪-‮]/;
const _BIDI_STRIP = /[‎‏‪-‮]/g;
function fixBiDi(raw) {
  if (!raw) return '';
  const hasBidi = _BIDI_TEST.test(raw);
  const s = raw.replace(_BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  const fixed = s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('') : w)
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
  if (company && !/^[֐-׿a-zA-Z0-9 \-']{1,60}$/.test(company)) {
    return res.status(400).json({ error: 'invalid company' });
  }
  const companyArg = company && company !== 'הכל'
    ? `,\n  ALL_PARTS[חברה] = "${company.replace(/"/g, '')}"`
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
    const order = req.body;
    if (!order || !order.custId) return res.status(400).json({ error: 'invalid order' });
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

// GET /pbi/dagim-sales?periods=2026-5,2026-6 — live sales for הזמנה period filter (combined period)
// Legacy single-month form also supported: ?year=2026&month=5
app.get('/pbi/dagim-sales', requireAuth, dataRateLimit, async (req, res) => {
  let dateFilter;

  if (req.query.periods) {
    // Multi-period: "2026-5,2026-6" → OR-combined DAX filter
    const parts = String(req.query.periods).split(',').map(s => s.trim()).filter(Boolean);
    const conditions = [];
    for (const p of parts) {
      const [y, m] = p.split('-').map(Number);
      if (!y || y < 2020 || y > 2030) return res.status(400).json({ error: `invalid period: ${p}` });
      if (m) {
        if (m < 1 || m > 12) return res.status(400).json({ error: `invalid month in: ${p}` });
        conditions.push(`(YEAR('ALL_PARTS'[תאריך]) = ${y} && MONTH('ALL_PARTS'[תאריך]) = ${m})`);
      } else {
        conditions.push(`YEAR('ALL_PARTS'[תאריך]) = ${y}`);
      }
    }
    if (!conditions.length) return res.status(400).json({ error: 'no valid periods' });
    dateFilter = `FILTER('ALL_PARTS', ${conditions.join(' || ')})`;
  } else {
    // Legacy single-month form
    const year  = parseInt(req.query.year  || '0', 10);
    const month = parseInt(req.query.month || '0', 10);
    if (!year || year < 2020 || year > 2030) return res.status(400).json({ error: 'invalid year' });
    if (month && (month < 1 || month > 12))  return res.status(400).json({ error: 'invalid month' });
    dateFilter = month
      ? `FILTER('ALL_PARTS', YEAR('ALL_PARTS'[תאריך]) = ${year} && MONTH('ALL_PARTS'[תאריך]) = ${month})`
      : `FILTER('ALL_PARTS', YEAR('ALL_PARTS'[תאריך]) = ${year})`;
  }

  try {
    const rows = await executeDax(`
      EVALUATE
      CALCULATETABLE(
        ADDCOLUMNS(
          SUMMARIZE('ALL_PARTS', 'ALL_PARTS'[מק'ט]),
          "daySales", [TOTAL מכר בקרטונים ממוצע ביום]
        ),
        'ALL_PARTS'[חברה] = "FORMULA",
        ${dateFilter}
      )
    `);
    const data = {};
    for (const r of rows) {
      const mk = r["ALL_PARTS[מק'ט]"];
      if (mk != null) data[String(mk)] = r['[daySales]'] ?? null;
    }
    res.json({ ok: true, data });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'server_error' });
  }
});

// ── MMD ORDERS ──────────────────────────────────────────────────────────────
app.use('/mmd', express.static(path.join(__dirname, '..', 'MMD ORDERS')));
app.get('/logo-diler-bmd.png', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'logo-diler-bmd.png'));
});

app.get('/pbi/mmd-orders', dataRateLimit, async (req, res) => {
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
      taur:      fixBiDi(r['KARTIS PARIT[תאור]'] || ''),
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Columbus server running on port ${PORT}`));
