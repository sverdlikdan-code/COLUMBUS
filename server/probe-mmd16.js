require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { executeDax } = require('./powerbi');
const MMD_DS = process.env.POWERBI_MMD_DATASET_ID;

async function probe() {
  const y1 = 2026, m1 = 5, y2 = 2026, m2 = 6;
  const lastDay2 = new Date(y2, m2, 0).getDate();
  const df = `DATESBETWEEN(DIMCALENDAR[Date], DATE(${y1},${m1},1), DATE(${y2},${m2},${lastDay2}))`;

  console.log(`=== CORRECT MEASURE NAMES — SKU 732, May-Jun 2026 ===\n`);
  try {
    const r = await executeDax(`
      EVALUATE
      FILTER(
        SUMMARIZECOLUMNS(
          'KARTIS PARIT'[מק"ט],
          "mkr_shvua",  CALCULATE([מכר ממוצע בשבוע קרטון], ${df}),
          "mkr_tk",     CALCULATE([מכר קרטון], ${df}),
          "shavuot",    [לכמה שבועות יספיק המלאי],
          "weeks_nf",   [WEEKS נפח הזמנה],
          "yamim_haya", CALCULATE([ימים שהיה בהם מלאי], ${df}),
          "yamim_mkr",  CALCULATE([ימים שהיה מכר], ${df}),
          "pct_mkr",    CALCULATE([ימי מכר מכלל ימי עבודה %], ${df}),
          "yamim_ok",   MIN('תוקף FORM'[כמה ימים נשארו]),
          "hamlatza",   CALCULATE([המלצה להזמנה קרטון], ${df})
        ),
        'KARTIS PARIT'[מק"ט] = "732"
      )
    `, MMD_DS);
    if (r[0]) {
      console.log('SKU 732 results:');
      Object.entries(r[0]).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} = ${v}`));
    } else {
      console.log('No result for SKU 732');
    }
  } catch(e) {
    const d = e.message.match(/"value":"([^"]{0,500})"/) || [];
    console.log('ERR:', (d[1] || e.message).substring(0, 500));
  }

  console.log('\n=== PBI expected values for 732 ===');
  console.log('  מכר קרטון בתקופה         = 310');
  console.log('  לכמה שבועות יספיק המלאי  = 2.14');
  console.log('  WEEKS לפח (נפח הזמנה)    = 4 (expected)');
  console.log('  ימים שהיה מלאי            = 28');
  console.log('  ימי מכר מכלל % מכר        = 90%');
  console.log('  כמה ימים נשארו            = 312');
}

probe().catch(e => console.error('FATAL:', e.message));
