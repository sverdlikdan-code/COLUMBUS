// build-formula-road.js
// Runs in GitHub Actions: fetches all managers/agents/clients from PBI,
// geocodes missing GPS, saves docs/formula-road-data.json
// formula-road.html loads this file — no live server needed.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const { executeDax } = require('../server/powerbi');
const { fetchLastRefresh } = require('./pbi-kapua');


const DAY_LABELS = { 1:'א', 2:'ב', 3:'ג', 4:'ד', 5:'ה' };
const IL = { minLat:29.3, maxLat:33.5, minLng:34.2, maxLng:35.9 };
const geocodeCache  = new Map();
const cityBBoxCache = new Map();

// Pre-verified GPS lookup (from EXEL COORDINATES.xlsx)
const GPS_LOOKUP_PATH = path.join(__dirname, '../docs/gps-lookup.json');
const gpsLookup = fs.existsSync(GPS_LOOKUP_PATH)
  ? JSON.parse(fs.readFileSync(GPS_LOOKUP_PATH, 'utf8'))
  : {};

// Agent-corrected GPS (highest priority — overrides everything)
const GPS_CORRECTIONS_PATH = path.join(__dirname, '../docs/gps-corrections.json');
const gpsCorrections = fs.existsSync(GPS_CORRECTIONS_PATH)
  ? JSON.parse(fs.readFileSync(GPS_CORRECTIONS_PATH, 'utf8'))
  : {};

// Manager-corrected visit days
const DAY_CORRECTIONS_PATH = path.join(__dirname, '../docs/day-corrections.json');
const dayCorrections = fs.existsSync(DAY_CORRECTIONS_PATH)
  ? JSON.parse(fs.readFileSync(DAY_CORRECTIONS_PATH, 'utf8'))
  : {};

// Persistent Azure Maps geocode cache — survives between builds
const AZURE_CACHE_PATH = path.join(__dirname, '../docs/azure-geocode-cache.json');
const azureCache = fs.existsSync(AZURE_CACHE_PATH)
  ? JSON.parse(fs.readFileSync(AZURE_CACHE_PATH, 'utf8'))
  : {};
let azureCacheDirty = false;

function workingDaysPct() {
  const now = new Date();
  const yesterday = now.getDate() - 1; // today is incomplete — count up to yesterday
  const y = now.getFullYear(), m = now.getMonth();
  const dim = new Date(y, m + 1, 0).getDate();
  let total = 0, passed = 0;
  for (let d = 1; d <= dim; d++) {
    if (new Date(y, m, d).getDay() <= 4) { // Sun(0)–Thu(4)
      total++;
      if (d <= yesterday) passed++;
    }
  }
  return total ? passed / total : 0;
}

