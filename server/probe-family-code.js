require('dotenv').config({ path: '../.env' });
const { executeDax } = require('./powerbi');

(async () => {
  console.log('=== ADIFUT sample row (all columns) ===');
  try {
    const rows = await executeDax(`EVALUATE TOPN(3, ADIFUT)`);
    rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 400)); }

  console.log('\n=== ADIFUT rows matching on משפחת מוצר (clean text field) ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      FILTER(
        ADIFUT,
        ADIFUT[משפחת מוצר] = "גבינה SVALIA" ||
        ADIFUT[משפחת מוצר] = "דגים KAZAHSTAN" ||
        ADIFUT[משפחת מוצר] = "דגים RUSSIA"
      )
    `);
    rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 400)); }

  console.log('\n=== ALL_PARTS -> ADIFUT[N משפחה] for our 3 families + PRESIDENT SKUs ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      ADDCOLUMNS(
        SUMMARIZE(ALL_PARTS, ALL_PARTS[תאור משפחת מוצר]),
        "N_mishpacha", LOOKUPVALUE(ADIFUT[N משפחה], ADIFUT[משפחת מוצר], ALL_PARTS[תאור משפחת מוצר])
      )
    `);
    rows.filter(r => ['גבינה SVALIA','דגים KAZAHSTAN','דגים RUSSIA'].includes(r["ALL_PARTS[תאור משפחת מוצר]"]))
        .forEach(r => console.log(JSON.stringify(r)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 400)); }

  console.log('\n=== PRESIDENT SKUs 413000-413002 -> family + N משפחה ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      ADDCOLUMNS(
        FILTER(
          SUMMARIZE(ALL_PARTS, ALL_PARTS[מק'ט], ALL_PARTS[תאור משפחת מוצר]),
          ALL_PARTS[מק'ט] = "413000" || ALL_PARTS[מק'ט] = "413001" || ALL_PARTS[מק'ט] = "413002"
        ),
        "N_mishpacha", LOOKUPVALUE(ADIFUT[N משפחה], ADIFUT[משפחת מוצר], ALL_PARTS[תאור משפחת מוצר])
      )
    `);
    rows.forEach(r => console.log(JSON.stringify(r)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 400)); }

  console.log("\n=== 'KARTIS PARIT' sample row (all columns) ===");
  try {
    const rows = await executeDax(`EVALUATE TOPN(3, 'KARTIS PARIT')`);
    rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 400)); }

  console.log("\n=== 'KARTIS PARIT' rows for our 664/721/413000-2 SKUs ===");
  try {
    const rows = await executeDax(`
      EVALUATE
      FILTER(
        'KARTIS PARIT',
        'KARTIS PARIT'[מק"ט] = "664" || 'KARTIS PARIT'[מק"ט] = "721" ||
        'KARTIS PARIT'[מק"ט] = "413000" || 'KARTIS PARIT'[מק"ט] = "413001" || 'KARTIS PARIT'[מק"ט] = "413002"
      )
    `);
    rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
  } catch (e) { console.log('ERROR:', e.message.slice(0, 400)); }
})();
