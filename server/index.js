require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const { executeDax } = require('./powerbi');

const app = express();
app.use(cors());
app.use(express.json());

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
app.get('/geocode', async (req, res) => {
  const { address, city } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });
  const result = await geocodeAddress(address, city || '');
  res.json(result || {});
});

// GET /managers — unique manager groups from Fabric
app.get('/managers', async (req, res) => {
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
app.get('/manager-agents', async (req, res) => {
  const { manager } = req.query;
  if (!manager) return res.status(400).json({ error: 'manager required' });
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
app.get('/customers', async (req, res) => {
  const { agent, day } = req.query;
  if (!agent) return res.status(400).json({ error: 'agent required' });

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

// Save planogram base JSON back to docs/
app.post('/save-kapua', (req, res) => {
  try {
    const path = require('path');
    const fs   = require('fs');
    const data = req.body;
    if (!data || !data.picks) return res.status(400).json({ error: 'invalid payload' });
    const dest = path.join(__dirname, '..', 'docs', 'kapua-base.json');
    fs.writeFileSync(dest, JSON.stringify(data, null, 2), 'utf8');
    res.json({ ok: true, v: data.v });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Columbus server running on port ${PORT}`));