function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi, /מרכז עסקים[^,]*/gi, /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi, /מתחם[^,]*/gi, /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi, /\(.*?\)/g,
];
function fixPriorityAddr(address) {
  if (!address) return address;
  // trim decimal fractions from numbers (Priority stores "52.000" → "52")
  let s = address.replace(/(\d+)\.\d+/g, '$1');
  // Priority exports some fields in visual LTR order with directional marks — strip + reverse to logical order
  if (/[‎‏‪-‮]/.test(s)) {
    s = s.replace(/[‎‏‪-‮]/g, '');
    s = s.split('').reverse().join('')
         .replace(/\d+/g, m => m.split('').reverse().join(''))
         .replace(/[A-Za-z][A-Za-z\d\s\-'",.]*/g, m => m.split('').reverse().join(''));
  }
  return s.trim();
}
function cleanAddr(address) {
  if (!address) return address;
  let s = fixPriorityAddr(address);
  // take first part before comma
  s = s.split(',')[0];
  // strip intersection suffix — keep only the street before פינת
  s = s.replace(/[,\s]+פינת[\s\S]*$/i, '').trim();
  // strip venue noise (קניון, מרכז, etc.) — but only if something useful remains
  let stripped = s;
  for (const p of VENUE_PATTERNS) stripped = stripped.replace(p, '');
  stripped = stripped.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
  // if stripping removed everything (pure POI address), keep the original
  s = stripped || s;
  return s.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

// Raw address trimmed to: first comma, or last digit (strips trailing non-numeric noise)
function trimAddr(address) {
  if (!address) return null;
  const raw = fixPriorityAddr(address);
  // "הרצל 12/3" → "הרצל 12" — first number is always the house number (Israeli format: HOUSE/APT)
  let s = raw.replace(/(\d+)\/\d+/g, '$1');
  // "ארגמן פינת החותרים 1" → "ארגמן" (keep only first street, before intersection marker)
  s = s.replace(/[,\s]+פינת[\s\S]*$/i, '').trim();
  if (s.includes(',')) return s.split(',')[0].trim();
  const m = s.match(/^([\s\S]*\d)/);
  return m ? m[1].trim() : null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function nominatim(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'ColumbusDillerApp/1.1' },
    signal: AbortSignal.timeout(5000),
  });
  return r.json();
}

async function getCityBBox(city) {
  if (!city) return null;
  if (cityBBoxCache.has(city)) return cityBBoxCache.get(city);
  try {
    const data = await nominatim(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&countrycodes=il,ps`
    );
    if (data.length && data[0].boundingbox) {
      const bb = data[0].boundingbox;
      const bbox = { minLat:+bb[0], maxLat:+bb[1], minLng:+bb[2], maxLng:+bb[3] };
      cityBBoxCache.set(city, bbox);
      return bbox;
    }
  } catch (_) {}
  cityBBoxCache.set(city, null);
  return null;
}

function inBBox(lat, lng, bbox) {
  if (!bbox) return false; // no bbox → can't validate → treat as invalid, force re-geocode
  const P = 0.018;
  return lat >= bbox.minLat-P && lat <= bbox.maxLat+P && lng >= bbox.minLng-P && lng <= bbox.maxLng+P;
}

// extract "שם רחוב 12" pattern from noisy address
function extractStreetNum(address) {
  if (!address) return null;
  const m = (address || '').match(/[א-ת"'\-\s]{2,}\s+\d+/);
  return m ? m[0].trim() : null;
}

async function nominatimQuery(q) {
  try {
    const data = await nominatim(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=il,ps`
    );
    if (data.length) return { lat: +data[0].lat, lng: +data[0].lon };
  } catch (_) {}
  return null;
}

// Persistent Google Maps geocode cache
const GOOGLE_CACHE_PATH = path.join(__dirname, '../docs/google-geocode-cache.json');
const googleCache = fs.existsSync(GOOGLE_CACHE_PATH)
  ? JSON.parse(fs.readFileSync(GOOGLE_CACHE_PATH, 'utf8'))
  : {};
let googleCacheDirty = false;

async function googleMapsQuery(q, city) {
  if (!process.env.GOOGLE_MAPS_KEY) return null;
  if (q in googleCache) return googleCache[q];
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=he&region=il&key=${process.env.GOOGLE_MAPS_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await r.json();
    const res = data?.results?.[0];
    if (res?.geometry?.location) {
      const { lat, lng } = res.geometry.location;
      googleCache[q] = { lat, lng }; googleCacheDirty = true;
      return { lat, lng };
    }
  } catch (_) {}
  googleCache[q] = null; googleCacheDirty = true;
  return null;
}

async function azureMapsQuery(q, city) {
  if (!process.env.AZURE_MAPS_KEY) return null;
  if (q in azureCache) return azureCache[q];
  try {
    const url = `https://atlas.microsoft.com/geocode?api-version=2023-06-01&query=${encodeURIComponent(q)}&countrySet=IL,PS&subscription-key=${process.env.AZURE_MAPS_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await r.json();
    const f = data?.features?.[0];
    if (f?.geometry?.coordinates) {
      const [lng, lat] = f.geometry.coordinates;
      // if Azure returned a bbox and we don't have one for this city yet — store it
      if (city && !cityBBoxCache.get(city)) {
        const bb = f.properties?.boundingBox;
        if (bb?.topLeftPoint && bb?.btmRightPoint) {
          cityBBoxCache.set(city, {
            minLat: bb.btmRightPoint.latitude,  maxLat: bb.topLeftPoint.latitude,
            minLng: bb.topLeftPoint.longitude,  maxLng: bb.btmRightPoint.longitude,
          });
        }
      }
      azureCache[q] = { lat, lng }; azureCacheDirty = true;
      return { lat, lng };
    }
  } catch (_) {}
  azureCache[q] = null; azureCacheDirty = true;
  return null;
}

async function geocodeOne(address, city) {
  const trimmed = trimAddr(address);
  const cleaned = cleanAddr(address);
  const attempts = [];
  if (trimmed) attempts.push([trimmed, city].filter(Boolean).join(', '));
  if (cleaned && cleaned !== trimmed) attempts.push([cleaned, city].filter(Boolean).join(', '));
  const street = extractStreetNum(cleaned || address);
  if (street && street !== cleaned && street !== trimmed) attempts.push([street, city].filter(Boolean).join(', '));

  for (let i = 0; i < attempts.length; i++) {
    const key = attempts[i];
    if (geocodeCache.has(key)) { const r = geocodeCache.get(key); if (r) return r; continue; }
    if (i > 0) await sleep(1100);
    const r = await nominatimQuery(key);
    geocodeCache.set(key, r);
    if (r) return r;
  }
  return null;
}

async function geocodeBatch(clients, reGeocode = new Set()) {
  // fetch bboxes for ALL cities (needed for bbox validation)
  const allCities = [...new Set(clients.map(c => c.city).filter(Boolean))];
  for (const city of allCities) {
    if (!cityBBoxCache.has(city)) { await getCityBBox(city); await sleep(1100); }
  }

  // validate existing IL coords against city bbox — null out only if outside
  for (const c of clients) {
    if (isValidIL(c.lat, c.lng)) {
      const bbox = cityBBoxCache.get(c.city) ?? null;
      if (!inBBox(c.lat, c.lng, bbox)) { c.lat = null; c.lng = null; }
    }
  }

  // X/Y apartment addresses (e.g. "הרצל 12/3") — GPS was likely geocoded from dirty address → force re-geocode
  // Skip: gps-corrections (manual fixes) and gps-lookup (Excel coordinates, more reliable)
  const APT_RE = /\d+\/\d+/;
  for (const c of clients) {
    if (!APT_RE.test(c.address)) continue;
    if (!isValidIL(c.lat, c.lng)) continue;         // already missing GPS → will geocode anyway
    if (c.gpsSource === 'correction') continue;      // manual agent fix → don't touch
    if (gpsLookup[String(c.custId)]) continue;       // Excel coordinates → probably correct
    c.lat = null; c.lng = null;                      // was PBI GPS from dirty address → re-geocode
  }

  // settlement addresses (מושב/קיבוץ etc.) without street number → force city center
  // PBI GPS for these is unreliable — the address IS the settlement name
  const SETTLEMENT_RE = /(מושב|קיבוץ|כפר|ישוב|מוצא|נחלה)/i;
  for (const c of clients) {
    if (!isValidIL(c.lat, c.lng)) continue;   // already no GPS, skip
    if (extractStreetNum(c.address)) continue; // has street+number, GPS may be valid
    if (SETTLEMENT_RE.test(c.address)) { c.lat = null; c.lng = null; }
  }

  // venue addresses (קניון/מרכז/תחנה) without street number → Google POI → Azure POI → city-center
  const VENUE_RE = /קניון|מרכז מסחרי|מרכז קניות|מרכז עסקים|תחנה מרכזית/i;
  for (const c of clients) {
    if (isValidIL(c.lat, c.lng)) continue;
    if (extractStreetNum(c.address)) continue;
    if (!VENUE_RE.test(c.address)) continue;
    const q = [fixPriorityAddr(c.address), c.city].filter(Boolean).join(', ');
    const azBbox = cityBBoxCache.get(c.city) ?? null;
    const g = await googleMapsQuery(q, c.city);
    if (g && inBBox(g.lat, g.lng, azBbox)) {
      c.lat = g.lat; c.lng = g.lng; c.gpsSource = 'google-poi';
    } else {
      const az = await azureMapsQuery(q, c.city);
      if (az && inBBox(az.lat, az.lng, azBbox)) {
        c.lat = az.lat; c.lng = az.lng; c.gpsSource = 'azure-poi';
      }
    }
    await sleep(1100);
  }

  // clients without street number → city center from bbox (0 API calls)
  for (const c of clients) {
    if (isValidIL(c.lat, c.lng)) continue;
    if (extractStreetNum(c.address)) continue; // has number → will Nominatim below
    const bbox = cityBBoxCache.get(c.city);
    if (bbox) { c.lat = (bbox.minLat + bbox.maxLat) / 2; c.lng = (bbox.minLng + bbox.maxLng) / 2; c.gpsSource = 'city-center'; }
  }

  // cascade-geocode clients with street number still missing valid coords
  // (skip clients covered by gps-lookup — their coords are already verified)
  const need = clients.filter(c => !isValidIL(c.lat, c.lng) && extractStreetNum(c.address) && (!gpsLookup[String(c.custId)] || reGeocode.has(String(c.custId))));
  for (const c of need) {
    const bbox = cityBBoxCache.get(c.city) ?? null;
    // 1st try: Nominatim
    const r = await geocodeOne(c.address, c.city);
    if (r && inBBox(r.lat, r.lng, bbox)) {
      c.lat = r.lat; c.lng = r.lng; c.gpsSource = 'nominatim';
    } else {
      // 2nd try: Google Maps (best for Hebrew: POI, intersections, abbreviations)
      const q = [cleanAddr(c.address), c.city].filter(Boolean).join(', ');
      const azBbox = cityBBoxCache.get(c.city) ?? null;
      const g = await googleMapsQuery(q, c.city);
      if (g && inBBox(g.lat, g.lng, azBbox)) {
        c.lat = g.lat; c.lng = g.lng; c.gpsSource = 'google';
      } else {
        // 3rd try: Azure Maps
        const az = await azureMapsQuery(q, c.city);
        if (az && inBBox(az.lat, az.lng, azBbox)) {
          c.lat = az.lat; c.lng = az.lng; c.gpsSource = 'azure';
        }
      }
    }
    await sleep(1100);
  }

  // clients still without GPS after Nominatim+Azure — try Azure on city name alone (no bbox check)
  const stillMissing = clients.filter(c => !isValidIL(c.lat, c.lng) && !gpsLookup[String(c.custId)] && c.gpsSource !== 'city-center');
  for (const c of stillMissing) {
    const az = await azureMapsQuery(c.city, c.city);
    const azBbox = cityBBoxCache.get(c.city) ?? null;
    if (az && inBBox(az.lat, az.lng, azBbox)) {
      c.lat = az.lat; c.lng = az.lng; c.gpsSource = 'city-center';
    }
  }
}

function mapClient(r, dayNum) {
  const custId = r['משטח[מס. לקוח]'];
  const corr   = custId ? gpsCorrections[String(custId)] : null;
  const lookup = custId ? gpsLookup[String(custId)] : null;
  return {
    custId,
    custName:      fixPriorityAddr(r['משטח[שם לקוח]'] || ''),
    city:          fixPriorityAddr(r['משטח[עיר]']     || ''),
    address:       fixPriorityAddr(r['משטח[כתובת]']   || ''),
    lat:           corr ? corr.lat : (r['משטח[קו רוחב]'] || null) || (lookup ? lookup.lat : null),
    lng:           corr ? corr.lng : (r['משטח[קו אורך]'] || null) || (lookup ? lookup.lng : null),
    gpsSource:     corr ? 'correction' : (r['משטח[קו רוחב]'] ? 'pbi' : lookup ? 'lookup' : null),
    agentCode:     r['משטח[סוכן]'],
    agentName:     r['משטח[שם סוכן]'] || '',
    dayNum,
    dayLabel:      DAY_LABELS[dayNum],
    priorityOrder: r['[סדר ביקור_k]'] || 0,
    lastOrderDate: r['[הזמנה אחרונה]'] ? r['[הזמנה אחרונה]'].split('T')[0] : null,
    monthlySales:  r['[מכירות חודש]']  || 0,
    target:        r['[יעד]']          || 0,
    pct:           (() => { const m = r['[מכירות חודש]'] || 0; const t = r['[יעד]'] || 0; return t > 0 ? m / t : 0; })(),
    indication:    r['[indication]'] || null,
  };
}

async function fetchClients(agentCode, dayNum) {
  const dayLabel = DAY_LABELS[dayNum];
  const daysPct  = workingDaysPct();
  const dax = `
EVALUATE
ADDCOLUMNS(
  FILTER('משטח',
    'משטח'[סוכן] = "${agentCode}"
    && NOT(ISBLANK(LOOKUPVALUE('משטח עם כפולות'[מס.לקוח],
         'משטח עם כפולות'[מס.לקוח], 'משטח'[מס. לקוח],
         'משטח עם כפולות'[יום], "${dayLabel}")))
  ),
  "סדר ביקור_k", LOOKUPVALUE('משטח עם כפולות'[סדר ביקור],
                    'משטח עם כפולות'[מס.לקוח], 'משטח'[מס. לקוח],
                    'משטח עם כפולות'[יום], "${dayLabel}"),
  "הזמנה אחרונה",
    CALCULATE(MAX('ALL_PARTS'[תאריך]),
      FILTER('ALL_PARTS',
        'ALL_PARTS'[מספר לקוח]=EARLIER('משטח'[מס. לקוח])
        && 'ALL_PARTS'[חברה]="FORMULA")),
  "מכירות חודש",
    CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)],
      FILTER('ALL_PARTS',
        'ALL_PARTS'[מספר לקוח]=EARLIER('משטח'[מס. לקוח])
        && 'ALL_PARTS'[חברה]="FORMULA"
        && YEAR('ALL_PARTS'[תאריך])=YEAR(TODAY())
        && MONTH('ALL_PARTS'[תאריך])=MONTH(TODAY()))),
  "יעד", CALCULATE([יעד $], 'משטח'[סטטוס] IN {"פעיל"}),
  "indication",
    VAR target = CALCULATE([יעד $], 'משטח'[סטטוס] IN {"פעיל"})
    VAR sales  = CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)],
      FILTER('ALL_PARTS',
        'ALL_PARTS'[מספר לקוח]=EARLIER('משטח'[מס. לקוח])
        && 'ALL_PARTS'[חברה]="FORMULA"
        && YEAR('ALL_PARTS'[תאריך])=YEAR(TODAY())
        && MONTH('ALL_PARTS'[תאריך])=MONTH(TODAY())))
    RETURN IF(target = 0, BLANK(),
      IF(DIVIDE(sales, target) - ${daysPct} < -0.05, "😕", "🚀"))
)
ORDER BY [סדר ביקור_k] ASC`;
  const rows = await executeDax(dax);
  return rows.map(r => mapClient(r, dayNum));
}

async function main() {
  console.log('▶ build-formula-road starting…');

  // 1. Managers
  const mgrRows = await executeDax(
    "EVALUATE DISTINCT(SELECTCOLUMNS('משטח', \"mgr\", 'משטח'[קבוצה]))"
  );
  const managers = [...new Set(mgrRows.map(r => r['[mgr]']).filter(Boolean))].sort();
  console.log(`  managers: ${managers.join(', ')}`);

  // 2. Agents per manager
  const agentsByManager = {};
  for (const mgr of managers) {
    const rows = await executeDax(`
