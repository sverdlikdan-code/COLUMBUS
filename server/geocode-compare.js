/**
 * Geocode all clients via Google (name+addr+city) + Overpass for chains
 * Outputs Excel with comparison vs current PBI GPS
 */
require('dotenv').config({ path: require('path').join(__dirname, '../planogram/.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { ClientSecretCredential } = require('@azure/identity');

const GOOGLE_CACHE_PATH = path.join(__dirname, '../docs/google-geocode-cache.json');
const googleCache = fs.existsSync(GOOGLE_CACHE_PATH)
  ? JSON.parse(fs.readFileSync(GOOGLE_CACHE_PATH, 'utf8')) : {};
let googleCacheDirty = false;

const OVERPASS_MIRROR = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const overpassCache = new Map(); // name → [{lat,lng}]

function haversine(lat1,lng1,lat2,lng2){
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function isValidIL(lat,lng){ return lat&&lng&&lat>29&&lat<34&&lng>33&&lng<36.5; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function fixBiDi(s) {
  if (!s) return s;
  s = s.replace(/(\d+)\.\d+/g, '$1');
  if (/[‎‏‪-‮]/.test(s)) {
    s = s.replace(/[‎‏‪-‮]/g, '');
    s = s.split('').reverse().join('')
         .replace(/\d+/g, m => m.split('').reverse().join(''))
         .replace(/[A-Za-z][A-Za-z\d\s\-'",.]*/g, m => m.split('').reverse().join(''));
  }
  return s.trim();
}

async function googleQuery(q) {
  if (!process.env.GOOGLE_MAPS_KEY) return null;
  if (q in googleCache) return googleCache[q];
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=he&region=il&key=${process.env.GOOGLE_MAPS_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    const loc = d?.results?.[0]?.geometry?.location;
    if (loc) { googleCache[q] = {lat:loc.lat,lng:loc.lng}; googleCacheDirty=true; return {lat:loc.lat,lng:loc.lng}; }
  } catch(_) {}
  googleCache[q] = null; googleCacheDirty=true; return null;
}

async function overpassBranches(name) {
  if (overpassCache.has(name)) return overpassCache.get(name);
  try {
    const q = `[out:json][timeout:20];(node["name"~"${name.replace(/"/g,'')}",i](29.0,34.0,33.5,36.0);way["name"~"${name.replace(/"/g,'')}",i](29.0,34.0,33.5,36.0););out center 50;`;
    const r = await fetch(`${OVERPASS_MIRROR}?data=${encodeURIComponent(q)}`,{headers:{'User-Agent':'COLUMBUS/1.0'},signal:AbortSignal.timeout(20000)});
    if(!r.ok){overpassCache.set(name,[]);return[];}
    const d = await r.json();
    const branches = (d.elements||[]).map(e=>({lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon})).filter(b=>isValidIL(b.lat,b.lng));
    overpassCache.set(name, branches); return branches;
  } catch(_) { overpassCache.set(name,[]); return []; }
}

function findInCity(branches, pbiLat, pbiLng, radius=15000) {
  // Find closest branch within radius km of PBI location (or within Israel if no PBI)
  if (!branches.length) return null;
  if (isValidIL(pbiLat, pbiLng)) {
    const nearby = branches
      .map(b=>({...b, dist:haversine(pbiLat,pbiLng,b.lat,b.lng)}))
      .filter(b=>b.dist<radius)
      .sort((a,b)=>a.dist-b.dist);
    return nearby[0]||null;
  }
  return branches[0]; // no PBI coords — take first result
}

async function main() {
  console.log('Fetching all clients from PBI...');
  const cred = new ClientSecretCredential(process.env.PBI_TENANT, process.env.PBI_CLIENT, process.env.PBI_SECRET);
  const token = (await cred.getToken('https://analysis.windows.net/powerbi/api/.default')).token;

  const dax = `EVALUATE
DISTINCT(SELECTCOLUMNS(
  FILTER('משטח', 'משטח'[סטטוס] = "פעיל"),
  "custId",'משטח'[מס. לקוח],
  "name",'משטח'[שם לקוח],
  "city",'משטח'[עיר],
  "addr",'משטח'[כתובת],
  "pbiLat",'משטח'[קו רוחב],
  "pbiLng",'משטח'[קו אורך],
  "custType",'משטח'[רשתות - פרטי]
))`;

  const r = await fetch(`https://api.powerbi.com/v1.0/myorg/datasets/${process.env.PBI_DATASET}/executeQueries`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body: JSON.stringify({queries:[{query:dax}],serializerSettings:{includeNulls:true}})
  });
  const d = await r.json();
  if(d.error){console.error('PBI ERR:',d.error.message?.slice(0,200));return;}
  const rows = d.results?.[0]?.tables?.[0]?.rows||[];
  console.log(`Got ${rows.length} unique clients`);

  // Normalize city name for geocoding (e.g. "תל אביב יפו" → "תל אביב")
  function normCity(c) {
    return (c||'').replace(/\s*[-–]\s*יפו$/,'').replace(/\s+יפו$/,'').trim();
  }

  // Fix BiDi on all fields
  const clients = rows.map(row=>({
    custId: row['[custId]'],
    name:   fixBiDi(row['[name]']||''),
    city:   normCity(fixBiDi(row['[city]']||'')),
    addr:   fixBiDi(row['[addr]']||''),
    pbiLat: Number(row['[pbiLat]'])||0,
    pbiLng: Number(row['[pbiLng]'])||0,
    custType: row['[custType]']||'',
  }));

  console.log('Skipping Overpass pre-fetch (too many unique names). Google only in this run.');

  // Geocode all clients via Google + Overpass
  const results = [];
  let i=0;
  for(const c of clients){
    i++;
    const pbiOk = isValidIL(c.pbiLat, c.pbiLng);

    // Google: chains by name+city only (addresses from Priority are often garbled)
    const gq = c.custType === 'רשתות'
      ? [c.name, c.city].filter(Boolean).join(', ')
      : [c.name, c.addr, c.city].filter(Boolean).join(', ');
    const g = await googleQuery(gq);
    const gOk = g && isValidIL(g.lat, g.lng);

    // Overpass for chains
    let ovLat=null, ovLng=null;
    if(c.custType==='רשתות'&&c.name){
      const branches = overpassCache.get(c.name)||[];
      const match = findInCity(branches, c.pbiLat, c.pbiLng);
      if(match){ ovLat=match.lat; ovLng=match.lng; }
    }

    const gDist  = (pbiOk&&gOk) ? haversine(c.pbiLat,c.pbiLng,g.lat,g.lng) : null;
    const ovDist = (pbiOk&&ovLat) ? haversine(c.pbiLat,c.pbiLng,ovLat,ovLng) : null;

    results.push({...c, pbiOk, gLat:g?.lat||null, gLng:g?.lng||null, gOk, ovLat, ovLng, gDist, ovDist});

    if(i%100===0){
      process.stdout.write(`  ${i}/${clients.length} (${Math.round(i/clients.length*100)}%)...\r`);
      if(googleCacheDirty){ fs.writeFileSync(GOOGLE_CACHE_PATH,JSON.stringify(googleCache,null,2)); googleCacheDirty=false; }
    }
    if(!(gq in googleCache)||googleCache[gq]===null) await sleep(300);
  }
  console.log('\nGeocoding done. Building Excel...');

  // Build Excel
  const wb = new ExcelJS.Workbook();
  const F1={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'}};
  const F2={type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F5F5'}};
  const GREEN ={type:'pattern',pattern:'solid',fgColor:{argb:'FFE8F5E9'}};
  const ORANGE={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF3E0'}};
  const RED   ={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFEBEE'}};

  const ws = wb.addWorksheet('Geocode Compare',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
  const cols = [
    {n:'מס. לקוח',w:14},{n:'שם לקוח',w:32},{n:'עיר',w:16},{n:'כתובת',w:28},{n:'סוג',w:12},
    {n:'PBI Lat',w:13},{n:'PBI Lng',w:13},{n:'PBI OK',w:9},
    {n:'Google Lat',w:13},{n:'Google Lng',w:13},
    {n:"מרחק PBI↔Google (מ')",w:20},
    {n:'Overpass Lat',w:13},{n:'Overpass Lng',w:13},
    {n:"מרחק PBI↔OSM (מ')",w:18},
    {n:'סטטוס',w:18},
  ];
  ws.addTable({name:'GeocodeCompare',ref:'A1',headerRow:true,totalsRow:false,
    style:{theme:'TableStyleLight1',showRowStripes:false},
    columns:cols.map(c=>({name:c.n,filterButton:true})),
    rows:results.map(r=>{
      const status =
        !r.pbiOk && r.gOk   ? '🆕 Google בלבד' :
        !r.pbiOk && !r.gOk  ? '❌ אין GPS'      :
        r.gDist>500          ? '⚠️ הפרש גדול'   :
        r.gDist>100          ? '🔶 הפרש קטן'    : '✅ זהה';
      return [
        String(r.custId||''), r.name, r.city, r.addr, r.custType,
        r.pbiOk?+r.pbiLat.toFixed(6):'', r.pbiOk?+r.pbiLng.toFixed(6):'', r.pbiOk?'✅':'❌',
        r.gLat?+r.gLat.toFixed(6):'', r.gLng?+r.gLng.toFixed(6):'',
        r.gDist!==null?r.gDist:'',
        r.ovLat?+r.ovLat.toFixed(6):'', r.ovLng?+r.ovLng.toFixed(6):'',
        r.ovDist!==null?r.ovDist:'',
        status,
      ];
    }),
  });
  cols.forEach((c,i)=>{ws.getColumn(i+1).width=c.w;});
  const h=ws.getRow(1); h.font={bold:true,color:{argb:'FFFFFFFF'}};
  h.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1565C0'}};
  results.forEach((r,i)=>{
    const row=ws.getRow(i+2);
    const fill = !r.pbiOk&&r.gOk ? GREEN : r.gDist>500 ? ORANGE : i%2===0?F1:F2;
    row.eachCell(c=>{c.fill=fill;});
  });

  // Summary sheet
  const ws2=wb.addWorksheet('סיכום');
  const total=results.length;
  const noGps=results.filter(r=>!r.pbiOk&&!r.gOk).length;
  const googleOnly=results.filter(r=>!r.pbiOk&&r.gOk).length;
  const bigDiff=results.filter(r=>r.pbiOk&&r.gOk&&r.gDist>500).length;
  const smallDiff=results.filter(r=>r.pbiOk&&r.gOk&&r.gDist>100&&r.gDist<=500).length;
  const same=results.filter(r=>r.pbiOk&&r.gOk&&r.gDist<=100).length;
  const ovFixed=results.filter(r=>r.ovLat).length;
  [
    ['סה"כ לקוחות',total],
    ['✅ GPS תואם (הפרש <100מ)',same],
    ['🔶 הפרש קטן (100-500מ)',smallDiff],
    ['⚠️ הפרש גדול (>500מ)',bigDiff],
    ['🆕 Google מצא, PBI ריק',googleOnly],
    ['❌ אין GPS בכלל',noGps],
    ['',''],
    ['OSM Overpass מצא ענפים',ovFixed],
  ].forEach(([k,v])=>ws2.addRow([k,v]));
  ws2.getColumn(1).width=30; ws2.getColumn(2).width=12;

  const out=`c:/Users/d.sverdlik/Desktop/WORKSPACE/COLUMBUS/geocode-compare-${new Date().toISOString().slice(0,10)}.xlsx`;
  await wb.xlsx.writeFile(out);
  console.log('Saved:',out);

  if(googleCacheDirty) fs.writeFileSync(GOOGLE_CACHE_PATH,JSON.stringify(googleCache,null,2));
  console.log('Google cache updated');

  // Print summary
  console.log('\n=== SUMMARY ===');
  console.log('Total:',total,'| Same:',same,'| SmallDiff:',smallDiff,'| BigDiff:',bigDiff,'| GoogleOnly:',googleOnly,'| NoGPS:',noGps);
  console.log('Overpass found branches:',ovFixed);
}

main().catch(e=>console.error('FATAL:',e.message));
