// check-outlier-gps.js — finds fake/default GPS clusters from Priority ERP
const fs   = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/formula-road-data.json'), 'utf8'));

// Collect all clients with GPS across all routes
const all = [];
for (const clients of Object.values(data.routes)) {
  for (const c of clients) {
    if (c.lat && c.lng) all.push(c);
  }
}

// Round to 3 decimal places (~100m grid) to detect same-location clusters
const clusters = new Map();
for (const c of all) {
  const key = `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`;
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push(c);
}

// Find fake clusters: 3+ clients from DIFFERENT cities at the same coords
const fake = [];
for (const [coord, clients] of clusters.entries()) {
  const cities = new Set(clients.map(c => c.city));
  if (clients.length >= 3 && cities.size >= 2) {
    fake.push({ coord, count: clients.length, cities: [...cities], clients });
  }
}
fake.sort((a,b) => b.count - a.count);

console.log(`\n=== FAKE/DEFAULT GPS CLUSTERS (same coords, different cities) ===`);
console.log(`Found ${fake.length} clusters, ${fake.reduce((s,f)=>s+f.count,0)} total affected clients\n`);

for (const f of fake.slice(0, 20)) {
  const [lat, lng] = f.coord.split(',');
  console.log(`📍 ${lat}, ${lng}  →  ${f.count} clients from cities: ${[...f.cities].join(', ')}`);
  for (const c of f.clients.slice(0, 5)) {
    console.log(`   ${c.custId}  ${c.city}  |  ${c.address}`);
  }
  if (f.clients.length > 5) console.log(`   ... and ${f.clients.length-5} more`);
  console.log('');
}

// Summary of how many unique clients would be freed if we null out these clusters
const fakeIds = new Set(fake.flatMap(f => f.clients.map(c => c.custId)));
console.log(`\nTotal clients that would get their GPS nulled: ${fakeIds.size}`);
console.log(`(they'd then fall back to city-center or re-geocoded)\n`);

// Also show top offenders by city-coord mismatch
const KNOWN_CITIES = {
  'תל אביב-יפו':[32.08,34.78], 'ירושלים':[31.78,35.23], 'חיפה':[32.81,34.99],
  'באר שבע':[31.24,34.79], 'נתניה':[32.33,34.86], 'ראשון לציון':[31.97,34.80],
  'פתח תקווה':[32.09,34.89], 'אשדוד':[31.80,34.65], 'חולון':[32.01,34.77],
};
function distKm(lat1,lng1,lat2,lng2){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
console.log(`=== KNOWN-CITY MISMATCH (client's city vs GPS location) ===`);
let mismatch=0;
for (const c of all) {
  const ref = KNOWN_CITIES[c.city];
  if (!ref) continue;
  const d = distKm(c.lat,c.lng,ref[0],ref[1]);
  if (d > 20) {
    mismatch++;
    if (mismatch <= 15) console.log(`  ${c.custId}  city:${c.city}  addr:${c.address}  →  ${d.toFixed(0)}km off  (lat:${c.lat.toFixed(4)},lng:${c.lng.toFixed(4)})`);
  }
}
console.log(`Total mismatches >20km from city center: ${mismatch}`);
