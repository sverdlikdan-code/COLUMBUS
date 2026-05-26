// geocode-coordinates-check.js
// Reads COORDINATES CHECK.xlsx, geocodes addresses, fills columns 13+14 (קו רוחב2 / קו אורך2)
// Run: node planogram/geocode-coordinates-check.js

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const FILE = path.join(__dirname, '../COORDINATES CHECK.xlsx');
const SHEET = 'DataSheet';
const IL = { minLat:29.3, maxLat:33.5, minLng:34.2, maxLng:35.9 };

function isValidIL(lat, lng) {
  return lat && lng && !isNaN(lat) && !isNaN(lng)
    && lat >= IL.minLat && lat <= IL.maxLat
    && lng >= IL.minLng && lng <= IL.maxLng;
}

const VENUE_PATTERNS = [
  /מרכז מסחרי[^,]*/gi, /מרכז עסקים[^,]*/gi, /מרכז קניות[^,]*/gi,
  /קניון[^,]*/gi, /מתחם[^,]*/gi, /פארק תעשיי?ה[^,]*/gi,
  /אזור תעשיי?ה[^,]*/gi, /\(.*?\)/g,
];
const VENUE_RE = /מרכז|קניון|מתחם|פארק|אזור תעשי/;

function cleanAddr(addr) {
  if (!addr) return '';
  let s = addr.replace(/(\d+)\.\d+/g, '$1');
  for (const p of VENUE_PATTERNS) s = s.replace(p, '');
  return s.replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

function extractStreetNum(addr) {
  const m = (addr||'').match(/[א-ת"'\-\s]{2,}\s+\d+/);
  return m ? m[0].trim() : null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const cache = new Map();

async function nominatim(q) {
  if (cache.has(q)) return cache.get(q);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=il,ps`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'ColumbusDillerGeocode/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    const data = await r.json();
    const result = data.length ? { lat: +data[0].lat, lng: +data[0].lon } : null;
    cache.set(q, result);
    return result;
  } catch (_) { cache.set(q, null); return null; }
}

async function geocodeRow(addr, city) {
  if (!addr && !city) return null;
  const cleaned = cleanAddr(addr);
  const hasNum  = extractStreetNum(cleaned || addr);

  // Strategy 1: cleaned address + city (if has number)
  if (hasNum) {
    const q1 = [cleaned, city, 'ישראל'].filter(Boolean).join(', ');
    const r1 = await nominatim(q1);
    if (r1 && isValidIL(r1.lat, r1.lng)) return r1;
    await sleep(1100);

    // Strategy 2: original address contains venue — try street+num+city only
    const street = extractStreetNum(cleaned || addr);
    if (street && street !== cleaned) {
      const q2 = [street, city, 'ישראל'].filter(Boolean).join(', ');
      const r2 = await nominatim(q2);
      if (r2 && isValidIL(r2.lat, r2.lng)) return r2;
      await sleep(1100);
    }
  }

  // Strategy 3: venue name (מרכז/קניון etc.) → search as POI
  if (VENUE_RE.test(addr)) {
    // Extract just the venue portion
    const venueMatch = addr.match(/((?:קניון|מרכז מסחרי|מרכז קניות|מתחם|פארק)[^\d,]+)/i);
    if (venueMatch) {
      const q3 = [venueMatch[1].trim(), city, 'ישראל'].filter(Boolean).join(', ');
      const r3 = await nominatim(q3);
      if (r3 && isValidIL(r3.lat, r3.lng)) return r3;
      await sleep(1100);
    }
  }

  // Strategy 4: city center only
  if (city) {
    const q4 = city + ', ישראל';
    const r4 = await nominatim(q4);
    if (r4 && isValidIL(r4.lat, r4.lng)) return { ...r4, cityCenter: true };
    await sleep(1100);
  }

  return null;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) { console.error('Sheet not found:', SHEET); process.exit(1); }

  const totalRows = ws.rowCount - 1;
  console.log(`Starting geocode for ${totalRows} rows…`);

  // Check if cols 13/14 have headers, add if not
  const h13 = ws.getRow(1).getCell(13).value;
  const h14 = ws.getRow(1).getCell(14).value;
  if (!h13) ws.getRow(1).getCell(13).value = 'קו רוחב2';
  if (!h14) ws.getRow(1).getCell(14).value = 'קו אורך2';

  let done=0, found=0, cityOnly=0, failed=0;
  const SAVE_EVERY = 50;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row   = ws.getRow(r);
    const id    = String(row.getCell(1).value || '').trim();
    const addr  = String(row.getCell(6).value || '').trim();
    const city  = String(row.getCell(7).value || '').trim();

    // Skip already geocoded
    const existing13 = row.getCell(13).value;
    if (existing13 && !isNaN(Number(existing13))) { done++; continue; }

    if (!id) continue;

    const result = await geocodeRow(addr, city);
    if (result) {
      row.getCell(13).value = result.lat;
      row.getCell(14).value = result.lng;
      if (result.cityCenter) cityOnly++; else found++;
    } else {
      row.getCell(13).value = '';
      row.getCell(14).value = '';
      failed++;
    }

    done++;
    if (done % 10 === 0) {
      const pct = ((done/totalRows)*100).toFixed(1);
      process.stdout.write(`\r${done}/${totalRows} (${pct}%) | found:${found} cityOnly:${cityOnly} failed:${failed}   `);
    }

    if (done % SAVE_EVERY === 0) {
      await wb.xlsx.writeFile(FILE);
      process.stdout.write(' [saved]');
    }

    await sleep(1100);
  }

  await wb.xlsx.writeFile(FILE);
  console.log(`\n✅ Done. found:${found} cityOnly:${cityOnly} failed:${failed}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
