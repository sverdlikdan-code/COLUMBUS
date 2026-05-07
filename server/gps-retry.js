// Re-geocodes only "שגוי" + "לא" rows with fixAddress applied correctly
// Run: node gps-retry.js

require('dotenv').config({ path: '../.env' });
const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
const AZURE_KEY = process.env.AZURE_MAPS_KEY || '';

function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── House number reversal ─────────────────────────────────────────────────────
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

// ── Address cleaner ───────────────────────────────────────────────────────────
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

// ── City comparison ───────────────────────────────────────────────────────────
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

// ── Geocode ───────────────────────────────────────────────────────────────────
const cache = new Map();
async function geocode(address, city) {
  const q = [address, city, 'ישראל'].filter(Boolean).join(', ');
  if (cache.has(q)) return cache.get(q);
  try {
    const url = `https://atlas.microsoft.com/search/address/json?api-version=1.0&query=${encodeURIComponent(q)}&subscription-key=${AZURE_KEY}&language=he-IL&countrySet=IL&limit=1`;
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!AZURE_KEY) { console.error('❌ AZURE_MAPS_KEY missing in .env'); process.exit(1); }

  // Load complete Excel
  const serverDir  = __dirname;
  const completeFiles = fs.readdirSync(serverDir)
    .filter(f => f.match(/^gps-complete-\d{4}-\d{2}-\d{2}\.xlsx$/))
    .sort().reverse();
  if (!completeFiles.length) { console.error('❌ No gps-complete-*.xlsx found'); process.exit(1); }

  const completeFile = path.join(serverDir, completeFiles[0]);
  const inputFile    = path.resolve(serverDir, '..', 'EXEL COORDINATES.xlsx');
  console.log(`📂 Complete: ${completeFiles[0]}`);

  const wb       = XLSX.readFile(completeFile);
  const ws       = wb.Sheets['כל הלקוחות'];
  const allRows  = XLSX.utils.sheet_to_json(ws);

  // Load original addresses (for fixAddress on raw data)
  const inWb    = XLSX.readFile(inputFile);
  const inWs    = inWb.Sheets[inWb.SheetNames[0]];
  const inRows  = XLSX.utils.sheet_to_json(inWs, { header: 1 });
  const origMap = new Map();
  for (let i = 1; i < inRows.length; i++) {
    const r = inRows[i];
    if (r[0]) origMap.set(String(r[0]), String(r[3] || '').trim()); // custId → raw address
  }

  // Find rows that need retry
  const toRetry = allRows.filter(r => {
    const imp = String(r['מצאתי יותר מדויק'] || '');
    return imp === 'שגוי' || imp === 'לא';
  });

  console.log(`🔄 Rows to retry: ${toRetry.length} (שגוי: ${toRetry.filter(r=>r['מצאתי יותר מדויק']==='שגוי').length} | לא: ${toRetry.filter(r=>r['מצאתי יותר מדויק']==='לא').length})`);
  console.log(`☁️  Azure Maps — all within free tier\n`);

  let improved = 0, stillWrong = 0, stillNotFound = 0;
  const importRows = [];

  // Build current import list (existing + already-good)
  const importMap = new Map();
  for (const r of allRows) {
    const id  = String(r['מס. לקוח'] || '');
    const imp = String(r['מצאתי יותר מדויק'] || '');
    if (imp === 'כן' || imp === '—') {
      importMap.set(id, { lat: r['קו רוחב חדש'] || r['קו רוחב מקורי'], lng: r['קו אורך חדש'] || r['קו אורך מקורי'] });
    }
  }

  for (let i = 0; i < toRetry.length; i++) {
    const row    = toRetry[i];
    const custId = String(row['מס. לקוח'] || '');
    const city   = String(row['עיר'] || '').trim();
    const rawAddr = origMap.get(custId) || String(row['כתובת מקורית'] || '');
    const progress = `[${i+1}/${toRetry.length}]`;

    // Apply full pipeline: fixAddress → cleanAddress
    const fixed   = fixAddress(rawAddr);
    const cleaned = cleanAddress(fixed, city);

    if (!cleaned) {
      console.log(`${progress} ⏭  SKIP  ${custId} | ${rawAddr || '—'}`);
      // Update row
      const idx = allRows.findIndex(r => String(r['מס. לקוח']) === custId);
      if (idx >= 0) { allRows[idx]['מצאתי יותר מדויק'] = 'לא'; allRows[idx]['סטטוס'] = '⏭ כתובת ריקה'; }
      stillNotFound++;
      continue;
    }

    const geo = await geocode(cleaned, city);
    await sleep(150);

    const idx = allRows.findIndex(r => String(r['מס. לקוח']) === custId);

    if (geo) {
      const cityResult  = compareCities(city, geo.city);
      const icon        = cityResult === 'match' ? '✅' : '❗';
      console.log(`${progress} ${icon} ${custId} | ${cleaned} → ${geo.lat}, ${geo.lng}${cityResult !== 'match' ? ` ⚠️ ${geo.city}` : ''}`);

      if (idx >= 0) {
        allRows[idx]['כתובת לחיפוש'] = cleaned;
        allRows[idx]['קו רוחב חדש']  = geo.lat;
        allRows[idx]['קו אורך חדש']  = geo.lng;
        allRows[idx]['עיר שנמצאה']   = geo.city;
      }

      if (cityResult === 'match') {
        if (idx >= 0) { allRows[idx]['מצאתי יותר מדויק'] = 'כן'; allRows[idx]['סטטוס'] = '✅ נמצא'; }
        importMap.set(custId, { lat: geo.lat, lng: geo.lng });
        improved++;
      } else if (cityResult === 'wrong') {
        if (idx >= 0) { allRows[idx]['מצאתי יותר מדויק'] = 'שגוי'; allRows[idx]['סטטוס'] = `❌ עיר שגויה (נמצא: ${geo.city})`; }
        stillWrong++;
      } else {
        if (idx >= 0) { allRows[idx]['מצאתי יותר מדויק'] = 'אולי'; allRows[idx]['סטטוס'] = '⚠️ עיר לא ידועה'; }
        importMap.set(custId, { lat: geo.lat, lng: geo.lng });
        improved++;
      }
    } else {
      console.log(`${progress} ❌ ${custId} | ${cleaned}, ${city}`);
      if (idx >= 0) { allRows[idx]['מצאתי יותר מדויק'] = 'לא'; allRows[idx]['סטטוס'] = '❌ לא נמצא'; }
      stillNotFound++;
    }
  }

  // Rebuild import sheet from importMap
  for (const [id, coords] of importMap) {
    importRows.push({ 'מס. לקוח': id, 'קו רוחב': coords.lat, 'קו אורך': coords.lng });
  }

  // Write updated Excel
  const outFile = path.join(serverDir, `gps-final-${new Date().toISOString().slice(0,10)}.xlsx`);
  const wbOut = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(allRows);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 38 },
    { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wbOut, ws1, 'כל הלקוחות');

  const ws2 = XLSX.utils.json_to_sheet(importRows);
  ws2['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wbOut, ws2, 'לייבוא לפריוריטי');

  XLSX.writeFile(wbOut, outFile);

  console.log(`\n📊 Retry results:`);
  console.log(`  ✅ Newly fixed:      ${improved}`);
  console.log(`  ❌ Still wrong city: ${stillWrong}`);
  console.log(`  ❌ Still not found:  ${stillNotFound}`);
  console.log(`  📁 Total for import: ${importRows.length}`);
  console.log(`\n📁 Updated Excel: ${outFile}`);
}

main().catch(console.error);
