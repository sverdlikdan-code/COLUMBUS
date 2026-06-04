/**
 * export-gps-report.js — GPS diff + geocode missing
 * Запуск: node server/export-gps-report.js
 * Результат: Desktop/gps-report-YYYY-MM-DD.xlsx
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs      = require('fs');
const ExcelJS = require('exceljs');
const { executeDax } = require('./powerbi');

const AZURE_MAPS_KEY  = process.env.AZURE_MAPS_KEY  || '';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || '';

// ── Israel bbox ───────────────────────────────────────────────────────────────
const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}
function isWithinBBox(lat, lng, bbox) {
  if (!bbox) return isValidIL(lat, lng);
  const pad = 0.05;
  return lat >= bbox.minLat - pad && lat <= bbox.maxLat + pad &&
         lng >= bbox.minLng - pad && lng <= bbox.maxLng + pad;
}

// ── Geocode cache ─────────────────────────────────────────────────────────────
const CACHE_PATH = path.join(__dirname, 'geocode-cache.json');
const geocodeCache = new Map();
try {
  const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  for (const [k, v] of Object.entries(data)) geocodeCache.set(k, v);
  console.log(`Cache loaded: ${geocodeCache.size} entries`);
} catch (_) {}

function saveCache() {
  const obj = {};
  for (const [k, v] of geocodeCache) obj[k] = v;
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(obj), 'utf8'); } catch (_) {}
}

// ── City bbox cache ───────────────────────────────────────────────────────────
const cityBBoxCache = new Map();
async function getCityBBox(city) {
  if (cityBBoxCache.has(city)) return cityBBoxCache.get(city);
  if (AZURE_MAPS_KEY) {
    try {
      const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(city + ', ישראל')}&countrySet=IL&limit=1&subscription-key=${AZURE_MAPS_KEY}`;
      const d = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json();
      const bb = d?.results?.[0]?.boundingBox;
      if (bb) {
        const bbox = { minLat: bb.southWest.lat, maxLat: bb.northEast.lat, minLng: bb.southWest.lon, maxLng: bb.northEast.lon };
        cityBBoxCache.set(city, bbox); return bbox;
      }
    } catch (_) {}
  }
  cityBBoxCache.set(city, null); return null;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────
async function gGoogle(q) {
  if (!GOOGLE_MAPS_KEY) return null;
  try {
    const d = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=il&key=${GOOGLE_MAPS_KEY}`, { signal: AbortSignal.timeout(5000) })).json();
    const r = d?.results?.[0]?.geometry?.location;
    return r ? { lat: r.lat, lng: r.lng } : null;
  } catch (_) { return null; }
}

async function gAzure(q) {
  if (!AZURE_MAPS_KEY) return null;
  try {
    const d = await (await fetch(`https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(q)}&countrySet=IL&limit=1&subscription-key=${AZURE_MAPS_KEY}`, { signal: AbortSignal.timeout(5000) })).json();
    const r = d?.results?.[0];
    return r?.position ? { lat: r.position.lat, lng: r.position.lon } : null;
  } catch (_) { return null; }
}

let _nomTs = 0;
async function gNominatim(q) {
  const wait = 1100 - (Date.now() - _nomTs);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _nomTs = Date.now();
  try {
    const d = await (await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=il`, { headers: { 'User-Agent': 'ColumbusDillerApp/1.1' }, signal: AbortSignal.timeout(5000) })).json();
    return d[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) } : null;
  } catch (_) { return null; }
}

async function geocodeOne(q) {
  if (geocodeCache.has(q)) return geocodeCache.get(q);
  let r = await gGoogle(q);
  if (!r) r = await gAzure(q);
  if (!r) r = await gNominatim(q);
  geocodeCache.set(q, r || null);
  return r || null;
}

function cleanAddr(s) {
  return (s || '').replace(/(\d+)\/\d+/g, '$1').replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

// Power BI (Priority ERP) delivers Hebrew text wrapped in LRO/RLO BiDi marks,
// with characters in visual order (reversed). Strip marks then un-reverse.
const BIDI_TEST  = /[‎‏‪-‮]/;     // no g — for detection only
const BIDI_STRIP = /[‎‏‪-‮]/g;    // g — for replace
function fixBiDiHebrew(raw) {
  if (!raw) return '';
  const hasBidi = BIDI_TEST.test(raw);
  const s = raw.replace(BIDI_STRIP, '').trim();
  if (!hasBidi || !/[א-ת]/.test(s)) return s;
  return s.split(/\s+/).reverse()
    .map(w => /[א-ת]/.test(w) ? w.split('').reverse().join('') : w)
    .join(' ');
}

async function geocodeClient(c) {
  if (/ת\.?ד\.?\s*\d+/i.test(c.address)) return null;
  const bbox = cityBBoxCache.get(c.city) ?? null;
  const addr = cleanAddr(c.address);
  const city = c.city || '';

  const queries = [
    addr && city ? `${addr}, ${city}, ישראל` : null,
    addr         ? `${addr}, ישראל`           : null,
    city         ? `${city}, ישראל`           : null,
  ].filter(Boolean);

  for (const q of queries) {
    const r = await geocodeOne(q);
    if (r && isWithinBBox(r.lat, r.lng, bbox)) return r;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Querying Power BI...');
  const rows = await executeDax(`
EVALUATE
SUMMARIZE(
  FILTER('משטח', 'משטח'[סטטוס] = "פעיל"),
  'משטח'[מס. לקוח],
  'משטח'[שם לקוח],
  'משטח'[עיר],
  'משטח'[כתובת],
  'משטח'[קו רוחב],
  'משטח'[קו אורך],
  'משטח'[סוכן],
  'משטח'[שם סוכן]
)
ORDER BY 'משטח'[מס. לקוח] ASC
  `);

  const clients = rows.map(r => ({
    custId:    r['משטח[מס. לקוח]'],
    custName:  fixBiDiHebrew(r['משטח[שם לקוח]'] || ''),
    city:      fixBiDiHebrew(r['משטח[עיר]']     || ''),
    address:   fixBiDiHebrew(r['משטח[כתובת]']   || ''),
    pbiLat:    r['משטח[קו רוחב]']  || null,
    pbiLng:    r['משטח[קו אורך]']  || null,
    agentCode: r['משטח[סוכן]']     || '',
    agentName: fixBiDiHebrew(r['משטח[שם סוכן]'] || ''),
  }));
  console.log(`Active clients: ${clients.length}`);

  // Load manual GPS corrections
  let corrections = {};
  try { corrections = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'gps-corrections.json'), 'utf8')); } catch (_) {}
  console.log(`Manual corrections: ${Object.keys(corrections).length}`);

  // Prefetch city bboxes (only for cities needing geocoding)
  const cities = [...new Set(clients.filter(c => !isValidIL(c.pbiLat, c.pbiLng) && !corrections[String(c.custId)]).map(c => c.city).filter(Boolean))];
  console.log(`Fetching bboxes for ${cities.length} cities...`);
  await Promise.all(cities.map(city => getCityBBox(city)));

  // Process
  const diffRows = [];
  let idx = 0, geocoded = 0, fromCache = 0, failed = 0;

  for (const c of clients) {
    idx++;
    if (idx % 100 === 0) process.stdout.write(`\r  Processing ${idx}/${clients.length} | geocoded: ${geocoded} cache: ${fromCache} failed: ${failed}   `);

    const corr = corrections[String(c.custId)];

    if (corr) {
      diffRows.push({ ...c, ourLat: corr.lat, ourLng: corr.lng, gpsSource: 'correction', note: 'תיקון ידני' });
      continue;
    }

    if (isValidIL(c.pbiLat, c.pbiLng)) continue; // Priority GPS valid → skip

    // Need geocoding
    const cacheKey = [cleanAddr(c.address), c.city, 'ישראל'].filter(Boolean).join(', ');
    const wasCached = geocodeCache.has(cacheKey);
    const geo = await geocodeClient(c);

    if (geo) {
      if (!wasCached) { geocoded++; } else { fromCache++; }
      diffRows.push({ ...c, ourLat: geo.lat, ourLng: geo.lng, gpsSource: 'no-gps', note: wasCached ? 'מתוך cache' : 'גיאוקוד חדש' });
    } else {
      failed++;
      diffRows.push({ ...c, ourLat: '', ourLng: '', gpsSource: 'no-gps', note: 'לא נמצא GPS' });
    }
  }

  saveCache();
  console.log(`\nDone processing. Saving cache...`);

  // ── Write Excel ──────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GPS Report');
  ws.views = [{ rightToLeft: true }];

  ws.columns = [
    { header: 'מס. לקוח',          key: 'custId',    width: 12 },
    { header: 'שם לקוח',           key: 'custName',  width: 34 },
    { header: 'עיר',               key: 'city',      width: 16 },
    { header: 'כתובת',             key: 'address',   width: 30 },
    { header: 'קו רוחב Priority',  key: 'pbiLat',    width: 16 },
    { header: 'קו אורך Priority',  key: 'pbiLng',    width: 16 },
    { header: 'קו רוחב FORMULA',   key: 'ourLat',    width: 16 },
    { header: 'קו אורך FORMULA',   key: 'ourLng',    width: 16 },
    { header: 'סטטוס',             key: 'gpsSource', width: 14 },
    { header: 'קוד סוכן',          key: 'agentCode', width: 12 },
    { header: 'שם סוכן',           key: 'agentName', width: 22 },
    { header: 'הערה',              key: 'note',      width: 26 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
  });
  ws.getRow(1).height = 24;

  const srcFill = {
    'correction': 'FF1B5E20',
    'no-gps':     'FF0D47A1',
  };

  for (const row of diffRows) {
    const r = ws.addRow({
      custId:    row.custId,
      custName:  row.custName,
      city:      row.city,
      address:   row.address,
      pbiLat:    row.pbiLat ?? '',
      pbiLng:    row.pbiLng ?? '',
      ourLat:    row.ourLat ?? '',
      ourLng:    row.ourLng ?? '',
      gpsSource: row.gpsSource,
      agentCode: row.agentCode,
      agentName: row.agentName,
      note:      row.note,
    });
    const bg = srcFill[row.gpsSource];
    if (bg) {
      r.getCell('gpsSource').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      r.getCell('gpsSource').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    }
    // highlight rows where our GPS is empty
    if (!row.ourLat) {
      r.getCell('note').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8F00' } };
    }
    r.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });
  }

  ws.autoFilter  = { from: 'A1', to: `L${diffRows.length + 1}` };
  ws.views[0].state  = 'frozen';
  ws.views[0].ySplit = 1;

  const today   = new Date().toISOString().slice(0, 10);
  const outPath = `C:\\Users\\d.sverdlik\\Desktop\\gps-report-${today}.xlsx`;
  await wb.xlsx.writeFile(outPath);

  const cntCorr    = diffRows.filter(r => r.gpsSource === 'correction').length;
  const cntGeocoded = diffRows.filter(r => r.gpsSource === 'no-gps' && r.ourLat).length;
  const cntFailed  = diffRows.filter(r => r.gpsSource === 'no-gps' && !r.ourLat).length;

  console.log(`\n✓ Saved: ${outPath}`);
  console.log(`  ✏️  Manual corrections:  ${cntCorr}`);
  console.log(`  📍 Geocoded (no-gps):   ${cntGeocoded} (${fromCache} from cache, ${geocoded} new)`);
  console.log(`  ❌ Failed (no GPS found): ${cntFailed}`);
  console.log(`  Total rows: ${diffRows.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
