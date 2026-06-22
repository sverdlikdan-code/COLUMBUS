// Regenerate HTML maps from cached geocoded data (no Nominatim calls)
const fs = require('fs');
const DESKTOP = 'C:/Users/d.sverdlik/Desktop';

// ── יום 1 — אשדוד ── ORIGINAL order from MARSHRUT RUD + full addresses
const DAY1 = [
  { n:1,  id:'1140127', name:'קשת טעמים - האורגים סניף 22',       addr:'האורגים 8, אשדוד',                                   lat:31.8111, lng:34.6620 },
  { n:2,  id:'1140011', name:'טיב טעם אשדוד סניף 3',               addr:'הרצל, סטאר סנטר, אשדוד',                             lat:31.8101, lng:34.6557 },
  { n:3,  id:'1151156', name:'ממתקי אשדוד',                         addr:'דוד המלך 20, אשדוד',                                 lat:31.7740, lng:34.6440 },
  { n:4,  id:'1111069', name:'שופרסל דיל הרצל סניף 183',            addr:'הרצל, קניון סיטי, אשדוד',                            lat:31.7977, lng:34.6530 },
  { n:5,  id:'1130012', name:'יוחננוף אשדוד סניף 5',               addr:"ז'יבוטינסקי 27, אשדוד",                              lat:31.7970, lng:34.6491 },
  { n:6,  id:'1130922', name:'שוק העיר סיטי סניף 17',              addr:"קניון סיטי, שד' מנחם בגין פינת הרצל, אשדוד",         lat:31.7977, lng:34.6510 },
  { n:7,  id:'1136630', name:'סופר פאפא גן העיר',                   addr:'אריק אינשטיין 4, אשדוד',                             lat:31.7970, lng:34.6491 },
  { n:8,  id:'1135315', name:'ארקטיקה פוד - רוגוזין 27',            addr:'רוגוזין 27, אשדוד',                                  lat:31.8065, lng:34.6437 },
  { n:9,  id:'1150944', name:'סופר מישל אשדוד',                     addr:'הציונות 41, אשדוד',                                  lat:31.7869, lng:34.6448 },
  { n:10, id:'1136621', name:'סופר פאפא אס ישראל',                  addr:'עצמאות 26, אשדוד',                                   lat:31.7950, lng:34.6480 },
  { n:11, id:'1136622', name:'סופר פאפא - אבן אזרע 23',             addr:'אבן אזרע 23, אשדוד',                                 lat:31.7869, lng:34.6448 },
  { n:12, id:'1140211', name:"קרל ברג - רובע י' סניף 3",            addr:"הנביאים 12 רובע י', אשדוד",                          lat:31.7784, lng:34.6511 },
  { n:13, id:'1153313', name:'דוד יעקובי - מרקט אשדוד',             addr:'הנביאים 34, אשדוד',                                  lat:31.7781, lng:34.6517 },
  { n:14, id:'1111026', name:'שופרסל דיל שבט לוי סניף 92',          addr:'שבט לוי 12, אשדוד',                                  lat:31.7785, lng:34.6346 },
  { n:15, id:'1111130', name:'שופרסל דיל האגס סניף 320',            addr:'האגס 4, אשדוד',                                      lat:31.7960, lng:34.6500 },
  { n:16, id:'1111061', name:'שופרסל דיל הבושם סניף 166',           addr:'הבושם 7, אשדוד',                                     lat:31.8224, lng:34.6683 },
];

