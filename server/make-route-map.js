require('dotenv').config({ path: '../.env' });
const ExcelJS = require('exceljs');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

const DESKTOP = 'C:/Users/d.sverdlik/Desktop';
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function nominatim(q) {
  return new Promise(resolve => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=il`;
    https.get(url, { headers: { 'User-Agent': 'COLUMBUS-MARSHRUT/1.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(j.length ? { lat: +j[0].lat, lng: +j[0].lon } : null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function geocode(addr, city) {
  for (const q of [
    `${addr}, ${city}, ישראל`,
    `${addr.split(' ').slice(0,3).join(' ')}, ${city}, ישראל`,
    `${city}, ישראל`
  ]) {
    const r = await nominatim(q);
    await sleep(1100);
    if (r) return r;
  }
  return null;
}

// Nearest-neighbour TSP starting from first point
function optimizeOrder(pts) {
  if (pts.length <= 2) return pts;
  const used = new Set([0]);
  const route = [pts[0]];
  while (route.length < pts.length) {
    const last = route[route.length - 1];
    let best = null, bestD = Infinity;
    pts.forEach((p, i) => {
      if (used.has(i)) return;
      const d = (p.lat - last.lat) ** 2 + (p.lng - last.lng) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    used.add(best);
    route.push(pts[best]);
  }
  return route;
}

function buildHtml(dayLabel, pts) {
  const cLat = pts.reduce((s,p) => s+p.lat, 0) / pts.length;
  const cLng = pts.reduce((s,p) => s+p.lng, 0) / pts.length;

  // Use JSON data array — no Hebrew/quote escaping issues in JS
  const stopsJson = JSON.stringify(pts.map((p, i) => ({
    n: i + 1, id: p.id, name: p.name, addr: p.addr, lat: p.lat, lng: p.lng
  })));

  const list = pts.map((p, i) => `
<div class="stop" id="s${i}" onclick="focusStop(${i})">
  <span class="num">${i + 1}</span>
  <div><div class="nm">${p.name}</div><div class="ad">${p.addr}</div><div class="id">${p.id}</div></div>
</div>`).join('');

  return `<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>מסלול ${dayLabel}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:Arial,sans-serif}
body{display:flex;flex-direction:row-reverse}
#sb{width:320px;min-width:320px;overflow-y:auto;background:#f4f6fa;border-right:2px solid #d0d8e8;direction:rtl}
#map{flex:1;height:100vh}
h2{background:#1A3F7C;color:#fff;padding:13px 16px;font-size:15px;direction:rtl}
.stop{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid #e0e6f0;cursor:pointer;transition:background .15s;direction:rtl}
.stop:hover,.stop.active{background:#dce8ff}
.num{background:#1A3F7C;color:#fff;border-radius:50%;width:26px;height:26px;min-width:26px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:11px;flex-shrink:0}
.nm{font-weight:bold;font-size:13px;line-height:1.3}
.ad{font-size:11px;color:#555;margin-top:2px}
.id{font-size:11px;color:#aaa}
</style>
</head>
<body>
<div id="sb">
  <h2>&#x1F4CD; ${dayLabel} &mdash; ${pts.length} &#x05E2;&#x05E6;&#x05D9;&#x05E8;&#x05D5;&#x05EA;</h2>
  ${list}
</div>
<div id="map"></div>
<script>
const STOPS = ${stopsJson};
const map = L.map('map').setView([${cLat},${cLng}], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap', maxZoom: 19
}).addTo(map);

const markers = STOPS.map(s => {
  const icon = L.divIcon({
    className: '',
    html: '<div style="background:#1A3F7C;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)">' + s.n + '</div>',
    iconSize: [28,28], iconAnchor: [14,14], popupAnchor: [0,-14]
  });
  return L.marker([s.lat, s.lng], {icon})
    .addTo(map)
    .bindPopup('<b>' + s.n + '. ' + s.name + '</b><br>' + s.addr + '<br><small>' + s.id + '</small>');
});

L.polyline(STOPS.map(s => [s.lat, s.lng]), {color:'#1A3F7C', weight:3, opacity:.7, dashArray:'7,5'}).addTo(map);

function focusStop(i) {
  document.querySelectorAll('.stop').forEach(el => el.classList.remove('active'));
  document.getElementById('s'+i).classList.add('active');
  map.setView([STOPS[i].lat, STOPS[i].lng], 16);
  markers[i].openPopup();
}
<\/script>
</body>
</html>`;
}

async function processDay(ws, label, outFile) {
  const clients = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const v = row.values;
    const id   = String(v[2] || '').trim();
    const name = String(v[3] || '').trim();
    const city = String(v[5] || '').trim();
    const addr = String(v[6] || '').trim();
    if (!id || id === '???' || !name || name === '—') return;
    clients.push({ id, name, city, addr });
  });

  console.log(`\n──── ${label}: ${clients.length} клиентов ────`);

  const geo = [];
  for (const c of clients) {
    process.stdout.write(`  ${c.name.slice(0, 35).padEnd(35)} → `);
    const g = await geocode(c.addr, c.city);
    if (g) {
      console.log(`(${g.lat.toFixed(4)}, ${g.lng.toFixed(4)})`);
      geo.push({ ...c, ...g });
    } else {
      console.log('❌ не найден');
    }
  }

  const route = optimizeOrder(geo);
  const html  = buildHtml(label, route);
  fs.writeFileSync(path.join(DESKTOP, outFile), html, 'utf8');

  console.log(`\n✅ ${outFile} — оптимизированный порядок:`);
  route.forEach((c, i) => console.log(`  ${i+1}. [${c.id}] ${c.name}`));
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(DESKTOP, 'MARSHRUT-RUD-MATCHED.xlsx'));

  const [ws1, ws2] = wb.worksheets;
  await processDay(ws1, 'יום 1 — אשדוד',        'route-day1-ashdod.html');
  await processDay(ws2, 'יום 2 — ראשון לציון',  'route-day2-rishon.html');

  console.log('\n🗺  Готово! Открой на Desktop:');
  console.log('  route-day1-ashdod.html');
  console.log('  route-day2-rishon.html');
}

main().catch(console.error);
