require('dotenv').config({ path: '../.env' });
const sql = require('mssql');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ── Config ───────────────────────────────────────────────────────────────────
// Source: 'excel' reads ../EXEL COORDINATES.xlsx, 'sql' reads Priority DB
const SOURCE = process.argv[2] === '--sql' ? 'sql' : 'excel';
// Set to false to skip house-number reversal (Excel addresses may already be correct)
const FIX_NUMBERS = true;
// Azure Maps key — set in .env as AZURE_MAPS_KEY, or leave blank to use Nominatim
const AZURE_KEY = process.env.AZURE_MAPS_KEY || '';

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── House number reverser ────────────────────────────────────────────────────
function reversePart(s) {
  const t = s.trim();
  if (t.length >= 2 && /^\d+$/.test(t)) return t.split('').reverse().join('');
  return t;
}
function reverseHouseNumber(numToken) {
  return numToken.split('/').map(reversePart).join('/');
}
function fixAddress(address) {
  if (!address) return address;
  const m = address.match(/^(.*\D)\s+(\d[\d\/]*)(\s*)$/);
  if (!m) return address;
  return `${m[1].trim()} ${reverseHouseNumber(m[2])}`;
}

// ── Address cleaner ──────────────────────────────────────────────────────────
const STRIP_PATTERNS = [
  /מרכז\s+[א-ת](['"]?\s*\w*)?/g,
  /מרכז\s+מסחרי[^,\d]*/gi,
  /מרכז\s+עסקים[^,\d]*/gi,
  /מרכז\s+קניות[^,\d]*/gi,
  /קניון[^,\d]*/gi,
  /מתחם[^,\d]*/gi,
  /פארק\s+תעשיי?ה[^,\d]*/gi,
  /אזור\s+תעשיי?ה[^,\d]*/gi,
  /קומה\s*[-–]?\s*\d+/gi,
  /קומה\s+[א-ת]+/gi,
  /דירה\s*[-–]?\s*\d+/gi,
  /דירה\s+[א-ת]+/gi,
  /כניסה\s+[א-ת\d]+/gi,
  /בניין\s*[א-ת\d]*/gi,
  /\(.*?\)/g,
  /בית\s+קפה[^,]*/gi,
  /מסעדה[^,]*/gi,
  /סופרמרקט[^,]*/gi,
  /שופרסל[^,]*/gi,
  /קריית\s+[א-ת ]+/gi,
  /קרית\s+[א-ת ]+/gi,
];

function removeCityFromAddress(address, city) {
  if (!address || !city) return address;
  const c = city.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Remove city preceded/followed by comma or space
  return address
    .replace(new RegExp('[,،]?\\s*' + c + '\\s*[,،]?', 'gi'), '')
    .replace(/[,،\s]+$/, '').replace(/^[,،\s]+/, '')
    .replace(/\s{2,}/g, ' ').trim();
}

function cleanAddress(address, city) {
  if (!address || address.trim() === '-' || address.trim().length < 2) return null;
  let a = address;
  for (const p of STRIP_PATTERNS) a = a.replace(p, '');
  if (city) a = removeCityFromAddress(a, city);
  a = a.replace(/,/g, ' ').replace(/[،\s]+$/, '').replace(/^[،\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  if (a.length < 3) return null;
  return a;
}

// ── City match checker ───────────────────────────────────────────────────────
function normalizeCity(city) {
  if (!city) return '';
  return city
    .replace(/^ה/, '')
    .replace(/\s*-\s*יפו$/i, '')
    .replace(/['"״]/g, '')
    .replace(/[-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cityMatches(clientCity, geocodedAddr) {
  const a = geocodedAddr || {};
  const candidates = [
    a.city, a.town, a.village, a.suburb,
    a.municipality, a.county, a.state_district,
    a.localName, a.countrySubdivision,
  ].filter(Boolean).map(normalizeCity);

  const target = normalizeCity(clientCity);
  if (!target) return true;

  return candidates.some(c =>
    c === target ||
    c.includes(target) ||
    target.includes(c)
  );
}

// ── Geocoders ────────────────────────────────────────────────────────────────
const geocodeCache = new Map();

async function geocodeAzure(address, city) {
  const query = [address, city, 'ישראל'].filter(Boolean).join(', ');
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  try {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(query)}&subscription-key=${AZURE_KEY}&language=he-IL&countrySet=IL&limit=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await resp.json();
    if (data.results && data.results.length > 0) {
      const r = data.results[0];
      const lat = r.position.lat;
      const lng = r.position.lon;
      if (isValidIL(lat, lng)) {
        const addr = r.address || {};
        const result = {
          lat, lng,
          nominatimCity: {
            city: addr.municipality || addr.localName,
            town: addr.localName,
            village: addr.localName,
          },
          displayName: addr.freeformAddress,
        };
        geocodeCache.set(query, result);
        return result;
      }
    }
  } catch (_) {}

  geocodeCache.set(query, null);
  return null;
}

async function geocodeNominatim(address, city) {
  const query = [address, city, 'ישראל'].filter(Boolean).join(', ');
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=il&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'DillerFormulaGeocode/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    const data = await resp.json();
    if (data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (isValidIL(lat, lng)) {
        const result = {
          lat, lng,
          nominatimCity: data[0].address,
          displayName: data[0].display_name,
        };
        geocodeCache.set(query, result);
        return result;
      }
    }
  } catch (_) {}

  geocodeCache.set(query, null);
  return null;
}

async function geocode(address, city) {
  if (AZURE_KEY) return geocodeAzure(address, city);
  return geocodeNominatim(address, city);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Read clients from Excel ──────────────────────────────────────────────────
function readFromExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Cols: [0]=custId [1]=custName [2]=city [3]=address [4]=lng [5]=lat
  const clients = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const lat = parseFloat(r[5]) || 0;
    const lng = parseFloat(r[4]) || 0;
    // Keep name as-is (Power BI export already has RTL marks)
    clients.push({
      custId:   String(r[0]),
      custName: String(r[1] || ''),
      city:     String(r[2] || ''),
      address:  String(r[3] || ''),
      existingLat: lat,
      existingLng: lng,
      needsGeo: !isValidIL(lat, lng),
    });
  }
  return clients;
}

// ── Read clients from SQL ────────────────────────────────────────────────────
async function readFromSQL() {
  const pool = await sql.connect({
    server:   process.env.DB_SERVER,
    port:     parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options:  { encrypt: false, trustServerCertificate: true },
  });
  console.log('✅ Connected to Priority DB');

  const result = await pool.request().query(`
    SELECT
      c.CUSTNAME   AS custId,
      REVERSE(c.CUSTDES) AS custName,
      c.STATE      AS city,
      c.ADDRESS    AS address
    FROM CUSTOMERS c
    INNER JOIN CUSTSTATS cs ON c.CUSTSTAT = cs.CUSTSTAT
    WHERE cs.STATDES = N'פעיל'
    AND (
      c.GPSX IS NULL OR c.GPSX = '' OR c.GPSX = '0'
      OR c.GPSY IS NULL OR c.GPSY = '' OR c.GPSY = '0'
      OR TRY_CAST(c.GPSX AS float) IS NULL
      OR TRY_CAST(c.GPSX AS float) < 29.3
      OR TRY_CAST(c.GPSX AS float) > 33.5
    )
    ORDER BY c.STATE, c.CUSTNAME
  `);
  sql.close();

  return result.recordset.map(c => ({
    custId:      c.custId,
    custName:    c.custName,
    city:        c.city,
    address:     c.address,
    existingLat: 0,
    existingLng: 0,
    needsGeo:    true,
  }));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const provider = AZURE_KEY ? '☁️  Azure Maps' : '🌍 Nominatim';
  console.log(`\n🗺  Geocode Batch — source: ${SOURCE.toUpperCase()} | provider: ${provider}`);
  console.log(`🔢  Fix house numbers: ${FIX_NUMBERS ? 'YES' : 'NO'}\n`);

  let allClients;
  if (SOURCE === 'excel') {
    const xlFile = path.resolve(__dirname, '..', 'EXEL COORDINATES.xlsx');
    console.log(`📂 Reading: ${xlFile}`);
    allClients = readFromExcel(xlFile);
  } else {
    allClients = await readFromSQL();
  }

  const toGeocode = allClients.filter(c => c.needsGeo);
  const alreadyGood = allClients.filter(c => !c.needsGeo);
  console.log(`📋 Total clients: ${allClients.length}`);
  console.log(`✅ Already have valid GPS: ${alreadyGood.length}`);
  console.log(`📍 Need geocoding: ${toGeocode.length}`);
  if (AZURE_KEY) console.log(`   Azure Maps — ~${Math.ceil(toGeocode.length / 1000 * 0.5).toFixed(2)}$ (free up to 5000/month)`);
  console.log();

  const rows = [];
  const importRows = []; // clean import sheet for office
  let success = 0, failed = 0, skipped = 0;

  for (let i = 0; i < toGeocode.length; i++) {
    const c = toGeocode[i];
    const raw = c.address;
    const fixed = FIX_NUMBERS ? fixAddress(raw) : raw;
    const cleaned = cleanAddress(fixed, c.city);
    const progress = `[${i+1}/${toGeocode.length}]`;

    if (!cleaned) {
      console.log(`${progress} ⏭  SKIP  ${c.custId} | ${raw || '—'}`);
      rows.push(makeRow(c, raw, fixed, cleaned, '', '', '', '', 'לא ניתן לגיאוקוד', c.existingLat || '', c.existingLng || ''));
      skipped++;
      continue;
    }

    const geo = await geocode(cleaned, c.city);
    await sleep(AZURE_KEY ? 150 : 1100);

    if (geo) {
      const inCity = cityMatches(c.city, geo.nominatimCity);
      const foundCity = [
        geo.nominatimCity?.city,
        geo.nominatimCity?.town,
        geo.nominatimCity?.village,
      ].filter(Boolean)[0] || '';
      const status = inCity ? '✅ נמצא' : `❗ עיר לא תואמת (נמצא: ${foundCity})`;
      const icon = inCity ? '✅' : '❗';
      console.log(`${progress} ${icon} ${c.custId} | ${cleaned}, ${c.city} → ${geo.lat}, ${geo.lng}${!inCity ? ` ⚠️ ${foundCity}` : ''}`);
      rows.push(makeRow(c, raw, fixed, cleaned, geo.lat, geo.lng, foundCity, geo.displayName, status, c.existingLat || '', c.existingLng || ''));
      if (inCity) importRows.push({ 'מס. לקוח': c.custId, 'קו רוחב': geo.lat, 'קו אורך': geo.lng });
      success++;
    } else {
      console.log(`${progress} ❌ ${c.custId} | ${cleaned}, ${c.city}`);
      rows.push(makeRow(c, raw, fixed, cleaned, '', '', '', '', '❌ לא נמצא', c.existingLat || '', c.existingLng || ''));
      failed++;
    }
  }

  // Add already-valid clients to results and import sheet
  for (const c of alreadyGood) {
    rows.push(makeRow(c, c.address, c.address, '', c.existingLat, c.existingLng, '', '', '✅ קיים במקור', c.existingLat, c.existingLng));
    importRows.push({ 'מס. לקוח': c.custId, 'קו רוחב': c.existingLat, 'קו אורך': c.existingLng });
  }

  // Write output Excel
  const outFile = path.join(__dirname, `gps-batch-${new Date().toISOString().slice(0,10)}.xlsx`);
  const wb = XLSX.utils.book_new();

  // Sheet 1: full results (all 7239)
  const ws1 = XLSX.utils.json_to_sheet(rows);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 30 }, { wch: 16 }, { wch: 35 },
    { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 18 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'GPS Results');

  // Sheet 2: import-ready (all with best GPS — for Priority import)
  const ws2 = XLSX.utils.json_to_sheet(importRows);
  ws2['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'לייבוא לפריוריטי');

  XLSX.writeFile(wb, outFile);

  const pct = ((success / toGeocode.length) * 100).toFixed(1);
  console.log(`\n📊 Done: ✅ ${success} found (${pct}%) | ❌ ${failed} not found | ⏭ ${skipped} skipped`);
  console.log(`📁 Total in output: ${rows.length} clients (${alreadyGood.length} existing + ${success} new)`);
  console.log(`📁 Import-ready rows: ${importRows.length}`);
  console.log(`📁 Excel saved: ${outFile}`);
}

function makeRow(c, raw, fixed, cleaned, lat, lng, foundCity, displayName, status, origLat, origLng) {
  return {
    'מס. לקוח':           c.custId,
    'שם לקוח':            c.custName,
    'עיר':                c.city,
    'כתובת מקורית':      raw,
    'כתובת לחיפוש':      cleaned || '',
    'קו רוחב חדש':       lat,
    'קו אורך חדש':       lng,
    'קו רוחב מקורי':     origLat != null ? origLat : (c.existingLat || ''),
    'קו אורך מקורי':     origLng != null ? origLng : (c.existingLng || ''),
    'עיר שנמצאה':         foundCity,
    'סטטוס':              status,
  };
}

main().catch(console.error);
