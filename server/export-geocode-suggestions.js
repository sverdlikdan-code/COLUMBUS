/**
 * export-geocode-suggestions.js — для адресов с уровнем SUSPECT прогоняем
 * LocationIQ Geocoding API и предлагаем уточнённые координаты. GARBAGE не
 * геокодируем автоматически (слишком велик риск ложной точки) — помечаем
 * для ручной проверки.
 * Источник: formiice-comparison-<date>.xlsx (уже содержит garbageLevel).
 * Запуск: node server/export-geocode-suggestions.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const ExcelJS = require('exceljs');
const { stripAfterHouseNumber, cleanAddress } = require('./geocoder');

const LOCATIONIQ_KEY = process.env.LOCATIONIQ_KEY || '';

// r.address already went through fixBiDi() upstream (digits already in
// logical order) — only strip trailing junk after the house number
// ("מרכז מסחרי", "קומה 2", neighborhood names...), don't touch digit order.
function cleanForGeocode(address, city) {
  const stripped = stripAfterHouseNumber(address || '');
  return cleanAddress(stripped, city) || address;
}

const IL = { minLat: 29.3, maxLat: 33.5, minLng: 34.2, maxLng: 35.9 };
function isValidIL(lat, lng) {
  return lat && lng && lat >= IL.minLat && lat <= IL.maxLat && lng >= IL.minLng && lng <= IL.maxLng;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Structured query (street/city/country as separate fields) forces LocationIQ
// to filter by city instead of free-text-matching a street name anywhere in
// the country — fixes the wrong-city collisions seen with a single "q=" string.
async function geocodeLocationIQ(street, city) {
  if (!LOCATIONIQ_KEY) return null;
  try {
    const url = `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_KEY}&street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}&country=Israel&format=json&limit=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (resp.status === 429) { await new Promise(res => setTimeout(res, 1200)); return geocodeLocationIQ(street, city); }
    const data = await resp.json();
    const r = Array.isArray(data) ? data[0] : null;
    if (!r) return null;
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), formatted: r.display_name || '', locationType: r.type || r.class || '' };
  } catch (_) { return null; }
}

const today = new Date().toISOString().slice(0, 10);
const inPath = `C:\\Users\\d.sverdlik\\Desktop\\formiice-comparison-${today}.xlsx`;

async function main() {
  console.log(`Reading: ${inPath}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inPath);
  const wsIn = wb.worksheets[0];

  const rows = [];
  wsIn.eachRow((row, idx) => {
    if (idx === 1) return;
    const v = row.values;
    rows.push({
      custId: String(v[1] ?? ''),
      custName: v[2] ?? '',
      city: v[3] ?? '',
      address: v[4] ?? '',
      pbiLat: v[5] ?? null,
      pbiLng: v[6] ?? null,
      iceLat: v[9] ?? null,
      iceLng: v[10] ?? null,
      status: v[11] ?? '',
      garbageLevel: v[12] ?? '',
      garbageScore: v[13] ?? '',
      garbageWhy: v[14] ?? '',
      agentCode: v[15] ?? '',
      agentName: v[16] ?? '',
    });
  });
  console.log(`Total rows: ${rows.length}`);

  const suspect = rows.filter(r => r.garbageLevel === 'SUSPECT');
  const garbage = rows.filter(r => r.garbageLevel === 'GARBAGE');
  console.log(`SUSPECT to geocode via Google: ${suspect.length}`);
  console.log(`GARBAGE flagged for manual review (not auto-geocoded): ${garbage.length}`);

  const results = [];
  let i = 0;
  for (const r of suspect) {
    i++;
    const cleanedAddr = cleanForGeocode(r.address, r.city);
    const g = await geocodeLocationIQ(cleanedAddr, r.city);

    let baseLat = isValidIL(r.pbiLat, r.pbiLng) ? r.pbiLat : (isValidIL(r.iceLat, r.iceLng) ? r.iceLat : null);
    let baseLng = isValidIL(r.pbiLat, r.pbiLng) ? r.pbiLng : (isValidIL(r.iceLat, r.iceLng) ? r.iceLng : null);

    let distanceKm = '';
    let verdict;
    if (!g || !isValidIL(g.lat, g.lng)) {
      verdict = 'LocationIQ לא מצא';
    } else if (baseLat) {
      distanceKm = haversineKm(baseLat, baseLng, g.lat, g.lng).toFixed(2);
      verdict = Number(distanceKm) > 2 ? 'הצעה שונה מהותית — לבדוק' : 'הצעה תואמת/קרובה';
    } else {
      verdict = 'הצעה חדשה (אין נקודת ייחוס)';
    }

    results.push({
      ...r,
      cleanedAddr,
      googleLat: g ? g.lat : '',
      googleLng: g ? g.lng : '',
      googleFormatted: g ? g.formatted : '',
      googleLocationType: g ? g.locationType : '',
      distanceKm,
      verdict,
      action: 'LocationIQ geocode',
    });

    if (i % 50 === 0) console.log(`  ${i}/${suspect.length}`);
    await new Promise(res => setTimeout(res, 550));
  }

  for (const r of garbage) {
    results.push({
      ...r,
      googleLat: '', googleLng: '', googleFormatted: '', googleLocationType: '',
      distanceKm: '', verdict: 'דורש בדיקה ידנית — לא נשלח ל-LocationIQ',
      action: 'בדיקה ידנית',
    });
  }

  const vCnt = {};
  for (const r of results) vCnt[r.verdict] = (vCnt[r.verdict] || 0) + 1;
  console.log('--- verdicts ---');
  for (const [k, v] of Object.entries(vCnt)) console.log(`${k}: ${v}`);

  // ── Write Excel ──────────────────────────────────────────────────────────
  const out = new ExcelJS.Workbook();
  const ws = out.addWorksheet('Geocode Suggestions');
  ws.views = [{ rightToLeft: true }];

  ws.columns = [
    { header: 'מס. לקוח',       key: 'custId',       width: 12 },
    { header: 'שם לקוח',        key: 'custName',     width: 32 },
    { header: 'עיר',            key: 'city',         width: 14 },
    { header: 'כתובת',          key: 'address',      width: 30 },
    { header: 'כתובת מנוקה לחיפוש', key: 'cleanedAddr', width: 26 },
    { header: 'ניקיון כתובת',   key: 'garbageLevel', width: 12 },
    { header: 'סיבה',           key: 'garbageWhy',   width: 32 },
    { header: 'קו רוחב (מקור)', key: 'pbiLat',       width: 13 },
    { header: 'קו אורך (מקור)', key: 'pbiLng',       width: 13 },
    { header: 'קו רוחב (Google)', key: 'googleLat',  width: 14 },
    { header: 'קו אורך (Google)', key: 'googleLng',  width: 14 },
    { header: 'כתובת מפורמטת (LocationIQ)', key: 'googleFormatted', width: 36 },
    { header: 'דיוק LocationIQ',    key: 'googleLocationType', width: 16 },
    { header: 'מרחק מהמקור (ק"מ)', key: 'distanceKm', width: 14 },
    { header: 'מסקנה',          key: 'verdict',      width: 26 },
    { header: 'קוד סוכן',       key: 'agentCode',    width: 12 },
    { header: 'שם סוכן',        key: 'agentName',    width: 22 },
  ];

  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3F7C' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFC9A84C' } } };
  });
  ws.getRow(1).height = 24;

  const verdictFill = {
    'הצעה תואמת/קרובה': 'FF1B5E20',
    'הצעה שונה מהותית — לבדוק': 'FFFF8F00',
    'הצעה חדשה (אין נקודת ייחוס)': 'FF0D47A1',
    'LocationIQ לא מצא': 'FF616161',
    'דורש בדיקה ידנית — לא נשלח ל-LocationIQ': 'FFB71C1C',
  };
  const garbageFill = { GARBAGE: 'FFB71C1C', SUSPECT: 'FFFF8F00', CLEAN: 'FF1B5E20' };

  for (const row of results) {
    const r = ws.addRow(row);
    const vbg = verdictFill[row.verdict];
    if (vbg) {
      r.getCell('verdict').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: vbg } };
      r.getCell('verdict').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    }
    const gbg = garbageFill[row.garbageLevel];
    if (gbg) {
      r.getCell('garbageLevel').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gbg } };
      r.getCell('garbageLevel').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    }
    r.eachCell(cell => { cell.alignment = { vertical: 'middle' }; });
  }

  ws.autoFilter = { from: 'A1', to: `Q${results.length + 1}` };
  ws.views[0].state = 'frozen';
  ws.views[0].ySplit = 1;

  const outPath = `C:\\Users\\d.sverdlik\\Desktop\\geocode-suggestions-${today}.xlsx`;
  await out.xlsx.writeFile(outPath);
  console.log(`\n✓ Saved: ${outPath}`);
  console.log(`  Total rows: ${results.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
