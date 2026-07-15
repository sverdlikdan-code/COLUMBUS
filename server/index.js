require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const ExcelJS = require('exceljs');
const { executeDax, getDatasetRefreshTime } = require('./powerbi');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── PBI CACHE ──────────────────────────────────────────────────────────────
// Single source of truth: all client/agent/manager data loaded from Power BI
// at startup and refreshed daily. Endpoints serve from memory → <5ms latency.

const DAY_HE_TO_NUM = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5 };

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
  'משטח עם כפולות',
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
        target:    parseFloat(r['[target]']) || 0,
        monthlySales:  0,
        avg6Sales:     0,
        avg6Orders:    0,
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
      c.avg6Sales  = parseFloat(r['[avg6Sales]'])  || 0;
      c.avg6Orders = parseFloat(r['[avg6Orders]']) || 0;
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
          const address = expandCityAbbrev(fixBiDiAddress(rawAddr));

          if (!iceByAgent.has(agentCode)) iceByAgent.set(agentCode, []);
          iceByAgent.get(agentCode).push({
            custId,
            custName:      fixBiDi(r['[custName]'] || ''),
            city,
            address,
            lat:           null,
            lng:           null,
            agentCode,
            agentName:     '',
            manager:       '',
            dayNum,
            dayLabel:      dayLetter,
            priorityOrder: 9000,
            fullAddress:   [address, city, 'ישראל'].filter(Boolean).join(', '),
            target:        0,
            monthlySales:  0,
            lastOrderDate: null,
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

    pbiCache = {
      clientMap,
      byAgent,
      iceByAgent,
      noScheduleByAgent,
      managers: [...managers].sort(),
      agentsByManager: new Map([...agentsByManager].map(([k, v]) => [k, [...v.values()]])),
      managerAgents,
      loadedAt: new Date(),
    };
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

// ── Magic-link invite tokens (HMAC-SHA256, no external lib) ─────────────────
const INVITE_SECRET = process.env.INVITE_SECRET || 'changeme';
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

// GET /invite/:token — magic link: verify → set cookie → redirect directly to formula-road with params
// formula-road.html reads _inv/_ac/_an from URL params and sets localStorage itself (avoids Custom Tab context split)
app.get('/invite/:token', (req, res) => {
  const payload = verifyInvite(req.params.token);
  if (!payload) return res.status(400).send(`<!DOCTYPE html><html><head><meta charset=utf-8><title>קישור לא בתוקף</title></head>
<body style="font-family:Arial;text-align:center;padding:60px;background:#f5f5f5">
<h2 style="color:#c62828">הקישור פג תוקף</h2>
<p style="color:#555">בקש קישור חדש מהמנהל.</p></body></html>`);
  const sessionToken = createSession(payload.code, false);
  const name = encodeURIComponent(payload.name || '');
  const code = encodeURIComponent(payload.code || '');
  const inv  = encodeURIComponent(sessionToken);
  res.setHeader('Set-Cookie', 'fr_ok=1; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=2592000');
  return res.redirect(302, `https://api.sverdlik-apps.site/formula-road?_inv=${inv}&_ac=${code}&_an=${name}`);
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

  // Super-manager password (sees ALL managers + ALL agents)
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
    // If this agent's clients have no manager (empty קבוצה) → they ARE a manager → see everything
    if (pbiCache?.managerAgents?.has(codeStr)) {
      return res.json({ ok: true, type: 'manager', token: createSession(null, true) });
    }
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
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY    || '';

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

// Gemini Flash — used for AI analytics (Anthropic fallback for geocoding)
async function callGemini(prompt, maxTokens = 500) {
  if (!GEMINI_API_KEY) throw new Error('AI not configured');
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(data?.error?.message || 'Gemini returned empty');
  return text;
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

// GET /territory-cities — unique cities from PBI cache
app.get('/territory-cities', requireAuth, async (req, res) => {
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const cities = new Set();
  for (const clients of pbiCache.byAgent.values()) {
    for (const c of clients) { if (c.city) cities.add(c.city); }
  }
  res.json([...cities].sort((a,b) => a.localeCompare(b, 'he')));
});

// GET /territory-clients?cities=CITY1,CITY2 — all clients in cities across all agents
app.get('/territory-clients', requireAuth, dataRateLimit, async (req, res) => {
  const { city, cities } = req.query;
  const raw = cities || city;
  if (!raw) return res.status(400).json({ error: 'cities required' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const citySet = new Set(raw.split(',').map(c => c.trim()).filter(Boolean));
  const results = [];
  const seen = new Set();
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
      pct:           c.pct || 0,
      clientType:    c.clientType || '',
      hevra:         c.hevra || 'FORMULA',
      ...extra,
    });
  };
  for (const [agentCode, clients] of pbiCache.byAgent) {
    for (const c of clients) {
      if (!c.city || !citySet.has(c.city)) continue;
      pushClient(c, agentCode);
    }
  }
  // Include ICE-only clients (visited by Formula agents in ICE territory)
  if (pbiCache.iceByAgent) {
    for (const [agentCode, clients] of pbiCache.iceByAgent) {
      for (const c of clients) {
        if (!c.city || !citySet.has(c.city)) continue;
        pushClient(c, agentCode, { hevra: 'ICE', iceOnly: true });
      }
    }
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

    let clients;
    if (dayNum === 0) {
      // "לא מוגדר": Formula unscheduled + ICE with no day
      clients = noSchedFormula.slice();
    } else {
      clients = allForAgent.slice();
      if (dayNum) clients = clients.filter(c => c.dayNum === dayNum);
    }

    // Merge ICE-only clients (not in any Formula list)
    const iceAll = pbiCache.iceByAgent?.get(agent) || [];
    let iceForDay;
    if (dayNum === 0) {
      iceForDay = iceAll.filter(c => c.dayNum === null && !allFormulaIds.has(c.custId));
    } else {
      iceForDay = iceAll.filter(c => (!dayNum || c.dayNum === dayNum) && !allFormulaIds.has(c.custId));
    }
    if (iceForDay.length) console.log(`[/customers] +${iceForDay.length} ICE-only clients`);
    clients = [...clients, ...iceForDay];
    console.log(`[/customers] after day filter + ICE: ${clients.length}`);

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
    { name: 'סדר ביקור מתוקן',    width: 8  },
    { name: 'מס. לקוח',           width: 14 },
    { name: 'שם לקוח',            width: 28 },
    { name: 'חברה',               width: 10 },
    { name: 'יום',                 width: 10 },
    { name: 'עיר',                 width: 16 },
    { name: 'כתובת',               width: 26 },
    { name: 'קו רוחב',             width: 13 },
    { name: 'קו אורך',             width: 13 },
    { name: 'GPS',                 width: 14 },
    { name: 'סדר ביקור PRIORITY',  width: 15 },
  ];

  ws.addTable({
    name: 'RouteTable',
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: COLS.map(c => ({ name: c.name, filterButton: true })),
    rows: rows.map(r => [
      r.currentPos,
      String(r.custId || ''),
      r.custName || '',
      r.hevra || 'FORMULA',
      r.dayLabel || '',
      r.city || '',
      r.address || '',
      r.lat ? Number(parseFloat(r.lat).toFixed(6)) : '',
      r.lng ? Number(parseFloat(r.lng).toFixed(6)) : '',
      (() => {
        if (!r.corrected) return r.lat && r.lng ? '✓' : 'חסר';
        if (r.pbiLat && r.pbiLng) return haversineDist(r.lat, r.lng, Number(r.pbiLat), Number(r.pbiLng)) <= 20 ? '✓' : '✓ CHANGED';
        return '✓ CHANGED';
      })(),
      r.noOrder ? 'חסר סדר ביקור' : (r.originalPos != null ? r.originalPos : ''),
    ]),
  });

  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const FILL_GREEN1  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } }; // corrected GPS (even)
  const FILL_GREEN2  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA5D6A7' } }; // corrected GPS (odd)
  const FILL_ORANGE  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC80' } }; // doubtful GPS
  const FILL_GRAY1   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEFF1' } }; // noOrder (even)
  const FILL_GRAY2   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }; // noOrder (odd)
  const FILL_STRIPE1 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }; // normal (even)
  const FILL_STRIPE2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; // normal (odd)
  const FILL_ICE1    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB2DFDB' } }; // ICE client (even)
  const FILL_ICE2    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF80CBC4' } }; // ICE client (odd)
  const DOUBTFUL     = new Set(['geocoded', 'pbi-sibling-near', 'city-center', 'no-gps']);

  rows.forEach((r, i) => {
    const rowNum = i + 2;
    let fill;
    const isChanged = r.corrected && (
      !r.pbiLat || !r.pbiLng || haversineDist(r.lat, r.lng, Number(r.pbiLat), Number(r.pbiLng)) > 20
    );
    if (r.iceOnly) {
      fill = i % 2 === 0 ? FILL_ICE1 : FILL_ICE2;
    } else if (isChanged) {
      fill = i % 2 === 0 ? FILL_GREEN1 : FILL_GREEN2;
    } else if (r.noOrder) {
      fill = i % 2 === 0 ? FILL_GRAY1 : FILL_GRAY2;
    } else if (DOUBTFUL.has(r.gpsSource)) {
      fill = FILL_ORANGE;
    } else {
      fill = i % 2 === 0 ? FILL_STRIPE1 : FILL_STRIPE2;
    }
    for (let col = 1; col <= COLS.length; col++) ws.getCell(rowNum, col).fill = fill;
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
  const { agentCode, agentName, dayOverrides = {}, savedOrders = {} } = req.body;
  if (!agentCode) return res.status(400).json({ error: 'agentCode required' });
  if (!pbiCache) return res.status(503).json({ error: 'cache_loading' });
  const allClients = pbiCache.byAgent.get(agentCode) || [];
  if (!allClients.length) return res.status(404).json({ error: 'no clients' });
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
  const days = DAY_ORDER.filter(d=>byDay[d]).concat(Object.keys(byDay).filter(d=>!DAY_ORDER.includes(d)));
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
      return {
        row:[i+1,String(c.custId||''),c.custName||'',c.city||'',c.address||'',
          lat?+parseFloat(lat).toFixed(6):'', lng?+parseFloat(lng).toFixed(6):'',
          gps, c.priorityOrder||'',
          ai?.aiLat||'', ai?.aiLng||''],
        isChanged, gpsSource:c.gpsSource||null, noOrder:!c.priorityOrder, even:i%2===0,
      };
    });
    ws.addTable({ name:`RouteTable_${day.charCodeAt(0)}`, ref:'A1', headerRow:true, totalsRow:false,
      style:{theme:'TableStyleLight1',showRowStripes:false},
      columns:COLS.map(c=>({name:c.name,filterButton:true})),
      rows:rowData.map(r=>r.row),
    });
    COLS.forEach((c,i)=>{ ws.getColumn(i+1).width=c.width; });
    const hdr=ws.getRow(1);
    hdr.height=22;
    hdr.font={bold:true,color:{argb:'FFFFFFFF'},size:10};
    hdr.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1565C0'}};
    hdr.eachCell(cell=>{ cell.alignment={horizontal:'right',vertical:'middle'}; });
    rowData.forEach((r,i) => {
      const rowNum=i+2;
      let f = r.isChanged ? (r.even?FILLS.G1:FILLS.G2)
             : r.noOrder  ? (r.even?FILLS.GR1:FILLS.GR2)
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

app.get('/api/territory/jerusalem', cors({ origin: true }), async (req, res) => {
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

app.post('/api/territory/geocode', cors({ origin: true }), async (req, res) => {
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
            const modelStr = m.newModel ? `${m.newModel}${m.newModelName && m.newModelName !== m.newModel ? ' — ' + m.newModelName : ''}` : '';
            return `<tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${m.action||''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${modelStr}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${m.salot||0}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${m.agala?'✓':''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${m.supplyDate||''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee">${m.fault||''}</td>
            </tr>`;
          }).join('');

          await resend.emails.send({
            from: process.env.RESEND_FROM || 'orders@sverdlik-apps.site',
            to: process.env.NOTIFY_EMAIL.split(',').map(e => e.trim()),
            cc: ['natalia.a@DilerBMD.com'],
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

// GET /pbi/inter-sales?periods=2026-5,2026-6 — products + sales for INTER ordering page
// Source: INTERNATIONAL CONTROL DESK (CONTROL workspace) — includes photo URL, ENG name, krat
const INTER_WS = 'ee9e5fc6-bc10-4e7d-a8f3-b23c08d150ed';
const INTER_DS = 'fb6691a0-9b2f-413b-b438-78d2982c4e70';
const INTER_DATA = `'DataIINא+F+I+MMD 25-23-24-22'`;

app.get('/pbi/inter-sales', dataRateLimit, async (req, res) => {
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

// ── PHOTO PROXY (CORS bridge for github.io → priority.dilerbmd.com) ─────────
app.get('/api/photo-proxy', async (req, res) => {
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buf);
  } catch { res.status(502).end(); }
});

// ── POSITION TABLE XLSX (מיקום + photos) ────────────────────────────────────
app.post('/api/export-position-xlsx', dataRateLimit, async (req, res) => {
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
app.get('/mmd/prophet.json', mmdGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'prophet.json'));
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

let rebuildInProgress = false;
app.post('/mmd/rebuild', mmdGuard, dataRateLimit, (req, res) => {
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

const MMD_LOCAL_STUB = '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>MMD Orders</title><style>body{font-family:sans-serif;background:#04111f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fff}div{text-align:center}a{color:#4fc3f7;font-size:1.2rem;font-weight:700;display:block;margin-top:16px}</style></head><body><div><div style="font-size:3rem;margin-bottom:16px">📦</div><p>MMD Orders פועל בשרת</p><a href="https://api.sverdlik-apps.site/mmd/">פתח MMD Orders ←</a></div></body></html>';

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
// On local Windows dev server, show a pointer page instead of serving Formula Road
// (avoids session mismatch; avoids redirect loop if local cloudflared is running)
const IS_LOCAL = process.platform === 'win32';
const VPS_URL = 'https://api.sverdlik-apps.site';
app.get('/formula-road', (req, res, next) => {
  if (IS_LOCAL) return res.status(200).send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Formula Road</title><style>body{font-family:sans-serif;background:#0a1628;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fff}div{text-align:center}a{color:#4fc3f7;font-size:1.2rem;font-weight:700}</style></head><body><div><div style="font-size:3rem;margin-bottom:16px">🗺</div><p>Formula Road פועל בשרת</p><a href="${VPS_URL}/formula-road">פתח Formula Road ←</a></div></body></html>`);
  next();
}, formulaRoadGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'formula-road.html'));
});
app.get('/mekarer-order.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'mekarer-order.html'));
});
app.get('/territory-planner.html', (req, res) => {
  if (!req.session?.agentCode && !req.session?.isManager) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'docs', 'territory-planner.html'));
});
app.get('/territory.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'territory.html'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'docs', 'sw.js'));
});
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'docs', 'manifest.json'));
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
app.get('/admin/debug-cache', async (req, res) => {
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

// ── AI Day Briefing — TOP 10 clients of agent's day, YoY growth + failures ───
// Metrics: current 3M total, prev-year same 3M total, order days, SKU count
// 3 parallel DAX calls -> rank TOP 10 by current sales -> Gemini growth/failure analysis
app.get('/api/day-briefing', requireAuth, async (req, res) => {
  const agentCode = req.session.agentCode;
  if (!agentCode) return res.status(403).json({ ok: false, error: 'manager session -- no agent' });
  if (!pbiCache) return res.status(503).json({ ok: false, error: 'cache_loading' });
  if (!GEMINI_API_KEY) return res.status(503).json({ ok: false, error: 'AI not configured' });

  const lang = (req.query.lang || 'he').slice(0, 2);
  const dayNum = parseInt(req.query.day) || 0;

  const allClients = pbiCache.byAgent.get(agentCode) || [];
  const dayClients = dayNum ? allClients.filter(c => c.dayNum === dayNum) : allClients;
  if (!dayClients.length) return res.json({ ok: false, error: 'no_clients' });

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

  const daxCur = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "total",     CALCULATE([הכנסות כלליות (ללא זיכויים מרכזים)]),
    "orderDays", CALCULATE(DISTINCTCOUNT(ALL_PARTS[תאריך])),
    "skus",      CALCULATE(DISTINCTCOUNT(ALL_PARTS[מק'ט])),
    "lastOrder", CALCULATE(MAX(ALL_PARTS[תאריך]))
  ),
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
)`;

  const daxPrev = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[מספר לקוח]),
    "prevTotal", CALCULATE([הכנסות כלליות (ללא זיכויים מרכזים)])
  ),
  ALL_PARTS[מספר לקוח] IN {${inList}},
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${prevStart.year},${prevStart.month},1),
  ALL_PARTS[תאריך] <= DATE(${prevEnd.year},${prevEnd.month},${prevLastDay})
)`;

  const daxAvg = `
EVALUATE
ROW(
  "avg", DIVIDE(
    CALCULATE([הכנסות כלליות (ללא זיכויים מרכזים)],
      ALL_PARTS[ASHMADOT] = "-מכר-",
      ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
      ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
    ),
    CALCULATE(DISTINCTCOUNT(ALL_PARTS[מספר לקוח]),
      ALL_PARTS[ASHMADOT] = "-מכר-",
      ALL_PARTS[תאריך] >= DATE(${curStart.year},${curStart.month},1),
      ALL_PARTS[תאריך] <= DATE(${curEnd.year},${curEnd.month},${curLastDay})
    )
  )
)`;

  try {
    const [curRows, prevRows, avgRows] = await Promise.all([
      executeDax(daxCur), executeDax(daxPrev), executeDax(daxAvg),
    ]);
    const companyAvg = Math.round(avgRows?.[0]?.['[avg]'] || 0);

    const curMap = {}, prevMap = {};
    for (const r of curRows) {
      const id = String(r[`ALL_PARTS[מספר לקוח]`] || r['[מספר לקוח]'] || '');
      if (id) curMap[id] = {
        total: Math.round(r['[total]'] || 0),
        orderDays: r['[orderDays]'] || 0,
        skus: r['[skus]'] || 0,
        lastOrder: r['[lastOrder]'] || null,
      };
    }
    for (const r of prevRows) {
      const id = String(r[`ALL_PARTS[מספר לקוח]`] || r['[מספר לקוח]'] || '');
      if (id) prevMap[id] = Math.round(r['[prevTotal]'] || 0);
    }

    const enriched = dayClients.map(c => {
      const id = String(c.custId);
      const s = curMap[id] || { total: 0, orderDays: 0, skus: 0, lastOrder: null };
      const prevTotal = prevMap[id] || 0;
      const yoy = prevTotal > 0 ? Math.round((s.total / prevTotal - 1) * 100) : null;
      const avgBasket = s.orderDays > 0 ? Math.round(s.total / s.orderDays) : 0;
      const daysSince = s.lastOrder ? Math.round((Date.now() - new Date(s.lastOrder)) / 86400000) : null;
      return { custId: id, name: c.custName || id, city: c.city || '', total: s.total, prevTotal, yoy, orderDays: s.orderDays, skus: s.skus, avgBasket, daysSince };
    });
    enriched.sort((a, b) => b.total - a.total);
    const top10 = enriched.slice(0, 10);
    const dormant = enriched.filter(c => c.daysSince !== null && c.daysSince > 21 && !top10.find(t => t.custId === c.custId));

    const monthStr = `${months[0].month}/${months[0].year} — ${curEnd.month}/${curEnd.year}`;
    const prevStr  = `${prevMonths[0].month}/${prevMonths[0].year} — ${prevEnd.month}/${prevEnd.year}`;

    const top10Lines = top10.map((c, i) => {
      const vsAvg = companyAvg ? ` (${c.total >= companyAvg ? '+' : ''}${Math.round((c.total / companyAvg - 1) * 100)}% מממוצע)` : '';
      const yoyStr = c.yoy !== null ? ` | YoY:${c.yoy >= 0 ? '+' : ''}${c.yoy}%` : ' | YoY:—';
      const basketStr = c.avgBasket ? ` | סל:₪${c.avgBasket.toLocaleString()}` : '';
      const skuStr = c.skus ? ` | SKU:${c.skus}` : '';
      const dormFlag = c.daysSince > 21 ? ` ⚠️${c.daysSince}d` : '';
      return `${i + 1}. ${c.name} (${c.city}): ₪${c.total.toLocaleString()}${vsAvg}${yoyStr}${basketStr}${skuStr}${dormFlag}`;
    }).join('\n');

    const dormantLines = dormant.length
      ? '\nלא הזמינו >3 שבועות (לא בTOP10): ' + dormant.slice(0, 5).map(c => `${c.name}(${c.daysSince}d)`).join(', ')
      : '';

    const context = `תקופה נוכחית: ${monthStr} | תקופה מקבילה אשתקד: ${prevStr}\nממוצע לקוח בחברה: ₪${companyAvg.toLocaleString()}\n\nTOP 10 לקוחות היום:\n${top10Lines}${dormantLines}`;

    const prompts = {
      he: `אתה מנהל אזור. נתוני TOP 10 לקוחות של הסוכן להיום (מכירות, YoY%, סל ממוצע, SKU):\n${context}\n\n⚡ מצא: 1) זוני צמיחה — מי גדל YoY ומה ניתן להגדיל עוד 2) כשלים — מי יורד YoY / לא הזמין / סל קטן 3) המלצה חדה לסוכן. מנהלי, ישיר, 6-8 שורות.`,
      uk: `Ти менеджер зони. TOP 10 клієнтів на сьогодні:\n${context}\n\n⚡ Знайди: 1) Зони росту — хто зростає YoY 2) Провали — хто падає / не замовляв 3) Рекомендація. Прямо, 6-8 рядків.`,
      ru: `Ты менеджер зоны. TOP 10 клиентов на сегодня:\n${context}\n\n⚡ Найди: 1) Зоны роста — кто растёт YoY 2) Провалы — кто падает / не заказывал 3) Рекомендация. Прямо, 6-8 строк.`,
    };

    const analysis = await callGemini(prompts[lang] || prompts.he, 700);
    res.json({ ok: true, top10, dormant: dormant.slice(0, 5), companyAvg, monthStr, prevStr, analysis });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI Client Analytics — per-customer sales by מחלקה, 3 closed months ──────
// Uses main FORMULA dataset (POWERBI_DATASET_ID): ALL_PARTS + ADIFUT[מחלקה]
app.get('/api/client-analytics/:custId', requireAuth, async (req, res) => {
  const custId = String(req.params.custId || '').trim();
  if (!custId) return res.status(400).json({ ok: false, error: 'custId required' });
  const lang = (req.query.lang || 'he').slice(0, 2);
  if (!GEMINI_API_KEY && !ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: 'AI not configured' });

  // Last 3 closed months
  const now = new Date();
  const cm = now.getMonth() + 1, cy = now.getFullYear();
  const months = [];
  for (let i = 3; i >= 1; i--) {
    let m = cm - i, y = cy;
    if (m <= 0) { m += 12; y--; }
    months.push({ year: y, month: m, label: `${m}/${y}` });
  }
  const start = months[0], end = months[2];
  const lastDay = new Date(end.year, end.month, 0).getDate();
  const SKIP_CATS = new Set(['ציוד', 'שאריות', 'תגמולים']);

  // Also get company-wide average for same period (for comparison)
  const daxClient = `
EVALUATE
CALCULATETABLE(
  ADDCOLUMNS(
    SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
    "מחלקה", LOOKUPVALUE(ADIFUT[מחלקה], ADIFUT[תאור משפחה], ALL_PARTS[תאור משפחת מוצר]),
    "total",  CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)]),
    "lastOrder", CALCULATE(MAX(ALL_PARTS[תאריך]))
  ),
  ALL_PARTS[מספר לקוח] = "${custId}",
  ALL_PARTS[ASHMADOT] = "-מכר-",
  ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
  ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
)`;

  const daxAvg = `
EVALUATE
ROW(
  "avg_per_client", DIVIDE(
    CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)],
      ALL_PARTS[ASHMADOT] = "-מכר-",
      ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
      ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
    ),
    CALCULATE(DISTINCTCOUNT(ALL_PARTS[מספר לקוח]),
      ALL_PARTS[ASHMADOT] = "-מכר-",
      ALL_PARTS[תאריך] >= DATE(${start.year},${start.month},1),
      ALL_PARTS[תאריך] <= DATE(${end.year},${end.month},${lastDay})
    )
  )
)`;

  try {
    const [rows, avgRows] = await Promise.all([
      executeDax(daxClient),
      executeDax(daxAvg),
    ]);

    const companyAvg = Math.round(avgRows?.[0]?.['[avg_per_client]'] || 0);

    // Pivot by מחלקה (not משפחת מוצר — use department level)
    const byMachlaka = {};
    let clientTotal = 0;
    let lastOrderDate = null;
    for (const r of rows) {
      const cat   = r['[מחלקה]'] || '';
      const total = Math.round(r['[total]'] || 0);
      const lo    = r['[lastOrder]'];
      if (cat && !SKIP_CATS.has(cat) && total > 0) {
        byMachlaka[cat] = (byMachlaka[cat] || 0) + total;
        clientTotal += total;
      }
      if (lo && (!lastOrderDate || new Date(lo) > new Date(lastOrderDate))) lastOrderDate = lo;
    }

    const monthStr = months.map(m => m.label).join(' — ');
    const lines = Object.entries(byMachlaka)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, total]) => `${cat}: ₪${total.toLocaleString()}`);

    const daysSinceOrder = lastOrderDate
      ? Math.round((Date.now() - new Date(lastOrderDate)) / 86400000)
      : null;

    const dormantNote = daysSinceOrder && daysSinceOrder > 21
      ? `\n⚠️ לא הזמין ${daysSinceOrder} ימים — דורש תשומת לב!`
      : '';
    const avgNote = `\nממוצע לקוח בחברה לאותה תקופה: ₪${companyAvg.toLocaleString()}`;
    const clientNote = `סה"כ לקוח: ₪${clientTotal.toLocaleString()} (${clientTotal > companyAvg ? '+' + Math.round((clientTotal/companyAvg-1)*100) : Math.round((clientTotal/companyAvg-1)*100)}% מהממוצע)`;

    const context = `${monthStr}\n${lines.join('\n')}${avgNote}\n${clientNote}${dormantNote}`;

    const prompts = {
      he: `אתה מנהל אזור של חברת הפצה. נתוני מכירות לפי מחלקה:\n${context}\n\nתן 3 תצפיות חדות + המלצה לסוכן. השווה לממוצע. ציין מחלקות חלשות. אם לא הזמין >3 שבועות — זה קריטי. מנהלי, ישיר.`,
      uk: `Ти менеджер зони. Продажі по відділах:\n${context}\n\nДай 3 спостереження + рекомендацію. Порівняй із середнім. Відділи що відстають. Якщо >3 тижні без замовлення — критично. Прямо.`,
      ru: `Ты менеджер зоны. Продажи по отделам:\n${context}\n\nДай 3 наблюдения + рекомендацию. Сравни со средним. Слабые отделы. Если >3 недель без заказа — критично. Прямо.`,
    };

    const analysis = await callGemini(prompts[lang] || prompts.he, 500);

    res.json({ ok: true, months: months.map(m => m.label), families: byMachlaka, dropped: Array.from(SKIP_CATS), analysis });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Admin: send ONE test invite — temporary, no auth, sends only to Dan's tablet ──
app.get('/admin/send-test-invite', async (req, res) => {
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  if (!RESEND_KEY) return res.status(503).json({ ok: false, error: 'RESEND_API_KEY missing' });

  const toEmail = 'dilerformula98@gmail.com';
  const agentCode = '258'; const agentName = 'דוד גומרשטדט';
  const token = signInvite({ code: agentCode, name: agentName, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const inviteUrl = `https://api.sverdlik-apps.site/invite/${token}`;

  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>
body{margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif;direction:rtl}
.wrap{max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12)}
.header{background:#1A3F7C;padding:32px 24px;text-align:center}.header h1{color:#fff;margin:0;font-size:22px}
.header p{color:#a8c4e8;margin:6px 0 0;font-size:13px}.body{padding:32px 28px}
.greeting{font-size:18px;font-weight:700;color:#1A3F7C;margin-bottom:12px}
.text{color:#444;font-size:15px;line-height:1.7;margin-bottom:24px}
.btn{display:block;width:fit-content;margin:0 auto;background:#1A3F7C;color:#fff!important;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:17px;font-weight:700;text-align:center}
.note{color:#888;font-size:12px;text-align:center;margin-top:20px;line-height:1.6}
.footer{background:#f8f9fb;padding:16px 24px;text-align:center;color:#aaa;font-size:11px;border-top:1px solid #eee}
</style></head><body>
<div class="wrap">
  <div class="header"><h1>🗺️ Formula Roads</h1><p>מערכת ניהול מסלולים — בדיקת אימייל</p></div>
  <div class="body">
    <div class="greeting">שלום ${agentName}!</div>
    <div class="text">זהו קישור בדיקה ל-<strong>Formula Roads</strong>. לחץ כדי להיכנס אוטומטית.</div>
    <a class="btn" href="${inviteUrl}">כניסה ל-Formula Roads</a>
    <div class="note">הקישור בתוקף ל-7 ימים.</div>
  </div>
  <div class="footer">Formula Distribution &bull; DILER FORMULA &bull; TEST EMAIL</div>
</div></body></html>`;

  const body = JSON.stringify({ from: 'Formula Roads <orders@sverdlik-apps.site>', to: [toEmail], subject: 'TEST — זימון ל-Formula Roads', html });
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    if (r.ok) res.json({ ok: true, to: toEmail, inviteUrl });
    else res.status(500).json({ ok: false, error: d?.message || 'Resend error', status: r.status });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Columbus server running on port ${PORT}`);
  await loadPBICache();
  scheduleDailyPBIReload();
});
