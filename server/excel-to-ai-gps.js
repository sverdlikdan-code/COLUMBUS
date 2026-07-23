/**
 * Converts geocode-compare Excel → docs/google-gps.json
 * Priority: PBI (when valid + Google disagrees >2000m) → Google (bbox validated) → Overpass → rejected
 * Zero new Google requests — reads existing Excel columns only.
 */
const path = require('path');
const fs   = require('fs');
const ExcelJS = require('exceljs');

const EXCEL = (() => {
  const files = require('fs').readdirSync(path.join(__dirname,'..'))
    .filter(f => f.startsWith('geocode-compare-') && f.endsWith('.xlsx'))
    .sort().reverse();
  return path.join(__dirname, '..', files[0]);
})();
const OUT   = path.join(__dirname, '../docs/google-gps.json');
const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// ── City bbox cache (Nominatim) ───────────────────────────────────────────────
const bboxCache = new Map();
async function getCityBBox(city) {
  if (!city) return null;
  if (bboxCache.has(city)) return bboxCache.get(city);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&countrycodes=il,ps`;
    const r = await fetch(url, { headers: {'User-Agent':'COLUMBUS/1.0 (sverdlikdan@gmail.com)'}, signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (data.length && data[0].boundingbox) {
      const bb = data[0].boundingbox;
      const bbox = { minLat:+bb[0], maxLat:+bb[1], minLng:+bb[2], maxLng:+bb[3] };
      bboxCache.set(city, bbox); return bbox;
    }
  } catch (_) {}
  bboxCache.set(city, null); return null;
}

function inBBox(lat, lng, bbox) {
  if (!bbox) return true;
  const P = 0.025;
  return lat >= bbox.minLat-P && lat <= bbox.maxLat+P && lng >= bbox.minLng-P && lng <= bbox.maxLng+P;
}
function isValidIL(lat, lng) { return lat&&lng&&lat>29&&lat<34&&lng>33&&lng<36.5; }
function haversine(lat1,lng1,lat2,lng2){
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// ── Overpass by name + city bbox ──────────────────────────────────────────────
const ovCache = new Map();
async function overpassByName(name) {
  if (ovCache.has(name)) return ovCache.get(name);
  try {
    const q = `[out:json][timeout:15];(node["name"~"${name.replace(/"/g,'')}",i](29.0,34.0,33.5,36.0);way["name"~"${name.replace(/"/g,'')}",i](29.0,34.0,33.5,36.0););out center 50;`;
    const r = await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`, { headers:{'User-Agent':'COLUMBUS/1.0'}, signal:AbortSignal.timeout(15000) });
    if (!r.ok) { ovCache.set(name,[]); return []; }
    const d = await r.json();
    const branches = (d.elements||[]).map(e=>({lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon})).filter(b=>isValidIL(b.lat,b.lng));
    ovCache.set(name, branches); return branches;
  } catch(_) { ovCache.set(name,[]); return []; }
}

