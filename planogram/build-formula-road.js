// build-formula-road.js
// Runs in GitHub Actions: fetches all managers/agents/clients from PBI,
// geocodes missing GPS, saves docs/formula-road-data.json
// formula-road.html loads this file — no live server needed.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const { executeDax } = require('../server/powerbi');

const DAY_LABELS = { 1:'א', 2:'ב', 3:'ג', 4:'ד', 5:'ה' };
const IL = { minLat:29.3, maxLat:33.5, minLng:34.2, maxLng:35.9 };
const geocodeCache  = new Map();
const cityBBoxCache = new Map();

function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi, /מרכז עסקים[^,]*/gi, /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi, /מתחם[^,]*/gi, /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi, /\(.*?\)/g,
];
function cleanAddr(address) {
  if (!address) return address;
  let s = address;
  for (const p of VENUE_PATTERNS) s = s.replace(p, '');
  return s.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
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
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city+', ישראל')}&format=json&limit=1&countrycodes=il,ps`
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
  if (!bbox) return true;
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

async function geocodeOne(address, city) {
  const cleaned = cleanAddr(address);
  const attempts = [];
  if (cleaned) attempts.push([cleaned, city, 'ישראל'].filter(Boolean).join(', '));
  const street = extractStreetNum(cleaned || address);
  if (street && street !== cleaned) attempts.push([street, city, 'ישראל'].filter(Boolean).join(', '));

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

async function geocodeBatch(clients) {
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

  // clients without street number → city center from bbox (0 API calls)
  for (const c of clients) {
    if (isValidIL(c.lat, c.lng)) continue;
    if (extractStreetNum(c.address)) continue; // has number → will Nominatim below
    const bbox = cityBBoxCache.get(c.city);
    if (bbox) { c.lat = (bbox.minLat + bbox.maxLat) / 2; c.lng = (bbox.minLng + bbox.maxLng) / 2; }
  }

  // cascade-geocode clients with street number still missing valid coords
  const need = clients.filter(c => !isValidIL(c.lat, c.lng) && extractStreetNum(c.address));
  for (const c of need) {
    const r = await geocodeOne(c.address, c.city);
    if (r && inBBox(r.lat, r.lng, cityBBoxCache.get(c.city) ?? null)) {
      c.lat = r.lat; c.lng = r.lng;
    }
    await sleep(1100);
  }
}

function mapClient(r, dayNum) {
  return {
    custId:        r['משטח עם כפולות[מס.לקוח]'],
    custName:      r['משטח עם כפולות[שם לקוח]'] || '',
    city:          r['[עיר]']    || '',
    address:       r['[כתובת]']  || '',
    lat:           r['[lat]']    || null,
    lng:           r['[lng]']    || null,
    agentCode:     r['משטח עם כפולות[סוכן]'],
    agentName:     r['משטח עם כפולות[שם סוכן]'] || '',
    dayNum,
    dayLabel:      DAY_LABELS[dayNum] || r['משטח עם כפולות[יום]'],
    priorityOrder: r['משטח עם כפולות[סדר ביקור]'] || 0,
    lastOrderDate: r['[הזמנה אחרונה]'] ? r['[הזמנה אחרונה]'].split('T')[0] : null,
    monthlySales:  r['[מכירות חודש]']  || 0,
    totalSales:    r['[totalSales]']   || 0,
    target:        r['[יעד]']          || 0,
    pct:           (() => { const m = r['[מכירות חודש]'] || 0; const t = r['[יעד]'] || 0; return t > 0 ? m / t : 0; })(),
  };
}

async function fetchClients(agentCode, dayNum) {
  const dayLabel = DAY_LABELS[dayNum];
  const dax = `
EVALUATE
ADDCOLUMNS(
  FILTER('משטח עם כפולות',
    'משטח עם כפולות'[סוכן] = "${agentCode}"
    && 'משטח עם כפולות'[יום] = "${dayLabel}"
  ),
  "כתובת",    LOOKUPVALUE('משטח'[כתובת],   'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "עיר",      LOOKUPVALUE('משטח'[עיר],     'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "lat",      LOOKUPVALUE('משטח'[קו רוחב], 'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "lng",      LOOKUPVALUE('משטח'[קו אורך], 'משטח'[מס. לקוח], 'משטח עם כפולות'[מס.לקוח]),
  "הזמנה אחרונה",
    CALCULATE(MAX('ALL_PARTS'[תאריך]),
      FILTER('ALL_PARTS','ALL_PARTS'[מספר לקוח]=EARLIER('משטח עם כפולות'[מס.לקוח]))),
  "מכירות חודש",
    CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)],
      FILTER('ALL_PARTS',
        'ALL_PARTS'[מספר לקוח]=EARLIER('משטח עם כפולות'[מס.לקוח])
        && YEAR('ALL_PARTS'[תאריך])=YEAR(TODAY())
        && MONTH('ALL_PARTS'[תאריך])=MONTH(TODAY()))),
  "totalSales",
    CALCULATE([TOTAL SALES (ללא זיכויים מרכזים)],
      FILTER('ALL_PARTS','ALL_PARTS'[מספר לקוח]=EARLIER('משטח עם כפולות'[מס.לקוח]))),
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
ORDER BY 'משטח עם כפולות'[סדר ביקור] ASC`;
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

  // 3. Clients per agent×day
  const routes = {};
  for (const mgr of managers) {
    for (const agent of agentsByManager[mgr]) {
      for (const day of [1,2,3,4,5]) {
        const key = `${agent.agentCode}_${day}`;
        try {
          const clients = await fetchClients(agent.agentCode, day);
          await geocodeBatch(clients);
          routes[key] = clients;
          const noGps = clients.filter(c => !isValidIL(c.lat, c.lng)).length;
          console.log(`  ${key}: ${clients.length} clients, ${noGps} no-GPS`);
        } catch (e) {
          console.warn(`  ${key} FAILED: ${e.message}`);
          routes[key] = [];
        }
      }
    }
  }

  // 4. Save
  const out = {
    updatedAt: new Date().toISOString(),
    managers,
    agentsByManager,
    routes,
  };
  const outPath = path.join(__dirname, '../docs/formula-road-data.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`✅ Saved → docs/formula-road-data.json (${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
