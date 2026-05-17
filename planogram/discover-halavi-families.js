// Discover: exact [תאור משפחה] values in KARTIS PARIT for all sections
// Run in GitHub Actions — output used to build HALAVI_FAM_NAMES filter
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

  // All unique [תאור משפחה] values in KARTIS PARIT — with count of active products
  console.log('=== All [תאור משפחה] values in KARTIS PARIT (פעיל only) ===');
  const rows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'KARTIS PARIT'[תאור משפחה],
      FILTER('KARTIS PARIT', 'KARTIS PARIT'[סטטוס] = "פעיל"),
      "cnt", COUNTROWS('KARTIS PARIT')
    )
    ORDER BY [cnt] DESC
  `);
  rows.forEach(r => {
    const fam = r["KARTIS PARIT[תאור משפחה]"];
    const cnt = r["[cnt]"];
    console.log(`  "${fam}"  (${cnt})`);
  });

  // Cross-check: known חלבי makats → show their [תאור משפחה]
  const KNOWN_HALAVI = ['600','601','602','615','616','617','624','625','626','627','628',
    '630','631','643','644','645','646','649','650','651','652','654','655','656','657',
    '658','659','660','661','662','663','664','665','667','668','669','670','671','672',
    '673','674','675','677','678','680','681','683','684','685','759','760',
    '1050','1052','1053','1060','1061','1062','1063','1064','1075','1076','1077'];
  const mkSet = '{' + KNOWN_HALAVI.map(m => `"${m}"`).join(',') + '}';

  console.log('\n=== [תאור משפחה] for known חלבי makats ===');
  const hRows = await dax(t, `
    EVALUATE
    SUMMARIZECOLUMNS(
      'KARTIS PARIT'[תאור משפחה],
      FILTER('KARTIS PARIT', CONTAINSROW(${mkSet}, 'KARTIS PARIT'[מק"ט])),
      "cnt", COUNTROWS('KARTIS PARIT'),
      "sample", FIRSTNONBLANK('KARTIS PARIT'[מק"ט], 1)
    )
    ORDER BY 'KARTIS PARIT'[תאור משפחה]
  `);
  hRows.forEach(r => {
    console.log(`  "${r["KARTIS PARIT[תאור משפחה]"]}"  cnt=${r["[cnt]"]}  e.g. ${r["[sample]"]}`);
  });
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
