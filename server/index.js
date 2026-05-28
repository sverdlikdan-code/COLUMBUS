require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { executeDax } = require('./powerbi');

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
app.post('/log-access', (req, res) => {
  const { event, agentCode, agentName, isManager } = req.body || {};
  const ip = getRealIp(req);
  writeLog({
    ts: new Date().toISOString(),
    event: event || 'login',
    agentCode: agentCode || null,
    agentName: agentName || null,
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

const DAY_LABELS = { 1: 'א', 2: 'ב', 3: 'ג', 4: 'ד', 5: 'ה' };

// Israel bounding box
const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// In-memory geocode cache: address string → { lat, lng } | null
const geocodeCache = new Map();

// City bounding-box cache: city name → { minLat, maxLat, minLng, maxLng } | null
const cityBBoxCache = new Map();

async function getCityBBox(city) {
  if (!city) return null;
  if (cityBBoxCache.has(city)) return cityBBoxCache.get(city);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city + ', ישראל')}&format=json&limit=1&countrycodes=il`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ColumbusDillerApp/1.1' },
      signal: AbortSignal.timeout(4000),
    });
    const data = await resp.json();
    if (data.length > 0 && data[0].boundingbox) {
      const bb = data[0].boundingbox; // [minLat, maxLat, minLng, maxLng]
      const bbox = {
        minLat: parseFloat(bb[0]), maxLat: parseFloat(bb[1]),
        minLng: parseFloat(bb[2]), maxLng: parseFloat(bb[3]),
      };
      cityBBoxCache.set(city, bbox);
      return bbox;
    }
  } catch (_) {}
  cityBBoxCache.set(city, null);
  return null;
}

function isWithinCityBBox(lat, lng, bbox) {
  if (!bbox) return true; // can't validate → don't reject
  const PAD = 0.018; // ~2 km tolerance on each side
  return lat >= bbox.minLat - PAD && lat <= bbox.maxLat + PAD &&
         lng >= bbox.minLng - PAD && lng <= bbox.maxLng + PAD;
}

const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi,
  /מרכז עסקים[^,]*/gi,
  /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi,
  /מתחם[^,]*/gi,
  /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi,
  /בית קפה[^,]*/gi,
  /מסעדה[^,]*/gi,
  /סופרמרקט[^,]*/gi,
  /קומה\s*\d+/gi,
  /דירה\s*\d+/gi,
  /כניסה\s*[א-ת\d]+/gi,
  /בניין\s*[א-ת\d]*/gi,
  /\(.*?\)/g,
];

function cleanAddressForGeocoding(address) {
  if (!address) return address;
  let clean = address;
  for (const pattern of VENUE_PATTERNS) {
    clean = clean.replace(pattern, '');
  }
  return clean.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

async function geocodeAddress(address, city) {
  const cleanAddr = cleanAddressForGeocoding(address);
  const query = [cleanAddr, city, 'ישראל'].filter(Boolean).join(', ');
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=il`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ColumbusDillerApp/1.1' },
      signal: AbortSignal.timeout(4000),
    });
    const data = await resp.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache.set(query, result);
      return result;
    }
  } catch (_) {}

  geocodeCache.set(query, null);
  return null;
}

// Geocode a batch — max 1 req/sec (Nominatim rate limit)
function extractStreetNum(address) {
  if (!address) return null;
  const m = (address || '').match(/[א-ת"'\-\s]{2,}\s+\d+/);
  return m ? m[0].trim() : null;
}

async function geocodeAddressCascade(address, city) {
  const cleaned = cleanAddressForGeocoding(address);
  const attempts = [];
  if (cleaned) attempts.push([cleaned, city, 'ישראל'].filter(Boolean).join(', '));
  const street = extractStreetNum(cleaned || address);
  if (street && street !== cleaned) attempts.push([street, city, 'ישראל'].filter(Boolean).join(', '));

  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1100));
    const result = await geocodeAddress(attempts[i], '');
    if (result) return result;
  }
  return null;
}

async function geocodeBatch(clients) {
  // fetch bboxes for ALL cities (needed for bbox validation)
  const allCities = [...new Set(clients.map(c => c.city).filter(Boolean))];
  for (const city of allCities) {
    if (!cityBBoxCache.has(city)) {
      await getCityBBox(city);
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  // validate existing IL coords against city bbox — null out only if outside
  for (const c of clients) {
    if (isValidIL(c.lat, c.lng)) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (!isWithinCityBBox(c.lat, c.lng, bbox)) { c.lat = null; c.lng = null; }
    }
  }

  // cascade-geocode clients still missing valid coords
  const needsGeocode = clients.filter(c => !isValidIL(c.lat, c.lng) && (c.address || c.city));
  for (const c of needsGeocode) {
    const result = await geocodeAddressCascade(c.address, c.city);
    if (result) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (isWithinCityBBox(result.lat, result.lng, bbox)) {
        c.lat = result.lat; c.lng = result.lng;
      }
    }
    await new Promise(r => setTimeout(r, 1100));
  }
  return clients;
}

// GET /geocode?address=&city= — geocode a single address
app.get('/geocode', requireAuth, async (req, res) => {
  const { address, city } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });
  const result = await geocodeAddress(address, city || '');
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Columbus server running on port ${PORT}`));