function findInBBox(branches, bbox) {
  if (!branches.length || !bbox) return null;
  const P = 0.025;
  return branches.find(b => b.lat>=bbox.minLat-P&&b.lat<=bbox.maxLat+P&&b.lng>=bbox.minLng-P&&b.lng<=bbox.maxLng+P) || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL);
  const ws = wb.getWorksheet('Geocode Compare');
  if (!ws) { console.error('Sheet not found'); return; }

  const hdr = {};
  ws.getRow(1).eachCell((cell, col) => { hdr[cell.text] = col; });
  const idCol     = hdr['מס. לקוח'];
  const nameCol   = hdr['שם לקוח'];
  const cityCol   = hdr['עיר'];
  const typeCol   = hdr['סוג'];
  const pbiLatCol = hdr['PBI Lat'];
  const pbiLngCol = hdr['PBI Lng'];
  const gLatCol   = hdr['Google Lat'];
  const gLngCol   = hdr['Google Lng'];
  if (!idCol||!gLatCol||!gLngCol) { console.error('Missing columns:', hdr); return; }

  const rows = [];
  ws.eachRow((row, ri) => {
    if (ri === 1) return;
    const custId   = String(row.getCell(idCol).value||'').trim();
    const name     = String(row.getCell(nameCol).value||'').trim();
    const city     = String(row.getCell(cityCol).value||'').trim();
    const custType = String(row.getCell(typeCol).value||'').trim();
    const pbiLat   = pbiLatCol ? parseFloat(row.getCell(pbiLatCol).value) : NaN;
    const pbiLng   = pbiLngCol ? parseFloat(row.getCell(pbiLngCol).value) : NaN;
    const gLat     = parseFloat(row.getCell(gLatCol).value);
    const gLng     = parseFloat(row.getCell(gLngCol).value);
    if (!custId) return;
    rows.push({ custId, name, city, custType, pbiLat, pbiLng, gLat, gLng, gOk: isValidIL(gLat, gLng) });
  });
  console.log(`Total rows: ${rows.length}`);

  // pre-fetch city bboxes
  const cities = [...new Set(rows.map(r=>r.city).filter(Boolean))];
  console.log(`Fetching bbox for ${cities.length} cities...`);
  let ci=0;
  for (const city of cities) {
    await getCityBBox(city); ci++;
    if(ci%20===0) process.stdout.write(`  ${ci}/${cities.length}...\r`);
    await sleep(1100);
  }
  console.log('\nBbox done.');

  const result = {};
  let fromPbi=0, fromGoogle=0, fromOverpass=0, rejected=0;

  // Step 1: PBI wins when valid + Google is far (>2000m) — no API calls needed
  // Otherwise: Google wins when within city bbox
  const needOverpass = [];
  for (const row of rows) {
    const pbiOk = isValidIL(row.pbiLat, row.pbiLng);
    const bbox  = bboxCache.get(row.city) ?? null;

    if (pbiOk && row.gOk) {
      const dist = haversine(row.pbiLat, row.pbiLng, row.gLat, row.gLng);
      if (dist > 2000) {
        // PBI and Google disagree significantly — trust PBI (Priority has branch-specific coords)
        result[row.custId] = { aiLat:+row.pbiLat.toFixed(6), aiLng:+row.pbiLng.toFixed(6), src:'pbi' };
        fromPbi++; continue;
      }
    }

    if (!row.gOk) { needOverpass.push(row); continue; }
    if (inBBox(row.gLat, row.gLng, bbox)) {
      result[row.custId] = { aiLat:+row.gLat.toFixed(6), aiLng:+row.gLng.toFixed(6), src:'google' };
      fromGoogle++;
    } else {
      needOverpass.push(row); // Google found but wrong city → try Overpass
    }
  }
  console.log(`PBI preferred: ${fromPbi}, Google accepted: ${fromGoogle}, need Overpass: ${needOverpass.length}`);

  // Step 2: Overpass for remaining (chains + any with a name)
  const chainNames = [...new Set(needOverpass.filter(r=>r.name).map(r=>r.name))];
  console.log(`Overpass queries for ${chainNames.length} unique names...`);
  let oi=0;
  for (const name of chainNames) {
    await overpassByName(name); oi++;
    if(oi%10===0) process.stdout.write(`  ${oi}/${chainNames.length}...\r`);
    await sleep(300);
  }
  console.log('\nOverpass done.');

  for (const row of needOverpass) {
    if (!row.name) { rejected++; continue; }
    const bbox = bboxCache.get(row.city) ?? null;
    const branches = ovCache.get(row.name) || [];
    const match = findInBBox(branches, bbox);
    if (match) {
      result[row.custId] = { aiLat:+match.lat.toFixed(6), aiLng:+match.lng.toFixed(6), src:'overpass' };
      fromOverpass++;
    } else {
      rejected++;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\nDone. PBI: ${fromPbi}, Google: ${fromGoogle}, Overpass: ${fromOverpass}, Rejected: ${rejected}`);
  console.log(`Saved: ${OUT}`);
}

main().catch(e => console.error('FATAL:', e.message));
