// Re-geocode the 2,901 clients that already had GPS in Priority
// Logic: if Azure finds better address-level match → upgrade; else keep original
// Run: node gps-recheck-existing.js

require('dotenv').config({ path: '../.env' });
const XLSX = require('xlsx');
const path = require('path');

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
const AZURE_KEY = process.env.AZURE_MAPS_KEY || '';

function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── Address pipeline (same as gps-full-rerun) ──────────────────────────────
function reversePart(s) {
  const t = s.trim();
  if (t.length >= 2 && /^\d+$/.test(t)) return t.split('').reverse().join('');
  return t;
}
function fixAddress(address) {
  if (!address) return address;
  const m = address.match(/^(.*\D)\s+(\d[\d\/]*)(\s*)$/);
  if (!m) return address;
  const num = m[2].split('/').map(reversePart).join('/');
  return `${m[1].trim()} ${num}`;
}
function fixNumberInMiddle(address) {
  const m = address.match(/^(.*?\D)\s+(\d[\d\/]*)\s+(.+)$/);
  if (!m) return null;
  const num = m[2].split('/').map(reversePart).join('/');
  if (num === m[2]) return null;
  return `${m[1].trim()} ${num}`;
}
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
  a = a.replace(/,/g, ' ').replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  return a.length >= 3 ? a : null;
}
function prepareAddress(raw, city) {
  const fixed = fixNumberInMiddle(raw) || fixAddress(raw) || raw;
  return cleanAddress(fixed, city);
}

// ── City comparison ────────────────────────────────────────────────────────
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

