// Shared geocoding module for COLUMBUS
// Used by: gps scripts, Geograf agent (on-the-fly), future agents
// require('dotenv').config({ path: '../.env' }) must be called before use

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };

function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── 1. House number reversal ───────────────────────────────────────────────
// Priority ERP stores numbers RTL-reversed: 279 → 972, 15 → 51
function reversePart(s) {
  const t = s.trim();
  if (t.length >= 2 && /^\d+$/.test(t)) return t.split('').reverse().join('');
  return t;
}

function fixAddress(address) {
  if (!address) return address;
  // Number at end: "הרצל 15" → "הרצל 51"... wait, reversed: "51" → "15"
  const m = address.match(/^(.*\D)\s+(\d[\d\/]*)(\s*)$/);
  if (m) {
    const num = m[2].split('/').map(reversePart).join('/');
    return `${m[1].trim()} ${num}`;
  }
  // Number in middle: "הרצל 51 מרכז מסחרי" → "הרצל 15 מרכז מסחרי"
  const m2 = address.match(/^(.*?\D)\s+(\d[\d\/]*)\s+(.+)$/);
  if (m2) {
    const num = m2[2].split('/').map(reversePart).join('/');
    return `${m2[1].trim()} ${num} ${m2[3]}`;
  }
  return address;
}

// ── 2. Strip junk after house number ──────────────────────────────────────
// "הכרמל 22 פינת ארבל 51" → "הכרמל 22"
function stripAfterHouseNumber(address) {
  const m = address.match(/^([א-ת\w\s'".\\/\-״]+?)\s+(\d[\d\/]*)\s+.+$/);
  if (m) return `${m[1].trim()} ${m[2]}`;
  return address;
}

// ── 3. Clean address ───────────────────────────────────────────────────────
const STRIP_PATTERNS = [
  /מרכז\s+[א-ת](['"]?\s*\w*)?/g,
  /מרכז\s+מסחרי[^,\d]*/gi, /מרכז\s+עסקים[^,\d]*/gi,
  /מרכז\s+קניות[^,\d]*/gi, /קניון[^,\d]*/gi,
  /מתחם[^,\d]*/gi, /פארק\s+תעשיי?ה[^,\d]*/gi,
  /אזור\s+תעשיי?ה[^,\d]*/gi, /קומה\s*[-–]?\s*\d+/gi,
  /קומה\s+[א-ת]+/gi, /דירה\s*[-–]?\s*\d+/gi,
  /דירה\s+[א-ת]+/gi, /כניסה\s+[א-ת\d]+/gi,
  /בניין\s*[א-ת\d]*/gi, /\(.*?\)/g,
  /בית\s+קפה[^,]*/gi, /מסעדה[^,]*/gi,
  /סופרמרקט[^,]*/gi, /שופרסל[^,]*/gi,
];

function cleanAddress(address, city) {
  if (!address || address.trim().length < 2) return null;
  let a = address;
  for (const p of STRIP_PATTERNS) a = a.replace(p, '');
  if (city) {
    const c = city.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    a = a.replace(new RegExp('[,،]?\\s*' + c + '\\s*[,،]?', 'gi'), '');
  }
  a = a.replace(/,/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return a.length >= 3 ? a : null;
}

// ── Full pipeline ──────────────────────────────────────────────────────────
function prepareAddress(rawAddress, city) {
  if (!rawAddress) return null;
  const fixed   = fixAddress(rawAddress);
  const stripped = stripAfterHouseNumber(fixed);
  return cleanAddress(stripped, city);
}

// ── City normalization ─────────────────────────────────────────────────────
function normalizeCity(city) {
  if (!city) return '';
  return city
    .replace(/^ה/, '').replace(/\s*-\s*יפו$/i, '')
    .replace(/\s*-\s*/g, ' ').replace(/קריית/g, 'קרית')
    .replace(/['"״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function compareCities(a, b) {
  const na = normalizeCity(a), nb = normalizeCity(b);
  if (!na || !nb) return 'unknown';
  return (na === nb || na.includes(nb) || nb.includes(na)) ? 'match' : 'wrong';
}

// ── Azure Maps geocode ─────────────────────────────────────────────────────
const _cache = new Map();

async function geocodeAddress(address, city, cityCoords, opts = {}) {
  const AZURE_KEY = process.env.AZURE_MAPS_KEY;
  if (!AZURE_KEY) throw new Error('AZURE_MAPS_KEY missing in .env');

  const q = [address, city, 'ישראל'].filter(Boolean).join(', ');
  if (_cache.has(q)) return _cache.get(q);

  try {
    const radius = opts.radius || 20000;
    let url = `https://atlas.microsoft.com/search/address/json?api-version=1.0`
            + `&query=${encodeURIComponent(q)}&subscription-key=${AZURE_KEY}`
            + `&language=he-IL&countrySet=IL&limit=1`;
    if (cityCoords) url += `&lat=${cityCoords.lat}&lon=${cityCoords.lng}&radius=${radius}`;

    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();

    if (d.results?.[0]) {
      const res = d.results[0];
      const lat = res.position.lat, lng = res.position.lon;
      if (isValidIL(lat, lng)) {
        const a = res.address || {};
        const result = {
          lat, lng,
          city: a.municipality || a.localName || '',
          display: a.freeformAddress || '',
          confidence: res.score || 0,
        };
        _cache.set(q, result);
        return result;
      }
    }
  } catch (_) {}

  _cache.set(q, null);
  return null;
}

async function geocodeCity(city) {
  const AZURE_KEY = process.env.AZURE_MAPS_KEY;
  if (!AZURE_KEY || !city) return null;
  const key = `__city__${city}`;
  if (_cache.has(key)) return _cache.get(key);
  try {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0`
              + `&query=${encodeURIComponent(city + ', ישראל')}&subscription-key=${AZURE_KEY}`
              + `&language=he-IL&countrySet=IL&limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.results?.[0]) {
      const { lat, lon } = d.results[0].position;
      if (isValidIL(lat, lon)) { _cache.set(key, { lat, lng: lon }); return { lat, lng: lon }; }
    }
  } catch (_) {}
  _cache.set(key, null);
  return null;
}

// ── High-level: resolve one client ────────────────────────────────────────
// Returns: { lat, lng, source, cityMatch } or null
async function resolveClient({ custId, address, city, existingLat, existingLng }) {
  // 1. Already has valid GPS
  if (isValidIL(existingLat, existingLng)) {
    return { lat: existingLat, lng: existingLng, source: 'existing', cityMatch: true };
  }

  // 2. Prepare address
  const cleaned = prepareAddress(address, city);
  if (!cleaned) return null;

  // 3. Get city anchor
  const cityCoords = await geocodeCity(city);

  // 4. Geocode with anchor
  const geo = await geocodeAddress(cleaned, city, cityCoords);
  if (!geo) return null;

  const cityResult = compareCities(city, geo.city);
  return {
    lat: geo.lat,
    lng: geo.lng,
    source: 'azure',
    cleanedAddress: cleaned,
    foundCity: geo.city,
    cityMatch: cityResult === 'match',
    cityStatus: cityResult,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clearCache() { _cache.clear(); }

module.exports = {
  isValidIL,
  fixAddress,
  stripAfterHouseNumber,
  cleanAddress,
  prepareAddress,
  normalizeCity,
  compareCities,
  geocodeAddress,
  geocodeCity,
  resolveClient,
  sleep,
  clearCache,
};