// ── יום 2 — ראשון לציון ── start from בת ים, then ORIGINAL order from MARSHRUT RUD
const DAY2 = [
  // --- בת ים first (coming from there) ---
  { n:1,  id:'1130253', name:'מיקס מרקט בת ים',                     addr:'ניסינבאום 33, בת ים',                                 lat:32.0220, lng:34.7460 },
  { n:2,  id:'1112034', name:'ויקטורי בת ים',                        addr:'העמל 11, בת ים',                                     lat:32.0150, lng:34.7450 },
  { n:3,  id:'1140012', name:'טיב טעם בת ים סניף 5',                addr:"האצ'ל 18, בת ים",                                    lat:32.0180, lng:34.7500 },
  // --- ראשון לציון (original route order) ---
  { n:4,  id:'1140118', name:'קשת טעמים סניף 13',                   addr:'יעקב פר, ראשון לציון',                               lat:31.9636, lng:34.8101 },
  { n:5,  id:'1140129', name:'קשת טעמים מערב סניף 24',              addr:"לח'י 4, ראשון לציון",                                lat:31.9864, lng:34.7655 },
  { n:6,  id:'1140019', name:'טיב טעם מזרח סניף 14',                addr:'המכבים 62, ראשון לציון',                             lat:31.9845, lng:34.8113 },
  { n:7,  id:'1111081', name:'שופרסל דיל שמוטקין 210',               addr:'שמוטקין 30, ראשון לציון',                            lat:31.9763, lng:34.8125 },
  { n:8,  id:'1124079', name:'ויקטורי שמוטקין סניף 94',              addr:'שמוטקין 29, ראשון לציון',                            lat:31.9787, lng:34.8118 },
  { n:9,  id:'1130114', name:"חצי חינם הלח'י סניף 5",               addr:"הלח'י 16, ראשון לציון",                              lat:31.9539, lng:34.8235 },
  { n:10, id:'1132811', name:'תוצרת חקלאית - משה לוי סניף 8',       addr:'משה לוי 8, ראשון לציון',                             lat:31.9865, lng:34.7730 },
  { n:11, id:'1162000', name:'מניה - ההגנה 19',                      addr:'ההגנה 19, ראשון לציון',                              lat:31.9893, lng:34.7615 },
  { n:12, id:'1164611', name:'אלמוג ראשל"צ',                         addr:'ביאליק 6, ראשון לציון',                              lat:31.9647, lng:34.8021 },
  { n:13, id:'1135314', name:'ארקטיקה פוד ראשל"צ',                   addr:'רוטשילד 76, ראשון לציון',                            lat:31.9644, lng:34.7967 },
  { n:14, id:'1163100', name:'א.ע.ל הפקות (אבוחצירא)',               addr:'אבוחצירא 3, ראשון לציון',                            lat:31.9636, lng:34.8101 },
  { n:15, id:'1147011', name:'חממה - משה שרת',                       addr:'משה שרת 25, ראשון לציון',                            lat:31.9939, lng:34.7536 },
  { n:16, id:'1147010', name:"חממה - האצ'ל",                         addr:"האצ'ל 6, ראשון לציון",                               lat:31.9988, lng:34.7383 },
];

// Nearest-neighbour TSP from a given start index
function nnRoute(pts, startIdx) {
  const used = new Set([startIdx]);
  const route = [pts[startIdx]];
  while (route.length < pts.length) {
    const last = route[route.length - 1];
    let bestI = -1, bestD = Infinity;
    pts.forEach((p, i) => {
      if (used.has(i)) return;
      const d = (p.lat - last.lat) ** 2 + (p.lng - last.lng) ** 2;
      if (d < bestD) { bestD = d; bestI = i; }
    });
    used.add(bestI); route.push(pts[bestI]);
  }
  return route;
}

function totalDist(route) {
  return route.reduce((d, p, i) => {
    if (!i) return 0;
    return d + (p.lat - route[i-1].lat) ** 2 + (p.lng - route[i-1].lng) ** 2;
  }, 0);
}

function d2(a, b) { return (a.lat-b.lat)**2 + (a.lng-b.lng)**2; }

// 2-opt: remove crossing edges until no improvement
function twoOpt(route) {
  let r = [...route], improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < r.length - 1; i++) {
      for (let j = i + 2; j < r.length; j++) {
        if (j === r.length - 1 && i === 0) continue; // skip full reversal
        const before = d2(r[i], r[i+1]) + d2(r[j], r[(j+1) % r.length]);
        const after  = d2(r[i], r[j])   + d2(r[i+1], r[(j+1) % r.length]);
        if (after < before - 1e-12) {
          r = [...r.slice(0, i+1), ...r.slice(i+1, j+1).reverse(), ...r.slice(j+1)];
          improved = true;
        }
      }
    }
  }
  return r;
}

// Nearest-neighbour from best start + 2-opt refinement
function optimize(pts) {
  if (pts.length <= 2) return pts.map((s, i) => ({ ...s, n: i + 1 }));
  let best = null, bestD = Infinity;
  pts.forEach((_, si) => {
    const r = twoOpt(nnRoute(pts, si));
    const d = totalDist(r);
    if (d < bestD) { bestD = d; best = r; }
  });
  return best.map((s, i) => ({ ...s, n: i + 1 }));
}

