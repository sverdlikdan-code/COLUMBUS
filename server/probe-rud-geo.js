require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

const IDS = [
  '1140127','1140011','1151156','1111069','1130012','1130922','1136630','1135315',
  '1150944','1136621','1136622','1140211','1153313','1111026','1111130','1111061',
  '1130253','1112034','1140012','1140118','1140129','1140019','1111081','1124079',
  '1130114','1132811','1162000','1164611','1135314','1163100','1147011','1147010',
];

const inList = IDS.map(id => `"${id}"`).join(',');

(async () => {
  const rows = await executeDax(`
EVALUATE
FILTER(
  SELECTCOLUMNS(
    'משטח',
    "id",      'משטח'[מס. לקוח],
    "name",    'משטח'[שם לקוח],
    "addr",    'משטח'[כתובת],
    "city",    'משטח'[עיר],
    "lat",     'משטח'[קו רוחב],
    "lng",     'משטח'[קו אורך]
  ),
  [id] IN { ${inList} }
)
ORDER BY [id] ASC
  `);

  console.log(`\nFound ${rows.length} clients:\n`);
  rows.forEach(r => {
    const id   = r['[id]'];
    const lat  = r['[lat]'];
    const lng  = r['[lng]'];
    const name = r['[name]'];
    const addr = r['[addr]'];
    const city = r['[city]'];
    const hasGeo = lat && lng ? '✅' : '❌ NO GEO';
    console.log(`${hasGeo}  ${id}  lat:${lat ?? 'null'}  lng:${lng ?? 'null'}  | ${name} | ${addr}, ${city}`);
  });

  const missing = IDS.filter(id => !rows.find(r => r['[id]'] == id));
  if (missing.length) console.log('\n⚠️  Not found in משטח:', missing.join(', '));
})();
