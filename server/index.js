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
async function geocodeBatch(clients) {
  const needsGeocode = clients.filter(c => !isValidIL(c.lat, c.lng) && (c.address || c.city));
  for (const c of needsGeocode) {
    const result = await geocodeAddress(c.address, c.city);
    if (result) { c.lat = result.lat; c.lng = result.lng; }
    await new Promise(r => setTimeout(r, 1100)); // Nominatim: 1 req/sec
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
      SUM('ALL_PARTS'[סכום (ש'ח)]),
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
    )
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
      };
    });
    await geocodeBatch(clients);
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Columbus server running on port ${PORT}`));
