// Discover MLAY family codes for all חלבי products
// Run in GitHub Actions: node discover-halavi-families.js
// Output: family codes + product counts → use these as HALAVI_FAM_CODES in pbi-kapua.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getToken } = require('./pbi-kapua');

async function dax(t, query) {
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${process.env.PBI_WORKSPACE}/datasets/${process.env.PBI_DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
  );
  const j = await res.json();
  if (j.error) throw new Error('DAX: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

async function main() {
  const t = await getToken();

  // Known חלבי makats from MAHSAN חלבי/חלבי.xlsx — sample across all subfamilies
  const KNOWN_HALAVI = [
    // PRESIDENT
    '410000','410001','410002','410003','410004',
    '411000','411001','411500',
    '412200','412201','412202','412500','412501','412502',
    '413000','413001','413002','413200','413201','413202',
    '413500','413501','413502',
    // SVALIA חמאה
    '600','601','602',
    // SVALIA גורובט/תכתומ
    '615','616','617','628','643','644','645','646','655','656','657','658','659',
    // SVALIA גבינה/פרוסות
    '649','650','651','652','654','660','661','662','663','664','665','667','668',
    '669','670','671','672','673','674','675','677','678',
    // SVALIA סמטנה/קפיר/יוגורט
    '624','625','626','627','630','631',
    '1050','1052','1053','1060','1061','1062','1063','1064','1075','1076','1077',
    // SVALIA ברינזה
    '759','760',
    // ןילופ גבינה
    '680','681','683','684','685',
  ];

  const mkSet = '{' + KNOWN_HALAVI.map(m => `"${m}"`).join(',') + '}';

  console.log('=== MLAY family codes for חלבי products ===');
  const rows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      MLAY[משפחת מוצר],
      MLAY[תאור משפחה],
      FILTER(MLAY, CONTAINSROW(${mkSet}, MLAY[מק'ט])),
      "cnt", COUNTROWS(MLAY)
    )
    ORDER BY [cnt] DESC
  `);

  rows.forEach(r => {
    const code = r["MLAY[משפחת מוצר]"];
    const desc = r["MLAY[תאור משפחה]"];
    const cnt  = r["[cnt]"];
    console.log(`  '${code}':  // ${desc}  (${cnt} products)`);
  });

  console.log('\n=== All active חלבי products in these families ===');
  const famCodes = rows.map(r => `"${r["MLAY[משפחת מוצר]"]}"`).join(',');
  if (!famCodes) { console.log('No families found'); return; }

  const allRows = await dax(t, `
    EVALUATE
    FILTER(
      SUMMARIZECOLUMNS(
        MLAY[מק'ט],
        MLAY[תאור מוצר],
        MLAY[משפחת מוצר],
        MLAY[תאור משפחה],
        CALCULATETABLE(VALUES('KARTIS PARIT'[מק"ט]), 'KARTIS PARIT'[סטטוס]="פעיל")
      ),
      CONTAINSROW({${famCodes}}, MLAY[משפחת מוצר])
    )
    ORDER BY MLAY[משפחת מוצר], MLAY[מק'ט]
  `);

  const byFam = {};
  allRows.forEach(r => {
    const fam = r["MLAY[משפחת מוצר]"] + ' / ' + r["MLAY[תאור משפחה]"];
    if (!byFam[fam]) byFam[fam] = [];
    byFam[fam].push(r["MLAY[מק'ט]"] + ' ' + r["MLAY[תאור מוצר]"]);
  });
  Object.entries(byFam).forEach(([fam, prods]) => {
    console.log(`\n[${fam}] — ${prods.length} products`);
    prods.forEach(p => console.log('  ' + p));
  });

  console.log(`\nTotal active חלבי products in PBI: ${allRows.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
