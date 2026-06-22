require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  // Test כמה ימים נשארו without ASHDOD KAARTON filter (use measure filter)
  console.log('\n=== TEST כמה ימים נשארו ===');
  try {
    const r = await executeDax(`
      EVALUATE TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "yamim",  [כמה ימים נשארו],
          "mkr_tk", [מכר קרטון בתקופה]
        )
      )
    `, MMD_DS);
    console.log('OK:');
    r.forEach(row => {
      const mkt = row['KARTIS PARIT[מק"ט]'];
      const yamim = row['[yamim]'];
      const mkr = row['[mkr_tk]'];
      console.log(`  מקט ${mkt}: ימים=${yamim}, מכר_תקופה=${mkr}`);
    });
  } catch(e) { console.log('ERR:', e.message.substring(0, 400)); }

  // Test each measure individually
  console.log('\n=== TEST individual measures ===');
  const measures = [
    '[כמה ימים נשארו]',
    '[מכר קרטון בתקופה]',
    '[מלאי בקרטון EILAT]',
    '[מחסן מעבר]',
    '[מכר ממוצע בשבוע קרטון]',
    '[המלצה להזמנה קרטון]',
  ];
  for (const m of measures) {
    try {
      const r = await executeDax(`
        EVALUATE TOPN(2,
          SUMMARIZECOLUMNS(
            'KARTIS PARIT'[מק"ט],
            "v", ${m}
          )
        )
      `, MMD_DS);
      const vals = r.map(x => x['[v]']);
      console.log(`  ${m} OK: ${JSON.stringify(vals)}`);
    } catch(e) {
      const msg = e.message;
      const detail = msg.match(/"value":"([^"]{0,200})"/) || [];
      console.log(`  ${m} ERR: ${detail[1] || msg.substring(0,150)}`);
    }
  }

  // Check ASHDODמלאי זמין as column
  console.log('\n=== ASHDODמלאי זמין column ===');
  try {
    const r = await executeDax(`
      EVALUATE TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "ash_zmin", 'KARTIS PARIT'[ASHDODמלאי זמין]
        )
      )
    `, MMD_DS);
    r.forEach(row => console.log('  ', row['KARTIS PARIT[מק"ט]'], '=', row['[ash_zmin]']));
  } catch(e) { console.log('ERR:', e.message.substring(0, 300)); }
}

probe().catch(e => console.error('FATAL:', e.message));