// ── Geocode ────────────────────────────────────────────────────────────────
const geoCache = new Map();
async function geocode(address, city, cityCoords) {
  const q = [address, city, 'ישראל'].filter(Boolean).join(', ');
  if (geoCache.has(q)) return geoCache.get(q);
  try {
    let url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(q)}&subscription-key=${AZURE_KEY}&language=he-IL&countrySet=IL&limit=1`;
    if (cityCoords) url += `&lat=${cityCoords.lat}&lon=${cityCoords.lng}&radius=20000`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.results?.[0]) {
      const res = d.results[0];
      const lat = res.position.lat, lng = res.position.lon;
      if (isValidIL(lat, lng)) {
        const a = res.address || {};
        const result = { lat, lng, city: a.municipality || a.localName || '', display: a.freeformAddress || '' };
        geoCache.set(q, result);
        return result;
      }
    }
  } catch (_) {}
  geoCache.set(q, null);
  return null;
}
async function geocodeCity(city) {
  if (!city) return null;
  try {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(city + ', ישראל')}&subscription-key=${AZURE_KEY}&language=he-IL&countrySet=IL&limit=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.results?.[0]) {
      const { lat, lon } = d.results[0].position;
      if (isValidIL(lat, lon)) return { lat, lng: lon };
    }
  } catch (_) {}
  return null;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  if (!AZURE_KEY) { console.error('❌ AZURE_MAPS_KEY missing'); process.exit(1); }

  const outFile = path.resolve(__dirname, '..', 'EXEL COORDINATES.xlsx');
  const wb = XLSX.readFile(outFile);
  const ws = wb.Sheets['FINAL'];
  const rows = XLSX.utils.sheet_to_json(ws);

  // Only "—" rows (had GPS already)
  const toCheck = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => String(r['מצאתי יותר מדויק'] || '') === '—');

  console.log(`🔍 Клиентов для перепроверки: ${toCheck.length}`);
  console.log(`☁️  Azure Maps — ~$1.40\n`);

  // Pre-geocode unique cities
  const cities = [...new Set(toCheck.map(({ r }) => String(r['עיר'] || '').trim()).filter(Boolean))];
  const cityCache = new Map();
  console.log(`🏙️  Pre-geocoding ${cities.length} городов...`);
  for (const city of cities) {
    cityCache.set(city, await geocodeCity(city));
    await sleep(120);
  }
  console.log(`✅ Города готовы\n`);

  let upgraded = 0, keptOriginal = 0, noAddress = 0;

  for (let i = 0; i < toCheck.length; i++) {
    const { r, i: idx } = toCheck[i];
    const custId  = String(r['מס. לקוח'] || '');
    const city    = String(r['עיר'] || '').trim();
    const rawAddr = String(r['כתובת מקורית'] || '').trim();
    const origLat = parseFloat(r['קו רוחב מקורי']) || 0;
    const origLng = parseFloat(r['קו אורך מקורי']) || 0;
    const progress = `[${i+1}/${toCheck.length}]`;

    const cleaned = prepareAddress(rawAddr, city);
    if (!cleaned) {
      if (i % 100 === 0) console.log(`${progress} ⏭  ${custId} | нет адреса — оставляем оригинал`);
      noAddress++;
      continue;
    }

    const cityCoords = cityCache.get(city) || null;
    const geo = await geocode(cleaned, city, cityCoords);
    await sleep(150);

    if (geo && compareCities(city, geo.city) === 'match') {
      // Azure found a confirmed address-level match → upgrade
      rows[idx]['כתובת לחיפוש'] = cleaned;
      rows[idx]['קו רוחב']      = geo.lat;
      rows[idx]['קו אורך']      = geo.lng;
      rows[idx]['עיר שנמצאה']  = geo.city;
      rows[idx]['מצאתי יותר מדויק'] = 'כן';
      rows[idx]['סטטוס']        = '✅ שודרג';
      if (i % 50 === 0) console.log(`${progress} ⬆️  ${custId} | ${cleaned} → ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`);
      upgraded++;
    } else {
      // Keep original GPS — Azure didn't improve
      rows[idx]['כתובת לחיפוש'] = cleaned || rawAddr;
      rows[idx]['קו רוחב']      = origLat;
      rows[idx]['קו אורך']      = origLng;
      rows[idx]['סטטוס']        = geo ? `⚠️ שמור מקורי (נמצא: ${geo.city})` : '⚠️ שמור מקורי (לא נמצא)';
      if (i % 100 === 0) console.log(`${progress} 📌 ${custId} | оставляем оригинал`);
      keptOriginal++;
    }
  }

  // Rebuild לייבוא לפריוריטי
  const importFull = [];
  for (const r of rows) {
    const imp = String(r['מצאתי יותר מדויק'] || '');
    if (imp !== 'כן' && imp !== '—' && imp !== 'אולי') continue;
    let lat = imp === '—' ? r['קו רוחב מקורי'] : r['קו רוחב'];
    let lng = imp === '—' ? r['קו אורך מקורי'] : r['קו אורך'];
    importFull.push({
      'מס. לקוח':   String(r['מס. לקוח'] || ''),
      'שם לקוח':    String(r['שם לקוח'] || ''),
      'עיר':        String(r['עיר'] || ''),
      'כתובת':      String(r['כתובת לחיפוש'] || r['כתובת מקורית'] || ''),
      'קו רוחב':    lat || '',
      'קו אורך':    lng || '',
      'מצב':        imp === '—' ? 'קיים' : imp === 'כן' ? 'חדש' : 'אולי',
      'עיר שנמצאה': String(r['עיר שנמצאה'] || ''),
    });
  }

  // Write sheets
  const wsNew = XLSX.utils.json_to_sheet(rows);
  wsNew['!cols'] = [
    { wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 38 },
    { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 32 },
  ];
  const wsImp = XLSX.utils.json_to_sheet(importFull);
  wsImp['!cols'] = [
    { wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 38 },
    { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 18 },
  ];

  ['FINAL', 'לייבוא לפריוריטי'].forEach(name => {
    const i = wb.SheetNames.indexOf(name);
    if (i >= 0) { wb.SheetNames.splice(i, 1); delete wb.Sheets[name]; }
  });
  XLSX.utils.book_append_sheet(wb, wsNew, 'FINAL');
  XLSX.utils.book_append_sheet(wb, wsImp, 'לייבוא לפריוריטי');
  XLSX.writeFile(wb, outFile);

  console.log(`\n📊 Результат перепроверки:`);
  console.log(`  ⬆️  Улучшено (адресный GPS):  ${upgraded}`);
  console.log(`  📌 Оставлен оригинал:         ${keptOriginal}`);
  console.log(`  ⏭  Без адреса:                ${noAddress}`);
  console.log(`  📁 Итого в לייבוא:            ${importFull.length}`);
  console.log(`\n✅ Сохранено в EXEL COORDINATES.xlsx`);
}

main().catch(console.error);