EVALUATE DISTINCT(SELECTCOLUMNS(
  FILTER('משטח','משטח'[קבוצה]="${mgr.replace(/"/g,'')}"),
  "agentCode",'משטח'[סוכן], "agentName",'משטח'[שם סוכן]
)) ORDER BY [agentName] ASC`);
    agentsByManager[mgr] = rows.map(r => ({
      agentCode: r['[agentCode]'],
      agentName: r['[agentName]'] || r['[agentCode]'],
    })).filter(a => a.agentCode);
    console.log(`  ${mgr}: ${agentsByManager[mgr].length} agents`);
  }

  // 3a. Fetch all clients (no geocoding yet)
  const allRouteClients = {};
  for (const mgr of managers) {
    for (const agent of agentsByManager[mgr]) {
      for (const day of [1,2,3,4,5]) {
        const key = `${agent.agentCode}_${day}`;
        try {
          allRouteClients[key] = await fetchClients(agent.agentCode, day);
        } catch (e) {
          console.warn(`  ${key} fetch FAILED: ${e.message}`);
          allRouteClients[key] = [];
        }
      }
    }
  }

  // 3b. Global duplicate-coord detection — PBI sometimes assigns one coordinate to
  // multiple distinct clients (e.g. all of קרית גת at the same point).
  // Find coords shared by 2+ clients → force re-geocode via Azure.
  const coordCount = {};
  for (const clients of Object.values(allRouteClients)) {
    for (const c of clients) {
      if (c.gpsSource === 'correction' || !isValidIL(c.lat, c.lng)) continue;
      const ck = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
      if (!coordCount[ck]) coordCount[ck] = new Set();
      coordCount[ck].add(String(c.custId));
    }
  }
  const dupCustIds = new Set();
  for (const [ck, ids] of Object.entries(coordCount)) {
    if (ids.size >= 2) for (const id of ids) dupCustIds.add(id);
  }
  if (dupCustIds.size > 0) {
    console.log(`  ⚠ ${dupCustIds.size} clients share duplicate PBI coords → force re-geocode`);
    for (const clients of Object.values(allRouteClients)) {
      for (const c of clients) {
        if (dupCustIds.has(String(c.custId)) && c.gpsSource !== 'correction') {
          c.lat = null; c.lng = null; c.gpsSource = null;
        }
      }
    }
  }

  // 3c. Geocode each route (dupCustIds bypass gpsLookup skip)
  const routes = {};
  for (const mgr of managers) {
    for (const agent of agentsByManager[mgr]) {
      for (const day of [1,2,3,4,5]) {
        const key = `${agent.agentCode}_${day}`;
        try {
          const clients = allRouteClients[key];
          await geocodeBatch(clients, dupCustIds);
          routes[key] = clients;
          const noGps  = clients.filter(c => !isValidIL(c.lat, c.lng)).length;
          const byAzure = clients.filter(c => c.gpsSource === 'azure').length;
          const azureStr = byAzure ? `, ${byAzure} azure` : '';
          console.log(`  ${key}: ${clients.length} clients, ${noGps} no-GPS${azureStr}`);
        } catch (e) {
          console.warn(`  ${key} FAILED: ${e.message}`);
          routes[key] = [];
        }
      }
    }
  }

  // 4. Save — use PBI SERVER DATE TIME as updatedAt (same as planogram editor)
  const pbiRefreshRaw = await fetchLastRefresh().catch(() => null);
  // Build agents map from PBI data (managers use password 1999, not agent code)
  const agents = {};
  for (const agentList of Object.values(agentsByManager)) {
    for (const a of agentList) {
      const c = String(a.agentCode || '');
      if (c && !agents[c]) agents[c] = { name: a.agentName || '' };
    }
  }

  // routes and agents are excluded from the public static file (security: customer data)
  // Agent validation is now server-side (/auth endpoint)
  const out = {
    updatedAt: pbiRefreshRaw || new Date().toISOString(),
    managers,
    agentsByManager,
  };
  const outPath = path.join(__dirname, '../docs/formula-road-data.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`✅ Saved → docs/formula-road-data.json (${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);

  // Build client lookup for CSV enrichment
  const clientLookup = {};
  for (const key of Object.keys(routes)) {
    for (const cl of routes[key]) {
      if (cl.custId && !clientLookup[String(cl.custId)]) {
        clientLookup[String(cl.custId)] = {
          custName: cl.custName || '',
          city:     cl.city    || '',
          address:  cl.address || '',
        };
      }
    }
  }

  // Generate CSV of all corrections for Priority ERP import
  const corrIds = Object.keys(gpsCorrections);
  if (corrIds.length > 0) {
    const now = new Date();
    const fmtDate = iso => {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const daysSince = iso => {
      if (!iso) return '';
      const diff = Math.floor((now - new Date(iso)) / 86400000);
      return diff === 0 ? 'היום' : diff === 1 ? 'אתמול' : `לפני ${diff} ימים`;
    };
    const csvLines = ['מס. לקוח,שם לקוח,עיר,כתובת,קו רוחב,קו אורך,תאריך תיקון,ימים'];
    const sorted = corrIds.slice().sort((a,b) => new Date(gpsCorrections[b].correctedAt||0) - new Date(gpsCorrections[a].correctedAt||0));
    for (const id of sorted) {
      const c   = gpsCorrections[id];
      const inf = clientLookup[id] || {};
      const esc = s => `"${(s||'').replace(/"/g,'""')}"`;
      csvLines.push([
        id,
        esc(c.name || inf.custName),
        esc(inf.city || c.city),
        esc(inf.address || c.address),
        c.lat,
        c.lng,
        esc(fmtDate(c.correctedAt)),
        esc(daysSince(c.correctedAt)),
      ].join(','));
    }
    const csvPath = path.join(__dirname, '../docs/gps-corrections-export.csv');
    fs.writeFileSync(csvPath, '﻿' + csvLines.join('\n'), 'utf8'); // BOM for Excel Hebrew
    console.log(`✅ Priority CSV → docs/gps-corrections-export.csv (${corrIds.length} corrections)`);
  }

  // Generate CSV of all day corrections for Priority ERP import
  const dayIds = Object.keys(dayCorrections);
  if (dayIds.length > 0) {
    const esc = s => `"${(s||'').replace(/"/g,'""')}"`;
    const dayLines = ['מס. לקוח,שם לקוח,עיר,סוכן,יום ביקור,תאריך תיקון'];
    for (const id of dayIds) {
      const d   = dayCorrections[id];
      const inf = clientLookup[id] || {};
      dayLines.push([
        id,
        esc(d.custName || inf.custName),
        esc(d.city    || inf.city),
        esc(d.agentCode || ''),
        esc(d.dayLabel || ''),
        d.correctedAt || '',
      ].join(','));
    }
    const dayPath = path.join(__dirname, '../docs/day-corrections-export.csv');
    fs.writeFileSync(dayPath, '﻿' + dayLines.join('\n'), 'utf8');
    console.log(`✅ Priority Day CSV → docs/day-corrections-export.csv (${dayIds.length} corrections)`);
  }

  if (azureCacheDirty) {
    fs.writeFileSync(AZURE_CACHE_PATH, JSON.stringify(azureCache, null, 2));
    console.log(`✅ Azure cache → docs/azure-geocode-cache.json (${Object.keys(azureCache).length} entries)`);
  }
  if (googleCacheDirty) {
    fs.writeFileSync(GOOGLE_CACHE_PATH, JSON.stringify(googleCache, null, 2));
    console.log(`✅ Google cache → docs/google-geocode-cache.json (${Object.keys(googleCache).length} entries)`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
