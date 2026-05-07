// Fix 62 addresses where house number was in the middle (not reversed by fixAddress)
// Run: node gps-fix62.js

require('dotenv').config({ path: '../.env' });
const XLSX = require('xlsx');
const path = require('path');

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
const AZURE_KEY = process.env.AZURE_MAPS_KEY || '';

function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── Reverse number (same logic as original fixAddress) ─────────────────────
function reversePart(s) {
  const t = s.trim();
  if (t.length >= 2 && /^\d+$/.test(t)) return t.split('').reverse().join('');
  return t;
}

// Fix address where number is in the MIDDLE (not just at end)
function fixNumberInMiddle(address) {
  // Match: text + number + space + more text
  const m = address.match(/^(.*?\D)\s+(\d[\d\/]*)\s+(.+)$/);
  if (!m) return null; // no number in middle
  const num = m[2].split('/').map(reversePart).join('/');
  if (num === m[2]) return null; // number same after reversal (e.g. 11, 22)
  // Return just street + reversed number (strip the junk after)
  return `${m[1].trim()} ${num}`;
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
const cache = new Map();
async function geocode(address, city, cityCoords) {
  const q = [address, city, 'ישראל'].filter(Boolean).join(', ');
  if (cache.has(q)) return cache.get(q);
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
        cache.set(q, result);
        return result;
      }
    }
  } catch (_) {}
  cache.set(q, null);
  return null;
}

// Pre-geocode a city for anchor
async function geocodeCity(city) {
  if (!city) return null;
  const q = `${city}, ישראל`;
  try {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(q)}&subscription-key=${AZURE_KEY}&language=he-IL&countrySet=IL&limit=1`;
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
  if (!ws) { console.error('❌ No FINAL sheet'); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(ws);
  const ws2 = wb.Sheets['לייבוא לפריוריטי'];
  const importRows = XLSX.utils.sheet_to_json(ws2);
  const importMap = new Map(importRows.map(r => [String(r['מס. לקוח']), r]));

  // Find the 62 — addresses with number in middle that wasn't reversed
  const toFix = [];
  for (const r of rows) {
    const orig = String(r['כתובת מקורית'] || '').trim();
    const imp = String(r['מצאתי יותר מדויק'] || '');
    if (imp === '—') continue; // already had GPS
    const fixed = fixNumberInMiddle(orig);
    if (fixed) toFix.push({ row: r, newAddr: fixed });
  }

  console.log(`🔧 Addresses to fix: ${toFix.length}`);
  console.log(`☁️  Azure Maps geocode\n`);

  // Pre-geocode unique cities
  const cities = [...new Set(toFix.map(x => String(x.row['עיר'] || '').trim()).filter(Boolean))];
  const cityCache = new Map();
  console.log(`🏙️  Pre-geocoding ${cities.length} cities...`);
  for (const city of cities) {
    const coords = await geocodeCity(city);
    cityCache.set(city, coords);
    await sleep(120);
  }

  let improved = 0, stillBad = 0;

  for (let i = 0; i < toFix.length; i++) {
    const { row, newAddr } = toFix[i];
    const custId = String(row['מס. לקוח'] || '');
    const city = String(row['עיר'] || '').trim();
    const cityCoords = cityCache.get(city) || null;
    const progress = `[${i+1}/${toFix.length}]`;

    const geo = await geocode(newAddr, city, cityCoords);
    await sleep(150);

    const idx = rows.findIndex(r => String(r['מס. לקוח']) === custId);

    if (geo) {
      const cityResult = compareCities(city, geo.city);
      const icon = cityResult === 'match' ? '✅' : '❗';
      console.log(`${progress} ${icon} ${custId} | ${newAddr} → ${geo.lat}, ${geo.lng}${cityResult !== 'match' ? ` (${geo.city})` : ''}`);

      if (idx >= 0) {
        rows[idx]['כתובת לחיפוש'] = newAddr;
        rows[idx]['קו רוחב חדש'] = geo.lat;
        rows[idx]['קו אורך חדש'] = geo.lng;
        rows[idx]['עיר שנמצאה'] = geo.city;
      }

      if (cityResult === 'match') {
        if (idx >= 0) { rows[idx]['מצאתי יותר מדויק'] = 'כן'; rows[idx]['סטטוס'] = '✅ נמצא (fix62)'; }
        importMap.set(custId, { 'מס. לקוח': custId, 'קו רוחב': geo.lat, 'קו אורך': geo.lng });
        improved++;
      } else if (cityResult === 'wrong') {
        if (idx >= 0) { rows[idx]['מצאתי יותר מדויק'] = 'שגוי'; rows[idx]['סטטוס'] = `❌ עיר שגויה (${geo.city})`; }
        stillBad++;
      } else {
        if (idx >= 0) { rows[idx]['מצאתי יותר מדויק'] = 'אולי'; rows[idx]['סטטוס'] = '⚠️ עיר לא ידועה (fix62)'; }
        importMap.set(custId, { 'מס. לקוח': custId, 'קו רוחב': geo.lat, 'קו אורך': geo.lng });
        improved++;
      }
    } else {
      console.log(`${progress} ❌ ${custId} | ${newAddr}, ${city}`);
      if (idx >= 0) { rows[idx]['מצאתי יותר מדויק'] = 'לא'; rows[idx]['סטטוס'] = '❌ לא נמצא (fix62)'; }
      stillBad++;
    }
  }

  // Write back FINAL sheet
  const wsNew = XLSX.utils.json_to_sheet(rows);
  wsNew['!cols'] = [
    { wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 38 },
    { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 32 },
  ];

  // Write back לייבוא לפריוריטי sheet
  const importArr = [...importMap.values()];
  const wsImport = XLSX.utils.json_to_sheet(importArr);
  wsImport['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }];

  // Replace sheets
  ['FINAL', 'לייבוא לפריוריטי'].forEach(name => {
    const idx = wb.SheetNames.indexOf(name);
    if (idx >= 0) { wb.SheetNames.splice(idx, 1); delete wb.Sheets[name]; }
  });
  XLSX.utils.book_append_sheet(wb, wsNew, 'FINAL');
  XLSX.utils.book_append_sheet(wb, wsImport, 'לייבוא לפריוריטי');
  XLSX.writeFile(wb, outFile);

  console.log(`\n📊 Fix62 results:`);
  console.log(`  ✅ Newly fixed: ${improved}`);
  console.log(`  ❌ Still bad:   ${stillBad}`);
  console.log(`  📁 Import rows: ${importArr.length}`);
  console.log(`\n✅ Saved to EXEL COORDINATES.xlsx`);
}

main().catch(console.error);