const DAY1_OPT = optimize(DAY1);
const DAY2_OPT = optimize(DAY2);

const DAYS = [
  { label: 'יום 1 — אשדוד',       stops: DAY1_OPT },
  { label: 'יום 2 — ראשון לציון', stops: DAY2_OPT },
];

// Unused — marker HTML is built inline in JS template

const tabs = DAYS.map((day, di) => {
  const list = day.stops.map(s => `
<div class="stop" id="d${di}s${s.n-1}" onclick="focusStop(${di},${s.n-1})">
  <span class="num">${s.n}</span>
  <div><div class="nm">${s.name}</div><div class="ad">${s.addr}</div><div class="id">${s.id}</div></div>
</div>`).join('');

  return `
<div class="tab-panel${di===0?' active':''}" id="panel${di}">
  <div class="sb" id="sb${di}">
    <div class="sb-head">
      <span>&#x1F4CD; ${day.label} &mdash; ${day.stops.length} &#x05E2;&#x05E6;&#x05D9;&#x05E8;&#x05D5;&#x05EA;</span>
      <button class="print-btn" onclick="window.print()">&#x1F5A8;</button>
    </div>
    ${list}
  </div>
  <div class="map-wrap" style="position:relative">
    <div id="map${di}" style="width:100%;height:100%"></div>
    <div class="rot-bar">
      <button class="rot-btn" onclick="rotMap(${di},-15)">&#8592;</button>
      <button class="rot-btn rot-reset" onclick="rotMap(${di},null)">&#x2B06;</button>
      <button class="rot-btn" onclick="rotMap(${di},+15)">&#8594;</button>
    </div>
  </div>
</div>`;
}).join('');

const stopsData = JSON.stringify(DAYS.map(d => d.stops));

