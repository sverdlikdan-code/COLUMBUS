// Discover: KARTIS PARIT columns + dagim names
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getToken } = require('./pbi-kapua');

async function dax(t, query) {
  const WORKSPACE = process.env.PBI_WORKSPACE;
  const DATASET   = process.env.PBI_DATASET;
  const res = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE}/datasets/${DATASET}/executeQueries`,
    { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }) }
  );
  const j = await res.json();
  if (j.error) throw new Error('DAX error: ' + JSON.stringify(j.error));
  return j.results?.[0]?.tables?.[0]?.rows || [];
}

async function main() {
  const t = await getToken();

  // 1. Get a sample row from KARTIS PARIT to see all columns
  console.log('\n=== KARTIS PARIT sample row (all columns) ===');
  const sample = await dax(t, `EVALUATE TOPN(1, 'KARTIS PARIT')`);
  if (sample.length) {
    const cols = Object.keys(sample[0]);
    cols.forEach(c => console.log(' ', c, '=', sample[0][c]));
  }

  // 2. Find columns in KARTIS PARIT that contain "מדף" or "shelf"
  console.log('\n=== Columns with מדף/shelf in KARTIS PARIT ===');
  if (sample.length) {
    const cols = Object.keys(sample[0]).filter(c =>
      c.includes('מדף') || c.toLowerCase().includes('shelf') || c.includes('חי')
    );
    cols.forEach(c => console.log(' ', c));
  }

  // 3. Check if dagim products exist in MLAY
  console.log('\n=== MLAY check for dagim makats ===');
  const mlayRows = await dax(t, `
    EVALUATE
    FILTER(
      SELECTCOLUMNS(MLAY, "mk", MLAY[מק'ט], "name", MLAY[תאור מוצר], "fam", MLAY[משפחת מוצר]),
      CONTAINSROW({"403007","403008","403004","1017","1018","1015","1166","1167"}, [mk])
    )
  `);
  if (mlayRows.length) {
    mlayRows.forEach(r => console.log(' ', r['[mk]'], r['[name]'], r['[fam]']));
  } else {
    console.log('  NOT FOUND in MLAY — dagim makats not in MLAY table');
  }

  // 4. Check if dagim products exist in KARTIS PARIT
  console.log('\n=== KARTIS PARIT check for dagim makats ===');
  const kpRows = await dax(t, `
    EVALUATE
    FILTER(
      SELECTCOLUMNS('KARTIS PARIT', "mk", 'KARTIS PARIT'[מק"ט], "desc", 'KARTIS PARIT'[תאור]),
      CONTAINSROW({"403007","403008","403004","1017","1018","1015"}, [mk])
    )
  `);
  if (kpRows.length) {
    kpRows.forEach(r => console.log(' ', r['[mk]'], r['[desc]']));
  } else {
    console.log('  NOT FOUND in KARTIS PARIT');
  }
}

main().catch(console.error);
