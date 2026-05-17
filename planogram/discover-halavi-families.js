// Discover: KARTIS PARIT columns and family/section groupings for חלבי products
// Run in GitHub Actions: node discover-halavi-families.js
// Goal: find which column in KARTIS PARIT maps products to חלבי/קפוא/דגים sections
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

  // 1. All columns of KARTIS PARIT — sample row for known חלבי makat 665
  console.log('=== KARTIS PARIT — all columns for makat 665 (חלבי) ===');
  const sample = await dax(t, `EVALUATE FILTER(TOPN(1, 'KARTIS PARIT'), 'KARTIS PARIT'[מק"ט] = "665")`);
  if (sample.length) {
    Object.entries(sample[0]).forEach(([k, v]) => console.log(`  ${k} = ${v}`));
  } else {
    console.log('  makat 665 not found — trying TOPN(1)');
    const any = await dax(t, `EVALUATE TOPN(1, 'KARTIS PARIT')`);
    if (any.length) Object.entries(any[0]).forEach(([k, v]) => console.log(`  ${k} = ${v}`));
  }

  // 2. Known חלבי makats — sample for comparison
  console.log('\n=== KARTIS PARIT — makat 601 (SVALIA חמאה, קפוא) ===');
  const sampleKapua = await dax(t, `EVALUATE FILTER(TOPN(1, 'KARTIS PARIT'), 'KARTIS PARIT'[מק"ט] = "601")`);
  if (sampleKapua.length) {
    Object.entries(sampleKapua[0]).forEach(([k, v]) => console.log(`  ${k} = ${v}`));
  }

  // 3. Try common grouping columns: קבוצה, ענף, מחסן, קטגוריה, תחום, מדור
  const candidates = ['קבוצה', 'ענף', 'מחסן', 'קטגוריה', 'תחום', 'מדור', 'סוג', 'מחלקה'];
  for (const col of candidates) {
    try {
      const rows = await dax(t, `
        EVALUATE
        TOPN(3, SUMMARIZECOLUMNS('KARTIS PARIT'[${col}]), 'KARTIS PARIT'[${col}], ASC)
      `);
      if (rows.length) {
        console.log(`\n✅ Column [${col}] EXISTS — sample values:`, rows.map(r => r[`KARTIS PARIT[${col}]`]).join(', '));
      }
    } catch {}
  }

  // 4. Group known חלבי makats by all string columns to find the section discriminator
  const HALAVI_MAKATS = ['600','601','602','615','616','649','650','660','661','665','680','759'];
  const KAPUA_MAKATS  = ['029', '026']; // family codes — skip, use makats from KAPUA section
  const mkSet = '{' + HALAVI_MAKATS.map(m => `"${m}"`).join(',') + '}';

  console.log('\n=== Unique column values for known חלבי makats (looking for section discriminator) ===');
  // Try columns discovered in step 1
  const firstRow = sample[0] || sampleKapua[0] || {};
  const colNames = Object.keys(firstRow).map(k => k.replace(/^[^[]+\[/, '').replace(/\]$/, ''));

  for (const col of colNames) {
    try {
      const rows = await dax(t, `
        EVALUATE
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[${col}],
          FILTER('KARTIS PARIT', CONTAINSROW(${mkSet}, 'KARTIS PARIT'[מק"ט])),
          "cnt", COUNTROWS('KARTIS PARIT')
        )
      `);
      const vals = rows.map(r => `"${r[`KARTIS PARIT[${col}]`]}"(${r['[cnt]']})`).join(', ');
      if (rows.length <= 5) console.log(`  [${col}]: ${vals}`);
    } catch {}
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