const html = `<!DOCTYPE html>
<html lang="he">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>מסלול RUD — אשדוד + ראשון לציון</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script src="https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:Arial,sans-serif;overflow:hidden;direction:rtl}
#tabs{display:flex;background:#0f2a5e;height:46px;flex-shrink:0}
.tab-btn{flex:1;border:none;background:transparent;color:rgba(255,255,255,.65);font-size:15px;font-weight:700;cursor:pointer;transition:all .2s;border-bottom:3px solid transparent}
.tab-btn.active{color:#fff;border-bottom:3px solid #4fa3ff;background:rgba(255,255,255,.08)}
#app{display:flex;flex-direction:column;height:100vh}
#panels{flex:1;overflow:hidden;position:relative}
.tab-panel{display:none;position:absolute;inset:0;flex-direction:row-reverse}
.tab-panel.active{display:flex}
.sb{width:320px;min-width:320px;height:100%;overflow-y:auto;background:#f4f6fa;border-right:2px solid #d0d8e8;display:flex;flex-direction:column}
.sb-head{background:#1A3F7C;color:#fff;padding:10px 14px;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:2}
.print-btn{background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:5px;padding:4px 10px;font-size:13px;cursor:pointer}
.print-btn:hover{background:rgba(255,255,255,.35)}
.map-wrap{flex:1;height:100%;position:relative}
.rot-bar{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:6px;background:rgba(255,255,255,.92);border:1px solid #ccc;border-radius:24px;padding:5px 10px;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.rot-btn{border:none;background:#1A3F7C;color:#fff;border-radius:50%;width:38px;height:38px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
.rot-btn:hover{background:#2a5aaa}
.rot-reset{background:#555}
.rot-reset:hover{background:#333}
.stop{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid #e0e6f0;cursor:pointer;transition:background .15s}
.stop:hover,.stop.active{background:#dce8ff}
.num{background:#1A3F7C;color:#fff;border-radius:50%;width:26px;height:26px;min-width:26px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:11px;flex-shrink:0}
.nm{font-weight:bold;font-size:13px;line-height:1.3}
.ad{font-size:12px;color:#333;margin-top:3px;font-weight:500}
.id{font-size:11px;color:#aaa;margin-top:1px}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  @page{size:A4 landscape;margin:5mm}
  html,body{width:287mm!important;height:200mm!important;overflow:hidden!important;margin:0!important}
  #app{width:287mm!important;height:200mm!important;display:flex!important;flex-direction:column!important}
  #tabs,.print-btn,.rot-bar{display:none!important}
  #panels{flex:1!important;overflow:hidden!important;position:relative!important;height:200mm!important}
  .tab-panel{display:none!important}
  .tab-panel.active{display:flex!important;position:absolute!important;inset:0!important;flex-direction:row-reverse!important}
  .sb{width:75mm!important;min-width:75mm!important;height:100%!important;overflow:hidden!important;border-right:1px solid #ccc!important}
  .sb-head{background:#1A3F7C!important;padding:6px 10px!important;font-size:10px!important}
  .stop{padding:3px 6px!important;border-bottom:1px solid #e8eef8!important}
  .nm{font-size:9px!important;line-height:1.2!important}
  .ad{font-size:8px!important;margin-top:1px!important}
  .id{font-size:7px!important;margin-top:0!important}
  .num{width:16px!important;height:16px!important;min-width:16px!important;font-size:8px!important}
  .map-wrap{flex:1!important;height:100%!important;overflow:hidden!important}
}
</style>
</head>
<body>
<div id="app">
  <div id="tabs">
    <button class="tab-btn active" onclick="switchTab(0)">יום 1 — אשדוד</button>
    <button class="tab-btn" onclick="switchTab(1)">יום 2 — ראשון לציון</button>
  </div>
  <div id="panels">${tabs}</div>
</div>
<script>
const ALL = ${stopsData};
const maps = [];
const initialized = [false, false];

function makeMarker(s, mapObj) {
  const html =
    '<div style="background:#1A3F7C;color:#fff;border-radius:50%;width:38px;height:38px;' +
    'display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:15px;' +
    'border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.55);cursor:pointer">' + s.n + '</div>';
  const icon = L.divIcon({ className:'', html, iconSize:[38,38], iconAnchor:[19,19], popupAnchor:[0,-22] });
  const m = L.marker([s.lat, s.lng], {icon}).addTo(mapObj);
  m.bindPopup(
    '<div style="font-family:Arial,sans-serif;min-width:200px;direction:rtl">' +
    '<div style="font-weight:800;font-size:15px;margin-bottom:4px">' + s.n + '. ' + s.name + '</div>' +
    '<div style="font-size:13px;color:#444">' + s.addr + '</div>' +
    '<div style="font-size:11px;color:#999;margin-top:3px">' + s.id + '</div>' +
    '</div>'
  );
  return m;
}

function initMap(di) {
  if (initialized[di]) return;
  initialized[di] = true;
  const stops = ALL[di];
  const cLat = stops.reduce((s,p) => s+p.lat, 0) / stops.length;
  const cLng = stops.reduce((s,p) => s+p.lng, 0) / stops.length;
  const map = L.map('map' + di, { rotate: true, bearing: 0 }).setView([cLat, cLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom:19
  }).addTo(map);
  const markers = stops.map(s => makeMarker(s, map));
  L.polyline(stops.map(s => [s.lat, s.lng]), {color:'#1A3F7C', weight:3, opacity:.75, dashArray:'7,5'}).addTo(map);
  maps[di] = { map, markers, stops };
}

function focusStop(di, i) {
  document.querySelectorAll('#panel' + di + ' .stop').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('d' + di + 's' + i);
  if (el) { el.classList.add('active'); el.scrollIntoView({block:'nearest'}); }
  const {map, markers, stops} = maps[di];
  map.setView([stops[i].lat, stops[i].lng], 16);
  markers[i].openPopup();
}

const bearings = [0, 0];

function rotMap(di, delta) {
  if (!maps[di]) return;
  if (delta === null) {
    bearings[di] = 0;
  } else {
    bearings[di] = (bearings[di] + delta + 360) % 360;
  }
  maps[di].map.setBearing(bearings[di]);
}

function switchTab(i) {
  document.querySelectorAll('.tab-btn').forEach((b,j) => b.classList.toggle('active', i===j));
  document.querySelectorAll('.tab-panel').forEach((p,j) => p.classList.toggle('active', i===j));
  initMap(i);
  setTimeout(() => maps[i] && maps[i].map.invalidateSize(), 60);
}

// Init first tab immediately
initMap(0);
<\/script>
</body>
</html>`;

const OUT = `${DESKTOP}/marshrut-rud.html`;
fs.writeFileSync(OUT, html, 'utf8');
console.log('✅ Saved:', OUT);
