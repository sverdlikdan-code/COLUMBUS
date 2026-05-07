// Post-processor: merges geocode batch results with original Excel
// Run: node gps-merge.js

const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

// ── Smart city comparison ─────────────────────────────────────────────────────
// Normalizes both city names and determines if they refer to the same place
function normalizeCity(city) {
  if (!city) return '';
  return city
    .replace(/^ה/, '')                     // remove ה prefix
    .replace(/\s*-\s*יפו$/i, '')          // תל אביב-יפו → תל אביב
    .replace(/\s*-\s*/g, ' ')             // hyphen → space
    .replace(/קריית/g, 'קרית')            // קריית → קרית
    .replace(/['"״]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function compareCities(dbCity, foundCity) {
  const a = normalizeCity(dbCity);
  const b = normalizeCity(foundCity);
  if (!a || !b) return 'unknown';
  if (a === b || a.includes(b) || b.includes(a)) return 'match';
  return 'wrong';
}

// ── Find files ────────────────────────────────────────────────────────────────
const serverDir = __dirname;
const batchFiles = fs.readdirSync(serverDir)
  .filter(f => f.match(/^gps-batch-\d{4}-\d{2}-\d{2}\.xlsx$/))
  .sort().reverse();

if (batchFiles.length === 0) { console.error('❌ No gps-batch-*.xlsx found'); process.exit(1); }

const batchFile = path.join(serverDir, batchFiles[0]);
const inputFile = path.resolve(serverDir, '..', 'EXEL COORDINATES.xlsx');
console.log(`📂 Batch: ${batchFiles[0]}`);
console.log(`📂 Input: EXEL COORDINATES.xlsx\n`);

// ── Load batch results ────────────────────────────────────────────────────────
const batchWb   = XLSX.readFile(batchFile);
const batchRows = XLSX.utils.sheet_to_json(batchWb.Sheets[batchWb.SheetNames[0]]);
const batchMap  = new Map();
for (const r of batchRows) {
  const id = String(r['מס. לקוח'] || '').trim();
  if (id) batchMap.set(id, r);
}
console.log(`📋 Batch rows: ${batchMap.size}`);

// ── Load original input ───────────────────────────────────────────────────────
const inputWb   = XLSX.readFile(inputFile);
const inputWs   = inputWb.Sheets[inputWb.SheetNames[0]];
const inputRows = XLSX.utils.sheet_to_json(inputWs, { header: 1 });
// Cols: [0]=custId [1]=custName [2]=city [3]=address [4]=lng [5]=lat

// ── Process ───────────────────────────────────────────────────────────────────
const allRows   = [];
const importRows = [];
let cntExisting = 0, cntNew = 0, cntSpelling = 0, cntWrong = 0, cntNotFound = 0;

for (let i = 1; i < inputRows.length; i++) {
  const r = inputRows[i];
  if (!r[0]) continue;

  const custId   = String(r[0]);
  const custName = String(r[1] || '');
  const city     = String(r[2] || '').trim();
  const addrRaw  = String(r[3] || '').trim();
  const origLng  = parseFloat(r[4]) || 0;
  const origLat  = parseFloat(r[5]) || 0;
  const hadGps   = isValidIL(origLat, origLng);

  let newLat = '', newLng = '', status = '', foundCity = '', addrClean = '', improved = '';

  if (hadGps) {
    // Already had valid GPS — keep as-is
    newLat    = origLat;
    newLng    = origLng;
    status    = '✅ קיים במקור';
    addrClean = addrRaw;
    improved  = '—';
    cntExisting++;
    importRows.push({ 'מס. לקוח': custId, 'קו רוחב': origLat, 'קו אורך': origLng });

  } else {
    const b = batchMap.get(custId);
    if (b) {
      // ── Use the address that was ACTUALLY sent to geocoder ──
      addrClean = String(b['כתובת לחיפוש'] || b['כתובת אחרי תיקון'] || addrRaw);

      const bLat = parseFloat(b['קו רוחב']) || 0;
      const bLng = parseFloat(b['קו אורך']) || 0;
      foundCity  = String(b['עיר שנמצאה'] || '');

      if (isValidIL(bLat, bLng)) {
        newLat = bLat;
        newLng = bLng;

        const cityResult = compareCities(city, foundCity);

        if (cityResult === 'match') {
          // City confirmed — green light
          status   = '✅ נמצא';
          improved = 'כן';
          cntNew++;
          importRows.push({ 'מס. לקוח': custId, 'קו רוחב': bLat, 'קו אורך': bLng });

        } else if (cityResult === 'wrong') {
          // GPS found but points to a DIFFERENT city — reject
          status   = `❌ עיר שגויה (נמצא: ${foundCity})`;
          improved = 'שגוי';
          cntWrong++;
          // NOT added to importRows

        } else {
          // foundCity empty or unknown — include with caution
          status   = '⚠️ עיר לא ידועה';
          improved = 'אולי';
          cntSpelling++;
        }

      } else {
        // No valid GPS returned
        addrClean = String(b['כתובת לחיפוש'] || addrRaw);
        status    = String(b['סטטוס'] || '❌ לא נמצא');
        improved  = 'לא';
        cntNotFound++;
      }

    } else {
      // Not in batch at all (was skipped — empty/ungeocodable address)
      addrClean = addrRaw;
      status    = '⏭ כתובת ריקה';
      improved  = 'לא';
      cntNotFound++;
    }
  }

  allRows.push({
    'מס. לקוח':           custId,
    'שם לקוח':            custName,
    'עיר':                city,
    'כתובת מקורית':      addrRaw,
    'כתובת לחיפוש':      addrClean,
    'מצאתי יותר מדויק':  improved,
    'קו רוחב חדש':       newLat,
    'קו אורך חדש':       newLng,
    'קו רוחב מקורי':     origLat || '',
    'קו אורך מקורי':     origLng || '',
    'עיר שנמצאה':         foundCity,
    'סטטוס':              status,
  });
}

// ── Write Excel ───────────────────────────────────────────────────────────────
const outFile = path.join(serverDir, `gps-complete-${new Date().toISOString().slice(0,10)}.xlsx`);
const wb = XLSX.utils.book_new();

const ws1 = XLSX.utils.json_to_sheet(allRows);
ws1['!cols'] = [
  { wch: 12 }, { wch: 32 }, { wch: 16 }, { wch: 38 },
  { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
  { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 32 },
];
XLSX.utils.book_append_sheet(wb, ws1, 'כל הלקוחות');

const ws2 = XLSX.utils.json_to_sheet(importRows);
ws2['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }];
XLSX.utils.book_append_sheet(wb, ws2, 'לייבוא לפריוריטי');

XLSX.writeFile(wb, outFile);

// ── Report ────────────────────────────────────────────────────────────────────
const total = cntNew + cntSpelling + cntWrong + cntNotFound;
console.log(`\n📊 דוח סופי (${allRows.length} לקוחות):`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  — קיים במקור (GPS תקין):            ${cntExisting}`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  מתוך ${total} שניסינו לגאוקד:`);
console.log(`  כן    ✅ נמצא + עיר מאושרת:         ${cntNew}  (${(cntNew/total*100).toFixed(1)}%)`);
console.log(`  אולי  ⚠️  נמצא, עיר לא ברורה:      ${cntSpelling}`);
console.log(`  שגוי  ❌ נמצא אבל עיר אחרת לגמרי: ${cntWrong}  (${(cntWrong/total*100).toFixed(1)}%)`);
console.log(`  לא    ❌ לא נמצא / ריק:             ${cntNotFound}  (${(cntNotFound/total*100).toFixed(1)}%)`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  📁 לייבוא לפריוריטי (כן + קיים):   ${importRows.length}`);
console.log(`\n📁 Excel: ${outFile}`);
