require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Test with correct column name מק"ט
  console.log('\n=== TEST כמה ימים נשארו + מכר קרטון בתקופה (correct col name) ===');
  try {
    const r = await executeDax(`
      EVALUATE TOPN(8,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          'KARTIS PARIT'[תאור],
          "yamim",   [כמה ימים נשארו],
          "mkr_tk",  [מכר קרטון בתקופה],
          "ash_zmin",'KARTIS PARIT'[ASHDODמלאי זמין],
          "ashdod_k",'KARTIS PARIT'[ASHDOD KAARTON]
        ),
        'KARTIS PARIT'[ASHDOD KAARTON] > 0
      )
    `, MMD_DS);
    console.log('OK:');
    r.forEach(row => {
      const mkt = row['KARTIS PARIT[מק"ט]'];
      const yamim = row['[yamim]'];
      const mkr = row['[mkr_tk]'];
      const ash_zmin = row['[ash_zmin]'];
      const ashdod_k = row['[ashdod_k]'];
      console.log(`  מקט ${mkt}: ימים=${yamim}, מכר=${mkr}, ASHDODזמין=${ash_zmin}, KAARTON=${ashdod_k}`);
    });
  } catch(e) { console.log('ERR:', e.message.substring(0, 500)); }

  // Try other stock measures
  console.log('\n=== TEST stock measures ===');
  for (const m of ['[מלאי בקרטון EILAT]', '[מחסן מעבר]', '[מכר ממוצע בשבוע קרטון]', '[המלצה להזמנה קרטון]']) {
    try {
      const r = await executeDax(`
        EVALUATE TOPN(2, SUMMARIZECOLUMNS('KARTIS PARIT'[מק"ט], "v", ${m}), 'KARTIS PARIT'[ASHDOD KAARTON] > 0)
      `, MMD_DS);
      console.log(`  ${m} OK:`, r.map(x => x['[v]']).join(', '));
    } catch(e) { console.log(`  ${m} ERR:`, e.message.substring(0, 120)); }
  }
}

probe().catch(e => console.error('FATAL:', e.message));
