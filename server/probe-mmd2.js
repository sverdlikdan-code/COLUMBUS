require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  console.log('MMD DS:', MMD_DS);

  // Test measure כמה ימים נשארו and מכר קרטון בתקופה
  console.log('\n=== TEST: כמה ימים נשארו + מכר קרטון בתקופה ===');
  try {
    const r = await executeDax(`
      EVALUATE TOPN(5,
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מקט],
          'KARTIS PARIT'[תאור],
          "yamim", [כמה ימים נשארו],
          "mkr_tk", [מכר קרטון בתקופה]
        ),
        'KARTIS PARIT'[ASHDOD KAARTON] > 0
      )
    `, MMD_DS);
    console.log('OK:', JSON.stringify(r.slice(0,3), null, 2));
  } catch(e) { console.log('ERR:', e.message.substring(0,400)); }

  // Check all available columns in KARTIS PARIT
  console.log('\n=== KARTIS PARIT COLUMNS ===');
  try {
    const r = await executeDax(`EVALUATE TOPN(1, 'KARTIS PARIT')`, MMD_DS);
    if (r.length) Object.keys(r[0]).forEach(k => console.log('  ', k, '=', r[0][k]));
  } catch(e) { console.log('ERR:', e.message.substring(0,300)); }

  // INFO.MEASURES - look for relevant measures
  console.log('\n=== RELEVANT MEASURES ===');
  try {
    const rows = await executeDax(`
      EVALUATE
      SELECTCOLUMNS(
        INFO.MEASURES(),
        "T", [TableName],
        "N", [Name],
        "E", [Expression]
      )
    `, MMD_DS);
    const keywords = ['ימים','מכר','מלאי','ASHDOD','קרטון','MMD','EILAT','המלצה','תוקף','maavar'];
    rows.forEach(r => {
      const name = r['[N]'] || '';
      if (keywords.some(k => name.includes(k))) {
        console.log(`  [${r['[T]']}] ${name}`);
        const expr = r['[E]'] || '';
        if (expr) console.log(`    = ${expr.substring(0, 200)}`);
      }
    });
  } catch(e) { console.log('ERR INFO:', e.message.substring(0,300)); }
}

probe().catch(e => console.error('FATAL:', e.message));
