require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

// Clients from regen-maps.js with NO GPS in PBI
const NO_GPS = [
  { id:'1111026', addr:'שבט לוי 12',          city:'אשדוד' },
  { id:'1111061', addr:'הבושם 7',              city:'אשדוד' },
  { id:'1111069', addr:'הרצל',                 city:'אשדוד' },
  { id:'1111081', addr:'שמוטקין 30',           city:'ראשון לציון' },
  { id:'1111130', addr:'האגס 4',               city:'אשדוד' },
  { id:'1130922', addr:'מנחם בגין',            city:'אשדוד' },
  { id:'1135314', addr:'רוטשילד 76',           city:'ראשון לציון' },
  { id:'1136630', addr:'אריק אינשטיין 4',      city:'אשדוד' },
  { id:'1140011', addr:'ז\'יבוטינסקי',         city:'אשדוד' },
  { id:'1150944', addr:'הציונות 41',           city:'אשדוד' },
  { id:'1151156', addr:'דוד המלך 20',          city:'אשדוד' },
  { id:'1153313', addr:'הנביאים 34',           city:'אשדוד' },
];

function normalize(s) {
  return (s || '').replace(/["‪‬]/g, '').trim();
}

function addrMatch(pbiAddr, targetAddr) {
  const a = normalize(pbiAddr).toLowerCase();
  const t = normalize(targetAddr).toLowerCase();
  // extract street name (first word/words) and number
  const streetWords = t.replace(/\d+/g, '').trim();
  if (!streetWords) return false;
  return a.includes(streetWords) || streetWords.split(' ').some(w => w.length > 2 && a.includes(w));
}

(async () => {
  console.log('Loading all PBI clients with GPS in אשדוד + ראשון לציון...\n');

  const rows = await executeDax(`
EVALUATE
FILTER(
  SELECTCOLUMNS(
    'משטח',
    "id",   'משטח'[מס. לקוח],
    "name", 'משטח'[שם לקוח],
    "addr", 'משטח'[כתובת],
    "city", 'משטח'[עיר],
    "lat",  'משטח'[קו רוחב],
    "lng",  'משטח'[קו אורך]
  ),
  AND(
    OR([city] = "אשדוד", [city] = "ראשון לציון"),
    AND([lat] <> 0, [lng] <> 0)
  )
)
  `);

  console.log(`Found ${rows.length} clients with GPS\n`);
  console.log('='.repeat(70));

  for (const target of NO_GPS) {
    const matches = rows.filter(r =>
      normalize(r['[city]']) === target.city &&
      addrMatch(r['[addr]'], target.addr)
    );

    if (matches.length) {
      console.log(`\n✅ ${target.id} (${target.addr}, ${target.city})`);
      matches.forEach(m => {
        const lat = m['[lat]'];
        const lng = m['[lng]'];
        const id  = m['[id]'];
        const addr = normalize(m['[addr]']);
        console.log(`   → ${id}  lat:${lat}  lng:${lng}  | ${addr}`);
      });
    } else {
      console.log(`\n❌ ${target.id} (${target.addr}, ${target.city}) — no match`);
    }
  }
})();
